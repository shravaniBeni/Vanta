/**
 * client/src/lib/standaloneCodeGen.js
 *
 * Phase 9D Correction: Deterministic standalone RAG application generator.
 *
 * Converts the ACTIVE Vanta workflow into a self-contained Node.js project
 * that can be run independently of Vanta.
 *
 * CONTRACT:
 *   - Pure function: no LLM, no network, no DB writes, no side effects
 *   - Deterministic: same workflow always produces the same files
 *   - Generated code uses REAL packages/APIs matching Vanta's actual runtime:
 *       @huggingface/transformers (Xenova/bge-small-en-v1.5)
 *       @supabase/supabase-js (pgvector)
 *       openai SDK pointing to OpenRouter
 *       pdf-parse, mammoth, csv-parse
 *   - NEVER mutates the workflow
 *   - NEVER generates code for unavailable/unsupported capabilities
 *   - Returns a structured project: { files: [{path, content, language}] }
 *
 * Validation before generation:
 *   1. workflow must have nodes
 *   2. all nodes must be "supported" in the client registry
 *   3. required pipeline stages must be present
 *   4. required configuration must exist on each node
 */

// ─── Client-side capability registry (mirrors server/src/nodeCapabilityRegistry.js) ──

const CLIENT_REGISTRY = {
  DocumentUpload:    { runtime_status: 'supported'    },
  TextSplitter:      { runtime_status: 'supported'    },
  Embeddings:        { runtime_status: 'supported'    },
  VectorStore:       { runtime_status: 'supported'    },
  LLM:               { runtime_status: 'supported'    },
  ChatOutput:        { runtime_status: 'supported'    },
  APIIntegration:    { runtime_status: 'experimental' },
  DocumentProcessor: { runtime_status: 'experimental' },
  WebCrawler:        { runtime_status: 'unavailable'  },
  VoiceRecognition:  { runtime_status: 'unavailable'  },
  OCR:               { runtime_status: 'supported'    },
  Translator:        { runtime_status: 'unavailable'  },
  DataFilter:        { runtime_status: 'unavailable'  },
  DataValidation:    { runtime_status: 'unavailable'  },
  ImageAnalysis:     { runtime_status: 'unavailable'  },
  CustomCode:        { runtime_status: 'unavailable'  },
  CodeExecution:     { runtime_status: 'unavailable'  },
};

// ─── Generation result types ──────────────────────────────────────────────────

/**
 * @typedef {{ path: string, content: string, language: string }} GeneratedFile
 *
 * @typedef {{
 *   ok: true,
 *   files: GeneratedFile[],
 *   config: object,
 * } | {
 *   ok: false,
 *   errors: string[],
 *   files: [],
 * }} GenerationResult
 */

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(chatbot) {
  const errors = [];
  const nodes = chatbot.nodes || [];
  const connections = chatbot.connections || [];

  if (nodes.length === 0) {
    errors.push('Workflow has no nodes. Activate a workflow through the Architect first.');
    return errors;
  }

  // Check all nodes are supported
  for (const node of nodes) {
    const cap = CLIENT_REGISTRY[node.type];
    if (!cap) {
      errors.push(`Unknown node type "${node.type}" — code generation is not supported for unrecognized node types.`);
      continue;
    }
    if (cap.runtime_status === 'unavailable') {
      errors.push(`Node "${node.type}" is unavailable in the Vanta runtime. Standalone code generation is blocked until this capability is implemented.`);
    } else if (cap.runtime_status === 'experimental') {
      errors.push(`Node "${node.type}" is experimental and not safe for production. Standalone code generation requires all nodes to be fully supported.`);
    }
  }

  if (errors.length > 0) return errors;

  // Required node types
  const presentTypes = new Set(nodes.map(n => n.type));
  const required = ['DocumentUpload', 'TextSplitter', 'Embeddings', 'VectorStore', 'LLM', 'ChatOutput'];
  for (const r of required) {
    if (!presentTypes.has(r)) {
      errors.push(`Required node "${r}" is missing from the active workflow.`);
    }
  }

  // Required config on TextSplitter
  const splitter = nodes.find(n => n.type === 'TextSplitter');
  if (splitter) {
    const { chunk_size, strategy } = splitter.params || {};
    if (!chunk_size) errors.push('TextSplitter is missing chunk_size configuration.');
    if (!strategy)   errors.push('TextSplitter is missing strategy configuration.');
    const supported = new Set(['fixed', 'recursive', 'structure-aware']);
    if (strategy && !supported.has(strategy)) {
      errors.push(`TextSplitter strategy "${strategy}" is not executable. Supported: fixed, recursive, structure-aware.`);
    }
  }

  // Required config on VectorStore
  const vs = nodes.find(n => n.type === 'VectorStore');
  if (vs) {
    if (!vs.params?.top_k) errors.push('VectorStore is missing top_k configuration.');
  }

  // Required config on LLM
  const llm = nodes.find(n => n.type === 'LLM');
  if (llm) {
    if (!llm.params?.model) errors.push('LLM is missing model configuration.');
  }

  return errors;
}

// ─── Config extractor ─────────────────────────────────────────────────────────

