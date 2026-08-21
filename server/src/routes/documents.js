/**
 * server/src/routes/documents.js
 *
 * Phase 4: Document upload, indexing, and management.
 * Fully migrated to Supabase Storage + pgvector. No SQLite writes.
 *
 * Upload pipeline:
 *   multer.memoryStorage() → Supabase Storage → parse buffer → chunk
 *   → local BGE embedText() → document_chunks (vector(384))
 *
 * Routes:
 *   POST /api/documents/upload              — upload + index a document
 *   POST /api/documents/:id/signed-url      — generate a 1-hour signed URL
 *   DELETE /api/documents/app/:ragAppId     — delete all docs for a RAG app
 *   DELETE /api/documents/:id               — delete one document
 *
 * All routes require authentication (applied in index.js).
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { extractTextFromBuffer, chunkText, sanitizeFilename } from '../documentParser.js';
import { indexChunk, deleteChunksForDocument, deleteChunksForApp } from '../vectorStore.js';

// ─── Multer — memory storage (no disk writes) ─────────────────────────────────

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.csv']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
  },
});

const STORAGE_BUCKET = 'knowledge-docs';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the Supabase Storage path for a document.
 * Format: {user_id}/{rag_app_id}/{document_id}/{safe_filename}
 * Never uses the raw original filename — always sanitized.
 */
function buildStoragePath(userId, ragAppId, documentId, originalName) {
  const safe = sanitizeFilename(originalName);
  return `${userId}/${ragAppId}/${documentId}/${safe}`;
}

/**
 * Delete a Supabase Storage object by path, logging errors but not throwing.
 */
async function removeStorageObject(storagePath) {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);
  if (error) {
    console.warn(`[documents] Storage cleanup failed for ${storagePath}: ${error.message}`);
  }
}

// ─── POST /api/documents/upload ───────────────────────────────────────────────

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // multer errors (file too large, wrong type, etc.)
      console.error('[documents/upload] multer error:', err.message, err.code);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  // Wrap the entire handler so no error silently becomes a generic 500
  try {
    await handleUpload(req, res);
  } catch (unexpectedErr) {
    console.error('[documents/upload] UNHANDLED ERROR:', unexpectedErr.message, unexpectedErr.stack);
    res.status(500).json({ error: 'Internal server error: ' + unexpectedErr.message });
  }
});

async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { chatbot_id, node_id } = req.body;
  if (!chatbot_id) return res.status(400).json({ error: 'chatbot_id is required' });

  // ── 1. Verify RAG app ownership ──────────────────────────────────────────
  const ragApp = await getOwnedRagApp(chatbot_id, req.user.id);
  if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

  // ── 2. Derive chunking config from workflow nodes ────────────────────────
  const nodes = Array.isArray(ragApp.nodes) ? ragApp.nodes : [];
  const splitterNode = nodes.find(n => n.type === 'TextSplitter');
  const chunkSize = splitterNode?.params?.chunk_size || 1000;
  const overlap   = splitterNode?.params?.overlap    || 200;
  const nodeId    = node_id || 'default';

  // ── 3. Generate document_id and storage path ─────────────────────────────
  const documentId  = uuidv4();
  const storagePath = buildStoragePath(req.user.id, chatbot_id, documentId, req.file.originalname);

  // ── 4. Insert document row with status=processing ───────────────────────
  const { error: insertErr } = await supabase
    .from('documents')
    .insert({
      id:           documentId,
      user_id:      req.user.id,
      rag_app_id:   chatbot_id,
      node_id:      nodeId,
      file_name:    req.file.originalname,
      storage_path: storagePath,
      mime_type:    req.file.mimetype || null,
      size_bytes:   req.file.size,
      status:       'processing',
      chunk_count:  0,
    });

  if (insertErr) {
    console.error('[documents/upload] insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to create document record' });
  }

  // ── 5. Upload buffer to Supabase Storage ────────────────────────────────
  console.log(`[documents/upload] uploading to storage: path=${storagePath} size=${req.file.size}`);
  const { error: storageErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      upsert: false,
    });

  if (storageErr) {
    console.error('[documents/upload] storage error:', storageErr.message, storageErr);
    // Rollback: mark document as error
    await supabase.from('documents').update({
      status: 'error',
      error_message: 'Storage upload failed',
    }).eq('id', documentId);
    return res.status(500).json({ error: 'File storage failed' });
  }

  // ── 6. Parse text from buffer ────────────────────────────────────────────
  let text;
  try {
    text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    console.log(`[documents/upload] parsed text length=${text?.length ?? 0} file=${req.file.originalname}`);
  } catch (parseErr) {
    console.error('[documents/upload] parse error:', parseErr.message);
    await removeStorageObject(storagePath);
    await supabase.from('documents').update({
      status: 'error',
      error_message: `Parsing failed: ${parseErr.message.slice(0, 200)}`,
    }).eq('id', documentId);
    return res.status(422).json({ error: 'Could not extract text from this document' });
  }

  if (!text || text.trim().length === 0) {
    await removeStorageObject(storagePath);
    await supabase.from('documents').update({
      status: 'error',
      error_message: 'Document contained no extractable text',
    }).eq('id', documentId);
    return res.status(422).json({ error: 'Document contained no extractable text' });
  }

  // ── 7. Chunk + embed + insert ────────────────────────────────────────────
  const chunks = chunkText(text, chunkSize, overlap);
  console.log(`[documents/upload] chunks=${chunks.length} chunkSize=${chunkSize} overlap=${overlap} docId=${documentId.slice(0,8)}`);
  if (chunks.length === 0) {
    await removeStorageObject(storagePath);
    await supabase.from('documents').update({
      status: 'error',
      error_message: 'No chunks produced from document text',
    }).eq('id', documentId);
    return res.status(422).json({ error: 'No chunks produced from document text' });
  }
  let insertedCount = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      // Truncate chunk to 8000 chars — embedder has a token limit
      const safeContent = chunks[i].slice(0, 8000);
      await indexChunk({
        userId:     req.user.id,
        ragAppId:   chatbot_id,
        documentId,
        nodeId,
        fileName:   req.file.originalname,
        content:    safeContent,
        chunkIndex: i,
      });
      insertedCount++;
    }
  } catch (embedErr) {
    console.error('[documents/upload] embedding/insert error:', embedErr.message, embedErr.stack?.split('\n')[1]);
    // Rollback: delete any chunks that were already inserted
    await deleteChunksForDocument(documentId);
    // Original file stays in Storage for potential retry/debug
    await supabase.from('documents').update({
      status: 'error',
      error_message: `Indexing failed: ${embedErr.message.slice(0, 200)}`,
    }).eq('id', documentId);
    return res.status(500).json({ error: 'Document indexing failed' });
  }

  // ── 8. Mark document as indexed ─────────────────────────────────────────
  await supabase.from('documents').update({
    status:        'indexed',
    chunk_count:   insertedCount,
    error_message: null,
  }).eq('id', documentId);
  console.log(`[documents/upload] DONE docId=${documentId.slice(0,8)} status=indexed chunks=${insertedCount}`);

  // Return document metadata — no file_url, no permanent public URL
  res.json({
    id:          documentId,
    file_name:   req.file.originalname,
    size_bytes:  req.file.size,
    chunk_count: insertedCount,
    status:      'indexed',
  });
}

