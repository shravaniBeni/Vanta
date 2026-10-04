/**
 * server/src/workflowBuilder.js
 *
 * Phase 8: Deterministic workflow compiler.
 *
 * Converts an approved architect_plan into React Flow-compatible
 * nodes[] and connections[].
 *
 * CONTRACT:
 *   - Pure function: no LLM calls, no DB writes, no embeddings
 *   - Same approved plan always produces the same logical workflow
 *   - All node types match the existing Editor node registry
 *   - Node params match what NodeProperties.jsx and chat.js expect
 *
 * NODE TYPE MAPPING (architect_plan → existing node type):
 *   Knowledge source     → DocumentUpload   (params: rag_app_id, document_count, documents[])
 *   Chunking             → TextSplitter     (params: chunk_size, overlap, strategy, architect_version)
 *   Embedding            → Embeddings       (params: model, dimension, provider, normalize)
 *   Vector store/retrieval → VectorStore    (params: type, metric, top_k, reranking, vector_dimension)
 *   LLM/generation       → LLM             (params: model, temperature, grounding_required, response_style)
 *   Output               → ChatOutput      (params: architect_version)
 *
 * POSITION LAYOUT: nodes are arranged left-to-right in a single row at y=220.
 * x positions are spaced 240px apart starting at x=80.
 */

// ─── Supported executable strategies ─────────────────────────────────────────

const SUPPORTED_STRATEGIES = new Set(['fixed', 'recursive', 'structure-aware']);
// ─── LLM model mapping ────────────────────────────────────────────────────────
// response_style and temperature are INDEPENDENT fields.
// temperature is a numeric hint derived from the style for the initial workflow,
// but response_style is stored separately as a string so the runtime can use it
// as a prompt instruction. Changing one does not change the other.
// Both are stored in LLM.params.

const RESPONSE_STYLE_TEMPERATURE = {
  'concise and factual': 0.2,
  'factual':             0.2,
  'concise':             0.3,
  'step-by-step':        0.3,
  'detailed':            0.5,
  'conversational':      0.7,
};

