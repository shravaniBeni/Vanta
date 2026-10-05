/**
 * server/src/routes/crawl.js
 *
 * WebCrawler node — crawl a website and ingest pages as document chunks.
 *
 * POST /api/crawl/start
 *   Body: { rag_app_id, url, max_pages?, depth_limit?, same_domain?,
 *           include_patterns?, exclude_patterns? }
 *   Crawls the site, creates a virtual "document" per page, embeds chunks,
 *   inserts into document_chunks. Responds with crawl stats.
 *
 * GET /api/crawl/status/:ragAppId
 *   Returns crawl progress/history for a RAG app (from crawl_jobs table if
 *   it exists, otherwise from documents with source='web').
 *
 * All routes require authentication.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { crawlWebsite } from '../webCrawler.js';
import { chunkDocument } from '../documentParser.js';
import { embedText } from '../embeddings.js';

const router = Router();

// ─── POST /api/crawl/start ────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const {
    rag_app_id,
    url,
    max_pages    = 10,
    depth_limit  = 2,
    same_domain  = true,
    include_patterns = [],
    exclude_patterns = [],
  } = req.body;

  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' });

  // Validate URL
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
  if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

  // Resolve chunking config from active workflow
  const nodes = Array.isArray(ragApp.nodes) ? ragApp.nodes : [];
  const splitterNode = nodes.find(n => n.type === 'TextSplitter');
  const chunkSize    = splitterNode?.params?.chunk_size    ?? 1000;
  const chunkOverlap = splitterNode?.params?.overlap       ??
                       splitterNode?.params?.chunk_overlap ?? 200;
  const strategy     = splitterNode?.params?.strategy      ?? 'recursive';

  console.log(`[crawl] starting for ${rag_app_id.slice(0,8)} url=${url} max_pages=${max_pages}`);

  // Run crawl
  let crawlResult;
  try {
    crawlResult = await crawlWebsite({
      url:             url.trim(),
      max_pages:       Math.min(50, Math.max(1, parseInt(max_pages, 10) || 10)),
      depth_limit:     Math.min(5,  Math.max(0, parseInt(depth_limit, 10) || 2)),
      same_domain,
      include_patterns: Array.isArray(include_patterns) ? include_patterns : [],
      exclude_patterns: Array.isArray(exclude_patterns) ? exclude_patterns : [],
    });
  } catch (err) {
    console.error('[crawl] crawlWebsite error:', err.message);
    return res.status(500).json({ error: 'Crawl failed: ' + err.message });
  }

  if (crawlResult.pages.length === 0) {
    return res.status(200).json({
      rag_app_id,
      pages_crawled: 0,
      chunks_indexed: 0,
      stats: crawlResult.stats,
      errors: crawlResult.errors,
      message: 'No pages with extractable content were found.',
    });
  }

  // Ingest each page: chunk → embed → insert
  let totalChunks = 0;
  const ingestionErrors = [];

  for (const page of crawlResult.pages) {
    if (!page.text || page.text.trim().length < 50) continue;

    const documentId = uuidv4();
    const chunks = chunkDocument(page.text, {
      strategy,
      chunk_size:    chunkSize,
      chunk_overlap: chunkOverlap,
    });

    if (chunks.length === 0) continue;

    // Store a lightweight document row for the page (no Storage file)
    const safeTitle = page.title?.slice(0, 255) || page.url.slice(0, 255);
    await supabase.from('documents').insert({
      id:           documentId,
      user_id:      req.user.id,
      rag_app_id,
      node_id:      'web-crawler',
      file_name:    safeTitle,
      storage_path: `web/${rag_app_id}/${documentId}`,  // virtual path — no Storage file
      mime_type:    'text/html',
      size_bytes:   page.text.length,
      status:       'indexed',
      chunk_count:  chunks.length,
    });

    // Embed + insert chunks
    let pageChunks = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const safeContent = chunks[i].slice(0, 8000);
        const embedding   = await embedText(safeContent);
        const embStr      = `[${embedding.join(',')}]`;

        await supabase.from('document_chunks').insert({
          id:          uuidv4(),
          user_id:     req.user.id,
          rag_app_id,
          document_id: documentId,
          node_id:     'web-crawler',
          file_name:   safeTitle,
          content:     safeContent,
          embedding:   embStr,
          chunk_index: i,
          metadata: {
            source:       'web',
            source_url:   page.url,
            page_title:   page.title,
            crawl_depth:  page.depth,
            chunk_size:   chunkSize,
            chunk_overlap: chunkOverlap,
            strategy,
          },
        });
        pageChunks++;
      } catch (embedErr) {
        ingestionErrors.push(`${page.url} chunk ${i}: ${embedErr.message}`);
      }
    }
    totalChunks += pageChunks;
    console.log(`[crawl] indexed ${pageChunks} chunks from ${page.url}`);
  }

  res.json({
    rag_app_id,
    pages_crawled:  crawlResult.pages.length,
    chunks_indexed: totalChunks,
    stats:          crawlResult.stats,
    errors:         [...crawlResult.errors, ...ingestionErrors],
  });
});

// ─── GET /api/crawl/status/:ragAppId ─────────────────────────────────────────

router.get('/status/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    // Return documents with node_id='web-crawler'
    const { data: webDocs } = await supabase
      .from('documents')
      .select('id, file_name, size_bytes, chunk_count, status, created_at')
      .eq('rag_app_id', req.params.ragAppId)
      .eq('node_id', 'web-crawler')
      .order('created_at', { ascending: false })
      .limit(100);

    const docs = webDocs || [];
    const totalChunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);

    res.json({
      rag_app_id:     req.params.ragAppId,
      pages_indexed:  docs.length,
      total_chunks:   totalChunks,
      pages:          docs.map(d => ({
        id:          d.id,
        title:       d.file_name,
        chunk_count: d.chunk_count,
        status:      d.status,
        created_at:  d.created_at,
      })),
    });
  } catch (err) {
    console.error('[crawl/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