function extractConfig(chatbot) {
  const nodes = chatbot.nodes;

  const splitter = nodes.find(n => n.type === 'TextSplitter');
  const embeddings = nodes.find(n => n.type === 'Embeddings');
  const vs = nodes.find(n => n.type === 'VectorStore');
  const llm = nodes.find(n => n.type === 'LLM');

  const chunkSize    = splitter?.params?.chunk_size    ?? 1000;
  const chunkOverlap = splitter?.params?.overlap ?? splitter?.params?.chunk_overlap ?? 200;
  const strategy     = splitter?.params?.strategy     ?? 'recursive';

  const embModel     = embeddings?.params?.model     ?? 'Xenova/bge-small-en-v1.5';
  const embDimension = embeddings?.params?.dimension  ?? 384;
  const embNormalize = embeddings?.params?.normalize  !== false; // default true

  const vsType       = vs?.params?.type   ?? 'pgvector';
  const vsMetric     = vs?.params?.metric ?? 'cosine';
  const vsTopK       = vs?.params?.top_k  ?? 5;
  const vsReranking  = vs?.params?.reranking ?? false;
  const vsDimension  = vs?.params?.vector_dimension ?? embDimension;

  const llmModel       = llm?.params?.model             ?? 'openai/gpt-4o-mini';
  const llmTemperature = llm?.params?.temperature        ?? 0.4;
  const llmGrounding   = llm?.params?.grounding_required ?? false;
  const llmStyle       = llm?.params?.response_style     ?? '';

  // Detect if neighbor expansion should be used
  const useNeighborExpansion = strategy === 'structure-aware' || strategy === 'recursive';

  return {
    appId:            chatbot.id,
    appTitle:         chatbot.title,
    appDescription:   chatbot.description || '',
    architectVersion: chatbot.architect_version,

    // Chunking
    chunkSize, chunkOverlap, strategy,

    // Embeddings
    embModel, embDimension, embNormalize,
    bgePrefixForQuery: 'Represent this sentence for searching relevant passages: ',

    // Vector store
    vsType, vsMetric, vsTopK, vsReranking, vsDimension,
    useNeighborExpansion,

    // LLM
    llmModel, llmTemperature, llmGrounding, llmStyle,
  };
}

// ─── File generators ──────────────────────────────────────────────────────────

function genPackageJson(cfg) {
  const pkg = {
    name: cfg.appTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rag-app',
    version: '1.0.0',
    description: cfg.appDescription || `Standalone RAG app generated from Vanta workflow`,
    type: 'module',
    main: 'src/index.js',
    scripts: {
      start: 'node src/index.js',
      ingest: 'node src/ingest.js',
      query: 'node src/query.js'
    },
    dependencies: {
      '@huggingface/transformers': '^3.5.2',
      '@supabase/supabase-js': '^2.45.4',
      'openai': '^4.52.7',
      'pdf-parse': '^1.1.1',
      'mammoth': '^1.7.2',
      'csv-parse': '^5.5.6',
      'dotenv': '^16.4.5',
      'uuid': '^10.0.0',
      'express': '^4.19.2'
    }
  };
  return JSON.stringify(pkg, null, 2);
}

function genEnvExample(cfg) {
  return `# ─── Vanta Standalone RAG — Environment Configuration ───────────────────────
# Copy this file to .env and fill in your credentials.
# Never commit .env to version control.

# ── OpenRouter (LLM) ──────────────────────────────────────────────────────────
# Get your key at https://openrouter.ai/
# The generated app uses model: ${cfg.llmModel}
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# ── Supabase (vector store) ───────────────────────────────────────────────────
# Project URL and anon/service key from https://app.supabase.com/ → Settings → API
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# ── Embedding model cache (optional) ─────────────────────────────────────────
# Directory where Xenova/bge-small-en-v1.5 weights will be cached (~45 MB).
# Defaults to ~/.cache/huggingface if not set.
# TRANSFORMERS_CACHE=./model-cache

# ── Application ───────────────────────────────────────────────────────────────
PORT=3000
`;
}

