/**
 * Vector store using cosine similarity on SQLite-persisted embeddings.
 * Uses @libsql/client for all DB operations.
 */

import { client } from './db.js';
import { embedText } from './openai.js';
import { v4 as uuidv4 } from 'uuid';

function cosineSim(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function retrieveChunks(chatbotId, query, topK = 5) {
  const result = await client.execute({
    sql: 'SELECT id, content, file_name, embedding FROM document_chunks WHERE chatbot_id = ?',
    args: [chatbotId],
  });

  if (!result.rows.length) return [];

  let queryEmb;
  try {
    queryEmb = await embedText(query);
  } catch (err) {
    console.error('[vectorStore] embedding error:', err.message);
    return [];
  }

  const scored = result.rows
    .filter(r => r.embedding)
    .map(r => {
      let emb;
      try { emb = JSON.parse(r.embedding); } catch { return null; }
      return { content: r.content, fileName: r.file_name, score: cosineSim(queryEmb, emb) };
    })
    .filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function indexChunk(chatbotId, nodeId, fileName, content, embeddingModel = 'text-embedding-3-small') {
  let embeddingJson = null;
  try {
    const emb = await embedText(content, embeddingModel);
    embeddingJson = JSON.stringify(emb);
  } catch (err) {
    console.warn('[vectorStore] could not embed chunk:', err.message);
  }

  await client.execute({
    sql: `INSERT INTO document_chunks (id, chatbot_id, node_id, file_name, content, embedding)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [uuidv4(), chatbotId, nodeId, fileName, content, embeddingJson],
  });
}

export async function clearChunks(chatbotId) {
  await client.execute({
    sql: 'DELETE FROM document_chunks WHERE chatbot_id = ?',
    args: [chatbotId],
  });
}
