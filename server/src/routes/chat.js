/**
 * server/src/routes/chat.js
 *
 * Phase 8 stabilization: unified runtime configuration.
 *
 * POST /api/chat         — RAG chat (public embed OR authenticated)
 * POST /api/chat/preview — authenticated preview with real RAG
 *
 * Both paths now use resolveRagRuntimeConfig() to read top_k, temperature,
 * grounding_required, and response_style from the persisted workflow nodes.
 * This ensures architect_plan == workflow == runtime for all paths.
 *
 * Neighbor expansion is applied for structure-aware/recursive workflows
 * to improve retrieval completeness for broad procedural queries.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { invokeLLM } from '../openai.js';
import { retrieveChunks, expandWithNeighbors } from '../vectorStore.js';
import { DEFAULT_CHAT_MODEL } from '../openai.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRagRuntimeConfig } from '../ragRuntimeConfig.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(val, fallback) {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

async function tryGetUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    const { data } = await supabase.auth.getUser(token);
    return data?.user ? { id: data.user.id } : null;
  } catch {
    return null;
  }
}

async function getRagAppById(id) {
  const { data, error } = await supabase
    .from('rag_apps')
    .select('id, user_id, title, description, status, nodes, connections')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  // Parse JSONB nodes
  data.nodes = safeJson(data.nodes, []);
  return data;
}

async function getRagAppByEmbedId(embedId) {
  const { data, error } = await supabase
    .from('rag_apps')
    .select('id, title, description, status, nodes, connections')
    .eq('embed_id', embedId)
    .single();
  if (error || !data) return null;
  data.nodes = safeJson(data.nodes, []);
  return data;
}

async function persistMessages({
  ragAppId, userId, sessionId,
  userQuery, assistantAnswer, confidence, retrievedChunkIds,
}) {
  try {
    await supabase.from('messages').insert([
      {
        id: uuidv4(), user_id: userId, rag_app_id: ragAppId,
        session_id: sessionId, role: 'user', content: userQuery,
      },
      {
        id: uuidv4(), user_id: userId, rag_app_id: ragAppId,
        session_id: sessionId, role: 'assistant', content: assistantAnswer,
        confidence: confidence ?? null,
        retrieved_chunk_ids: retrievedChunkIds?.length ? retrievedChunkIds : null,
      },
    ]);
  } catch (err) {
    console.warn('[chat] message persistence error:', err.message);
  }
}

/**
 * Detect whether neighbor expansion should be applied.
 * Only benefits structure-aware and recursive workflows.
 * Checks the TextSplitter node's strategy param.
 */
function shouldExpandNeighbors(nodes) {
  const splitter = nodes.find(n => n.type === 'TextSplitter');
  const strategy = splitter?.params?.strategy;
  return strategy === 'structure-aware' || strategy === 'recursive';
}

/**
 * Build a grounded RAG prompt using the runtime configuration.
 *
 * @param {{
 *   title: string,
 *   description: string,
 *   grounding_required: boolean,
 *   response_style: string,
 *   chunks: Array<{content: string}>,
 *   query: string,
 *   isPreview: boolean,
 * }} params
 * @returns {string}
 */