function genReadme(cfg) {
  return `# ${cfg.appTitle}

${cfg.appDescription ? cfg.appDescription + '\n\n' : ''}Standalone RAG application generated from a Vanta active workflow.
${cfg.architectVersion != null ? `Architect version: ${cfg.architectVersion}\n` : ''}
## Architecture

\`\`\`
Document Upload
     ↓
Text Splitter  (strategy: ${cfg.strategy}, chunk_size: ${cfg.chunkSize}, overlap: ${cfg.chunkOverlap})
     ↓
Embeddings     (${cfg.embModel}, ${cfg.embDimension}-dim, normalize: ${cfg.embNormalize})
     ↓
Vector Store   (Supabase pgvector, metric: ${cfg.vsMetric}, top_k: ${cfg.vsTopK})
     ↓
LLM            (${cfg.llmModel}, temp: ${cfg.llmTemperature}, grounding: ${cfg.llmGrounding})
     ↓
Chat Output
\`\`\`

## Prerequisites

- Node.js 18+
- A Supabase project with pgvector enabled
- An OpenRouter API key (for LLM access)

## Installation

\`\`\`bash
npm install
\`\`\`

## Environment Setup

\`\`\`bash
cp .env.example .env
# Edit .env and set:
#   OPENROUTER_API_KEY=sk-or-v1-...
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_SERVICE_KEY=your-service-role-key
\`\`\`

## Database Setup

Run the following SQL in your Supabase SQL editor to create the vector table:

\`\`\`sql
-- See setup.sql for the full schema
\`\`\`

Or run the included \`setup.sql\` file directly in the Supabase SQL editor.

## Ingest Documents

Place your documents in the \`documents/\` folder, then run:

\`\`\`bash
# Create the documents directory
mkdir -p documents

# Run ingestion (uses node src/ingest.js)
node src/ingest.js
\`\`\`

Supported formats: PDF, DOCX, TXT, MD, CSV

## Start the Server

\`\`\`bash
node src/index.js
\`\`\`

The server starts on \`http://localhost:3000\`.

## Query the RAG

### HTTP API

\`\`\`bash
curl -X POST http://localhost:3000/query \\
  -H "Content-Type: application/json" \\
  -d '{"query": "Your question here"}'
\`\`\`

### CLI

\`\`\`bash
node src/query.js "Your question here"
\`\`\`

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| \`OPENROUTER_API_KEY\` | OpenRouter API key (get at openrouter.ai) |
| \`SUPABASE_URL\` | Supabase project URL |
| \`SUPABASE_SERVICE_KEY\` | Supabase service role key |

## Configuration Summary

| Setting | Value |
|---------|-------|
| Chunking strategy | ${cfg.strategy} |
| Chunk size | ${cfg.chunkSize} chars |
| Chunk overlap | ${cfg.chunkOverlap} chars |
| Embedding model | ${cfg.embModel} |
| Vector dimension | ${cfg.vsDimension} |
| Retrieval metric | ${cfg.vsMetric} |
| Top-K results | ${cfg.vsTopK} |
| LLM model | ${cfg.llmModel} |
| Temperature | ${cfg.llmTemperature} |
| Grounding | ${cfg.llmGrounding ? 'strict (knowledge base only)' : 'flexible'} |
${cfg.llmStyle ? `| Response style | ${cfg.llmStyle} |\n` : ''}\
${cfg.useNeighborExpansion ? '| Neighbor expansion | enabled |\n' : ''}\
`;
}

function genConfig(cfg) {
  return `/**
 * src/config.js — Generated from Vanta active workflow
 * Do NOT edit manually — regenerate from the Vanta Code tab.
 */

import 'dotenv/config';

export const WORKFLOW_CONFIG = {
  appId:    ${JSON.stringify(cfg.appId)},
  appTitle: ${JSON.stringify(cfg.appTitle)},

  chunking: {
    strategy:    ${JSON.stringify(cfg.strategy)},
    chunk_size:  ${cfg.chunkSize},
    chunk_overlap: ${cfg.chunkOverlap},
  },

  embeddings: {
    model:       ${JSON.stringify(cfg.embModel)},
    dimension:   ${cfg.embDimension},
    normalize:   ${cfg.embNormalize},
    queryPrefix: ${JSON.stringify(cfg.bgePrefixForQuery)},
  },

  vectorStore: {
    type:       ${JSON.stringify(cfg.vsType)},
    metric:     ${JSON.stringify(cfg.vsMetric)},
    top_k:      ${cfg.vsTopK},
    reranking:  ${cfg.vsReranking},
    dimension:  ${cfg.vsDimension},
    useNeighborExpansion: ${cfg.useNeighborExpansion},
    maxExpansionNeighbors: 3,
  },

  llm: {
    model:              ${JSON.stringify(cfg.llmModel)},
    temperature:        ${cfg.llmTemperature},
    grounding_required: ${cfg.llmGrounding},
    response_style:     ${JSON.stringify(cfg.llmStyle)},
    max_tokens:         1024,
  },
};

// ─── Runtime credentials (from .env) ─────────────────────────────────────────

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('[config] OPENROUTER_API_KEY not set — LLM calls will fail.');
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[config] Supabase credentials not set — vector store calls will fail.');
}

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const SUPABASE_URL       = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const PORT               = parseInt(process.env.PORT || '3000', 10);
`;
}

