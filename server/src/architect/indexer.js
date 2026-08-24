/**
 * server/src/architect/indexer.js
 *
 * Final indexing service — executes approved Architect plan against a document.
 *
 * This is the ONLY place that creates final document_chunks.
 * It must only be called AFTER architect_status = 'approved'.
 *
 * Pipeline:
 *   1. Fetch document + verify ownership
 *   2. Verify rag_app.architect_status = 'approved'
 *   3. Load approved architect_plan
 *   4. Validate plan (must not be null)
 *   5. Set document status = 'indexing'
 *   6. Delete any pre-existing chunks for this document (safe replacement)
 *   7. Download original file from Supabase Storage
 *   8. Extract text
 *   9. Apply approved chunking strategy (chunkDocument)
 *  10. Embed each chunk with BGE (embedText, 384 dim)
 *  11. Insert document_chunks with architect traceability metadata
 *  12. Update document: status='indexed', chunk_count, error_message=null
 *
 * On any failure:
 *   - Delete partial chunks
 *   - Set document status = 'error', error_message populated
 *   - Preserve original Storage file
 *   - Preserve approved architect_plan
 *   - Throw so the caller can handle appropriately
 */

import supabase from '../supabase.js';
import { extractTextFromBuffer, chunkDocument } from '../documentParser.js';
import { embedText } from '../embeddings.js';
import { deleteChunksForDocument } from '../vectorStore.js';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_BUCKET = 'knowledge-docs';
const EXPECTED_DIM   = 384;
const MAX_CHUNK_CHARS = 8000; // embedder token limit guard

/**
 * Index a single document using its RAG app's approved Architect plan.
 *
 * @param {string} documentId
 * @param {string} ragAppId
 * @param {string} userId
 * @returns {Promise<{ chunk_count: number }>}
 * @throws on any failure (document is marked 'error', original file preserved)
 */
