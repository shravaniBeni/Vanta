/**
 * client/src/lib/workflowCodeGen.js
 *
 * Phase 9D: Deterministic workflow → code representation generator.
 *
 * CONTRACT:
 *   - Pure function: no LLM, no network, no DB writes, no side effects
 *   - Same workflow input always produces the same output
 *   - Never mutates the workflow
 *   - Works entirely from the ACTIVE workflow (chatbot.nodes + chatbot.connections)
 *   - Uses the client-side capability registry to show runtime status
 *
 * Output format: a human-readable JSON-like representation of the pipeline
 * showing node identity, type, runtime status, configuration, and connections.
 */

// ─── Client-side capability registry (mirrors server/src/nodeCapabilityRegistry.js) ──

const CLIENT_REGISTRY = {
  DocumentUpload:    { label: 'Knowledge Source', category: 'Input',       runtime_status: 'supported',    affects_ingestion: true,  affects_query_runtime: false },
  TextSplitter:      { label: 'Text Splitter',    category: 'Processing',  runtime_status: 'supported',    affects_ingestion: true,  affects_query_runtime: false },
  Embeddings:        { label: 'Embeddings',        category: 'Processing',  runtime_status: 'supported',    affects_ingestion: true,  affects_query_runtime: true  },
  VectorStore:       { label: 'Vector Store',      category: 'Storage',     runtime_status: 'supported',    affects_ingestion: true,  affects_query_runtime: true  },
  LLM:               { label: 'Language Model',    category: 'AI',          runtime_status: 'supported',    affects_ingestion: false, affects_query_runtime: true  },
  ChatOutput:        { label: 'Chat Output',       category: 'Output',      runtime_status: 'supported',    affects_ingestion: false, affects_query_runtime: true  },
  APIIntegration:    { label: 'API Integration',   category: 'Integration', runtime_status: 'experimental', affects_ingestion: false, affects_query_runtime: true  },
  DocumentProcessor: { label: 'Doc Processor',     category: 'Processing',  runtime_status: 'experimental', affects_ingestion: true,  affects_query_runtime: false },
  WebCrawler:        { label: 'Web Crawler',        category: 'Input',       runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  VoiceRecognition:  { label: 'Voice to Text',     category: 'Input',       runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  OCR:               { label: 'OCR Layer',          category: 'Processing',  runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  Translator:        { label: 'Translator',         category: 'Processing',  runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  DataFilter:        { label: 'Data Filter',        category: 'Processing',  runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  DataValidation:    { label: 'Data Validation',   category: 'Processing',  runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  ImageAnalysis:     { label: 'Image Analysis',    category: 'Processing',  runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: false },
  CustomCode:        { label: 'Custom Code',        category: 'Advanced',    runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: true  },
  CodeExecution:     { label: 'Code Execution',    category: 'Advanced',    runtime_status: 'unavailable',  affects_ingestion: true,  affects_query_runtime: true  },
};

/**
 * Get capability info for a node type. Returns a fallback for unknowns.
 * @param {string} type
 */
function getCapability(type) {
  return CLIENT_REGISTRY[type] ?? {
    label: type,
    category: 'Unknown',
    runtime_status: 'unknown',
    affects_ingestion: false,
    affects_query_runtime: false,
  };
}

// ─── Topology helpers ─────────────────────────────────────────────────────────

/**
 * Build an adjacency map: nodeId → [downstream nodeId, ...]
 */
function buildAdjacency(connections) {
  const adj = {};
  for (const c of connections) {
    if (!adj[c.from]) adj[c.from] = [];
    adj[c.from].push(c.to);
  }
  return adj;
}

/**
 * Topological sort (Kahn's algorithm). Returns an ordered array of node IDs.
 * Falls back to insertion order if the graph has cycles or disconnections.
 */
function topoSort(nodes, connections) {
  const ids = nodes.map(n => n.id);
  const inDegree = Object.fromEntries(ids.map(id => [id, 0]));
  const adj = buildAdjacency(connections);

  for (const c of connections) {
    if (inDegree[c.to] !== undefined) inDegree[c.to]++;
  }

  const queue = ids.filter(id => inDegree[id] === 0);
  const sorted = [];

  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const next of (adj[id] || [])) {
      if (inDegree[next] !== undefined) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      }
    }
  }

  // Any nodes not reached (cycles / disconnected) — append in original order
  const reached = new Set(sorted);
  for (const id of ids) {
    if (!reached.has(id)) sorted.push(id);
  }

  return sorted;
}

// ─── Param serialization ──────────────────────────────────────────────────────

/**
 * Return a clean config object for a node, stripping internal bookkeeping keys
 * and large/noisy fields (like full document lists).
 */
function serializeParams(type, params = {}) {
  const skip = new Set([
    'rag_app_id', 'reason', 'documents', 'uploaded_files',
    'architect_version', 'document_count',
  ]);

  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }

  // For DocumentUpload — show document count instead of the full list
  if (type === 'DocumentUpload') {
    const count = params.document_count ?? (params.documents?.length ?? 0);
    if (count > 0) out.document_count = count;
    const architectVersion = params.architect_version;
    if (architectVersion !== undefined) out.architect_version = architectVersion;
  }

  return out;
}

// ─── Node representation ──────────────────────────────────────────────────────

/**
 * Serialize a single node to a plain object for the code view.
 */
function serializeNode(node, connections) {
  const cap = getCapability(node.type);
  const downstream = connections
    .filter(c => c.from === node.id)
    .map(c => c.to);
  const upstream = connections
    .filter(c => c.to === node.id)
    .map(c => c.from);

  return {
    id:             node.id,
    type:           node.type,
    label:          node.label || cap.label,
    category:       cap.category,
    runtime_status: cap.runtime_status,
    config:         serializeParams(node.type, node.params),
    connects_from:  upstream,
    connects_to:    downstream,
  };
}

// ─── Stage classification ─────────────────────────────────────────────────────

const STAGE_MAP = {
  Input:       'ingestion',
  Processing:  'ingestion',
  Storage:     'ingestion_and_query',
  AI:          'query',
  Output:      'query',
  Integration: 'query',
  Advanced:    'query',
};

function getStage(category) {
  return STAGE_MAP[category] || 'unknown';
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate a deterministic code representation of the ACTIVE workflow.
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   description?: string,
 *   nodes: object[],
 *   connections: object[],
 *   architect_version?: number,
 *   status?: string,
 * }} chatbot  — the ACTIVE chatbot object (chatbot.nodes/connections = active)
 *
 * @returns {{
 *   source: 'active_workflow',
 *   generated_at: string,           — ISO timestamp (for display only)
 *   app: object,
 *   pipeline: object[],             — nodes in topological order
 *   connections: object[],
 *   summary: object,
 *   warnings: string[],
 *   text: string,                   — formatted multi-line string for display
 * }}
 */
export function generateWorkflowCode(chatbot) {
  const nodes       = Array.isArray(chatbot.nodes)       ? chatbot.nodes       : [];
  const connections = Array.isArray(chatbot.connections) ? chatbot.connections : [];

  const warnings = [];

  // ── Empty workflow ─────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    const emptyText = [
      `// ${chatbot.title || 'Untitled'}`,
      `// No active workflow nodes.`,
      `// Build a workflow in the Visual tab and activate it via the Architect to see the code representation.`,
    ].join('\n');

    return {
      source:       'active_workflow',
      generated_at: new Date().toISOString(),
      app: { id: chatbot.id, title: chatbot.title, status: chatbot.status },
      pipeline:     [],
      connections:  [],
      summary:      { node_count: 0, connection_count: 0, executable: false },
      warnings:     ['Workflow has no nodes.'],
      text:         emptyText,
    };
  }

  // ── Topological sort ───────────────────────────────────────────────────────
  const sortedIds    = topoSort(nodes, connections);
  const nodeById     = Object.fromEntries(nodes.map(n => [n.id, n]));
  const sortedNodes  = sortedIds.map(id => nodeById[id]).filter(Boolean);

  const pipeline = sortedNodes.map(n => serializeNode(n, connections));

  // ── Summary stats ──────────────────────────────────────────────────────────
  const statusCounts = { supported: 0, experimental: 0, unavailable: 0, unknown: 0 };
  for (const p of pipeline) {
    statusCounts[p.runtime_status] = (statusCounts[p.runtime_status] || 0) + 1;
  }

  const executable = statusCounts.experimental === 0 &&
                     statusCounts.unavailable   === 0 &&
                     statusCounts.unknown       === 0;

  if (!executable) {
    const nonRunnable = pipeline
      .filter(p => p.runtime_status !== 'supported')
      .map(p => `${p.type} (${p.runtime_status})`);
    warnings.push(`Non-executable nodes present: ${nonRunnable.join(', ')}`);
  }

  // ── Format text output ─────────────────────────────────────────────────────
  const text = _formatText(chatbot, pipeline, connections, executable, warnings);

  return {
    source:       'active_workflow',
    generated_at: new Date().toISOString(),
    app: {
      id:                chatbot.id,
      title:             chatbot.title,
      description:       chatbot.description,
      status:            chatbot.status,
      architect_version: chatbot.architect_version,
    },
    pipeline,
    connections: connections.map(c => ({ from: c.from, to: c.to })),
    summary: {
      node_count:       nodes.length,
      connection_count: connections.length,
      executable,
      status_counts:    statusCounts,
    },
    warnings,
    text,
  };
}

