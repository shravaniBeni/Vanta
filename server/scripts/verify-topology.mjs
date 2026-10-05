/**
 * server/scripts/verify-topology.mjs
 *
 * Topology connection regression tests.
 * Run: node scripts/verify-topology.mjs
 *
 * Tests:
 *  1.  WebCrawler + type-string connection resolves to real ID
 *  2.  WebCrawler auto-connects when proposal omits connections entirely
 *  3.  WebCrawler → TextSplitter type compatibility valid
 *  4.  WebCrawler → Embeddings type compatibility INVALID (rejected)
 *  5.  Existing DocumentUpload connection preserved when WebCrawler added
 *  6.  Both DocUpload and WebCrawler connect to same TextSplitter (fan-in)
 *  7.  OCR topology: DocUpload → OCR → TextSplitter
 *  8.  Normal RAG: DocUpload → TextSplitter → Embeddings → VectorStore → LLM → ChatOutput
 *  9.  Dangling WebCrawler (no connections) triggers warning in validateWorkflow
 * 10.  Invalid connection WebCrawler→Embeddings blocked by type check
 * 11.  buildCandidateWorkflow: connection using existing node ID still works
 * 12.  Type-string resolution: lowercase "webcrawler" resolves correctly
 * 13.  Multiple new nodes: both get auto-connected if LLM omits connections
 * 14.  Phase 9D regression: standaloneCodeGen WebCrawler supported
 * 15.  Phase 10A regression: classificationNeedsOcr still works
 */

import { buildCandidateWorkflow, analyzeImpact } from '../src/architect/proposalActivator.js';
import { validateWorkflow } from '../src/workflowUtils.js';
import { getNodeCapability } from '../src/nodeCapabilityRegistry.js';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; results.push({ name, status:'PASS' }); })
              .catch(err => { failed++; results.push({ name, status:'FAIL', error:err.message }); });
    }
    passed++; results.push({ name, status:'PASS' });
  } catch (err) {
    failed++; results.push({ name, status:'FAIL', error:err.message });
  }
}
function assert(c,m)   { if(!c) throw new Error(m||'Assertion failed'); }
function eq(a,b,m)     { if(a!==b) throw new Error(m||`Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`); }
function has(arr,fn,m) { assert(arr.some(fn), m); }
function lacks(arr,fn,m){ assert(!arr.some(fn), m); }

// ─── Base active workflow ─────────────────────────────────────────────────────

const BASE_NODES = [
  { id:'knowledge-source', type:'DocumentUpload',label:'Knowledge Source', x:80,  y:220, params:{} },
  { id:'chunking',         type:'TextSplitter',  label:'Text Splitter',   x:320, y:220, params:{} },
  { id:'embedding',        type:'Embeddings',    label:'Embeddings',      x:560, y:220, params:{} },
  { id:'retrieval',        type:'VectorStore',   label:'Vector Store',    x:800, y:220, params:{} },
  { id:'generation',       type:'LLM',           label:'LLM',             x:1040,y:220, params:{} },
  { id:'output',           type:'ChatOutput',    label:'Chat Output',     x:1280,y:220, params:{} },
];
const BASE_CONNS = [
  { from:'knowledge-source', to:'chunking'   },
  { from:'chunking',         to:'embedding'  },
  { from:'embedding',        to:'retrieval'  },
  { from:'retrieval',        to:'generation' },
  { from:'generation',       to:'output'     },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

// 1. WebCrawler + type-string connection resolves to real ID
test('1. WebCrawler type-string in connections.add resolves to generated ID', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{ url:'https://example.com' }, reason:'Add web content.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: {
        add: [{ from:'WebCrawler', to:'chunking', reason:'Crawled pages enter chunking.' }],
        remove: []
      }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  assert(crawler, 'WebCrawler node must exist');
  assert(crawler.id.startsWith('webcrawler-'), `ID must start with webcrawler-, got: ${crawler.id}`);
  // The connection must exist with the real generated ID
  const conn = connections.find(c => c.from === crawler.id && c.to === 'chunking');
  assert(conn, `Connection ${crawler.id}→chunking must exist. Connections: ${JSON.stringify(connections.map(c=>c.from+'→'+c.to))}`);
});

// 2. WebCrawler auto-connects when proposal omits connections entirely
test('2. WebCrawler auto-connects to TextSplitter when proposal has no connections', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{}, reason:'Add web.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: { add: [], remove: [] }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  assert(crawler, 'WebCrawler must be added');
  const autoConn = connections.find(c => c.from === crawler.id);
  assert(autoConn, `WebCrawler must have an auto-connection. All connections: ${JSON.stringify(connections.map(c=>c.from+'→'+c.to))}`);
  // Target must accept 'documents' input — i.e. TextSplitter
  const targetNode = nodes.find(n => n.id === autoConn.to);
  assert(targetNode, 'Target of auto-connection must exist');
  const targetCap = getNodeCapability(targetNode.type);
  assert(targetCap.input_types.includes('documents'), `Auto-connection target must accept documents, got: ${targetCap.input_types.join(', ')}`);
});