export async function indexDocumentWithPlan(documentId, ragAppId, userId) {
  // ── 1. Fetch document ──────────────────────────────────────────────────────
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, file_name, storage_path, rag_app_id, node_id, status')
    .eq('id', documentId)
    .eq('rag_app_id', ragAppId)
    .single();

  if (docErr || !doc) {
    throw new Error(`[indexer] Document ${documentId.slice(0,8)} not found in app ${ragAppId.slice(0,8)}`);
  }

  // ── 2. Fetch RAG app and verify approval ───────────────────────────────────
  const { data: ragApp, error: appErr } = await supabase
    .from('rag_apps')
    .select('architect_status, architect_plan, architect_version')
    .eq('id', ragAppId)
    .eq('user_id', userId)
    .single();

  if (appErr || !ragApp) {
    throw new Error(`[indexer] RAG app ${ragAppId.slice(0,8)} not found or not owned by user`);
  }

  if (ragApp.architect_status !== 'approved') {
    throw new Error(
      `[indexer] Cannot index: architect_status is '${ragApp.architect_status}', must be 'approved'`
    );
  }

  // ── 3. Validate architect_plan ─────────────────────────────────────────────
  const plan = ragApp.architect_plan;
  if (!plan || !plan.chunking) {
    throw new Error('[indexer] No valid architect_plan found on RAG app');
  }

  const { strategy, chunk_size, chunk_overlap } = plan.chunking;

  // ── 4. Mark as indexing ────────────────────────────────────────────────────
  await supabase
    .from('documents')
    .update({ status: 'indexing', error_message: null })
    .eq('id', documentId);

  // ── 5. Delete any pre-existing chunks (safe replacement) ──────────────────
  await deleteChunksForDocument(documentId);

  // ── 6. Download original file from Storage ─────────────────────────────────
  let buffer;
  try {
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(doc.storage_path);

    if (dlErr || !fileData) {
      throw new Error(`Storage download failed: ${dlErr?.message || 'no data'}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (dlErr) {
    await _markError(documentId, `Storage download failed: ${dlErr.message}`);
    throw dlErr;
  }

  // ── 7. Extract text ────────────────────────────────────────────────────────
  let text;
  try {
    text = await extractTextFromBuffer(buffer, doc.file_name);
  } catch (parseErr) {
    await _markError(documentId, `Text extraction failed: ${parseErr.message.slice(0, 200)}`);
    throw parseErr;
  }

  if (!text || text.trim().length === 0) {
    const err = new Error('[indexer] Document contained no extractable text');
    await _markError(documentId, err.message);
    throw err;
  }

  // ── 8. Chunk using approved strategy ──────────────────────────────────────
  const chunks = chunkDocument(text, { strategy, chunk_size, chunk_overlap });

  if (chunks.length === 0) {
    const err = new Error('[indexer] No chunks produced from document text');
    await _markError(documentId, err.message);
    throw err;
  }

  console.log(
    `[indexer] doc=${documentId.slice(0,8)} strategy=${strategy} ` +
    `chunk_size=${chunk_size} overlap=${chunk_overlap} chunks=${chunks.length}`
  );

  // ── 9. Embed + insert chunks ──────────────────────────────────────────────
  // Build traceability metadata from the approved plan
  const chunkMeta = {
    architect_version:   ragApp.architect_version,
    chunking_strategy:   strategy,
    chunk_size,
    chunk_overlap,
    embedding_model:     plan.embedding?.model  || 'Xenova/bge-small-en-v1.5',
    embedding_dimension: plan.embedding?.dimension || 384,
  };

  let insertedCount = 0;
  const insertedIds = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const safeContent = chunks[i].slice(0, MAX_CHUNK_CHARS);

      const embedding = await embedText(safeContent);

      if (embedding.length !== EXPECTED_DIM) {
        throw new Error(
          `[indexer] Unexpected embedding dimension ${embedding.length} (expected ${EXPECTED_DIM})`
        );
      }

      const allFinite = embedding.every(v => isFinite(v));
      if (!allFinite) throw new Error('[indexer] Embedding contains non-finite values');

      const embeddingStr = `[${embedding.join(',')}]`;
      const chunkId = uuidv4();

      const { error: insertErr } = await supabase
        .from('document_chunks')
        .insert({
          id:          chunkId,
          user_id:     userId,
          rag_app_id:  ragAppId,
          document_id: documentId,
          node_id:     doc.node_id || 'default',
          file_name:   doc.file_name,
          content:     safeContent,
          embedding:   embeddingStr,
          chunk_index: i,
          metadata:    chunkMeta,
        });

      if (insertErr) {
        throw new Error(`[indexer] DB insert failed for chunk ${i}: ${insertErr.message}`);
      }

      insertedIds.push(chunkId);
      insertedCount++;
    }
  } catch (embedErr) {
    console.error('[indexer] Embedding/insert error:', embedErr.message);
    // Remove partial chunks — delete by IDs inserted so far
    if (insertedIds.length > 0) {
      await supabase.from('document_chunks').delete().in('id', insertedIds);
    }
    await _markError(documentId, `Indexing failed: ${embedErr.message.slice(0, 200)}`);
    throw embedErr;
  }

  // ── 10. Mark document as indexed ──────────────────────────────────────────
  await supabase
    .from('documents')
    .update({
      status:        'indexed',
      chunk_count:   insertedCount,
      error_message: null,
    })
    .eq('id', documentId);

  console.log(`[indexer] DONE doc=${documentId.slice(0,8)} status=indexed chunks=${insertedCount}`);

  return { chunk_count: insertedCount };
}

/**
 * Index ALL profiled documents for a RAG app using its approved plan.
 * Skips already-indexed documents unless force=true.
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @param {{ force?: boolean }} options
 * @returns {Promise<{ indexed: number, skipped: number, errors: string[] }>}
 */
export async function indexAllDocumentsWithPlan(ragAppId, userId, { force = false } = {}) {
  const statuses = force
    ? ['profiled', 'indexed', 'error']
    : ['profiled'];

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id')
    .eq('rag_app_id', ragAppId)
    .in('status', statuses);

  if (error) throw new Error(`[indexer] Failed to list documents: ${error.message}`);
  if (!docs?.length) return { indexed: 0, skipped: 0, errors: [] };

  let indexed = 0;
  let skipped = 0;
  const errors = [];

  for (const doc of docs) {
    try {
      await indexDocumentWithPlan(doc.id, ragAppId, userId);
      indexed++;
    } catch (err) {
      console.error(`[indexer] Failed to index doc ${doc.id.slice(0,8)}: ${err.message}`);
      errors.push(`${doc.id.slice(0,8)}: ${err.message}`);
    }
  }

  return { indexed, skipped, errors };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _markError(documentId, message) {
  await supabase
    .from('documents')
    .update({ status: 'error', error_message: message.slice(0, 500) })
    .eq('id', documentId);
}
