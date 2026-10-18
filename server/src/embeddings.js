/**
 * server/src/embeddings.js
 *
 * Embedding service — local BAAI/bge-small-en-v1.5 ONNX inference is the
 * intended production path. The HuggingFace Inference API is an optional
 * fallback for environments that cannot run the local model (e.g. free-tier
 * hosts with <512 MB RAM or mandatory cold-start constraints).
 *
 * MODE 1 — Local ONNX (default, production):
 *   @huggingface/transformers loads Xenova/bge-small-en-v1.5 at startup.
 *   ~45 MB download on first boot, then cached on disk.
 *   Zero per-call cost, zero network latency, no external dependency.
 *   Requires a persistent process with ≥512 MB RAM.
 *   Use on: Railway Hobby, ECS Fargate, any always-on host.
 *
 * MODE 2 — HuggingFace Inference API (opt-in fallback):
 *   Set USE_HF_API=true in env.
 *   Calls https://api-inference.huggingface.co — same model, same 384-dim vectors.
 *   No local model download, works on Render free / serverless environments.
 *   Rate-limited on the free tier (~a few hundred req/hour).
 *   Set HF_API_TOKEN for better reliability (free HF account token).
 *
 * Public API (identical in both modes):
 *   loadEmbedder()          — initialise; must be called at startup
 *   embedText(text)         — embed a document chunk (no query prefix)
 *   embedQuery(text)        — embed a retrieval query (applies BGE prefix)
 *   isEmbedderReady()       — true when the embedder is initialised
 */

import 'dotenv/config';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_ID          = 'Xenova/bge-small-en-v1.5';
const HF_API_MODEL_ID   = 'BAAI/bge-small-en-v1.5';
const EXPECTED_DIM      = 384;
const BGE_QUERY_PREFIX  = 'Represent this sentence for searching relevant passages: ';
const HF_API_URL        = `https://api-inference.huggingface.co/models/${HF_API_MODEL_ID}`;

// ─── Mode detection ───────────────────────────────────────────────────────────

const USE_HF_API = process.env.USE_HF_API === 'true';
const HF_TOKEN   = process.env.HF_API_TOKEN || '';

if (USE_HF_API) {
  if (!HF_TOKEN) {
    console.warn(
      '[embeddings] Mode: HuggingFace Inference API (fallback). ' +
      'HF_API_TOKEN not set — rate limits will be lower. ' +
      'Get a free token at https://huggingface.co/settings/tokens'
    );
  } else {
    console.log('[embeddings] Mode: HuggingFace Inference API (fallback)');
  }
} else {
  console.log('[embeddings] Mode: local ONNX (production)');
}

// ─── Local ONNX state ────────────────────────────────────────────────────────

/** @type {import('@huggingface/transformers').FeatureExtractionPipeline | null} */
let _embedder = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the embedding pipeline.
 *
 * Local mode  : downloads + loads Xenova/bge-small-en-v1.5 (~45 MB ONNX).
 *               Subsequent calls are no-ops (singleton).
 *               On failure: logs and throws — server startup must not proceed
 *               with a broken embedder.
 * HF API mode : validates config and resolves immediately (no download).
 *
 * @returns {Promise<void>}
 */
export async function loadEmbedder() {
  if (USE_HF_API) {
    // No local model needed. Fire a warm-up ping so the HF container is ready.
    console.log('[embeddings] HF API mode — skipping local model load');
    if (HF_TOKEN) _warmUpHfModel().catch(() => {});
    return;
  }

  // ── Local ONNX path ───────────────────────────────────────────────────────
  if (_embedder !== null) return; // already loaded

  console.log(`[embeddings] Loading local model ${MODEL_ID}...`);

  const { pipeline, env } = await import('@huggingface/transformers');

  if (process.env.TRANSFORMERS_CACHE) {
    env.cacheDir = process.env.TRANSFORMERS_CACHE;
    console.log(`[embeddings] Cache directory: ${process.env.TRANSFORMERS_CACHE}`);
  }

  const t0 = Date.now();
  try {
    _embedder = await pipeline('feature-extraction', MODEL_ID);
    console.log(`[embeddings] ${MODEL_ID} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[embeddings] Failed to load ${MODEL_ID}: ${err.message}`);
    throw new Error(
      'Embedding model initialisation failed. ' +
      'Check TRANSFORMERS_CACHE directory and network access to HuggingFace CDN.'
    );
  }
}