function genEmbeddings(cfg) {
  return `/**
 * src/embeddings.js
 *
 * Local embedding service using @huggingface/transformers.
 * Model: ${cfg.embModel} (${cfg.embDimension}-dimensional)
 *
 * Mirrors Vanta's server/src/embeddings.js exactly.
 * The BGE query prefix is applied inside embedQuery() only.
 */

import { pipeline, env } from '@huggingface/transformers';
import { WORKFLOW_CONFIG } from './config.js';

const MODEL_ID = WORKFLOW_CONFIG.embeddings.model;
const EXPECTED_DIM = WORKFLOW_CONFIG.embeddings.dimension;
const BGE_QUERY_PREFIX = WORKFLOW_CONFIG.embeddings.queryPrefix;

if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

let _embedder = null;

export async function loadEmbedder() {
  if (_embedder !== null) return;
  console.log(\`[embeddings] Loading \${MODEL_ID}...\`);
  const t0 = Date.now();
  _embedder = await pipeline('feature-extraction', MODEL_ID);
  console.log(\`[embeddings] Ready in \${((Date.now() - t0) / 1000).toFixed(1)}s\`);
}

export function isEmbedderReady() {
  return _embedder !== null;
}

/**
 * Embed a document chunk for indexing (no prefix).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  _assertReady();
  if (!text || text.trim().length === 0) throw new Error('[embeddings] Input must be non-empty.');
  const out = await _embedder(text, { pooling: 'mean', normalize: ${cfg.embNormalize} });
  return _extract(out, text);
}

/**
 * Embed a retrieval query (applies BGE prefix).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedQuery(text) {
  _assertReady();
  if (!text || text.trim().length === 0) throw new Error('[embeddings] Input must be non-empty.');
  const out = await _embedder(\`\${BGE_QUERY_PREFIX}\${text}\`, { pooling: 'mean', normalize: ${cfg.embNormalize} });
  return _extract(out, text);
}

function _assertReady() {
  if (!_embedder) throw new Error('[embeddings] Call loadEmbedder() first.');
}

function _extract(out, originalText) {
  const vec = Array.from(out.data ?? out);
  if (vec.length !== EXPECTED_DIM) {
    throw new Error(
      \`[embeddings] Unexpected dimension: got \${vec.length}, expected \${EXPECTED_DIM}. Input: "\${String(originalText).slice(0, 60)}"\`
    );
  }
  return vec;
}
`;
}

function genDocumentParser(cfg) {
  // Generates the exact chunkDocument logic from Vanta's documentParser.js
  return `/**
 * src/documentParser.js
 *
 * Text extraction and chunking — mirrors Vanta's server/src/documentParser.js.
 * Strategy: ${cfg.strategy}, chunk_size: ${cfg.chunkSize}, overlap: ${cfg.chunkOverlap}
 */

import path from 'path';
import { WORKFLOW_CONFIG } from './config.js';

const { strategy, chunk_size, chunk_overlap } = WORKFLOW_CONFIG.chunking;

// ─── Text extraction ──────────────────────────────────────────────────────────

/**
 * Extract plain text from a Buffer based on file extension.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<string>}
 */
export async function extractTextFromBuffer(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await Promise.race([
      pdfParse(buffer, { max: 0 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF parsing timed out after 30s')), 30000)),
    ]);
    if (!data?.text) throw new Error('pdf-parse returned no text content');
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === '.csv') {
    const { parse } = await import('csv-parse/sync');
    const raw = buffer.toString('utf-8');
    try {
      const records = parse(raw, { columns: true, skip_empty_lines: true });
      return records.map(r => Object.entries(r).map(([k, v]) => \`\${k}: \${v}\`).join(' | ')).join('\\n');
    } catch {
      return raw;
    }
  }

  return buffer.toString('utf-8');
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Chunk document text using the active workflow configuration.
 * @param {string} text
 * @returns {string[]}
 */
export function chunkDocument(text) {
  if (!text || text.trim().length === 0) return [];
  const clean = text.replace(/\\r\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();

  switch (strategy) {
    case 'recursive':       return _chunkRecursive(clean, chunk_size, chunk_overlap);
    case 'structure-aware': return _chunkStructureAware(clean, chunk_size, chunk_overlap);
    case 'fixed':
    default:
      return _chunkFixed(clean, chunk_size, chunk_overlap);
  }
}

function _chunkFixed(text, cs, co) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + cs, text.length);
    const c = text.slice(start, end).trim();
    if (c.length > 20) chunks.push(c);
    if (end >= text.length) break;
    start += cs - co;
  }
  return chunks;
}

function _chunkRecursive(text, cs, co) {
  const paras = text.split(/\\n\\n+/).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) return _chunkFixed(text, cs, co);
  const chunks = [];
  let current = '';
  for (const para of paras) {
    const candidate = current ? \`\${current}\\n\\n\${para}\` : para;
    if (candidate.length <= cs) {
      current = candidate;
    } else {
      if (current.trim().length > 20) chunks.push(current.trim());
      if (para.length > cs) {
        chunks.push(..._splitOnSentences(para, cs, co));
        current = '';
      } else {
        current = para;
      }
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return co > 0 && chunks.length > 1 ? _applyOverlap(chunks, co) : chunks;
}

function _splitOnSentences(text, cs, co) {
  const sentences = text.split(/(?<=[.!?])\\s+/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    const c = current ? \`\${current} \${s}\` : s;
    if (c.length <= cs) {
      current = c;
    } else {
      if (current.trim().length > 20) chunks.push(current.trim());
      if (s.length > cs) { chunks.push(..._chunkFixed(s, cs, co)); current = ''; }
      else current = s;
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks;
}

const STRUCTURAL_SEPARATORS = [
  /^[A-Z][A-Z\\s]{3,}[A-Z]$/m,
  /^#{1,4}\\s+\\S/m,
  /^\\d{1,2}\\.\\s+[A-Z][a-zA-Z]/m,
  /^\\d+\\.\\d+(\\.\\d+)?\\s+/m,
  /^Step\\s+\\d+[\\s:.]/im,
];

function _chunkStructureAware(text, cs, co) {
  const lines = text.split('\\n');
  const starts = [0];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (STRUCTURAL_SEPARATORS.some(re => re.test(line)) && i > 0) {
      starts.push(lines.slice(0, i).join('\\n').length + 1);
    }
  }
  if (starts.length <= 1) return _chunkRecursive(text, cs, co);
  const sections = [];
  for (let i = 0; i < starts.length; i++) {
    const s = text.slice(starts[i], starts[i + 1] ?? text.length).trim();
    if (s.length > 0) sections.push(s);
  }
  const chunks = [];
  let current = '';
  for (const sec of sections) {
    const c = current ? \`\${current}\\n\\n\${sec}\` : sec;
    if (c.length <= cs) {
      current = c;
    } else {
      if (current.trim().length > 20) chunks.push(current.trim());
      if (sec.length > cs) { chunks.push(..._chunkRecursive(sec, cs, co)); current = ''; }
      else current = sec;
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return co > 0 && chunks.length > 1 ? _applyOverlap(chunks, co) : chunks;
}

function _applyOverlap(chunks, co) {
  const result = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const tail = prev.length > co ? prev.slice(prev.length - co) : prev;
    result.push(\`\${tail}\\n\${chunks[i]}\`);
  }
  return result;
}
`;
}

