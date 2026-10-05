/**
 * server/src/routes/documents.js
 *
 * Deferred-indexing document routes.
 *
 * Upload pipeline (Architect onboarding path):
 *   multer → Supabase Storage → extract text → profiler signals
 *   → documents.status = 'profiled'
 *   → NO document_chunks created yet
 *
 * Final indexing happens AFTER Architect plan approval via:
 *   POST /api/documents/:id/index
 *   POST /api/architect/index-all  (indexes all profiled docs for an app)
 *
 * Routes:
 *   GET  /api/documents                   — list documents for a RAG app
 *   POST /api/documents/upload            — upload + profile a document (no final chunks)
 *   POST /api/documents/:id/index         — apply approved plan, create final chunks
 *   POST /api/documents/:id/signed-url    — generate a 1-hour signed URL
 *   DELETE /api/documents/app/:ragAppId   — delete all docs for a RAG app
 *   DELETE /api/documents/:id             — delete one document
 *
 * All routes require authentication (applied in index.js).
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { extractTextFromBuffer, sanitizeFilename, profileDocument, classificationNeedsOcr } from '../documentParser.js';
import { deleteChunksForDocument, deleteChunksForApp } from '../vectorStore.js';
import { indexDocumentWithPlan } from '../architect/indexer.js';

// ─── Multer ───────────────────────────────────────────────────────────────────

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

// ─── GET /api/documents ───────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { rag_app_id } = req.query;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const { data, error } = await supabase
      .from('documents')
      .select('id, rag_app_id, node_id, file_name, mime_type, size_bytes, chunk_count, status, error_message, created_at')
      .eq('rag_app_id', rag_app_id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[documents GET /]', error.message);
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }

    // Try to enrich with profile_data if the column exists (added in migration 009)
    let enriched = data ?? [];
    try {
      const { data: withProfile, error: profileErr } = await supabase
        .from('documents')
        .select('id, profile_data')
        .eq('rag_app_id', rag_app_id);

      if (!profileErr && withProfile) {
        const profileMap = Object.fromEntries(withProfile.map(d => [d.id, d.profile_data]));
        enriched = enriched.map(d => ({ ...d, profile_data: profileMap[d.id] ?? null }));
      }
    } catch { /* migration 009 not yet applied — profile_data unavailable, non-fatal */ }

    res.json(enriched);
  } catch (err) {
    console.error('[documents GET /]', err.message);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStoragePath(userId, ragAppId, documentId, originalName) {
  const safe = sanitizeFilename(originalName);
  return `${userId}/${ragAppId}/${documentId}/${safe}`;
}

async function removeStorageObject(storagePath) {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  if (error) {
    console.warn(`[documents] Storage cleanup failed for ${storagePath}: ${error.message}`);
  }
}

// ─── POST /api/documents/upload ───────────────────────────────────────────────
// Profiling path: store file + extract text for Architect.
// Does NOT create document_chunks. Sets status = 'profiled'.

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[documents/upload] multer error:', err.message, err.code);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
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

  // ── 1. Verify ownership ──────────────────────────────────────────────────
  const ragApp = await getOwnedRagApp(chatbot_id, req.user.id);
  if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

  const nodeId      = node_id || 'default';
  const documentId  = uuidv4();
  const storagePath = buildStoragePath(req.user.id, chatbot_id, documentId, req.file.originalname);

  // ── 2. Insert document row with status=uploaded ──────────────────────────
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
      status:       'uploaded',
      chunk_count:  0,
    });

  if (insertErr) {
    console.error('[documents/upload] insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to create document record' });
  }

  // ── 3. Upload original file to Supabase Storage ──────────────────────────
  console.log(`[documents/upload] uploading to storage: path=${storagePath} size=${req.file.size}`);
  const { error: storageErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      upsert: false,
    });

  if (storageErr) {
    console.error('[documents/upload] storage error:', storageErr.message);
    await supabase.from('documents').update({
      status: 'error',
      error_message: 'Storage upload failed',
    }).eq('id', documentId);
    return res.status(500).json({ error: 'File storage failed' });
  }

  // ── 4. Mark as profiling ──────────────────────────────────────────────────
  await supabase.from('documents').update({ status: 'profiling' }).eq('id', documentId);

  // ── 5. Extract text to validate parsability ───────────────────────────────
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

  // ── 6. Profile the document ───────────────────────────────────────────────
  // Classify document type so the Architect and indexer can route correctly.
  let profileData = null;
  try {
    profileData = await profileDocument(req.file.buffer, req.file.originalname);
    console.log(`[documents/upload] profile: classification=${profileData.classification} pages=${profileData.signals.page_count} text_pages=${profileData.signals.text_pages}`);
  } catch (profileErr) {
    console.warn('[documents/upload] profile failed (non-fatal):', profileErr.message);
  }

  // ── 7. Check if current active workflow can handle this document type ──────
  // If the document needs OCR and the active workflow has no OCR node,
  // mark it as 'needs_architecture_review' rather than 'profiled'.
  const needsOcr = profileData ? classificationNeedsOcr(profileData.classification) : false;
  let finalStatus = 'profiled';

  if (needsOcr) {
    // Check if the current active workflow includes an OCR node
    const activeNodes = ragApp.nodes ?? [];
    const safeNodes = Array.isArray(activeNodes) ? activeNodes :
      (typeof activeNodes === 'string' ? JSON.parse(activeNodes) : []);
    const workflowHasOcr = safeNodes.some(n => n.type === 'OCR');

    if (!workflowHasOcr) {
      finalStatus = 'needs_architecture_review';
      console.log(`[documents/upload] doc=${documentId.slice(0,8)} classification=${profileData.classification} — no OCR in workflow → needs_architecture_review`);
    }
  }

  // ── 8. Mark as profiled (or needs_architecture_review) ───────────────────
  // profile_data column requires migration 009 — update without it if column absent
  try {
    await supabase.from('documents').update({
      status:        finalStatus,
      error_message: null,
      profile_data:  profileData,
    }).eq('id', documentId);
  } catch {
    // Fallback: migration 009 not applied yet — update without profile_data
    await supabase.from('documents').update({
      status:        finalStatus,
      error_message: null,
    }).eq('id', documentId);
  }

  console.log(`[documents/upload] DONE docId=${documentId.slice(0,8)} status=${finalStatus} (no chunks yet)`);

  // Return document metadata
  const responseBody = {
    id:                  documentId,
    file_name:           req.file.originalname,
    size_bytes:          req.file.size,
    chunk_count:         0,
    status:              finalStatus,
    profile_data:        profileData,
  };

  // Surface needs_architecture_review to the client clearly
  if (finalStatus === 'needs_architecture_review') {
    responseBody.needs_ocr    = true;
    responseBody.classification = profileData?.classification;
    responseBody.message = `Document classified as ${profileData?.classification}. ` +
      `Your current workflow does not include an OCR node. ` +
      `Use the Architect to add OCR support before this document can be indexed.`;
  }

  res.json(responseBody);
}