/**
 * Returns true when the embedder is ready to use.
 * @returns {boolean}
 */
export function isEmbedderReady() {
  if (USE_HF_API) return true;
  return _embedder !== null;
}

/**
 * Embed a document chunk for indexing.
 * Does NOT apply any query prefix — suitable for knowledge-base text.
 *
 * @param {string} text — non-empty string
 * @returns {Promise<number[]>} — 384-dimensional normalised float vector
 */
export async function embedText(text) {
  _assertValidInput(text);
  return USE_HF_API ? _apiEmbed(text) : _localEmbed(text);
}

/**
 * Embed a user retrieval query.
 * Applies the BGE retrieval instruction prefix before embedding.
 *
 * @param {string} text — non-empty query string
 * @returns {Promise<number[]>} — 384-dimensional normalised float vector
 */
export async function embedQuery(text) {
  _assertValidInput(text);
  const input = `${BGE_QUERY_PREFIX}${text}`;
  return USE_HF_API ? _apiEmbed(input) : _localEmbed(input);
}

// ─── Local ONNX embedding ─────────────────────────────────────────────────────

async function _localEmbed(text) {
  if (_embedder === null) {
    throw new Error(
      '[embeddings] Embedder not initialised. Call loadEmbedder() at startup before ' +
      'using embedText() or embedQuery().'
    );
  }

  const output = await _embedder(text, { pooling: 'mean', normalize: true });
  const data   = output.data ?? output;
  const vec    = Array.from(data);

  if (vec.length !== EXPECTED_DIM) {
    throw new Error(
      `[embeddings] Unexpected embedding dimension: got ${vec.length}, ` +
      `expected ${EXPECTED_DIM}. Input: "${String(text).slice(0, 60)}"`
    );
  }

  return vec;
}

// ─── HuggingFace Inference API embedding (fallback) ──────────────────────────

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
      if (attempt === retries) {
        throw new Error(`[embeddings] HF API request failed: ${err.message}`);
      }
      await _delay(1000 * attempt);
      continue;
    }

    // 503 = HF model container loading — wait and retry
    if (res.status === 503) {
      const body    = await res.json().catch(() => ({}));
      const waitMs  = Math.min((body.estimated_time || 20) * 1000, 30_000);
      console.log(
        `[embeddings] HF model loading, waiting ${Math.round(waitMs / 1000)}s ` +
        `(attempt ${attempt}/${retries})`
      );
      await _delay(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[embeddings] HF API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();

    // BAAI/bge-small-en-v1.5 via HF API returns a token matrix; mean-pool it.
    let vec;
    if (Array.isArray(data) && typeof data[0] === 'number') {
      vec = data;                          // already a flat vector
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      vec = _meanPool(data);               // token matrix — pool
    } else if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
      vec = _meanPool(data[0]);            // batched — take first item and pool
    } else {
      throw new Error(
        `[embeddings] Unexpected HF API response shape: ` +
        `${JSON.stringify(data).slice(0, 100)}`
      );
    }

    if (vec.length !== EXPECTED_DIM) {
      throw new Error(
        `[embeddings] Unexpected dimension from HF API: got ${vec.length}, ` +
        `expected ${EXPECTED_DIM}`
      );
    }

    return _l2Normalize(vec);
  }

  throw new Error('[embeddings] HF API: max retries exceeded');
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _assertValidInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('[embeddings] Input must be a non-empty string.');
  }
}

function _meanPool(tokenVectors) {
  if (!tokenVectors.length) throw new Error('[embeddings] Empty token vectors for mean pool');
  const dim  = tokenVectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const vec of tokenVectors) {
    for (let i = 0; i < dim; i++) mean[i] += vec[i];
  }
  return mean.map(v => v / tokenVectors.length);
}

function _l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

async function _warmUpHfModel() {
  // Best-effort warm-up so the HF container is ready before real traffic arrives.
  await _apiEmbed('warmup', 1).catch(() => {});
}

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