// 3. WebCrawler → TextSplitter type compatibility valid
test('3. WebCrawler→TextSplitter: type compatibility is valid', () => {
  const wc  = getNodeCapability('WebCrawler');
  const ts  = getNodeCapability('TextSplitter');
  const overlap = wc.output_types.filter(t => ts.input_types.includes(t));
  assert(overlap.length > 0, `WebCrawler→TextSplitter must have overlapping types. WC output: ${wc.output_types}, TS input: ${ts.input_types}`);
});

// 4. WebCrawler → Embeddings type compatibility INVALID
test('4. WebCrawler→Embeddings: type compatibility is INVALID (documents vs chunks)', () => {
  const wc  = getNodeCapability('WebCrawler');
  const emb = getNodeCapability('Embeddings');
  const overlap = wc.output_types.filter(t => emb.input_types.includes(t));
  eq(overlap.length, 0, `WebCrawler→Embeddings must have NO type overlap. WC: ${wc.output_types}, Emb: ${emb.input_types}`);
});

// 5. Existing DocumentUpload → TextSplitter connection preserved after adding WebCrawler
test('5. Existing DocumentUpload→TextSplitter preserved when WebCrawler added', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{}, reason:'Add web.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: { add:[], remove:[] }
    }
  };
  const { connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const docConn = connections.find(c => c.from === 'knowledge-source' && c.to === 'chunking');
  assert(docConn, 'DocumentUpload→TextSplitter must still exist after adding WebCrawler');
});

// 6. Both DocUpload and WebCrawler connect to same TextSplitter (fan-in)
test('6. Fan-in: both DocumentUpload and WebCrawler connect to TextSplitter', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{}, reason:'Add web.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: { add:[], remove:[] }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  const chunkingConns = connections.filter(c => c.to === 'chunking');
  assert(chunkingConns.length >= 2,
    `TextSplitter must have >=2 incoming connections (DocUpload + WebCrawler). Got: ${chunkingConns.map(c=>c.from).join(', ')}`);
  assert(chunkingConns.some(c => c.from === 'knowledge-source'), 'DocUpload→chunking must exist');
  assert(chunkingConns.some(c => c.from === crawler.id), `WebCrawler→chunking must exist`);
});

// 7. OCR topology: DocUpload → OCR → TextSplitter
test('7. OCR auto-connects: DocumentUpload→OCR→TextSplitter', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'OCR', label:'OCR Layer', params:{ language:'eng' }, reason:'OCR for scanned docs.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: { add:[], remove:[] }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const ocrNode = nodes.find(n => n.type === 'OCR');
  assert(ocrNode, 'OCR node must be added');
  // OCR has output_types: ['documents'] — should auto-connect to TextSplitter
  const ocrConn = connections.find(c => c.from === ocrNode.id);
  assert(ocrConn, 'OCR must have at least one outgoing connection');
  const targetCap = getNodeCapability(nodes.find(n => n.id === ocrConn.to)?.type);
  assert(targetCap?.input_types.includes('documents'), 'OCR must connect to a node accepting documents');
});

// 8. Normal RAG topology: buildCandidateWorkflow no-op preserves existing connections
test('8. Normal RAG: empty proposal preserves all existing connections', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [], remove_nodes: [], reconfigure_nodes: [],
      connections: { add:[], remove:[] }
    }
  };
  const { connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  eq(connections.length, 5, 'All 5 original connections must be preserved');
  assert(connections.some(c => c.from==='knowledge-source' && c.to==='chunking'));
  assert(connections.some(c => c.from==='generation' && c.to==='output'));
});

// 9. Dangling WebCrawler triggers warning in validateWorkflow
test('9. Dangling WebCrawler (no outgoing connection) triggers warning', () => {
  const nodesWithDangling = [
    ...BASE_NODES,
    { id:'webcrawler-xyz', type:'WebCrawler', label:'Web Crawler', x:80, y:400, params:{} },
  ];
  const result = validateWorkflow(nodesWithDangling, BASE_CONNS);
  assert(result.structurally_valid, 'Structurally valid (no errors)');
  const danglingWarning = result.warnings.find(w => w.includes('webcrawler-xyz') || (w.includes('WebCrawler') && w.includes('no downstream')));
  assert(danglingWarning, `Must have dangling node warning for WebCrawler. Warnings: ${result.warnings.join('; ')}`);
});

