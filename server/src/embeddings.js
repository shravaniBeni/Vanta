/**
 * server/src/embeddings.js
 *
 * Embedding service — two modes controlled by environment variables:
 *
 * MODE 1 (default for production / free hosting):  HuggingFace Inference API
 *   Set HF_API_TOKEN in env. Uses BAAI/bge-small-en-v1.5 via HTTP.
 *   - No model download, no memory overhead, no slow startup
 *   - Cold start: ~200ms per embedding call (network latency)
 *   - Free tier: ~a few hundred requests/hour (sufficient for testing)
 *   - Same model, same 384-dim vectors, same BGE query prefix
 *
 * MODE 2 (optional, for local dev or paid hosting):  Local ONNX via @huggingface/transformers
 *   Set USE_LOCAL_EMBEDDINGS=true in env.
 *   - Loads 45 MB model at startup, keeps in memory
 *   - No external API dependency, no rate limits
 *   - Requires persistent process (Railway Hobby, ECS, etc.)
 *
 * Public API (identical in both modes):
 *   loadEmbedder()          — must be called at startup (no-op in API mode)
 *   embedText(text)         — embed a document chunk
 *   embedQuery(text)        — embed a retrieval query (applies BGE prefix)
 *   isEmbedderReady()       — returns true when ready
 */

import 'dotenv/config';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_ID     = 'BAAI/bge-small-en-v1.5';
const EXPECTED_DIM = 384;
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const HF_API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

// ─── Mode detection ───────────────────────────────────────────────────────────

const USE_LOCAL = process.env.USE_LOCAL_EMBEDDINGS === 'true';
const HF_TOKEN  = process.env.HF_API_TOKEN || '';

if (USE_LOCAL) {
  console.log('[embeddings] Mode: LOCAL (@huggingface/transformers)');
} else {
  if (!HF_TOKEN) {
    console.warn(
      '[embeddings] HF_API_TOKEN not set. ' +
      'Embedding calls will use the unauthenticated HuggingFace API (lower rate limits). ' +
      'Set HF_API_TOKEN for better reliability.'
    );
  } else {
    console.log('[embeddings] Mode: HuggingFace Inference API (remote)');
  }
}

// ─── Local mode state ─────────────────────────────────────────────────────────

let _localEmbedder = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the embedding pipeline.
 * In API mode: validates config and resolves immediately.
 * In local mode: downloads + loads the ONNX model (~45 MB, ~5-30s).
 *
 * Must be called once at startup before embedText/embedQuery.
 */
export async function loadEmbedder() {
  if (USE_LOCAL) {
    if (_localEmbedder !== null) return;

    console.log(`[embeddings] Loading local model ${MODEL_ID}...`);
    const { pipeline, env } = await import('@huggingface/transformers');

    if (process.env.TRANSFORMERS_CACHE) {
      env.cacheDir = process.env.TRANSFORMERS_CACHE;
    }

    const t0 = Date.now();
    _localEmbedder = await pipeline('feature-extraction', MODEL_ID);
    console.log(`[embeddings] Local model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    // API mode: just warm up the model on HF if it's sleeping (cold inference endpoint)
    // This is a best-effort warm-up — failure is non-fatal, first real call will wait.
    console.log('[embeddings] API mode — skipping local model load');
    if (HF_TOKEN) {
      _warmUpHfModel().catch(() => {}); // fire-and-forget
    }
  }
}

export function isEmbedderReady() {
  if (USE_LOCAL) return _localEmbedder !== null;
  return true; // API mode is always "ready"
}

/**
 * Embed a document chunk for indexing (no query prefix).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  _assertValidInput(text);
  if (USE_LOCAL) {
    return _localEmbed(text);
  }
  return _apiEmbed(text);
}

/**
 * Embed a user retrieval query (applies BGE query prefix).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedQuery(text) {
  _assertValidInput(text);
  if (USE_LOCAL) {
    return _localEmbed(`${BGE_QUERY_PREFIX}${text}`);
  }
  return _apiEmbed(`${BGE_QUERY_PREFIX}${text}`);
}

// ─── Local embedding ──────────────────────────────────────────────────────────

async function _localEmbed(text) {
  if (!_localEmbedder) {
    throw new Error('[embeddings] Local embedder not initialized. Call loadEmbedder() first.');
  }
  const output = await _localEmbedder(text, { pooling: 'mean', normalize: true });
  const vec = Array.from(output.data ?? output);
  if (vec.length !== EXPECTED_DIM) {
    throw new Error(`[embeddings] Unexpected dimension ${vec.length} (expected ${EXPECTED_DIM})`);
  }
  return vec;
}

// ─── HuggingFace Inference API embedding ─────────────────────────────────────

/**
 * Call the HuggingFace Inference API to embed text.
 * Handles model loading delay (503 "loading" response) with retry.
 */
async function _apiEmbed(text, retries = 3) {
  const headers = { 'Content-Type': 'application/json' };
  if (HF_TOKEN) headers['Authorization'] = `Bearer ${HF_TOKEN}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(HF_API_URL, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ inputs: text }),
        signal:  AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt === retries) throw new Error(`[embeddings] API request failed: ${err.message}`);
      await _delay(1000 * attempt);
      continue;
    }

    // 503 = model loading on HF side — wait and retry
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      const waitMs = Math.min((body.estimated_time || 20) * 1000, 30_000);
      console.log(`[embeddings] HF model loading, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${retries})`);
      await _delay(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[embeddings] HF API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();

    // HF feature-extraction returns: number[][] (one vector per token) or number[]
    // With BAAI/bge-small-en-v1.5 it returns the full token matrix; we need the CLS/mean vector.
    let vec;
    if (Array.isArray(data) && typeof data[0] === 'number') {
      // Already a flat vector
      vec = data;
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      // Token matrix — mean pool
      vec = _meanPool(data);
    } else if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
      // Batched [[token_vectors]] — take first item and mean pool
      vec = _meanPool(data[0]);
    } else {
      throw new Error(`[embeddings] Unexpected API response shape: ${JSON.stringify(data).slice(0, 100)}`);
    }

    if (vec.length !== EXPECTED_DIM) {
      throw new Error(`[embeddings] Unexpected dimension ${vec.length} (expected ${EXPECTED_DIM})`);
    }

    // Normalize (HF API may not normalize by default)
    return _l2Normalize(vec);
  }

  throw new Error('[embeddings] HF API: max retries exceeded');
}

function _meanPool(tokenVectors) {
  if (!tokenVectors.length) throw new Error('[embeddings] Empty token vectors');
  const dim = tokenVectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const vec of tokenVectors) {
    for (let i = 0; i < dim; i++) mean[i] += vec[i];
  }
  const n = tokenVectors.length;
  return mean.map(v => v / n);
}

function _l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

async function _warmUpHfModel() {
  // Send a tiny dummy request so HF warms up the model container before real traffic
  await _apiEmbed('warmup', 1).catch(() => {});
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _assertValidInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('[embeddings] Input must be a non-empty string.');
  }
}

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
