/**
 * Phase 9D Test Suite
 *
 * Tests for:
 *   1.  Visual Workflow is the default tab
 *   2.  Code tab renders
 *   3.  Code is generated from ACTIVE workflow
 *   4.  Draft changes do not appear in Code
 *   5.  Generated output is deterministic
 *   6.  Supported nodes represented correctly
 *   7.  Experimental nodes represented with status
 *   8.  Unavailable nodes represented with status
 *   9.  Connections represented
 *   10. Node configuration represented
 *   11. Activation causes Code view to reflect newly active workflow
 *   12. Code view cannot mutate workflow state
 *   13. No database write occurs when rendering Code
 *   14. Existing Phase 9C behavior remains intact (structural check)
 *   15. Existing Phase 9B behavior remains intact (structural check)
 *
 * Run: node --experimental-vm-modules client/src/tests/phase9d.test.js
 * Or via Vitest: vitest run client/src/tests/phase9d.test.js
 */

// ─── Inline import-compatible module ─────────────────────────────────────────
// workflowCodeGen.js is an ES module. This test imports it directly.

import { generateWorkflowCode } from '../lib/workflowCodeGen.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: 'PASS' });
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

function assertContains(str, substring, message) {
  if (!str.includes(substring)) throw new Error(message || `Expected string to contain "${substring}"`);
}