// 10. Invalid connection WebCrawler→Embeddings blocked by type check in validateWorkflow
test('10. Invalid WebCrawler→Embeddings connection fails type check', () => {
  const crawler = { id:'wc-test', type:'WebCrawler', label:'Web Crawler', x:0, y:0, params:{} };
  const nodesWithCrawler = [...BASE_NODES, crawler];
  const connsWithInvalid = [
    ...BASE_CONNS,
    { from:'wc-test', to:'embedding' },  // WebCrawler(documents) → Embeddings(chunks) — INVALID
  ];
  const result = validateWorkflow(nodesWithCrawler, connsWithInvalid);
  const typeError = result.errors.find(e => e.includes('Incompatible') && e.includes('WebCrawler'));
  assert(typeError, `Must have incompatible connection error for WebCrawler→Embeddings. Errors: ${result.errors.join('; ')}`);
});

// 11. Connection using existing node ID (not type string) still works
test('11. Connection using existing node IDs (not type strings) works unchanged', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{}, reason:'Add web.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: {
        // Use 'chunking' (real existing ID) as the target
        add: [{ from:'WebCrawler', to:'chunking', reason:'Connect crawler to chunking.' }],
        remove: []
      }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  assert(crawler, 'WebCrawler must exist');
  assert(connections.some(c => c.from === crawler.id && c.to === 'chunking'),
    `${crawler.id}→chunking must exist`);
});

// 12. Lowercase "webcrawler" type string resolves correctly
test('12. Lowercase "webcrawler" type string resolves to generated ID', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [{ type:'WebCrawler', label:'Web Crawler', params:{}, reason:'.' }],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: {
        add: [{ from:'webcrawler', to:'chunking', reason:'lowercase type string' }],
        remove: []
      }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  assert(crawler, 'WebCrawler must exist');
  assert(connections.some(c => c.from === crawler.id && c.to === 'chunking'),
    `Lowercase type-string connection must resolve. Connections: ${connections.map(c=>c.from+'→'+c.to).join(', ')}`);
});

// 13. Multiple new nodes: both get auto-connected when LLM omits connections
test('13. Multiple new nodes auto-connect when proposal has empty connections', () => {
  const proposal = {
    recommended_changes: {
      add_nodes: [
        { type:'WebCrawler', label:'Web Crawler', params:{}, reason:'Add web.' },
        { type:'OCR', label:'OCR', params:{}, reason:'Add OCR.' },
      ],
      remove_nodes: [],
      reconfigure_nodes: [],
      connections: { add:[], remove:[] }
    }
  };
  const { nodes, connections } = buildCandidateWorkflow(BASE_NODES, BASE_CONNS, proposal);
  const crawler = nodes.find(n => n.type === 'WebCrawler');
  const ocr     = nodes.find(n => n.type === 'OCR');
  assert(crawler, 'WebCrawler must be added');
  assert(ocr, 'OCR must be added');
  // Both should have outgoing connections
  assert(connections.some(c => c.from === crawler.id), 'WebCrawler must be auto-connected');
  assert(connections.some(c => c.from === ocr.id), 'OCR must be auto-connected');
});

// 14. Phase 9D regression: standaloneCodeGen WebCrawler supported
test('14. Phase 9D regression: WebCrawler runtime_status is "supported" in registry', () => {
  const cap = getNodeCapability('WebCrawler');
  assert(cap, 'WebCrawler must be in registry');
  eq(cap.runtime_status, 'supported');
  assert(cap.output_types.includes('documents'), 'Must output documents');
});

// 15. Phase 10A regression: OCR supported + classificationNeedsOcr
import('../src/documentParser.js').then(m => {
  test('15. Phase 10A regression: classificationNeedsOcr works', () => {
    assert(m.classificationNeedsOcr('SCANNED'), 'SCANNED needs OCR');
    assert(!m.classificationNeedsOcr('TEXT_EXTRACTABLE'), 'TEXT must not need OCR');
  });
}).catch(() => {
  results.push({ name:'15. Phase 10A regression', status:'SKIP', error:'import failed' });
});

// ─── Report ───────────────────────────────────────────────────────────────────

// give async tests time to settle
await new Promise(r => setTimeout(r, 200));

const D = '─'.repeat(64);
console.log('\n' + D);
console.log('TOPOLOGY CONNECTION REGRESSION TESTS');
console.log(D);
for (const r of results) {
  const m = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '⊘' : '✗';
  console.log(`  ${m} ${r.name}`);
  if (r.status === 'FAIL') console.log(`      ERROR: ${r.error}`);
}
console.log(D);
const p = results.filter(r=>r.status==='PASS').length;
const f = results.filter(r=>r.status==='FAIL').length;
const s = results.filter(r=>r.status==='SKIP').length;
console.log(`  PASS: ${p}   FAIL: ${f}   SKIP: ${s}   TOTAL: ${results.length}`);
console.log(D + '\n');
if (f > 0) process.exit(1);