function styleToTemperature(style = '') {
  const lower = style.toLowerCase();
  for (const [key, val] of Object.entries(RESPONSE_STYLE_TEMPERATURE)) {
    if (lower.includes(key)) return val;
  }
  return 0.4; // safe default for a RAG assistant
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a workflow from an approved Architect plan.
 *
 * @param {{
 *   ragAppId: string,
 *   architectPlan: object,
 *   architectVersion: number,
 *   documents: Array<{ id: string, file_name: string, status: string }>
 * }} params
 *
 * @returns {{ nodes: object[], connections: object[] }}
 * @throws if the plan contains an unsupported strategy or missing required fields
 */
export function buildWorkflowFromArchitectPlan({ ragAppId, architectPlan, architectVersion, documents }) {
  // ── Validate plan completeness ─────────────────────────────────────────────
  if (!architectPlan) {
    throw new Error('[workflowBuilder] No architect_plan provided');
  }
  if (!architectPlan.chunking) {
    throw new Error('[workflowBuilder] architect_plan.chunking is missing');
  }
  if (!architectPlan.embedding) {
    throw new Error('[workflowBuilder] architect_plan.embedding is missing');
  }
  if (!architectPlan.retrieval) {
    throw new Error('[workflowBuilder] architect_plan.retrieval is missing');
  }
  if (!architectPlan.generation) {
    throw new Error('[workflowBuilder] architect_plan.generation is missing');
  }

  // ── Validate strategy ──────────────────────────────────────────────────────
  const strategy = architectPlan.chunking.strategy;
  if (!SUPPORTED_STRATEGIES.has(strategy)) {
    throw new Error(
      `[workflowBuilder] Unsupported chunking strategy '${strategy}'. ` +
      `Supported: ${[...SUPPORTED_STRATEGIES].join(', ')}. ` +
      `This indicates normalizeRawPlan() was bypassed.`
    );
  }

  // ── Validate numeric bounds ────────────────────────────────────────────────
  const { chunk_size, chunk_overlap } = architectPlan.chunking;
  if (!Number.isInteger(chunk_size) || chunk_size < 200 || chunk_size > 1500) {
    throw new Error(`[workflowBuilder] Invalid chunk_size: ${chunk_size}`);
  }
  if (!Number.isInteger(chunk_overlap) || chunk_overlap < 0 || chunk_overlap >= chunk_size) {
    throw new Error(`[workflowBuilder] Invalid chunk_overlap: ${chunk_overlap}`);
  }

  const topK = architectPlan.retrieval.top_k;
  if (!Number.isInteger(topK) || topK < 1 || topK > 10) {
    throw new Error(`[workflowBuilder] Invalid top_k: ${topK}`);
  }

  // ── Stable node IDs ────────────────────────────────────────────────────────
  // Using descriptive deterministic IDs so the workflow is reproducible
  // and traceable to the architect version that produced it.
  const requiresOcr = architectPlan.requires_ocr === true;

  const nodeIds = {
    knowledge:  'knowledge-source',
    ocr:        'ocr',              // only present when requires_ocr === true
    chunking:   'chunking',
    embedding:  'embedding',
    retrieval:  'retrieval',
    generation: 'generation',
    output:     'output',
  };

  // ── Node positions (left-to-right, single row) ─────────────────────────────
  const y = 220;
  const positions = requiresOcr ? {
    [nodeIds.knowledge]:  { x: 80,   y },
    [nodeIds.ocr]:        { x: 320,  y },
    [nodeIds.chunking]:   { x: 560,  y },
    [nodeIds.embedding]:  { x: 800,  y },
    [nodeIds.retrieval]:  { x: 1040, y },
    [nodeIds.generation]: { x: 1280, y },
    [nodeIds.output]:     { x: 1520, y },
  } : {
    [nodeIds.knowledge]:  { x: 80,   y },
    [nodeIds.chunking]:   { x: 320,  y },
    [nodeIds.embedding]:  { x: 560,  y },
    [nodeIds.retrieval]:  { x: 800,  y },
    [nodeIds.generation]: { x: 1040, y },
    [nodeIds.output]:     { x: 1280, y },
  };

  // ── Build nodes ────────────────────────────────────────────────────────────

  const nodes = [
    // 1. Knowledge source — DocumentUpload
    {
      id:    nodeIds.knowledge,
      type:  'DocumentUpload',
      label: 'Knowledge Source',
      x:     positions[nodeIds.knowledge].x,
      y:     positions[nodeIds.knowledge].y,
      params: {
        rag_app_id:     ragAppId,
        document_count: documents.length,
        documents:      documents.map(d => ({
          id:        d.id,
          file_name: d.file_name,
          status:    d.status,
        })),
        architect_version: architectVersion,
      },
    },

    // 2. OCR — only present when requires_ocr === true
    ...(requiresOcr ? [{
      id:    nodeIds.ocr,
      type:  'OCR',
      label: 'OCR Layer',
      x:     positions[nodeIds.ocr].x,
      y:     positions[nodeIds.ocr].y,
      params: {
        language:             architectPlan.ocr?.language             ?? 'eng',
        dpi:                  architectPlan.ocr?.dpi                  ?? 300,
        confidence_threshold: architectPlan.ocr?.confidence_threshold ?? 60,
        fallback_on_failure:  architectPlan.ocr?.fallback_on_failure  ?? false,
        architect_version:    architectVersion,
        reason:               'Document profiling detected scanned/image-heavy pages requiring OCR.',
      },
    }] : []),

    // 3. Chunking — TextSplitter
    {
      id:    nodeIds.chunking,
      type:  'TextSplitter',
      label: 'Text Splitter',
      x:     positions[nodeIds.chunking].x,
      y:     positions[nodeIds.chunking].y,
      params: {
        strategy:          strategy,
        chunk_size:        chunk_size,
        overlap:           chunk_overlap,
        chunk_overlap:     chunk_overlap,
        architect_version: architectVersion,
        reason:            architectPlan.chunking.reason || '',
      },
    },

    // 4. Embedding — Embeddings
    {
      id:    nodeIds.embedding,
      type:  'Embeddings',
      label: 'Embeddings',
      x:     positions[nodeIds.embedding].x,
      y:     positions[nodeIds.embedding].y,
      params: {
        model:             architectPlan.embedding.model      || 'Xenova/bge-small-en-v1.5',
        dimension:         architectPlan.embedding.dimension  || 384,
        provider:          'local',
        normalize:         true,
        architect_version: architectVersion,
        reason:            architectPlan.embedding.reason || '',
      },
    },

    // 5. Retrieval — VectorStore
    {
      id:    nodeIds.retrieval,
      type:  'VectorStore',
      label: 'Vector Store',
      x:     positions[nodeIds.retrieval].x,
      y:     positions[nodeIds.retrieval].y,
      params: {
        type:              'pgvector',
        metric:            architectPlan.retrieval.similarity_metric || 'cosine',
        top_k:             topK,
        reranking:         false,
        vector_dimension:  architectPlan.embedding.dimension || 384,
        architect_version: architectVersion,
        reason:            architectPlan.retrieval.reason || '',
      },
    },

    // 6. Generation — LLM
    {
      id:    nodeIds.generation,
      type:  'LLM',
      label: 'Language Model',
      x:     positions[nodeIds.generation].x,
      y:     positions[nodeIds.generation].y,
      params: {
        model:              'openai/gpt-4o-mini',
        temperature:        styleToTemperature(architectPlan.generation.response_style),
        grounding_required: architectPlan.generation.grounding_required,
        response_style:     architectPlan.generation.response_style || '',
        architect_version:  architectVersion,
        reason:             architectPlan.generation.reason || '',
      },
    },

    // 7. Output — ChatOutput
    {
      id:    nodeIds.output,
      type:  'ChatOutput',
      label: 'Chat Output',
      x:     positions[nodeIds.output].x,
      y:     positions[nodeIds.output].y,
      params: {
        architect_version: architectVersion,
      },
    },
  ];

  // ── Build connections ──────────────────────────────────────────────────────
  // With OCR:    knowledge → ocr → chunking → embedding → retrieval → generation → output
  // Without OCR: knowledge → chunking → embedding → retrieval → generation → output
  const connections = requiresOcr ? [
    { from: nodeIds.knowledge,  to: nodeIds.ocr       },
    { from: nodeIds.ocr,        to: nodeIds.chunking   },
    { from: nodeIds.chunking,   to: nodeIds.embedding  },
    { from: nodeIds.embedding,  to: nodeIds.retrieval  },
    { from: nodeIds.retrieval,  to: nodeIds.generation },
    { from: nodeIds.generation, to: nodeIds.output     },
  ] : [
    { from: nodeIds.knowledge,  to: nodeIds.chunking   },
    { from: nodeIds.chunking,   to: nodeIds.embedding  },
    { from: nodeIds.embedding,  to: nodeIds.retrieval  },
    { from: nodeIds.retrieval,  to: nodeIds.generation },
    { from: nodeIds.generation, to: nodeIds.output     },
  ];

  return { nodes, connections };
}