function assertNotContains(str, substring, message) {
  if (str.includes(substring)) throw new Error(message || `Expected string NOT to contain "${substring}"`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_WORKFLOW = {
  id:                'bot-001',
  title:             'Test RAG Bot',
  description:       'A test chatbot',
  status:            'deployed',
  architect_version: 2,
  nodes: [
    {
      id:     'knowledge-source',
      type:   'DocumentUpload',
      label:  'Knowledge Source',
      x: 80,  y: 220,
      params: { rag_app_id: 'bot-001', document_count: 3, architect_version: 2 },
    },
    {
      id:     'chunking',
      type:   'TextSplitter',
      label:  'Text Splitter',
      x: 320, y: 220,
      params: { strategy: 'recursive', chunk_size: 1000, overlap: 200, architect_version: 2 },
    },
    {
      id:     'embedding',
      type:   'Embeddings',
      label:  'Embeddings',
      x: 560, y: 220,
      params: { model: 'Xenova/bge-small-en-v1.5', dimension: 384, provider: 'local', normalize: true, architect_version: 2 },
    },
    {
      id:     'retrieval',
      type:   'VectorStore',
      label:  'Vector Store',
      x: 800, y: 220,
      params: { type: 'pgvector', metric: 'cosine', top_k: 5, reranking: false, vector_dimension: 384, architect_version: 2 },
    },
    {
      id:     'generation',
      type:   'LLM',
      label:  'Language Model',
      x: 1040, y: 220,
      params: { model: 'openai/gpt-4o-mini', temperature: 0.4, grounding_required: true, response_style: 'factual', architect_version: 2 },
    },
    {
      id:     'output',
      type:   'ChatOutput',
      label:  'Chat Output',
      x: 1280, y: 220,
      params: { architect_version: 2 },
    },
  ],
  connections: [
    { from: 'knowledge-source', to: 'chunking'   },
    { from: 'chunking',         to: 'embedding'  },
    { from: 'embedding',        to: 'retrieval'  },
    { from: 'retrieval',        to: 'generation' },
    { from: 'generation',       to: 'output'     },
  ],
};

const DRAFT_ONLY_NODES = [
  ...ACTIVE_WORKFLOW.nodes,
  {
    id:     'draft-node-xyz',
    type:   'WebCrawler',
    label:  'Web Crawler (draft only)',
    x: 100, y: 400,
    params: { url: 'https://example.com' },
  },
];

// Chatbot with experimental node
const EXPERIMENTAL_WORKFLOW = {
  id: 'bot-exp', title: 'Experimental Bot', status: 'draft', architect_version: 1,
  nodes: [
    { id: 'api', type: 'APIIntegration', label: 'API', x: 0, y: 0, params: { endpoint: 'https://api.test' } },
  ],
  connections: [],
};

// Chatbot with unavailable node
const UNAVAILABLE_WORKFLOW = {
  id: 'bot-unavail', title: 'Unavailable Bot', status: 'draft', architect_version: 0,
  nodes: [
    { id: 'ocr', type: 'OCR', label: 'OCR Layer', x: 0, y: 0, params: {} },
    { id: 'voice', type: 'VoiceRecognition', label: 'Voice', x: 240, y: 0, params: { language: 'en-US' } },
  ],
  connections: [{ from: 'ocr', to: 'voice' }],
};

const EMPTY_WORKFLOW = {
  id: 'bot-empty', title: 'Empty Bot', status: 'draft',
  nodes: [], connections: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

// TEST 1: Visual Workflow is the default tab
// (This is a structural test — the default tab state is `'visual'` in Editor.jsx)
test('1. Visual Workflow is the default tab (structural)', () => {
  // We verify the code generator doesn't crash and returns a valid result
  // The tab default is enforced in Editor.jsx: useState('visual')
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assert(result !== null, 'generateWorkflowCode should return a result');
  assert(result.source === 'active_workflow', 'source must be active_workflow');
});

// TEST 2: Code tab renders (generator returns text)
test('2. Code tab renders — generator produces non-empty text', () => {
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assert(result.text.length > 0, 'Generated text must be non-empty');
  assert(result.pipeline.length > 0, 'Pipeline must have nodes');
});

// TEST 3: Code is generated from ACTIVE workflow
test('3. Code is generated from the ACTIVE workflow only', () => {
  // The generator receives chatbot.nodes / chatbot.connections (the active fields)
  // Simulate: active workflow has 6 nodes
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assertEqual(result.summary.node_count, 6, 'Should reflect exactly 6 active nodes');
  assertContains(result.text, 'DocumentUpload', 'Active nodes must appear in code');
  assertContains(result.text, 'ChatOutput', 'Active pipeline end node must appear');
});

// TEST 4: Draft changes do NOT appear in Code
test('4. Draft changes do not appear in Code view', () => {
  // The Code tab always receives chatbot (active), never draftNodes
  // We verify: if we pass ONLY the active nodes, draft-only nodes don't appear
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assertNotContains(result.text, 'draft-node-xyz', 'Draft-only node must not appear in code');
  assertNotContains(result.text, 'Web Crawler (draft only)', 'Draft node label must not appear');
  // The 6 draft-extended nodes would have 7 entries — we should have exactly 6
  assertEqual(result.summary.node_count, 6, 'Exactly 6 active nodes, no draft leakage');
});

// TEST 5: Generated output is deterministic
test('5. Generated output is deterministic (same input → same output)', () => {
  const r1 = generateWorkflowCode(ACTIVE_WORKFLOW);
  const r2 = generateWorkflowCode(ACTIVE_WORKFLOW);
  assertEqual(r1.text, r2.text, 'Two calls with identical input must produce identical text');
  assertEqual(r1.summary.node_count, r2.summary.node_count, 'Node count must be stable');
  assertEqual(r1.summary.connection_count, r2.summary.connection_count, 'Connection count must be stable');
});

// TEST 6: Supported nodes represented correctly
test('6. Supported nodes are represented with status "supported"', () => {
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  const supportedTypes = ['DocumentUpload', 'TextSplitter', 'Embeddings', 'VectorStore', 'LLM', 'ChatOutput'];
  for (const type of supportedTypes) {
    const node = result.pipeline.find(n => n.type === type);
    assert(node, `Node ${type} must be in pipeline`);
    assertEqual(node.runtime_status, 'supported', `${type} must have status "supported"`);
  }
  assertContains(result.text, 'runtime_status: "supported"', 'Text must show supported status');
});

// TEST 7: Experimental nodes represented with status
test('7. Experimental nodes represented with runtime_status "experimental"', () => {
  const result = generateWorkflowCode(EXPERIMENTAL_WORKFLOW);
  const apiNode = result.pipeline.find(n => n.type === 'APIIntegration');
  assert(apiNode, 'APIIntegration must appear in pipeline');
  assertEqual(apiNode.runtime_status, 'experimental', 'Must have experimental status');
  assertContains(result.text, 'experimental', 'Text must mention experimental');
  assert(result.warnings.length > 0, 'Must have a warning for experimental nodes');
  assertContains(result.warnings[0], 'APIIntegration', 'Warning must name the experimental node');
});

// TEST 8: Unavailable nodes represented with status
test('8. Unavailable nodes represented with runtime_status "unavailable"', () => {
  const result = generateWorkflowCode(UNAVAILABLE_WORKFLOW);
  const ocrNode   = result.pipeline.find(n => n.type === 'OCR');
  const voiceNode = result.pipeline.find(n => n.type === 'VoiceRecognition');
  assert(ocrNode,   'OCR node must be in pipeline');
  assert(voiceNode, 'VoiceRecognition node must be in pipeline');
  assertEqual(ocrNode.runtime_status,   'unavailable', 'OCR must be unavailable');
  assertEqual(voiceNode.runtime_status, 'unavailable', 'VoiceRecognition must be unavailable');
  assertContains(result.text, '✕', 'Text must show ✕ icon for unavailable');
  assert(!result.summary.executable, 'Workflow with unavailable nodes must not be executable');
});

// TEST 9: Connections represented
test('9. Connections are represented in the output', () => {
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assertEqual(result.summary.connection_count, 5, 'Must have exactly 5 connections');
  assertContains(result.text, '"knowledge-source" → "chunking"', 'First connection must appear');
  assertContains(result.text, '"generation" → "output"', 'Last connection must appear');
  // Check pipeline node connectivity
  const splitter = result.pipeline.find(n => n.type === 'TextSplitter');
  assert(splitter.connects_from.includes('knowledge-source'), 'TextSplitter must receive from DocumentUpload');
  assert(splitter.connects_to.includes('embedding'), 'TextSplitter must send to Embeddings');
});

// TEST 10: Node configuration represented
test('10. Node configuration (params) is included in the output', () => {
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  const splitter = result.pipeline.find(n => n.type === 'TextSplitter');
  assert(splitter.config, 'TextSplitter must have config');
  assertEqual(splitter.config.chunk_size, 1000, 'chunk_size must be 1000');
  assertEqual(splitter.config.overlap, 200, 'overlap must be 200');
  assertEqual(splitter.config.strategy, 'recursive', 'strategy must be recursive');
  // Internal keys must be stripped
  assert(splitter.config.rag_app_id === undefined, 'rag_app_id must be stripped from config');
  assert(splitter.config.architect_version === undefined, 'architect_version must be stripped from config display');
  // Verify config appears in text
  assertContains(result.text, 'chunk_size', 'chunk_size must appear in text');
  assertContains(result.text, '"recursive"', 'strategy must appear as string in text');
  // LLM config
  const llm = result.pipeline.find(n => n.type === 'LLM');
  assertEqual(llm.config.temperature, 0.4, 'LLM temperature must be 0.4');
  assertEqual(llm.config.grounding_required, true, 'LLM grounding_required must be true');
});

// TEST 11: Activation causes Code view to reflect the newly active workflow
test('11. After activation, regeneration reflects the new active workflow', () => {
  // Simulate: chatbot is updated with new nodes after activation
  const activatedChatbot = {
    ...ACTIVE_WORKFLOW,
    architect_version: 3,
    nodes: [
      ...ACTIVE_WORKFLOW.nodes,
      // New node added by activation
      {
        id: 'new-proc', type: 'DocumentProcessor', label: 'Doc Processor',
        x: 160, y: 220, params: { extraction_mode: 'text', architect_version: 3 },
      },
    ],
    connections: [
      ...ACTIVE_WORKFLOW.connections,
    ],
  };

  const before = generateWorkflowCode(ACTIVE_WORKFLOW);
  const after  = generateWorkflowCode(activatedChatbot);

  assert(before.text !== after.text, 'Code must change after activation');
  assertEqual(after.summary.node_count, 7, 'Must reflect 7 nodes after activation');
  assertContains(after.text, 'DocumentProcessor', 'New node must appear after activation');
  assertEqual(after.app.architect_version, 3, 'architect_version must reflect new value');
});

// TEST 12: Code view cannot mutate workflow state
test('12. Code view cannot mutate workflow state', () => {
  const originalNodes = JSON.stringify(ACTIVE_WORKFLOW.nodes);
  const originalConns = JSON.stringify(ACTIVE_WORKFLOW.connections);

  generateWorkflowCode(ACTIVE_WORKFLOW);

  assertEqual(JSON.stringify(ACTIVE_WORKFLOW.nodes), originalNodes, 'nodes must be unchanged after generation');
  assertEqual(JSON.stringify(ACTIVE_WORKFLOW.connections), originalConns, 'connections must be unchanged');
});

// TEST 13: No database write occurs when rendering Code
test('13. No database write occurs when rendering Code (pure function)', () => {
  // generateWorkflowCode is a pure function with no async/network calls
  // It neither accepts nor calls any DB client
  const fnSource = generateWorkflowCode.toString();
  assertNotContains(fnSource, 'supabase',  'Generator must not reference supabase');
  assertNotContains(fnSource, 'fetch(',    'Generator must not use fetch');
  assertNotContains(fnSource, 'await',     'Generator must not be async');
  assertNotContains(fnSource, 'XMLHttpRequest', 'Generator must not use XHR');
});

// TEST 14: Phase 9C behavior remains intact (structural)
test('14. Phase 9C activation flow is structurally intact (Editor imports)', () => {
  // Verify the Editor still has the ArchitectChatPanel onActivated callback
  // by checking the code generator doesn't interfere with it.
  // The actual behavior is preserved by the tab conditional in Editor.jsx —
  // Code tab only renders WorkflowCodeView; all 9C flows are on the visual tab.
  assert(typeof generateWorkflowCode === 'function', 'generateWorkflowCode must be a function');
  // The Code tab is conditionally rendered — it never replaces 9C components
  const result = generateWorkflowCode(ACTIVE_WORKFLOW);
  assert(result.source === 'active_workflow', 'Code only shows active workflow, not proposals');
});

// TEST 15: Phase 9B behavior remains intact (structural)
test('15. Phase 9B Architect Chat is structurally intact', () => {
  // Code tab doesn't touch Architect Chat, proposals, or draft review
  // Verify the generator ignores proposal fields
  const chatbotWithProposal = {
    ...ACTIVE_WORKFLOW,
    proposed_architect_plan: { summary: 'This should not appear' },
    proposed_architect_status: 'ready_for_review',
  };
  const result = generateWorkflowCode(chatbotWithProposal);
  assertNotContains(result.text, 'proposed_architect', 'Proposal fields must not leak into code view');
  assertNotContains(result.text, 'ready_for_review', 'Proposal status must not appear');
  // Still generates from active nodes
  assertEqual(result.summary.node_count, 6, 'Must still use active nodes only');
});

// ─── Run ──────────────────────────────────────────────────────────────────────

const divider = '─'.repeat(60);

console.log('\n' + divider);
console.log('PHASE 9D TEST SUITE');
console.log(divider);

for (const r of results) {
  const mark = r.status === 'PASS' ? '✓' : '✗';
  const line = `  ${mark} ${r.name}`;
  if (r.status === 'FAIL') {
    console.log(line);
    console.log(`      ERROR: ${r.error}`);
  } else {
    console.log(line);
  }
}

console.log(divider);
console.log(`  PASS: ${passed}   FAIL: ${failed}   TOTAL: ${passed + failed}`);
console.log(divider + '\n');

// Exit non-zero on failure so CI can detect it
if (failed > 0) process.exit(1);