// ─── Text formatter ───────────────────────────────────────────────────────────

const STATUS_ICON = {
  supported:    '✓',
  experimental: '⚠',
  unavailable:  '✕',
  unknown:      '?',
};

const STATUS_LABEL = {
  supported:    'active',
  experimental: 'experimental — not executable in production',
  unavailable:  'unavailable — coming soon',
  unknown:      'unknown type',
};

function _formatText(chatbot, pipeline, connections, executable, warnings) {
  const lines = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(`// ═══════════════════════════════════════════════════════════════`);
  lines.push(`// Vanta · Active Workflow Representation`);
  lines.push(`// Generated from: active workflow (read-only)`);
  lines.push(`// ═══════════════════════════════════════════════════════════════`);
  lines.push('');
  lines.push(`workflow "${chatbot.title}" {`);
  if (chatbot.description) {
    lines.push(`  description: "${chatbot.description.replace(/"/g, '\\"').slice(0, 120)}"`);
  }
  if (chatbot.architect_version != null) {
    lines.push(`  architect_version: ${chatbot.architect_version}`);
  }
  lines.push(`  status: "${chatbot.status || 'draft'}"`);
  lines.push(`  executable: ${executable}`);
  lines.push('');

  if (warnings.length > 0) {
    lines.push(`  // ⚠ Warnings:`);
    for (const w of warnings) {
      lines.push(`  //   ${w}`);
    }
    lines.push('');
  }

  // ── Pipeline flow (ASCII) ──────────────────────────────────────────────────
  lines.push(`  // ── Pipeline Flow ──────────────────────────────────────────`);
  if (pipeline.length > 0) {
    for (let i = 0; i < pipeline.length; i++) {
      const p = pipeline[i];
      const icon = STATUS_ICON[p.runtime_status] || '?';
      lines.push(`  //   ${icon} ${p.type} (${p.label})`);
      if (i < pipeline.length - 1) {
        lines.push(`  //       ↓`);
      }
    }
  } else {
    lines.push(`  //   (empty)`);
  }
  lines.push('');

  // ── Nodes ──────────────────────────────────────────────────────────────────
  lines.push(`  // ── Nodes ────────────────────────────────────────────────────`);
  for (const p of pipeline) {
    const icon  = STATUS_ICON[p.runtime_status] || '?';
    const stage = getStage(p.category);
    lines.push('');
    lines.push(`  node ${p.type} {`);
    lines.push(`    id:             "${p.id}"`);
    lines.push(`    label:          "${p.label}"`);
    lines.push(`    category:       "${p.category}"`);
    lines.push(`    stage:          "${stage}"`);
    lines.push(`    runtime_status: "${p.runtime_status}"  // ${icon} ${STATUS_LABEL[p.runtime_status] || p.runtime_status}`);

    // Config
    const configKeys = Object.keys(p.config);
    if (configKeys.length > 0) {
      lines.push('');
      lines.push(`    config {`);
      for (const key of configKeys) {
        const val = p.config[key];
        const formatted = typeof val === 'string' ? `"${val}"` : JSON.stringify(val);
        lines.push(`      ${key}: ${formatted}`);
      }
      lines.push(`    }`);
    }

    // Connections
    if (p.connects_from.length > 0 || p.connects_to.length > 0) {
      lines.push('');
      if (p.connects_from.length > 0) {
        lines.push(`    receives_from: [${p.connects_from.map(id => `"${id}"`).join(', ')}]`);
      }
      if (p.connects_to.length > 0) {
        lines.push(`    sends_to:      [${p.connects_to.map(id => `"${id}"`).join(', ')}]`);
      }
    }

    lines.push(`  }`);
  }

  lines.push('');

  // ── Connections list ───────────────────────────────────────────────────────
  lines.push(`  // ── Connections ──────────────────────────────────────────────`);
  if (connections.length > 0) {
    lines.push(`  connections [`);
    for (const c of connections) {
      lines.push(`    "${c.from}" → "${c.to}"`);
    }
    lines.push(`  ]`);
  } else {
    lines.push(`  connections []`);
  }

  lines.push('');
  lines.push('}');
  lines.push('');
  lines.push(`// ── Legend ────────────────────────────────────────────────────`);
  lines.push(`// ✓  supported    — active in the Vanta runtime`);
  lines.push(`// ⚠  experimental — partially supported, not safe for production`);
  lines.push(`// ✕  unavailable  — defined in registry, runtime not yet implemented`);

  return lines.join('\n');
}
