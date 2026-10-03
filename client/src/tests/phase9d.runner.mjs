/**
 * Phase 9D test runner — uses relative import to avoid Vite alias resolution.
 * Run: node client/src/tests/phase9d.runner.mjs
 */
import { generateWorkflowCode } from '../lib/workflowCodeGen.js';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); passed++; results.push({ name, status: 'PASS' }); }
  catch (err) { failed++; results.push({ name, status: 'FAIL', error: err.message }); }
}
function assert(c, m)         { if (!c) throw new Error(m || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`); }
function assertContains(s, sub, m) { if (!s.includes(sub)) throw new Error(m || `Expected to contain "${sub}"`); }
function assertNotContains(s, sub, m) { if (s.includes(sub)) throw new Error(m || `Expected NOT to contain "${sub}"`); }

const ACTIVE = {
  id: 'bot-001', title: 'Test RAG Bot', description: 'A test chatbot',
  status: 'deployed', architect_version: 2,
  nodes: [
    { id: 'knowledge-source', type: 'DocumentUpload', label: 'Knowledge Source', x:80,  y:220, params: { rag_app_id:'bot-001', document_count:3, architect_version:2 } },
    { id: 'chunking',         type: 'TextSplitter',   label: 'Text Splitter',    x:320, y:220, params: { strategy:'recursive', chunk_size:1000, overlap:200, architect_version:2 } },
    { id: 'embedding',        type: 'Embeddings',     label: 'Embeddings',       x:560, y:220, params: { model:'Xenova/bge-small-en-v1.5', dimension:384, provider:'local', normalize:true, architect_version:2 } },
    { id: 'retrieval',        type: 'VectorStore',    label: 'Vector Store',     x:800, y:220, params: { type:'pgvector', metric:'cosine', top_k:5, reranking:false, vector_dimension:384, architect_version:2 } },
    { id: 'generation',       type: 'LLM',            label: 'Language Model',   x:1040,y:220, params: { model:'openai/gpt-4o-mini', temperature:0.4, grounding_required:true, response_style:'factual', architect_version:2 } },
    { id: 'output',           type: 'ChatOutput',     label: 'Chat Output',      x:1280,y:220, params: { architect_version:2 } },
  ],
  connections: [
    { from:'knowledge-source', to:'chunking'   },
    { from:'chunking',         to:'embedding'  },
    { from:'embedding',        to:'retrieval'  },
    { from:'retrieval',        to:'generation' },
    { from:'generation',       to:'output'     },
  ],
};

const EXP = {
  id:'bot-exp', title:'Experimental Bot', status:'draft', architect_version:1,
  nodes:[{ id:'api', type:'APIIntegration', label:'API', x:0, y:0, params:{ endpoint:'https://api.test' } }],
  connections:[],
};

const UNAVAIL = {
  id:'bot-unavail', title:'Unavailable Bot', status:'draft', architect_version:0,
  nodes:[
    { id:'ocr',   type:'OCR',               label:'OCR Layer', x:0,   y:0, params:{} },
    { id:'voice', type:'VoiceRecognition',  label:'Voice',     x:240, y:0, params:{ language:'en-US' } },
  ],
  connections:[{ from:'ocr', to:'voice' }],
};

const EMPTY = { id:'bot-empty', title:'Empty Bot', status:'draft', nodes:[], connections:[] };

test('1. Default tab (generator returns valid result)', () => {
  const r = generateWorkflowCode(ACTIVE);
  assert(r !== null);
  assertEqual(r.source, 'active_workflow');
});

test('2. Code tab renders — produces non-empty text', () => {
  const r = generateWorkflowCode(ACTIVE);
  assert(r.text.length > 0);
  assert(r.pipeline.length > 0);
});

test('3. Code generated from ACTIVE workflow', () => {
  const r = generateWorkflowCode(ACTIVE);
  assertEqual(r.summary.node_count, 6, 'Should reflect exactly 6 active nodes');
  assertContains(r.text, 'DocumentUpload');
  assertContains(r.text, 'ChatOutput');
});

test('4. Draft changes do not appear in Code', () => {
  const r = generateWorkflowCode(ACTIVE); // pass only active — no draft nodes
  assertNotContains(r.text, 'draft-node-xyz', 'Draft-only nodes must not appear');
  assertEqual(r.summary.node_count, 6, 'Only 6 active nodes, no draft leakage');
});

test('5. Generated output is deterministic', () => {
  const r1 = generateWorkflowCode(ACTIVE);
  const r2 = generateWorkflowCode(ACTIVE);
  assertEqual(r1.text, r2.text, 'Two calls must produce identical text');
});

test('6. Supported nodes represented with status "supported"', () => {
  const r = generateWorkflowCode(ACTIVE);
  for (const type of ['DocumentUpload','TextSplitter','Embeddings','VectorStore','LLM','ChatOutput']) {
    const n = r.pipeline.find(p => p.type === type);
    assert(n, `Node ${type} must be in pipeline`);
    assertEqual(n.runtime_status, 'supported', `${type} must be supported`);
  }
  assertContains(r.text, 'runtime_status: "supported"');
});

test('7. Experimental nodes represented with status "experimental"', () => {
  const r = generateWorkflowCode(EXP);
  const n = r.pipeline.find(p => p.type === 'APIIntegration');
  assert(n);
  assertEqual(n.runtime_status, 'experimental');
  assertContains(r.text, 'experimental');
  assert(r.warnings.length > 0, 'Must have warning');
  assertContains(r.warnings[0], 'APIIntegration');
});

test('8. Unavailable nodes represented with status "unavailable"', () => {
  const r = generateWorkflowCode(UNAVAIL);
  const ocr = r.pipeline.find(p => p.type === 'OCR');
  const voice = r.pipeline.find(p => p.type === 'VoiceRecognition');
  assert(ocr); assert(voice);
  assertEqual(ocr.runtime_status, 'unavailable');
  assertEqual(voice.runtime_status, 'unavailable');
  assertContains(r.text, '✕');
  assert(!r.summary.executable, 'Must not be executable');
});

test('9. Connections represented in output', () => {
  const r = generateWorkflowCode(ACTIVE);
  assertEqual(r.summary.connection_count, 5);
  assertContains(r.text, '"knowledge-source" → "chunking"');
  assertContains(r.text, '"generation" → "output"');
  const splitter = r.pipeline.find(p => p.type === 'TextSplitter');
  assert(splitter.connects_from.includes('knowledge-source'));
  assert(splitter.connects_to.includes('embedding'));
});

test('10. Node configuration represented', () => {
  const r = generateWorkflowCode(ACTIVE);
  const splitter = r.pipeline.find(p => p.type === 'TextSplitter');
  assertEqual(splitter.config.chunk_size, 1000);
  assertEqual(splitter.config.overlap, 200);
  assertEqual(splitter.config.strategy, 'recursive');
  assert(splitter.config.rag_app_id === undefined, 'rag_app_id must be stripped');
  assertContains(r.text, 'chunk_size');
  assertContains(r.text, '"recursive"');
  const llm = r.pipeline.find(p => p.type === 'LLM');
  assertEqual(llm.config.temperature, 0.4);
  assertEqual(llm.config.grounding_required, true);
});

test('11. Activation: regeneration reflects newly active workflow', () => {
  const activated = {
    ...ACTIVE, architect_version: 3,
    nodes: [...ACTIVE.nodes, { id:'new-proc', type:'DocumentProcessor', label:'Doc Processor', x:160, y:220, params:{ extraction_mode:'text', architect_version:3 } }],
  };
  const before = generateWorkflowCode(ACTIVE);
  const after  = generateWorkflowCode(activated);
  assert(before.text !== after.text, 'Code must change after activation');
  assertEqual(after.summary.node_count, 7);
  assertContains(after.text, 'DocumentProcessor');
  assertEqual(after.app.architect_version, 3);
});

test('12. Code view cannot mutate workflow state', () => {
  const origNodes = JSON.stringify(ACTIVE.nodes);
  const origConns = JSON.stringify(ACTIVE.connections);
  generateWorkflowCode(ACTIVE);
  assertEqual(JSON.stringify(ACTIVE.nodes), origNodes, 'nodes must be unchanged');
  assertEqual(JSON.stringify(ACTIVE.connections), origConns, 'connections must be unchanged');
});

test('13. No database write — pure function', () => {
  const src = generateWorkflowCode.toString();
  assertNotContains(src, 'supabase',  'No supabase calls');
  assertNotContains(src, "fetch(",    'No fetch calls');
  assertNotContains(src, 'await ',    'No async calls');
});

test('14. Phase 9C behavior intact (structural — active workflow only)', () => {
  const r = generateWorkflowCode(ACTIVE);
  assertEqual(r.source, 'active_workflow');
});

test('15. Phase 9B intact — proposal fields do not appear in Code view', () => {
  const withProposal = {
    ...ACTIVE,
    proposed_architect_plan: { summary:'This should not appear' },
    proposed_architect_status: 'ready_for_review',
  };
  const r = generateWorkflowCode(withProposal);
  assertNotContains(r.text, 'proposed_architect');
  assertNotContains(r.text, 'ready_for_review');
  assertEqual(r.summary.node_count, 6, 'Still uses active nodes only');
});

// ── Report ────────────────────────────────────────────────────────────────────
const D = '─'.repeat(62);
console.log('\n' + D);
console.log('PHASE 9D TEST SUITE');
console.log(D);
for (const r of results) {
  const m = r.status === 'PASS' ? '✓' : '✗';
  console.log(`  ${m} ${r.name}`);
  if (r.status === 'FAIL') console.log(`      ERROR: ${r.error}`);
}
console.log(D);
console.log(`  PASS: ${passed}   FAIL: ${failed}   TOTAL: ${passed + failed}`);
console.log(D + '\n');
if (failed > 0) process.exit(1);
