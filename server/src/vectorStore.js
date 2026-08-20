/**
 * server/src/vectorStore.js
 *
 * Phase 4: Vector store fully migrated to Supabase PostgreSQL + pgvector.
 * SQLite is no longer used by this module.
 *
 * indexChunk()      — embed text with local BGE model → insert into document_chunks
 * retrieveChunks()  — embed query → call match_chunks RPC → return results
 * deleteChunksForDocument() — remove all chunks for one document
 */

import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { embedText, embedQuery } from './embeddings.js';

const EXPECTED_DIM = 384;

// ─── Index ────────────────────────────────────────────────────────────────────

/**
 * Embed a single chunk and insert it into document_chunks.
 * Throws on embedding or DB failure — no silent fallback.
 *
 * @param {{
 *   userId: string,
 *   ragAppId: string,
 *   documentId: string,
 *   nodeId: string,
 *   fileName: string,
 *   content: string,
 *   chunkIndex: number,
 * }} params
 * @returns {Promise<string>} — the inserted chunk UUID
 */
export async function indexChunk({ userId, ragAppId, documentId, nodeId, fileName, content, chunkIndex }) {
  // Embed with local BGE model — no pseudo fallback
  const embedding = await embedText(content);

  if (embedding.length !== EXPECTED_DIM) {
    throw new Error(
      `[vectorStore] Unexpected embedding dimension ${embedding.length} (expected ${EXPECTED_DIM})`
    );
  }

  const id = uuidv4();

  const { error } = await supabase
    .from('document_chunks')
    .insert({
      id,
      user_id:     userId,
      rag_app_id:  ragAppId,
      document_id: documentId,
      node_id:     nodeId,
      file_name:   fileName,
      content,
      embedding,       // Supabase JS client serializes number[] → vector(384)
      chunk_index: chunkIndex,
      metadata:    {},
    });

  if (error) {
    throw new Error(`[vectorStore] Failed to insert chunk: ${error.message}`);
  }

  return id;
}

// ─── Retrieve ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most semantically similar chunks for a query.
 * Uses pgvector exact cosine search via the match_chunks RPC.
 *
 * @param {string} ragAppId
 * @param {string} query
 * @param {number} topK
 * @returns {Promise<Array<{ id: string, content: string, fileName: string, score: number }>>}
 */
export async function retrieveChunks(ragAppId, query, topK = 5) {
  // Apply BGE query prefix — only for retrieval queries, not document text
  const queryEmbedding = await embedQuery(query);

  if (queryEmbedding.length !== EXPECTED_DIM) {
    throw new Error(
      `[vectorStore] Query embedding dimension ${queryEmbedding.length} (expected ${EXPECTED_DIM})`
    );
  }

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    p_rag_app_id:    ragAppId,
    match_count:     topK,
  });

  if (error) {
    throw new Error(`[vectorStore] match_chunks RPC failed: ${error.message}`);
  }

  return (data ?? []).map(row => ({
    id:       row.id,
    content:  row.content,
    fileName: row.file_name,
    score:    row.score,
  }));
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete all document_chunks rows for a specific document.
 * Called on indexing failure (cleanup) and on document deletion.
 *
 * @param {string} documentId
 * @returns {Promise<void>}
 */
export async function deleteChunksForDocument(documentId) {
  const { error } = await supabase
    .from('document_chunks')
    .delete()
    .eq('document_id', documentId);

  if (error) {
    // Log but don't throw — deletion failure should not block the caller
    console.error(`[vectorStore] Failed to delete chunks for document ${documentId}: ${error.message}`);
  }
}

/**
 * Delete all document_chunks for a RAG app (used when clearing an entire app).
 *
 * @param {string} ragAppId
 * @returns {Promise<void>}
 */
export async function deleteChunksForApp(ragAppId) {
  const { error } = await supabase
    .from('document_chunks')
    .delete()
    .eq('rag_app_id', ragAppId);

  if (error) {
    console.error(`[vectorStore] Failed to delete chunks for app ${ragAppId}: ${error.message}`);
  }
}
