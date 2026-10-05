/**
 * server/src/architect/schema.js
 *
 * Zod schema for the AI RAG Architect plan.
 * Validates and enforces runtime constraints before persistence.
 *
 * Runtime constraints enforced here:
 *   - embedding model: always Xenova/bge-small-en-v1.5
 *   - embedding dimension: always 384
 *   - retrieval strategy: always "similarity"
 *   - similarity metric: always "cosine"
 *   - reranking: always disabled
 *   - chunk_size: 200–1500
 *   - chunk_overlap: 0–300, must be < chunk_size
 *   - top_k: 1–10
 */

import { z } from 'zod';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const KnowledgeProfileSchema = z.object({
  document_count:    z.number().int().min(0),
  document_types:    z.array(z.string()),
  structure:         z.string().optional().default(''),
  language:          z.string().optional().default('English'),
  notes:             z.string().optional().default(''),
});

const ChunkingSchema = z.object({
  // Executable strategies for the current runtime.
  // 'semantic' is intentionally excluded — it is not an executable strategy
  // at MVP. If the LLM recommends it, normalizeRawPlan() redirects it to
  // 'recursive' and adds a future_recommendation explaining why.
  strategy:      z.enum(['fixed', 'recursive', 'structure-aware']),
  chunk_size:    z.number().int().min(200).max(1500),
  chunk_overlap: z.number().int().min(0).max(300),
  reason:        z.string().min(1),
}).refine(
  d => d.chunk_overlap < d.chunk_size,
  { message: 'chunk_overlap must be less than chunk_size', path: ['chunk_overlap'] }
);

const EmbeddingSchema = z.object({
  // Runtime constraint: always BGE small
  model:     z.literal('Xenova/bge-small-en-v1.5'),
  dimension: z.literal(384),
  reason:    z.string().min(1),
});

const RetrievalSchema = z.object({
  // Runtime constraints: similarity/cosine only, no reranking
  active_strategy:  z.literal('similarity'),
  similarity_metric: z.literal('cosine'),
  top_k:            z.number().int().min(1).max(10),
  reranking: z.object({
    enabled: z.literal(false),
    model:   z.null(),
  }),
  reason: z.string().min(1),
});

const GenerationSchema = z.object({
  grounding_required: z.boolean(),
  response_style:     z.string().min(1),
  reason:             z.string().min(1),
});

const FutureRecommendationSchema = z.object({
  feature: z.string(),
  reason:  z.string(),
});

// ─── Full plan schema ─────────────────────────────────────────────────────────

export const ArchitectPlanSchema = z.object({
  domain:            z.string().min(1),
  use_case:          z.string().min(1),
  knowledge_profile: KnowledgeProfileSchema,
  // Phase 10A: OCR flag — set by planner when scanned/image-heavy docs detected.
  // When true, workflowBuilder inserts OCR between DocumentUpload and TextSplitter.
  requires_ocr:      z.boolean().default(false),
  ocr_reason:        z.string().optional().default(''),
  chunking:          ChunkingSchema,
  embedding:         EmbeddingSchema,
  retrieval:         RetrievalSchema,
  generation:        GenerationSchema,
  future_recommendations: z.array(FutureRecommendationSchema).default([]),
  summary:           z.string().min(1),
});

/**
 * Apply runtime constraints to raw LLM output before Zod validation.
 * Clamps numeric values and forces fixed runtime settings.
 * Returns the normalized object (Zod validation still runs after).
 */
export function normalizeRawPlan(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  // Phase 10A: Ensure requires_ocr is a boolean (LLM may omit it or return a string)
  if (typeof raw.requires_ocr !== 'boolean') {
    raw.requires_ocr = raw.requires_ocr === 'true' || raw.requires_ocr === true;
  }
  if (typeof raw.ocr_reason !== 'string') {
    raw.ocr_reason = '';
  }

  // Force fixed runtime values regardless of what the LLM returned
  if (raw.embedding) {
    raw.embedding.model     = 'Xenova/bge-small-en-v1.5';
    raw.embedding.dimension = 384;
  }
  if (raw.retrieval) {
    raw.retrieval.active_strategy   = 'similarity';
    raw.retrieval.similarity_metric = 'cosine';
    raw.retrieval.reranking         = { enabled: false, model: null };
    if (typeof raw.retrieval.top_k === 'number') {
      raw.retrieval.top_k = Math.max(1, Math.min(10, Math.round(raw.retrieval.top_k)));
    }
  }
  if (raw.chunking) {
    if (typeof raw.chunking.chunk_size === 'number') {
      raw.chunking.chunk_size = Math.max(200, Math.min(1500, Math.round(raw.chunking.chunk_size)));
    }
    if (typeof raw.chunking.chunk_overlap === 'number') {
      const maxOverlap = Math.min(300, (raw.chunking.chunk_size || 1000) - 1);
      raw.chunking.chunk_overlap = Math.max(0, Math.min(maxOverlap, Math.round(raw.chunking.chunk_overlap)));
    }

    // 'semantic' is NOT an executable strategy at MVP.
    // Redirect to 'recursive' (natural paragraph/sentence boundaries are the
    // closest supported approximation) and record it as a future recommendation.
    if (raw.chunking.strategy === 'semantic') {
      raw.chunking.strategy = 'recursive';
      raw.chunking.reason   =
        `[Strategy normalized from 'semantic' to 'recursive': true semantic segmentation ` +
        `requires embedding-based boundary detection which is not available in the current runtime. ` +
        `Recursive chunking on paragraph/sentence boundaries is the closest supported equivalent.] ` +
        (raw.chunking.reason || '');

      // Add to future_recommendations so the user knows what was downgraded
      if (!Array.isArray(raw.future_recommendations)) {
        raw.future_recommendations = [];
      }
      const alreadyExists = raw.future_recommendations.some(
        r => typeof r.feature === 'string' && r.feature.toLowerCase().includes('semantic')
      );
      if (!alreadyExists) {
        raw.future_recommendations.push({
          feature: 'semantic_chunking',
          reason:  'True semantic chunking would split text at topic boundaries using embedding similarity, ' +
                   'preserving coherent meaning units better than fixed or paragraph-based splits. ' +
                   'Not available in the current MVP runtime; recursive paragraph chunking is used instead.',
        });
      }
    }
  }

  return raw;
}
