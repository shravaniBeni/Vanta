/**
 * server/src/routes/chat.js
 *
 * Phase 5: All persistence migrated to Supabase. No SQLite.
 *
 * POST /api/chat         — RAG chat (public embed OR authenticated)
 * POST /api/chat/preview — LLM-only preview (temporarily public — see note)
 *
 * ── Auth model ────────────────────────────────────────────────────────────
 * /api/chat has no requireAuth middleware (index.js mounts it as public).
 * Instead, tryGetUser() optionally extracts the JWT if present.
 *
 * embed_id path  → always public, must be deployed, user_id = NULL
 * chatbot_id path with JWT → userId set, deployed check skipped
 * chatbot_id path without JWT → treated as public, must be deployed
 *
 * ── /api/chat/preview — TEMPORARY SECURITY EXCEPTION ────────────────────
 * Preview is used by the editor's WorkflowPreview panel. The frontend does
 * not yet send a JWT (frontend auth not implemented until Phase 6).
 * Preview remains public until Phase 6. No messages are persisted.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { invokeLLM } from '../openai.js';
import { retrieveChunks } from '../vectorStore.js';
import { DEFAULT_CHAT_MODEL } from '../openai.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(val, fallback) {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Optionally extract the authenticated user from the Authorization header.
 * Does NOT reject unauthenticated requests — returns null if no valid JWT.
 * /api/chat is mounted without requireAuth so we must do this ourselves.
 */
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
    .select('id, title, description, status, nodes, connections')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data;
}

async function getRagAppByEmbedId(embedId) {
  const { data, error } = await supabase
    .from('rag_apps')
    .select('id, title, description, status, nodes, connections')
    .eq('embed_id', embedId)
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * Persist a user + assistant message pair to Supabase.
 * userId may be null for public embed sessions.
 * Non-fatal — logs but does not throw.
 */
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
      // ── Public embed path — must be deployed ──────────────────────────────
      chatbot = await getRagAppByEmbedId(embed_id);
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
      if (chatbot.status !== 'deployed') {
        return res.status(403).json({ error: 'Chatbot is not deployed' });
      }
      // userId stays null
    } else {
      // ── Direct chatbot_id path ────────────────────────────────────────────
      chatbot = await getRagAppById(chatbot_id);
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

      // Optionally resolve user from JWT — does not block unauthenticated requests
      const user = await tryGetUser(req);
      if (user) {
        userId = user.id;  // Authenticated — set user_id on messages
      } else {
        // Unauthenticated — treat as public, must be deployed
        if (chatbot.status !== 'deployed') {
          return res.status(403).json({ error: 'Chatbot is not deployed' });
        }
      }
    }

    const sessionId = session_id || uuidv4();

    // ── Workflow config ───────────────────────────────────────────────────────
    const nodes       = safeJson(chatbot.nodes, []);
    const llmNode     = nodes.find(n => n.type === 'LLM');
    const model       = llmNode?.params?.model       || DEFAULT_CHAT_MODEL;
    const temperature = llmNode?.params?.temperature ?? 0.7;

    // ── Retrieve via pgvector ─────────────────────────────────────────────────
    let chunks = [];
    try {
      chunks = await retrieveChunks(chatbot.id, query, 5);
    } catch (err) {
      console.warn('[chat] retrieval error:', err.message);
    }

    const similarityScores  = chunks.map(c => c.score);
    const retrievedChunkIds = chunks.map(c => c.id).filter(Boolean);
    const retrievedTexts    = chunks.map(c => c.content);
    const chunkPreviews     = retrievedTexts.map(c =>
      c.substring(0, 120) + (c.length > 120 ? '...' : '')
    );
    const avgSimilarity = similarityScores.length
      ? similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
      : 0;

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = chunks.length > 0
      ? `You are "${chatbot.title}", an AI assistant.
${chatbot.description ? `About you: ${chatbot.description}\n` : ''}Use the following context to answer accurately and concisely.
If the context doesn't fully address the question, say so.

Context:
${chunks.map((c, i) => `[Source ${i + 1}]\n${c.content}`).join('\n\n---\n\n')}

User: ${query}
Answer:`
      : `You are "${chatbot.title}", an AI assistant.
${chatbot.description ? chatbot.description + '\n' : ''}No documents have been indexed yet. Inform the user politely and suggest uploading documents.

User: ${query}
Answer:`;

    // ── Generate ──────────────────────────────────────────────────────────────
    const answer = await invokeLLM(prompt, model, temperature);

    // ── Persist to Supabase ───────────────────────────────────────────────────
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
        retrievedChunks: retrievedTexts, chunkPreviews,
        configUsed: { model, topK: 5 },
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
// TEMPORARY SECURITY EXCEPTION — remains public until Phase 6 frontend auth.
// No message persistence on preview requests.

router.post('/preview', async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const chatbot = await getRagAppById(chatbot_id);
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    const nodes        = safeJson(chatbot.nodes, []);
    const nodesList    = nodes.map(n => `- ${n.type}: ${n.label}`).join('\n');
    const uploadedDocs = nodes
      .filter(n => n.type === 'DocumentUpload' && n.params?.uploaded_files?.length)
      .flatMap(n => (n.params.uploaded_files || []).map(f => f.name));

    const answer = await invokeLLM(
      `You are a RAG chatbot named "${chatbot.title}". ${chatbot.description || ''}
Workflow nodes:\n${nodesList}${uploadedDocs.length ? `\nUploaded docs: ${uploadedDocs.join(', ')}` : ''}
PREVIEW MODE. Simulate a realistic response. If no docs uploaded, say so.
User: ${query}`,
      DEFAULT_CHAT_MODEL, 0.7
    );

    res.json({ answer });
  } catch (err) {
    console.error('[chat/preview]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