function genVectorStore(cfg) {
  return `/**
 * src/vectorStore.js
 *
 * Vector store using Supabase pgvector.
 * Mirrors Vanta's server/src/vectorStore.js.
 * Metric: ${cfg.vsMetric}, dimension: ${cfg.vsDimension}, top_k: ${cfg.vsTopK}
 */

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { embedText, embedQuery } from './embeddings.js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, WORKFLOW_CONFIG } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TABLE        = 'document_chunks';
const EXPECTED_DIM = WORKFLOW_CONFIG.vectorStore.dimension;
const TOP_K        = WORKFLOW_CONFIG.vectorStore.top_k;

/**
 * Index a single text chunk by embedding and inserting into document_chunks.
 * @param {{ ragAppId, documentId, fileName, content, chunkIndex }} params
 * @returns {Promise<string>} chunk UUID
 */
export async function indexChunk({ ragAppId, documentId, fileName, content, chunkIndex }) {
  const embedding = await embedText(content);
  if (embedding.length !== EXPECTED_DIM) {
    throw new Error(\`[vectorStore] Unexpected embedding dimension \${embedding.length}\`);
  }

  const id = uuidv4();
  const embeddingStr = \`[\${embedding.join(',')}]\`;

  const { error } = await supabase.from(TABLE).insert({
    id, rag_app_id: ragAppId, document_id: documentId,
    file_name: fileName, content, embedding: embeddingStr,
    chunk_index: chunkIndex, metadata: {},
  });

  if (error) throw new Error(\`[vectorStore] Insert failed: \${error.message}\`);
  return id;
}

/**
 * Retrieve the top-K most similar chunks for a query.
 * @param {string} ragAppId
 * @param {string} query
 * @param {number} [topK]
 * @returns {Promise<Array<{id,content,fileName,score,document_id,chunk_index}>>}
 */
export async function retrieveChunks(ragAppId, query, topK = TOP_K) {
  const queryEmbedding = await embedQuery(query);
  if (queryEmbedding.length !== EXPECTED_DIM) {
    throw new Error(\`[vectorStore] Query embedding dimension mismatch\`);
  }

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: \`[\${queryEmbedding.join(',')}]\`,
    p_rag_app_id:    ragAppId,
    match_count:     topK,
  });

  if (error) throw new Error(\`[vectorStore] match_chunks RPC failed: \${error.message}\`);

  return (data ?? []).map(row => ({
    id:          row.id,
    content:     row.content,
    fileName:    row.file_name,
    score:       row.score,
    document_id: row.document_id,
    chunk_index: row.chunk_index,
  }));
}
${cfg.useNeighborExpansion ? `
/**
 * Expand primary chunks with their immediate structural neighbors.
 * Used with recursive/structure-aware strategies.
 * @param {string} ragAppId
 * @param {Array} primaryChunks
 * @param {number} [maxNeighbors]
 */
export async function expandWithNeighbors(ragAppId, primaryChunks, maxNeighbors = WORKFLOW_CONFIG.vectorStore.maxExpansionNeighbors) {
  if (!primaryChunks.length || maxNeighbors <= 0) return primaryChunks;

  const primaryIds = new Set(primaryChunks.map(c => c.id));
  const expansionChunks = [];

  for (const chunk of primaryChunks) {
    if (expansionChunks.length >= maxNeighbors) break;
    if (chunk.document_id == null || chunk.chunk_index == null) continue;

    const { data: neighbors } = await supabase
      .from(TABLE)
      .select('id, content, file_name, document_id, chunk_index')
      .eq('rag_app_id', ragAppId)
      .eq('document_id', chunk.document_id)
      .eq('chunk_index', chunk.chunk_index + 1)
      .limit(1);

    if (neighbors?.[0] && !primaryIds.has(neighbors[0].id)) {
      primaryIds.add(neighbors[0].id);
      expansionChunks.push({
        id: neighbors[0].id, content: neighbors[0].content,
        fileName: neighbors[0].file_name, score: 0,
        document_id: neighbors[0].document_id, chunk_index: neighbors[0].chunk_index,
        is_expansion: true,
      });
    }
  }
  return [...primaryChunks, ...expansionChunks];
}
` : ''}`;
}