function buildRagPrompt({ title, description, grounding_required, response_style, chunks, query, isPreview = false }) {
  const previewNote = isPreview ? ' (preview mode)' : '';

  // ── Response style instruction ─────────────────────────────────────────────
  let styleInstruction = '';
  if (response_style) {
    const style = response_style.toLowerCase();
    if (style.includes('concise') || style.includes('factual')) {
      styleInstruction = 'Respond concisely and factually. Avoid unnecessary elaboration.';
    } else if (style.includes('step-by-step')) {
      styleInstruction = 'Respond with clear step-by-step structure. Number each step.';
    } else if (style.includes('detailed')) {
      styleInstruction = 'Provide a detailed, comprehensive response covering all relevant aspects.';
    } else if (style.includes('conversational')) {
      styleInstruction = 'Respond in a natural, conversational tone.';
    } else {
      styleInstruction = `Response style: ${response_style}.`;
    }
  }

  if (chunks.length === 0) {
    return `You are "${title}", an AI assistant${previewNote}.
${description ? `About you: ${description}\n` : ''}No documents have been indexed yet. Inform the user politely and suggest uploading and indexing documents.

User: ${query}
Answer:`;
  }

  const contextText = chunks
    .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
    .join('\n\n---\n\n');

  if (grounding_required) {
    // Strict grounding: only answer from retrieved context
    return `You are "${title}", an AI assistant${previewNote}.
${description ? `About you: ${description}\n` : ''}${styleInstruction ? styleInstruction + '\n' : ''}
IMPORTANT: Answer ONLY using the provided context below. Do NOT use any knowledge outside this context.
If the retrieved context addresses the question, answer completely and accurately using it.
If the context is partially relevant, provide what you can from the context and clearly state what is not covered.
If the context does not address the question at all, state: "The available knowledge base does not contain information about this topic."
Do NOT fabricate information. Do NOT invent document-specific facts, procedures, thresholds, or specifications.
Preserve all safety warnings, caution notices, and numeric thresholds exactly as stated in the context.
Do not tell the user to consult the source if the requested information is already present in the context below.

Context:
${contextText}

User: ${query}
Answer:`;
  } else {
    // Flexible grounding: context-first but general knowledge allowed
    return `You are "${title}", an AI assistant${previewNote}.
${description ? `About you: ${description}\n` : ''}${styleInstruction ? styleInstruction + '\n' : ''}
Use the following retrieved context as your primary source. Supplement with general knowledge only for non-document-specific facts.
Preserve all safety warnings, caution notices, and numeric thresholds exactly as stated in the context.
Do not tell the user to consult the source if the requested information is already present in the context below.

Context:
${contextText}

User: ${query}
Answer:`;
  }
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { chatbot_id, embed_id, query, session_id } = req.body;

  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!chatbot_id && !embed_id) {
    return res.status(400).json({ error: 'chatbot_id or embed_id is required' });
  }

  try {
    let chatbot;
    let userId = null;

    if (embed_id) {
      chatbot = await getRagAppByEmbedId(embed_id);
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
      if (chatbot.status !== 'deployed') {
        return res.status(403).json({ error: 'Chatbot is not deployed' });
      }
    } else {
      chatbot = await getRagAppById(chatbot_id);
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
      const user = await tryGetUser(req);
      if (user) {
        userId = user.id;
      } else {
        if (chatbot.status !== 'deployed') {
          return res.status(403).json({ error: 'Chatbot is not deployed' });
        }
      }
    }

    const sessionId = session_id || uuidv4();

    // ── Resolve runtime config from persisted workflow ─────────────────────
    const cfg = resolveRagRuntimeConfig(chatbot);
    const { top_k, model, temperature, grounding_required, response_style } = cfg;

    // ── Retrieve via pgvector ─────────────────────────────────────────────
    let chunks = [];
    try {
      const primary = await retrieveChunks(chatbot.id, query, top_k);

      // Apply neighbor expansion for structure-aware/recursive workflows
      if (shouldExpandNeighbors(chatbot.nodes)) {
        chunks = await expandWithNeighbors(chatbot.id, primary, 3);
      } else {
        chunks = primary;
      }
    } catch (err) {
      console.warn('[chat] retrieval error:', err.message);
    }

    const similarityScores  = chunks.filter(c => !c.is_expansion).map(c => c.score);
    const retrievedChunkIds = chunks.map(c => c.id).filter(Boolean);
    const avgSimilarity = similarityScores.length
      ? similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
      : 0;
    const chunkPreviews = chunks.map(c =>
      c.content.substring(0, 120) + (c.content.length > 120 ? '...' : '')
    );

    // ── Build prompt ──────────────────────────────────────────────────────
    const prompt = buildRagPrompt({
      title: chatbot.title,
      description: chatbot.description,
      grounding_required,
      response_style,
      chunks,
      query,
      isPreview: false,
    });

    // ── Generate ──────────────────────────────────────────────────────────
    const answer = await invokeLLM(prompt, model, temperature);

    // ── Persist ───────────────────────────────────────────────────────────
    await persistMessages({
      ragAppId: chatbot.id, userId, sessionId,
      userQuery: query, assistantAnswer: answer,
      confidence: avgSimilarity, retrievedChunkIds,
    });

    res.json({
      answer,
      telemetry: {
        timestamp: new Date().toISOString(), query,
        llmResponse: answer, similarityScores, avgSimilarity,
        retrievedChunks: chunks.map(c => c.content),
        chunkPreviews,
        configUsed: { model, topK: top_k, grounding_required, response_style },
      },
      retrievedChunks: chunkPreviews,
      similarityScores,
      avgSimilarity,
      session_id: sessionId,
    });
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chat/preview ───────────────────────────────────────────────────

router.post('/preview', requireAuth, async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const chatbot = await getRagAppById(chatbot_id);
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    if (chatbot.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    // ── Resolve runtime config from persisted workflow ─────────────────────
    const cfg = resolveRagRuntimeConfig(chatbot);
    const { top_k, model, temperature, grounding_required, response_style } = cfg;

    // ── Retrieve via pgvector ─────────────────────────────────────────────
    let chunks = [];
    try {
      const primary = await retrieveChunks(chatbot.id, query, top_k);

      // Apply neighbor expansion for structure-aware/recursive workflows
      if (shouldExpandNeighbors(chatbot.nodes)) {
        chunks = await expandWithNeighbors(chatbot.id, primary, 3);
      } else {
        chunks = primary;
      }
    } catch (retrieveErr) {
      console.warn('[chat/preview] retrieval error:', retrieveErr.message);
    }

    const similarityScores = chunks.filter(c => !c.is_expansion).map(c => c.score);
    const retrievedTexts   = chunks.map(c => c.content);
    const chunkPreviews    = retrievedTexts.map(c =>
      c.substring(0, 120) + (c.length > 120 ? '...' : '')
    );
    const avgSimilarity = similarityScores.length
      ? similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
      : 0;

    // ── Build prompt ──────────────────────────────────────────────────────
    const prompt = buildRagPrompt({
      title: chatbot.title,
      description: chatbot.description,
      grounding_required,
      response_style,
      chunks,
      query,
      isPreview: true,
    });

    const answer = await invokeLLM(prompt, model, temperature);

    res.json({
      answer,
      retrievedChunks: chunkPreviews,
      similarityScores,
      avgSimilarity,
      telemetry: {
        timestamp:       new Date().toISOString(),
        query,
        llmResponse:     answer,
        similarityScores,
        avgSimilarity,
        retrievedChunks: retrievedTexts,
        chunkPreviews,
        configUsed:      { model, topK: top_k, grounding_required, response_style },
      },
    });
  } catch (err) {
    console.error('[chat/preview]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
