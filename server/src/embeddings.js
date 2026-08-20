/**
 * server/src/embeddings.js
 *
 * Local semantic embedding service using @huggingface/transformers.
 * Model: Xenova/bge-small-en-v1.5 (384-dimensional, based on BAAI/bge-small-en-v1.5)
 *
 * Public API:
 *   loadEmbedder()          — must be called once at server startup before any embedding
 *   embedText(text)         — embed a document chunk (no query prefix)
 *   embedQuery(text)        — embed a user retrieval query (applies BGE query prefix)
 *   isEmbedderReady()       — returns true if the pipeline is initialized
 *
 * Design decisions:
 *   - Pipeline is loaded once and reused across all requests (singleton).
 *   - embedText and embedQuery both return a plain number[] of length 384.
 *   - The BGE query retrieval prefix is applied inside embedQuery only — callers
 *     never need to know about it.
 *   - If embedding fails, a clear error is thrown. No pseudo-embedding fallback.
 *   - TRANSFORMERS_CACHE env var sets the local model cache directory.
 */

import 'dotenv/config';
import { pipeline, env } from '@huggingface/transformers';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const EXPECTED_DIM = 384;

// BGE retrieval instruction — prepended to query embeddings only.
// From the BAAI/bge-small-en-v1.5 model card:
//   "For retrieval, queries should be prefixed with this instruction."
// Document/chunk embeddings must NOT use this prefix.
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

// ─── Cache configuration ──────────────────────────────────────────────────────

// Allow TRANSFORMERS_CACHE to override the default HuggingFace cache location.
// Useful in development to keep model files inside the project data directory
// and to prevent re-downloading on every clean install.
// Default: platform-specific HuggingFace cache (~/.cache/huggingface)
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

// ─── Singleton state ──────────────────────────────────────────────────────────

/** @type {import('@huggingface/transformers').FeatureExtractionPipeline | null} */
let _embedder = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the embedding pipeline.
 * Must be called once at server startup before app.listen().
 * Subsequent calls are no-ops (returns immediately if already loaded).
 *
 * On failure: logs the error and throws — server startup must not proceed.
 * Do not catch and continue with a fallback.
 *
 * First call downloads the model (~45 MB ONNX weights + tokenizer files)
 * to TRANSFORMERS_CACHE. Subsequent starts use the cached files.
 *
 * @returns {Promise<void>}
 */
export async function loadEmbedder() {
  if (_embedder !== null) return; // already loaded

  console.log(`[embeddings] Loading model ${MODEL_ID}...`);
  if (process.env.TRANSFORMERS_CACHE) {
    console.log(`[embeddings] Cache directory: ${process.env.TRANSFORMERS_CACHE}`);
  }

  const t0 = Date.now();

  try {
    _embedder = await pipeline('feature-extraction', MODEL_ID);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[embeddings] ${MODEL_ID} ready in ${elapsed}s`);
  } catch (err) {
    // Do not leak internal paths or sensitive info in the message
    console.error(`[embeddings] Failed to load ${MODEL_ID}: ${err.message}`);
    throw new Error(`Embedding model initialization failed. Check TRANSFORMERS_CACHE and network access.`);
  }
}

/**
 * Returns true if the embedding pipeline is initialized and ready.
 * @returns {boolean}
 */
export function isEmbedderReady() {
  return _embedder !== null;
}

/**
 * Embed a document chunk for indexing.
 * Does NOT apply any query-specific prefix — suitable for knowledge base text.
 *
 * @param {string} text — non-empty string to embed
 * @returns {Promise<number[]>} — array of 384 normalized float values
 * @throws if embedder not loaded, input invalid, or output dimension wrong
 */
export async function embedText(text) {
  _assertReady();
  _assertValidInput(text);

  const output = await _embedder(text, { pooling: 'mean', normalize: true });
  return _extractAndValidate(output, text);
}

/**
 * Embed a user retrieval query.
 * Applies the BGE retrieval instruction prefix before embedding.
 * Use this for all user queries going into similarity search.
 *
 * @param {string} text — non-empty query string
 * @returns {Promise<number[]>} — array of 384 normalized float values
 * @throws if embedder not loaded, input invalid, or output dimension wrong
 */
export async function embedQuery(text) {
  _assertReady();
  _assertValidInput(text);

  const prefixed = `${BGE_QUERY_PREFIX}${text}`;
  const output = await _embedder(prefixed, { pooling: 'mean', normalize: true });
  return _extractAndValidate(output, text);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _assertReady() {
  if (_embedder === null) {
    throw new Error(
      '[embeddings] Embedder not initialized. Call loadEmbedder() at startup before using embedText() or embedQuery().'
    );
  }
}

function _assertValidInput(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('[embeddings] Input must be a non-empty string.');
  }
}

/**
 * Extract the float32 array from the Transformers.js pipeline output,
 * convert to a plain JS number[], and validate the dimension.
 */
function _extractAndValidate(output, originalText) {
  // Transformers.js feature-extraction returns a Tensor.
  // output.data is a Float32Array of shape [1, seq_len, hidden_dim] flattened,
  // but with pooling:'mean' it reduces to shape [1, hidden_dim].
  const data = output.data ?? output;
  const vec = Array.from(data);

  if (vec.length !== EXPECTED_DIM) {
    throw new Error(
      `[embeddings] Unexpected embedding dimension: got ${vec.length}, expected ${EXPECTED_DIM}. ` +
      `Model: ${MODEL_ID}. Input snippet: "${String(originalText).slice(0, 60)}"`
    );
  }

  return vec;
}
