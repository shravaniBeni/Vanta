/**
 * server/src/routes/chat.js
 *
 * Phase 4 update:
 *   - retrieveChunks() now uses pgvector via Supabase (was SQLite cosine sim)
 *   - chatbot lookup uses Supabase rag_apps (was SQLite chatbots table)
 *   - Messages still written to SQLite (migrated in Phase 5)
 *   - /api/chat remains public (no auth required) for deployed widget support
 *
 * Temporary persistence split:
 *   chatbot lookup  → Supabase rag_apps          ✅
 *   vector retrieval → Supabase pgvector          ✅
 *   message storage → SQLite chat_messages        (Phase 5)
 */

import { Router } from 'express';
import { client } from '../db.js';
import supabase from '../supabase.js';
import { invokeLLM } from '../openai.js';
import { retrieveChunks } from '../vectorStore.js';
import { DEFAULT_CHAT_MODEL } from '../openai.js';

const router = Router();

function safeJson(val, fallback) {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ─── Fetch chatbot from Supabase ──────────────────────────────────────────────
// Used by both POST / and POST /preview.
// For the deployed embed path, we look up by chatbot_id (UUID).
// The Chat.jsx page first fetches by embed_id via GET /api/chatbots?embed_id=,
// then sends the resolved UUID as chatbot_id in POST /api/chat.

async function getChatbotById(chatbotId) {
  const { data, error } = await supabase
    .from('rag_apps')
    .select('id, title, description, status, nodes, connections')
    .eq('id', chatbotId)
    .single();

  if (error || !data) return null;
  return data;
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const chatbot = await getChatbotById(chatbot_id);
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    const nodes = safeJson(chatbot.nodes, []);
    const llmNode = nodes.find(n => n.type === 'LLM');
    const model       = llmNode?.params?.model       || DEFAULT_CHAT_MODEL;
    const temperature = llmNode?.params?.temperature ?? 0.7;

    // ── Retrieve via pgvector ──────────────────────────────────────────────
    let chunks = [];
    try {
      chunks = await retrieveChunks(chatbot_id, query, 5);
    } catch (retrieveErr) {
      // Retrieval failure is non-fatal — answer without context
      console.warn('[chat] retrieval error:', retrieveErr.message);
    }

    const similarityScores = chunks.map(c => c.score);
    const retrievedTexts   = chunks.map(c => c.content);
    const chunkPreviews    = retrievedTexts.map(c =>
      c.substring(0, 120) + (c.length > 120 ? '...' : '')
    );

    // ── Build prompt ──────────────────────────────────────────────────────
    let prompt;
    if (chunks.length > 0) {
      const context = chunks
        .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
        .join('\n\n---\n\n');
      prompt = `You are "${chatbot.title}", an AI assistant.
${chatbot.description ? `About you: ${chatbot.description}\n` : ''}
Use the following context to answer the user's question accurately and concisely.
If the context doesn't fully address the question, say so honestly.

Context:
${context}

User: ${query}
Answer:`;
    } else {
      prompt = `You are "${chatbot.title}", an AI assistant.
${chatbot.description ? chatbot.description + '\n' : ''}
No documents have been indexed yet for this chatbot. Inform the user politely and suggest they upload documents using the workflow editor.

User: ${query}
Answer:`;
    }

    // ── Generate ──────────────────────────────────────────────────────────
    const answer = await invokeLLM(prompt, model, temperature);

    const avgSimilarity = similarityScores.length
      ? similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
      : 0;

    const telemetry = {
      timestamp: new Date().toISOString(),
      query,
      llmResponse: answer,
      similarityScores,
      avgSimilarity,
      retrievedChunks: retrievedTexts,
      chunkPreviews,
      configUsed: { model, topK: 5 },
    };

    // ── Persist messages to SQLite (Phase 5 will migrate this) ────────────
    try {
      const { v4: uuidv4 } = await import('uuid');
      await client.execute({
        sql: `INSERT INTO chat_messages (id, chatbot_id, role, content) VALUES (?, ?, 'user', ?)`,
        args: [uuidv4(), chatbot_id, query],
      });
      await client.execute({
        sql: `INSERT INTO chat_messages (id, chatbot_id, role, content, confidence) VALUES (?, ?, 'assistant', ?, ?)`,
        args: [uuidv4(), chatbot_id, answer, avgSimilarity],
      });
    } catch (msgErr) {
      // Message persistence is non-fatal — don't fail the chat response
      console.warn('[chat] message persistence error:', msgErr.message);
    }

    res.json({ answer, telemetry, retrievedChunks: chunkPreviews, similarityScores, avgSimilarity });
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chat/preview ───────────────────────────────────────────────────
// LLM-only preview used by the editor's WorkflowPreview panel.
// No retrieval. No message persistence.

router.post('/preview', async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const chatbot = await getChatbotById(chatbot_id);
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    const nodes = safeJson(chatbot.nodes, []);
    const nodesList = nodes.map(n => `- ${n.type}: ${n.label}`).join('\n');
    const uploadedDocs = nodes
      .filter(n => n.type === 'DocumentUpload' && n.params?.uploaded_files?.length)
      .flatMap(n => (n.params.uploaded_files || []).map(f => f.name));

    const answer = await invokeLLM(
      `You are a RAG chatbot named "${chatbot.title}". ${chatbot.description || ''}
Workflow nodes:\n${nodesList}${uploadedDocs.length ? `\nUploaded docs: ${uploadedDocs.join(', ')}` : ''}
This is PREVIEW mode. Simulate a realistic response. If no docs uploaded, say so.
User: ${query}`,
      DEFAULT_CHAT_MODEL,
      0.7
    );

    res.json({ answer });
  } catch (err) {
    console.error('[chat/preview]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