function genGeneration(cfg) {
  // The exact buildRagPrompt logic from chat.js, parameterized
  const groundingComment = cfg.llmGrounding
    ? '// grounding_required: true — answer ONLY from retrieved context'
    : '// grounding_required: false — context-first, general knowledge allowed as supplement';

  return `/**
 * src/generation.js
 *
 * LLM generation using OpenRouter.
 * Model: ${cfg.llmModel}, temperature: ${cfg.llmTemperature}
 * Grounding: ${cfg.llmGrounding ? 'strict' : 'flexible'}
 * ${cfg.llmStyle ? 'Response style: ' + cfg.llmStyle : ''}
 *
 * Mirrors Vanta's buildRagPrompt() from server/src/routes/chat.js.
 */

import OpenAI from 'openai';
import { OPENROUTER_API_KEY, WORKFLOW_CONFIG } from './config.js';

const openai = new OpenAI({
  apiKey:   OPENROUTER_API_KEY,
  baseURL:  'https://openrouter.ai/api/v1',
});

const { model, temperature, grounding_required, response_style, max_tokens } = WORKFLOW_CONFIG.llm;

/**
 * Build a grounded RAG prompt from retrieved chunks and a user query.
 * @param {{ title: string, description: string, chunks: Array<{content:string}>, query: string }} params
 * @returns {string}
 */
export function buildRagPrompt({ title, description, chunks, query }) {
  ${groundingComment}

  let styleInstruction = '';
  if (response_style) {
    const s = response_style.toLowerCase();
    if (s.includes('concise') || s.includes('factual'))
      styleInstruction = 'Respond concisely and factually. Avoid unnecessary elaboration.';
    else if (s.includes('step-by-step'))
      styleInstruction = 'Respond with clear step-by-step structure. Number each step.';
    else if (s.includes('detailed'))
      styleInstruction = 'Provide a detailed, comprehensive response covering all relevant aspects.';
    else if (s.includes('conversational'))
      styleInstruction = 'Respond in a natural, conversational tone.';
    else
      styleInstruction = \`Response style: \${response_style}.\`;
  }

  if (chunks.length === 0) {
    return \`You are "\${title}", an AI assistant.\\n\${description ? \`About you: \${description}\\n\` : ''}No documents have been indexed yet. Inform the user and suggest uploading documents.\\n\\nUser: \${query}\\nAnswer:\`;
  }

  const contextText = chunks
    .map((c, i) => \`[Source \${i + 1}]\\n\${c.content}\`)
    .join('\\n\\n---\\n\\n');

  if (grounding_required) {
    return \`You are "\${title}", an AI assistant.\\n\${description ? \`About you: \${description}\\n\` : ''}\${styleInstruction ? styleInstruction + '\\n' : ''}
IMPORTANT: Answer ONLY using the provided context below. Do NOT use any knowledge outside this context.
If the retrieved context addresses the question, answer completely and accurately using it.
If the context is partially relevant, provide what you can from the context and clearly state what is not covered.
If the context does not address the question at all, state: "The available knowledge base does not contain information about this topic."
Do NOT fabricate information. Preserve all safety warnings and numeric thresholds exactly as stated in the context.

Context:
\${contextText}

User: \${query}
Answer:\`;
  } else {
    return \`You are "\${title}", an AI assistant.\\n\${description ? \`About you: \${description}\\n\` : ''}\${styleInstruction ? styleInstruction + '\\n' : ''}
Use the following retrieved context as your primary source. Supplement with general knowledge only for non-document-specific facts.
Preserve all safety warnings and numeric thresholds exactly as stated in the context.

Context:
\${contextText}

User: \${query}
Answer:\`;
  }
}

/**
 * Send a prompt to the LLM and return the text response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generate(prompt) {
  const resp = await openai.chat.completions.create({
    model,
    temperature,
    max_tokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}
`;
}

