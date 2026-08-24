/**
 * server/src/nodeCapabilityRegistry.js
 *
 * Phase 9A: Central node capability registry.
 *
 * Defines what every node type IS and whether the backend can actually
 * execute it at runtime. A node is "supported" only when the backend
 * genuinely knows how to execute it end-to-end.
 *
 * runtime_status values:
 *   "supported"    — executable, tested, used in active workflows
 *   "experimental" — partially wired, not safe for production activation
 *   "unavailable"  — palette only, no backend execution
 *
 * input_types / output_types define the data contract for topology validation.
 * These are simple string tokens — not a type system. The validator checks
 * that output_types of a source node overlap with input_types of a target node.
 *
 * affects_ingestion:        true if changing this node's config requires
 *                           document re-indexing to take effect
 * affects_query_runtime:    true if this node is used during query time
 * requires_reindex_on_change: true if param changes invalidate existing chunks
 */

export const NODE_REGISTRY = {

  // ── SUPPORTED (active, tested, used by Phase 8 pipeline) ─────────────────

  DocumentUpload: {
    type:                    'DocumentUpload',
    label:                   'Knowledge Source',
    category:                'Input',
    runtime_status:          'supported',
    input_types:             [],                  // pipeline entry point
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: false,            // adding docs → build-pipeline re-indexes
    description:             'Knowledge base documents for this RAG application.',
  },

  TextSplitter: {
    type:                    'TextSplitter',
    label:                   'Text Splitter',
    category:                'Processing',
    runtime_status:          'supported',
    input_types:             ['documents'],
    output_types:            ['chunks'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,             // strategy/size change requires re-index
    description:             'Chunks document text using the Architect-approved strategy (fixed | recursive | structure-aware).',
  },

  Embeddings: {
    type:                    'Embeddings',
    label:                   'Embeddings',
    category:                'Processing',
    runtime_status:          'supported',
    input_types:             ['chunks'],
    output_types:            ['vectors'],
    affects_ingestion:        true,
    affects_query_runtime:    true,
    requires_reindex_on_change: true,             // model change requires full re-embed
    description:             'Embeds text chunks using Xenova/bge-small-en-v1.5 (384-dim, local).',
  },

  VectorStore: {
    type:                    'VectorStore',
    label:                   'Vector Store',
    category:                'Storage',
    runtime_status:          'supported',
    input_types:             ['vectors'],
    output_types:            ['retrieved_chunks'],
    affects_ingestion:        true,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,            // top_k change does not require re-index
    description:             'Supabase PostgreSQL + pgvector exact cosine similarity retrieval.',
  },

  LLM: {
    type:                    'LLM',
    label:                   'Language Model',
    category:                'AI',
    runtime_status:          'supported',
    input_types:             ['retrieved_chunks'],
    output_types:            ['response'],
    affects_ingestion:        false,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,
    description:             'OpenRouter LLM generation with grounding and response style control.',
  },

  ChatOutput: {
    type:                    'ChatOutput',
    label:                   'Chat Output',
    category:                'Output',
    runtime_status:          'supported',
    input_types:             ['response'],
    output_types:            [],                  // pipeline exit point
    affects_ingestion:        false,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,
    description:             'Final assistant response delivered to the user.',
  },

  // ── EXPERIMENTAL (partially wired, not safe for production activation) ───

  APIIntegration: {
    type:                    'APIIntegration',
    label:                   'API Integration',
    category:                'Integration',
    runtime_status:          'experimental',
    input_types:             ['retrieved_chunks', 'response'],
    output_types:            ['api_data'],
    affects_ingestion:        false,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,
    description:             'External API call for real-time data enrichment. Not executable in current runtime.',
  },

  DocumentProcessor: {
    type:                    'DocumentProcessor',
    label:                   'Doc Processor',
    category:                'Processing',
    runtime_status:          'experimental',
    input_types:             ['documents'],
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,
    description:             'Extended document parsing with table/image extraction. Not executable in current runtime.',
  },

  // ── UNAVAILABLE (palette only, no backend execution) ─────────────────────

  WebCrawler: {
    type:                    'WebCrawler',
    label:                   'Web Crawler',
    category:                'Input',
    runtime_status:          'unavailable',
    input_types:             [],
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: false,
    description:             'Web content ingestion. Coming soon.',
  },

  VoiceRecognition: {
    type:                    'VoiceRecognition',
    label:                   'Voice to Text',
    category:                 'Input',
    runtime_status:          'unavailable',
    input_types:             ['audio'],
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: false,
    description:             'Speech-to-text input. Coming soon.',
  },

  OCR: {
    type:                    'OCR',
    label:                   'OCR Layer',
    category:                'Processing',
    runtime_status:          'unavailable',
    input_types:             ['documents'],
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,
    description:             'Optical character recognition for scanned documents. Coming soon.',
  },

  Translator: {
    type:                    'Translator',
    label:                   'Translator',
    category:                'Processing',
    runtime_status:          'unavailable',
    input_types:             ['documents', 'chunks'],
    output_types:            ['documents', 'chunks'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,
    description:             'Language translation preprocessing. Coming soon.',
  },

  DataFilter: {
    type:                    'DataFilter',
    label:                   'Data Filter',
    category:                'Processing',
    runtime_status:          'unavailable',
    input_types:             ['documents', 'chunks'],
    output_types:            ['documents', 'chunks'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,
    description:             'Content filtering and deduplication. Coming soon.',
  },

  DataValidation: {
    type:                    'DataValidation',
    label:                   'Data Validation',
    category:                'Processing',
    runtime_status:          'unavailable',
    input_types:             ['documents', 'chunks'],
    output_types:            ['documents', 'chunks'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: false,
    description:             'Schema validation and quality checks. Coming soon.',
  },

  ImageAnalysis: {
    type:                    'ImageAnalysis',
    label:                   'Image Analysis',
    category:                'Processing',
    runtime_status:          'unavailable',
    input_types:             ['documents'],
    output_types:            ['documents'],
    affects_ingestion:        true,
    affects_query_runtime:    false,
    requires_reindex_on_change: true,
    description:             'Image captioning and visual content extraction. Coming soon.',
  },

  CustomCode: {
    type:                    'CustomCode',
    label:                   'Custom Code',
    category:                'Advanced',
    runtime_status:          'unavailable',
    input_types:             ['documents', 'chunks', 'response'],
    output_types:            ['documents', 'chunks', 'response'],
    affects_ingestion:        true,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,
    description:             'Custom Python/JS processing logic. Coming soon.',
  },

  CodeExecution: {
    type:                    'CodeExecution',
    label:                   'Code Execution',
    category:                'Advanced',
    runtime_status:          'unavailable',
    input_types:             ['documents', 'chunks', 'response'],
    output_types:            ['documents', 'chunks', 'response'],
    affects_ingestion:        true,
    affects_query_runtime:    true,
    requires_reindex_on_change: false,
    description:             'Sandboxed code execution environment. Coming soon.',
  },
};

/**
 * Get a node's capability entry. Returns null for unknown types.
 * @param {string} nodeType
 * @returns {object | null}
 */
export function getNodeCapability(nodeType) {
  return NODE_REGISTRY[nodeType] ?? null;
}

/**
 * Get the full capability registry as an array (for API exposure).
 * @returns {object[]}
 */
export function getAllCapabilities() {
  return Object.values(NODE_REGISTRY);
}

/**
 * Returns true if the node type is executable in the current runtime.
 * @param {string} nodeType
 * @returns {boolean}
 */
export function isNodeExecutable(nodeType) {
  return NODE_REGISTRY[nodeType]?.runtime_status === 'supported';
}

/**
 * Returns the set of node types required for a minimal valid RAG pipeline.
 */
export const REQUIRED_NODE_TYPES = new Set([
  'DocumentUpload',
  'TextSplitter',
  'Embeddings',
  'VectorStore',
  'LLM',
  'ChatOutput',
]);