// ─── POST /api/documents/:id/signed-url ──────────────────────────────────────

router.post('/:id/signed-url', async (req, res) => {
  try {
    // Fetch document and verify ownership via rag_app
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, user_id, storage_path, rag_app_id')
      .eq('id', req.params.id)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

    // Verify the user owns the rag_app that owns this document
    const ragApp = await getOwnedRagApp(doc.rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Document not found' });

    // Generate 1-hour signed URL
    const { data: signedData, error: signedErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(doc.storage_path, 3600);

    if (signedErr || !signedData?.signedUrl) {
      console.error('[documents/signed-url]', signedErr?.message);
      return res.status(500).json({ error: 'Failed to generate signed URL' });
    }

    res.json({ signed_url: signedData.signedUrl });
  } catch (err) {
    console.error('[documents/signed-url]', err.message);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

// ─── DELETE /api/documents/app/:ragAppId ─────────────────────────────────────
// Delete all documents for a RAG app (preserves backward-compat with the old
// DELETE /:chatbotId endpoint used by NodeProperties.jsx clearChunks).

router.delete('/app/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    // Fetch all document storage paths for this app
    const { data: docs } = await supabase
      .from('documents')
      .select('id, storage_path')
      .eq('rag_app_id', req.params.ragAppId);

    if (docs?.length) {
      // Delete all chunks
      await deleteChunksForApp(req.params.ragAppId);

      // Delete all Storage objects
      const paths = docs.map(d => d.storage_path);
      const { error: storageErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths);
      if (storageErr) {
        console.warn('[documents/delete-app] storage cleanup warning:', storageErr.message);
      }

      // Delete all document rows (cascades document_chunks too, but we already cleaned)
      await supabase.from('documents').delete().eq('rag_app_id', req.params.ragAppId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[documents/delete-app]', err.message);
    res.status(500).json({ error: 'Failed to delete documents' });
  }
});

// ─── DELETE /api/documents/:id ───────────────────────────────────────────────
// Delete a single document by ID.

router.delete('/:id', async (req, res) => {
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, storage_path, rag_app_id')
      .eq('id', req.params.id)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

    const ragApp = await getOwnedRagApp(doc.rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Document not found' });

    // Delete chunks first
    await deleteChunksForDocument(doc.id);

    // Delete Storage object
    await removeStorageObject(doc.storage_path);

    // Delete document row
    await supabase.from('documents').delete().eq('id', doc.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[documents/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export default router;