function genIngest(cfg) {
  return `/**
 * src/ingest.js
 *
 * Document ingestion: reads files from ./documents/, extracts text,
 * chunks with active workflow config, embeds, and stores in pgvector.
 *
 * Run: node src/ingest.js
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { loadEmbedder } from './embeddings.js';
import { extractTextFromBuffer, chunkDocument } from './documentParser.js';
import { indexChunk } from './vectorStore.js';
import { WORKFLOW_CONFIG } from './config.js';

const DOCUMENTS_DIR = './documents';
const RAG_APP_ID    = WORKFLOW_CONFIG.appId;

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.csv']);

async function ingest() {
  console.log('[ingest] Loading embedding model...');
  await loadEmbedder();

  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.error(\`[ingest] Documents directory not found: \${DOCUMENTS_DIR}\`);
    console.error('[ingest] Create the directory and place your documents inside it, then run again.');
    process.exit(1);
  }

  const files = fs.readdirSync(DOCUMENTS_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (files.length === 0) {
    console.log('[ingest] No supported files found in ./documents/');
    console.log('[ingest] Supported: .pdf .docx .doc .txt .md .csv');
    return;
  }

  console.log(\`[ingest] Found \${files.length} file(s) to process.\`);

  let totalChunks = 0;
  let errors = 0;

  for (const fileName of files) {
    const filePath = path.join(DOCUMENTS_DIR, fileName);
    console.log(\`\\n[ingest] Processing: \${fileName}\`);

    try {
      const buffer = fs.readFileSync(filePath);
      const text = await extractTextFromBuffer(buffer, fileName);

      if (!text || text.trim().length === 0) {
        console.warn(\`[ingest] No text extracted from \${fileName} — skipping.\`);
        continue;
      }

      console.log(\`[ingest] Extracted \${text.length} chars — chunking with strategy "\${WORKFLOW_CONFIG.chunking.strategy}"...\`);
      const chunks = chunkDocument(text);
      console.log(\`[ingest] \${chunks.length} chunks — embedding and indexing...\`);

      const documentId = uuidv4();

      for (let i = 0; i < chunks.length; i++) {
        await indexChunk({
          ragAppId:   RAG_APP_ID,
          documentId,
          fileName,
          content:    chunks[i],
          chunkIndex: i,
        });
        if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
          process.stdout.write(\`\\r  \${i + 1}/\${chunks.length} chunks indexed\`);
        }
      }
      console.log(\`\`); // newline after progress
      totalChunks += chunks.length;
      console.log(\`[ingest] ✓ \${fileName}: \${chunks.length} chunks\`);

    } catch (err) {
      console.error(\`[ingest] ✗ \${fileName}: \${err.message}\`);
      errors++;
    }
  }

  console.log(\`\\n[ingest] Done. \${files.length - errors} files indexed, \${totalChunks} total chunks, \${errors} errors.\`);
}

ingest().catch(err => {
  console.error('[ingest] Fatal:', err.message);
  process.exit(1);
});
`;
}

function genQuery(cfg) {
  return `/**
 * src/query.js
 *
 * CLI query interface for the standalone RAG application.
 *
 * Usage:
 *   node src/query.js "Your question here"
 *   node src/query.js   (interactive mode)
 */

import readline from 'readline';
import { loadEmbedder } from './embeddings.js';
import { retrieveChunks${cfg.useNeighborExpansion ? ', expandWithNeighbors' : ''} } from './vectorStore.js';
import { buildRagPrompt, generate } from './generation.js';
import { WORKFLOW_CONFIG } from './config.js';

async function query(question) {
  // ── Retrieve ─────────────────────────────────────────────────────────────
  let chunks = await retrieveChunks(WORKFLOW_CONFIG.appId, question, WORKFLOW_CONFIG.vectorStore.top_k);
${cfg.useNeighborExpansion ? `
  // Apply neighbor expansion (strategy: ${cfg.strategy} uses structural context expansion)
  chunks = await expandWithNeighbors(WORKFLOW_CONFIG.appId, chunks, WORKFLOW_CONFIG.vectorStore.maxExpansionNeighbors);
` : ''}
  const scores = chunks.filter(c => !c.is_expansion).map(c => c.score);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  console.log(\`[query] Retrieved \${chunks.length} chunks (avg similarity: \${avgScore.toFixed(3)})\`);

  // ── Generate ──────────────────────────────────────────────────────────────
  const prompt = buildRagPrompt({
    title:       WORKFLOW_CONFIG.appTitle,
    description: '',
    chunks,
    query:       question,
  });

  const answer = await generate(prompt);
  return { answer, chunks, avgScore };
}

async function main() {
  await loadEmbedder();

  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Single question mode
    const question = args.join(' ');
    console.log(\`\\nQuestion: \${question}\\n\`);
    const { answer, avgScore } = await query(question);
    console.log(\`Answer:\\n\${answer}\\n\`);
    console.log(\`Confidence: \${(avgScore * 100).toFixed(0)}%\`);
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(\`\\n\${WORKFLOW_CONFIG.appTitle} — Interactive Query\`);
  console.log('Type your question, or "exit" to quit.\\n');

  const ask = () => {
    rl.question('You: ', async (input) => {
      const q = input.trim();
      if (!q || q.toLowerCase() === 'exit') { rl.close(); return; }

      try {
        const { answer, avgScore } = await query(q);
        console.log(\`\\nBot: \${answer}\`);
        console.log(\`Confidence: \${(avgScore * 100).toFixed(0)}%\\n\`);
      } catch (err) {
        console.error(\`Error: \${err.message}\\n\`);
      }
      ask();
    });
  };
  ask();
}

main().catch(err => {
  console.error('[query] Fatal:', err.message);
  process.exit(1);
});
`;
}

