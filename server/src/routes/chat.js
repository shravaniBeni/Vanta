import { Router } from 'express';
import { client } from '../db.js';
import { invokeLLM } from '../openai.js';
import { retrieveChunks } from '../vectorStore.js';
import { DEFAULT_CHAT_MODEL } from '../openai.js';

const router = Router();

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─── Main RAG chat endpoint ───────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const result = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [chatbot_id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Chatbot not found' });

    const chatbot = result.rows[0];
    const nodes = safeJson(chatbot.nodes, []);
    const llmNode = nodes.find(n => n.type === 'LLM');
    const model = llmNode?.params?.model || DEFAULT_CHAT_MODEL;
    const temperature = llmNode?.params?.temperature ?? 0.7;

    // ── Retrieve ──────────────────────────────────────────────────────────────
    const chunks = await retrieveChunks(chatbot_id, query, 5);
    const similarityScores = chunks.map(c => c.score);
    const retrievedTexts = chunks.map(c => c.content);
    const chunkPreviews = retrievedTexts.map(c => c.substring(0, 120) + (c.length > 120 ? '...' : ''));

    // ── Build prompt ──────────────────────────────────────────────────────────
    let prompt;
    if (chunks.length > 0) {
      const context = chunks.map((c, i) => `[Source ${i + 1}]\n${c.content}`).join('\n\n---\n\n');
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

    // ── Generate ──────────────────────────────────────────────────────────────
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

    res.json({ answer, telemetry, retrievedChunks: chunkPreviews, similarityScores, avgSimilarity });
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Workflow preview / test mode ─────────────────────────────────────────────

router.post('/preview', async (req, res) => {
  const { chatbot_id, query } = req.body;
  if (!chatbot_id || !query) {
    return res.status(400).json({ error: 'chatbot_id and query are required' });
  }

  try {
    const result = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [chatbot_id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Chatbot not found' });

    const chatbot = result.rows[0];
    const nodes = safeJson(chatbot.nodes, []);
    const nodesList = nodes.map(n => `- ${n.type}: ${n.label}`).join('\n');
    const uploadedDocs = nodes
      .filter(n => n.type === 'DocumentUpload' && n.params?.uploaded_files?.length)
      .flatMap(n => safeJson(n.params?.uploaded_files, []).map(f => f.name));

    const answer = await invokeLLM(
      `You are a RAG chatbot named "${chatbot.title}". ${chatbot.description || ''}
Workflow nodes: ${nodesList}${uploadedDocs.length ? `\nUploaded docs: ${uploadedDocs.join(', ')}` : ''}
This is PREVIEW mode. Simulate a realistic response. If no docs uploaded, say so.
User: ${query}`,
      'gpt-3.5-turbo',
      0.7
    );

    res.json({ answer });
  } catch (err) {
    console.error('[chat/preview]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