// ─── POST /api/documents/:id/index ───────────────────────────────────────────
// Apply the approved Architect plan to create final document_chunks.
// Requires architect_status = 'approved' on the parent rag_app.

router.post('/:id/index', async (req, res) => {
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, rag_app_id, status')
      .eq('id', req.params.id)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

    // Verify ownership
    const ragApp = await getOwnedRagApp(doc.rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Document not found' });

    const result = await indexDocumentWithPlan(doc.id, doc.rag_app_id, req.user.id);

    res.json({
      id:          doc.id,
      status:      'indexed',
      chunk_count: result.chunk_count,
    });
  } catch (err) {
    console.error('[documents/index]', err.message);
    // indexDocumentWithPlan already set status='error' on the document
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/documents/:id/reprocess ───────────────────────────────────────
// Part 9/12: Reprocess a document using the current active workflow.
// Unlike /index, this works even when architect_status != 'approved'
// by reading active workflow nodes directly (for chatbots already built).
// Routes OCR or standard extraction based on active workflow and profile_data.

router.post('/:id/reprocess', async (req, res) => {
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, rag_app_id, status, file_name, storage_path, profile_data')
      .eq('id', req.params.id)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

    const ragApp = await getOwnedRagApp(doc.rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Document not found' });

    // Allow reprocess regardless of architect_status if workflow nodes exist
    if (!ragApp.nodes || !Array.isArray(ragApp.nodes) || ragApp.nodes.length === 0) {
      return res.status(400).json({
        error: 'No active workflow found. Build a RAG pipeline first before reprocessing documents.',
      });
    }

    // indexDocumentWithPlan requires architect_status = 'approved'
    // For chatbots with an already-built active workflow we can call it directly
    const result = await indexDocumentWithPlan(doc.id, doc.rag_app_id, req.user.id);

    res.json({
      id:          doc.id,
      status:      'indexed',
      chunk_count: result.chunk_count,
    });
  } catch (err) {
    console.error('[documents/reprocess]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/documents/:id/signed-url ──────────────────────────────────────

router.post('/:id/signed-url', async (req, res) => {
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, user_id, storage_path, rag_app_id')
      .eq('id', req.params.id)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

    const ragApp = await getOwnedRagApp(doc.rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Document not found' });

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

router.delete('/app/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const { data: docs } = await supabase
      .from('documents')
      .select('id, storage_path')
      .eq('rag_app_id', req.params.ragAppId);

    if (docs?.length) {
      await deleteChunksForApp(req.params.ragAppId);

      const paths = docs.map(d => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        const { error: storageErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(paths);
        if (storageErr) {
          console.warn('[documents/delete-app] storage cleanup warning:', storageErr.message);
        }
      }

      await supabase.from('documents').delete().eq('rag_app_id', req.params.ragAppId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[documents/delete-app]', err.message);
    res.status(500).json({ error: 'Failed to delete documents' });
  }
});

// ─── DELETE /api/documents/:id ───────────────────────────────────────────────

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

    await deleteChunksForDocument(doc.id);
    await removeStorageObject(doc.storage_path);
    await supabase.from('documents').delete().eq('id', doc.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[documents/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export default router;