function genIndex(cfg) {
  return `/**
 * src/index.js
 *
 * Express HTTP server for the standalone RAG application.
 * POST /query  — send a question, receive an answer
 * GET  /health — health check
 *
 * Start: node src/index.js
 */

import express from 'express';
import { loadEmbedder } from './embeddings.js';
import { retrieveChunks${cfg.useNeighborExpansion ? ', expandWithNeighbors' : ''} } from './vectorStore.js';
import { buildRagPrompt, generate } from './generation.js';
import { WORKFLOW_CONFIG, PORT } from './config.js';

const app = express();
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: WORKFLOW_CONFIG.appTitle });
});

// ─── Query ────────────────────────────────────────────────────────────────────

app.post('/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    // Retrieve
    let chunks = await retrieveChunks(WORKFLOW_CONFIG.appId, query, WORKFLOW_CONFIG.vectorStore.top_k);
${cfg.useNeighborExpansion ? `
    // Neighbor expansion for ${cfg.strategy} strategy
    chunks = await expandWithNeighbors(WORKFLOW_CONFIG.appId, chunks, WORKFLOW_CONFIG.vectorStore.maxExpansionNeighbors);
` : ''}
    const scores    = chunks.filter(c => !c.is_expansion).map(c => c.score);
    const avgScore  = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const chunkText = chunks.map(c => c.content.slice(0, 120) + (c.content.length > 120 ? '...' : ''));

    // Generate
    const prompt = buildRagPrompt({
      title:       WORKFLOW_CONFIG.appTitle,
      description: '',
      chunks,
      query,
    });
    const answer = await generate(prompt);

    res.json({ answer, avgSimilarity: avgScore, retrievedChunks: chunkText });
  } catch (err) {
    console.error('[/query]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  console.log('[server] Loading embedding model...');
  await loadEmbedder();
  app.listen(PORT, () => {
    console.log(\`[server] \${WORKFLOW_CONFIG.appTitle} running on http://localhost:\${PORT}\`);
    console.log(\`[server] POST /query  — ask a question\`);
    console.log(\`[server] GET  /health — health check\`);
  });
}

start().catch(err => {
  console.error('[server] Fatal:', err.message);
  process.exit(1);
});
`;
}

function genSetupSql(cfg) {
  return `-- ─── Standalone RAG Database Setup ──────────────────────────────────────────
-- Run this in your Supabase SQL editor before ingesting documents.
--
-- Vector dimension: ${cfg.vsDimension} (must match embedding model: ${cfg.embModel})

-- Enable pgvector extension
create extension if not exists vector;

-- Document chunks table
create table if not exists document_chunks (
  id           uuid primary key default gen_random_uuid(),
  rag_app_id   text not null,
  document_id  text not null,
  file_name    text,
  content      text not null,
  embedding    vector(${cfg.vsDimension}),
  chunk_index  integer,
  metadata     jsonb default '{}'
);

-- Index for fast approximate cosine search (IVFFlat)
-- Tune 'lists' based on your data size: sqrt(row_count) is a good starting point.
create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Exact cosine similarity search function (used by the application)
create or replace function match_chunks(
  query_embedding vector(${cfg.vsDimension}),
  p_rag_app_id    text,
  match_count     int default ${cfg.vsTopK}
)
returns table (
  id           uuid,
  content      text,
  file_name    text,
  document_id  text,
  chunk_index  integer,
  score        float
)
language sql stable as $$
  select
    id,
    content,
    file_name,
    document_id,
    chunk_index,
    1 - (embedding <=> query_embedding) as score
  from document_chunks
  where rag_app_id = p_rag_app_id
  order by embedding <=> query_embedding
  limit match_count;
$$;
`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate a standalone RAG project from the ACTIVE chatbot workflow.
 *
 * @param {object} chatbot — chatbot object with .nodes, .connections (ACTIVE)
 * @returns {GenerationResult}
 */
export function generateStandaloneCode(chatbot) {
  // ── Step 1: Validate ───────────────────────────────────────────────────────
  const errors = validate(chatbot);
  if (errors.length > 0) {
    return { ok: false, errors, files: [] };
  }

  // ── Step 2: Extract configuration ─────────────────────────────────────────
  const cfg = extractConfig(chatbot);

  // ── Step 3: Generate project files ────────────────────────────────────────
  const files = [
    { path: 'package.json',      content: genPackageJson(cfg),     language: 'json' },
    { path: '.env.example',      content: genEnvExample(cfg),      language: 'bash' },
    { path: 'README.md',         content: genReadme(cfg),          language: 'markdown' },
    { path: 'setup.sql',         content: genSetupSql(cfg),        language: 'sql' },
    { path: 'src/config.js',     content: genConfig(cfg),          language: 'javascript' },
    { path: 'src/embeddings.js', content: genEmbeddings(cfg),      language: 'javascript' },
    { path: 'src/documentParser.js', content: genDocumentParser(cfg), language: 'javascript' },
    { path: 'src/vectorStore.js',content: genVectorStore(cfg),     language: 'javascript' },
    { path: 'src/generation.js', content: genGeneration(cfg),      language: 'javascript' },
    { path: 'src/ingest.js',     content: genIngest(cfg),          language: 'javascript' },
    { path: 'src/query.js',      content: genQuery(cfg),           language: 'javascript' },
    { path: 'src/index.js',      content: genIndex(cfg),           language: 'javascript' },
  ];

  return { ok: true, files, config: cfg };
}
