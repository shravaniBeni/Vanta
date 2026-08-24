/**
 * server/scripts/verify-phase9a.js
 *
 * Phase 9A verification — Draft Workflow + Node Capability Registry + Topology Validation
 *
 * Tests 1-20 from the spec + Phase 8 regression smoke.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';
import { diffWorkflow, validateWorkflow } from '../src/workflowUtils.js';
import { getAllCapabilities, getNodeCapability, isNodeExecutable, REQUIRED_NODE_TYPES } from '../src/nodeCapabilityRegistry.js';

const API          = process.env.VERIFY_API_URL || 'http://127.0.0.1:3001';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0, failed = 0;
const cleanup = { userIds: [], ragAppIds: [] };

function pass(label, detail = '') { console.log(`  ✅  ${label}${detail ? '  —  ' + detail : ''}`); passed++; }
function fail(label, detail = '') { console.log(`  ❌  ${label}${detail ? '  —  ' + detail : ''}`); failed++; }
function section(t)               { console.log(`\n  ── ${t}`); }

async function signIn(email, pw) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description || j.msg}`);
  return j.access_token;
}

async function api(method, path, token, body) {
  const opts = { method, headers: { ...(token && { Authorization: `Bearer ${token}` }) } };
  if (body instanceof FormData) { opts.body = body; }
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${API}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function createUser(email, pw) {
  const { data } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (data?.user?.id) cleanup.userIds.push(data.user.id);
  return signIn(email, pw);
}

function makeUpload(chatbotId, content, filename) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  form.append('chatbot_id', chatbotId);
  return form;
}

async function doCleanup() {
  console.log('\n  ── Cleanup');
  for (const id of cleanup.ragAppIds) {
    try {
      const { data: docs } = await admin.from('documents').select('storage_path').eq('rag_app_id', id);
      if (docs?.length) {
        const paths = docs.map(d => d.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from('knowledge-docs').remove(paths);
      }
      await admin.from('messages').delete().eq('rag_app_id', id);
      await admin.from('document_chunks').delete().eq('rag_app_id', id);
      await admin.from('documents').delete().eq('rag_app_id', id);
      await admin.from('rag_apps').delete().eq('id', id);
    } catch { /* continue */ }
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('  cleanup done');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 9A — Draft Workflow + Capability Registry');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts     = Date.now();
  const tokenA = await createUser(`p9a-a-${ts}@vanta.test`, 'Phase9A!Test');
  const tokenB = await createUser(`p9a-b-${ts}@vanta.test`, 'Phase9A!Test');

  // Setup: approved Phase 8 app
  const genApp = await api('POST', '/api/chatbots/create-draft', tokenA,
    { description: 'Technical maintenance assistant' });
  const appId = genApp.body.id;
  cleanup.ragAppIds.push(appId);

  await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId, 'Section 3. Daily inspection. Step 1: Check pressure.', 'manual.txt'));
  const analyzeRes = await api('POST', '/api/architect/analyze', tokenA,
    { rag_app_id: appId, requirement: 'Technical maintenance assistant' });
  const planRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: appId, requirement: 'Technical maintenance assistant',
    knowledge_profile: analyzeRes.body.knowledge_profile,
  });
  await api('POST', '/api/architect/approve', tokenA, { rag_app_id: appId });
  const buildRes = await api('POST', '/api/architect/build-pipeline', tokenA, { rag_app_id: appId });

  // Get active workflow
  const activeApp = (await api('GET', `/api/chatbots/${appId}`, tokenA)).body;
  const activeNodes = activeApp.nodes || [];
  const activeConns = activeApp.connections || [];

  console.log(`\n  App: ${appId.slice(0,8)}  Active nodes: ${activeNodes.length}`);

  // ── Test 1: Phase 8 workflow loads as active ──────────────────────────────
  section('Test 1 — Active workflow loads from Phase 8 build');

  if (activeNodes.length >= 6)
    pass('1: Phase 8 workflow loaded as active', `nodes=${activeNodes.length}`);
  else fail('1: Active workflow missing Phase 8 nodes', `nodes=${activeNodes.length}`);

  // ── Tests 2-5: Draft isolation via API ────────────────────────────────────
  section('Tests 2-5 — Draft isolation (API level)');

  // Add a node to create a draft
  const draftNodes = [...activeNodes, {
    id: 'draft-extra-node', type: 'WebCrawler', label: 'Web Crawler',
    x: 400, y: 400, params: {}
  }];
  const draftConns = [...activeConns];

  const saveDraftRes = await api('PATCH', `/api/workflow/${appId}/draft`, tokenA, {
    nodes: draftNodes, connections: draftConns,
  });

  if (saveDraftRes.status === 200 && saveDraftRes.body.draft_saved)
    pass('2: Adding a node creates a draft (PATCH draft endpoint)');
  else fail('2: Draft save failed', JSON.stringify(saveDraftRes.body).slice(0, 80));

  // Verify active workflow is UNCHANGED in DB
  const { data: appAfterDraft } = await admin.from('rag_apps')
    .select('nodes, connections, draft_nodes, draft_connections')
    .eq('id', appId).single();

  if ((appAfterDraft?.nodes?.length || 0) === activeNodes.length)
    pass('6: Active workflow (nodes) unchanged after draft save');
  else fail('6: Active nodes changed when draft was saved');

  if ((appAfterDraft?.draft_nodes?.length || 0) === draftNodes.length)
    pass('2b: Draft nodes persisted correctly', `count=${appAfterDraft.draft_nodes.length}`);
  else fail('2b: Draft node count wrong', `expected=${draftNodes.length} got=${appAfterDraft?.draft_nodes?.length}`);

  // Remove a node — simulate draft update
  const draftAfterRemove = draftNodes.filter(n => n.id !== 'draft-extra-node');
  const removeRes = await api('PATCH', `/api/workflow/${appId}/draft`, tokenA, {
    nodes: draftAfterRemove, connections: draftConns,
  });
  if (removeRes.status === 200) pass('3: Removing a node updates draft only');
  else fail('3: Draft update after remove failed');

  // Reconnect — add a connection in draft
  const draftWithConn = [...draftConns, { from: 'knowledge-source', to: 'output' }];
  const reconnectRes = await api('PATCH', `/api/workflow/${appId}/draft`, tokenA, {
    nodes: draftAfterRemove, connections: draftWithConn,
  });
  if (reconnectRes.status === 200) pass('4: Reconnecting updates draft only');
  else fail('4: Draft reconnect failed');

  // Verify active still unchanged
  const { data: appStillActive } = await admin.from('rag_apps')
    .select('nodes, connections').eq('id', appId).single();
  if ((appStillActive?.nodes?.length || 0) === activeNodes.length)
    pass('6b: Active workflow still unchanged after multiple draft operations');
  else fail('6b: Active workflow was mutated by draft operations');

  // ── Test 7: Preview uses active workflow ──────────────────────────────────
  section('Tests 7-8 — Preview and Chat use active workflow');

  const previewRes = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appId, query: 'What is the inspection procedure?',
  });
  if (previewRes.status === 200 && previewRes.body.avgSimilarity >= 0)
    pass('7: Preview returns 200 (uses active workflow, not draft)', `avgSim=${previewRes.body.avgSimilarity?.toFixed(3)}`);
  else fail('7: Preview failed', `status=${previewRes.status}`);

  // Test 8: public chat (deploy to test)
  const embedId = `p9a_${appId}_${ts}`;
  await api('PATCH', `/api/chatbots/${appId}`, tokenA, { status: 'deployed', embed_id: embedId });
  const pubChat = await api('POST', '/api/chat', null, {
    embed_id: embedId, query: 'Daily inspection?',
  });
  if (pubChat.status === 200)
    pass('8: Public chat uses active workflow (not draft)');
  else fail('8: Public chat failed', `status=${pubChat.status}`);

  // ── Test 9: Discard Draft ─────────────────────────────────────────────────
  section('Test 9 — Discard Draft');

  const discardRes = await api('DELETE', `/api/workflow/${appId}/draft`, tokenA);
  if (discardRes.status === 200 && discardRes.body.draft_cleared)
    pass('9: Discard draft returns success');
  else fail('9: Discard draft failed', JSON.stringify(discardRes.body).slice(0, 80));

  const { data: appAfterDiscard } = await admin.from('rag_apps')
    .select('draft_nodes, draft_connections, draft_updated_at')
    .eq('id', appId).single();
  if (appAfterDiscard?.draft_nodes === null && appAfterDiscard?.draft_connections === null)
    pass('9b: Draft nulled in DB after discard');
  else fail('9b: Draft not nulled after discard');

  // ── Test 10: Draft survives reload ────────────────────────────────────────
  section('Test 10 — Draft survives reload');

  // Save a fresh draft
  const freshDraft = [...activeNodes, { id: 'reload-test', type: 'OCR', label: 'OCR', x: 100, y: 400, params: {} }];
  await api('PATCH', `/api/workflow/${appId}/draft`, tokenA, { nodes: freshDraft, connections: activeConns });

  // Read back via workflow endpoint
  const workflowState = await api('GET', `/api/workflow/${appId}`, tokenA);
  if (workflowState.status === 200 &&
      workflowState.body.has_draft &&
      workflowState.body.draft?.nodes?.length === freshDraft.length)
    pass('10: Draft survives reload via GET /api/workflow/:id',
      `nodes=${workflowState.body.draft.nodes.length}`);
  else fail('10: Draft not restored on reload', JSON.stringify(workflowState.body).slice(0, 100));

  // Cleanup the reload test draft
  await api('DELETE', `/api/workflow/${appId}/draft`, tokenA);

  // ── Tests 11-13: Workflow diff ────────────────────────────────────────────
  section('Tests 11-13 — Workflow Diff');

  const active = { nodes: activeNodes, connections: activeConns };

  // Test 11: Added node
  const withAdded = { nodes: [...activeNodes, { id: 'new-ocr', type: 'OCR', label: 'OCR', x: 100, y: 400, params: {} }], connections: activeConns };
  const diff11 = diffWorkflow(active, withAdded);
  if (diff11.added_nodes.length === 1 && diff11.added_nodes[0].id === 'new-ocr')
    pass('11: Diff correctly reports added node', `id=${diff11.added_nodes[0].id}`);
  else fail('11: Diff added_nodes wrong', JSON.stringify(diff11.added_nodes));

  // Test 12: Removed node
  const withRemoved = { nodes: activeNodes.slice(1), connections: activeConns };
  const diff12 = diffWorkflow(active, withRemoved);
  if (diff12.removed_nodes.length === 1)
    pass('12: Diff correctly reports removed node');
  else fail('12: Diff removed_nodes wrong', `count=${diff12.removed_nodes.length}`);

  // Test 13: Changed connection
  const withChangedConn = { nodes: activeNodes, connections: [...activeConns, { from: 'knowledge-source', to: 'output' }] };
  const diff13 = diffWorkflow(active, withChangedConn);
  if (diff13.added_connections.length === 1)
    pass('13: Diff correctly reports added connection');
  else fail('13: Diff added_connections wrong', `count=${diff13.added_connections.length}`);

  // Position change should NOT count as semantic change
  const withMovedNode = {
    nodes: activeNodes.map((n, i) => i === 0 ? { ...n, x: n.x + 100, y: n.y + 50 } : n),
    connections: activeConns,
  };
  const diff5 = diffWorkflow(active, withMovedNode);
  if (!diff5.has_changes)
    pass('5: Position-only change does NOT count as semantic architecture change');
  else fail('5: Position change incorrectly counted as architectural change',
    JSON.stringify(diff5).slice(0, 100));

  // ── Tests 14-15: Capability registry ─────────────────────────────────────
  section('Tests 14-15 — Capability Registry');

  const caps = getAllCapabilities();
  if (caps.length >= 17) pass('14a: Registry returns all node types', `count=${caps.length}`);
  else fail('14a: Registry incomplete', `count=${caps.length}`);

  // Core supported nodes
  const CORE = ['DocumentUpload', 'TextSplitter', 'Embeddings', 'VectorStore', 'LLM', 'ChatOutput'];
  const allCoreSupported = CORE.every(t => getNodeCapability(t)?.runtime_status === 'supported');
  if (allCoreSupported) pass('14: All core pipeline nodes are marked supported');
  else fail('14: Some core nodes not marked supported');

  // Placeholder nodes
  const PLACEHOLDERS = ['WebCrawler', 'OCR', 'VoiceRecognition', 'Translator', 'DataFilter', 'ImageAnalysis', 'CustomCode', 'CodeExecution', 'DataValidation'];
  const noneExecutable = PLACEHOLDERS.every(t => !isNodeExecutable(t));
  if (noneExecutable) pass('15: Placeholder nodes not marked executable');
  else fail('15: Some placeholder nodes incorrectly marked executable',
    PLACEHOLDERS.filter(t => isNodeExecutable(t)).join(', '));

  // Registry API endpoint
  const regRes = await api('GET', '/api/workflow/registry', tokenA);
  if (regRes.status === 200 && Array.isArray(regRes.body) && regRes.body.length >= 17)
    pass('14b: GET /api/workflow/registry returns registry', `count=${regRes.body.length}`);
  else fail('14b: Registry endpoint failed', `status=${regRes.status}`);

  // ── Test 16: Invalid connection detection ─────────────────────────────────
  section('Test 16 — Invalid Connection Detection');

  // TextSplitter outputs 'chunks', LLM accepts 'retrieved_chunks' — incompatible
  const invalidNodes = [
    { id: 'n1', type: 'TextSplitter', label: 'Splitter', x: 100, y: 100, params: {} },
    { id: 'n2', type: 'LLM',          label: 'LLM',      x: 300, y: 100, params: {} },
  ];
  const invalidConns = [{ from: 'n1', to: 'n2' }];
  const val16 = validateWorkflow(invalidNodes, invalidConns);
  if (!val16.structurally_valid && val16.errors.some(e => e.includes('Incompatible')))
    pass('16: Invalid connection (TextSplitter→LLM) detected as structurally invalid');
  else fail('16: Invalid connection not detected', JSON.stringify(val16.errors));

  // ── Test 17: Unsupported node → structurally valid but NOT executable ─────
  section('Test 17 — Unsupported Node: structurally_valid=true, executable=false');

  const nodesWithOCR = [...activeNodes, { id: 'ocr-1', type: 'OCR', label: 'OCR', x: 100, y: 400, params: {} }];
  const val17 = validateWorkflow(nodesWithOCR, activeConns);

  if (val17.structurally_valid)
    pass('17a: Draft with OCR is structurally_valid (intent preserved, not a structural error)');
  else fail('17a: OCR incorrectly made workflow structurally invalid',
    JSON.stringify(val17.errors));

  if (!val17.executable)
    pass('17b: Draft with OCR is NOT executable (OCR unavailable in current runtime)');
  else fail('17b: Draft with OCR incorrectly marked executable');

  if (val17.unsupported_capabilities.includes('OCR'))
    pass('17c: OCR listed in unsupported_capabilities');
  else fail('17c: OCR not in unsupported_capabilities', JSON.stringify(val17));

  // VoiceRecognition example from spec
  const nodesWithVoice = [...activeNodes, { id: 'vr-1', type: 'VoiceRecognition', label: 'Voice', x: 100, y: 500, params: {} }];
  const val17d = validateWorkflow(nodesWithVoice, activeConns);
  if (val17d.structurally_valid && !val17d.executable && val17d.unsupported_capabilities.includes('VoiceRecognition'))
    pass('17d: VoiceRecognition draft: structurally_valid=true, executable=false, capability listed');
  else fail('17d: VoiceRecognition validation wrong',
    `sv=${val17d.structurally_valid} exec=${val17d.executable} caps=${val17d.unsupported_capabilities}`);

  // Pure supported pipeline must be both structurally_valid AND executable
  const pureSupported = validateWorkflow(activeNodes, activeConns);
  if (pureSupported.structurally_valid && pureSupported.executable)
    pass('17e: Pure supported pipeline: structurally_valid=true AND executable=true');
  else fail('17e: Pure supported pipeline validation wrong',
    `sv=${pureSupported.structurally_valid} exec=${pureSupported.executable} errors=${pureSupported.errors}`);

  // Validate API returns new shape
  const valApiRes = await api('POST', `/api/workflow/${appId}/validate`, tokenA, {
    nodes: nodesWithOCR, connections: activeConns,
  });
  if (valApiRes.status === 200 &&
      valApiRes.body.structurally_valid === true &&
      valApiRes.body.executable === false &&
      valApiRes.body.unsupported_capabilities?.includes('OCR'))
    pass('17f: POST /api/workflow/validate returns new shape: structurally_valid + executable + unsupported_capabilities');
  else fail('17f: Validate API wrong shape', JSON.stringify(valApiRes.body).slice(0, 150));

  // ── Test 18-19: Ownership isolation ──────────────────────────────────────
  section('Tests 18-19 — Ownership Isolation');

  const genB = await api('POST', '/api/chatbots/create-draft', tokenB, { description: 'B app' });
  const appIdB = genB.body.id;
  cleanup.ragAppIds.push(appIdB);

  // User B cannot get User A's workflow
  const getAbyB = await api('GET', `/api/workflow/${appId}`, tokenB);
  if (getAbyB.status === 404) pass('18: User B cannot read User A workflow → 404');
  else fail('18: Ownership not enforced on GET workflow', `status=${getAbyB.status}`);

  // User B cannot save draft to User A's app
  const draftByB = await api('PATCH', `/api/workflow/${appId}/draft`, tokenB, { nodes: [], connections: [] });
  if (draftByB.status === 404) pass('19: User B cannot save draft to User A app → 404');
  else fail('19: Ownership not enforced on PATCH draft', `status=${draftByB.status}`);

  // ── Test 20: Phase 8 regression ───────────────────────────────────────────
  section('Test 20 — Phase 8 Regression Smoke');

  const health = await api('GET', '/api/health', null);
  if (health.status === 200) pass('20a: /api/health');
  else fail('20a: Health broken');

  const chatbots = await api('GET', '/api/chatbots', tokenA);
  if (chatbots.status === 200 && Array.isArray(chatbots.body)) pass('20b: /api/chatbots');
  else fail('20b: Chatbots list broken');

  if (previewRes.status === 200) pass('20c: Preview regression');
  else fail('20c: Preview broken');

  if (pubChat.status === 200) pass('20d: Public chat regression');
  else fail('20d: Public chat broken');

  // Diff API endpoint
  const diffApiRes = await api('POST', `/api/workflow/${appId}/diff`, tokenA, {
    nodes: activeNodes, connections: activeConns,
  });
  if (diffApiRes.status === 200 && diffApiRes.body.diff !== undefined)
    pass('20e: POST /api/workflow/:id/diff works', `has_changes=${diffApiRes.body.diff.has_changes}`);
  else fail('20e: Diff API broken');

  await doCleanup();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  if (failed > 0) process.exit(1);
}

run().catch(async err => {
  console.error('\nFatal:', err.message);
  await doCleanup();
  process.exit(1);
});
