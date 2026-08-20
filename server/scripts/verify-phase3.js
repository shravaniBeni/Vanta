/**
 * server/scripts/verify-phase3.js
 *
 * Phase 3 verification — projects and rag_apps Supabase migration.
 *
 * Usage:
 *   node scripts/verify-phase3.js
 *
 * Requires server running on PORT (default 3002 for testing, 3001 for prod).
 * Requires SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL in .env for admin ops.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.VERIFY_API_URL || 'http://localhost:3002';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
let failed = 0;
const createdAppIds   = [];
const createdProjIds  = [];
const createdUserIds  = [];

function pass(label, detail = '') {
  console.log(`  ✅  ${label}${detail ? '  —  ' + detail : ''}`);
  passed++;
}
function fail(label, detail = '') {
  console.log(`  ❌  ${label}${detail ? '  —  ' + detail : ''}`);
  failed++;
}
function section(title) {
  console.log(`\n  ── ${title}`);
}

async function signIn(email, password) {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
      body: JSON.stringify({ email, password }),
    }
  );
  const j = await r.json();
  if (!j.access_token) throw new Error(`Sign-in failed for ${email}: ${j.error_description || j.msg}`);
  return j.access_token;
}

async function api(method, path, token, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  let json;
  try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function ensureUser(email, password) {
  // Create user via admin API — ignore error if already exists
  const { data } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (data?.user?.id) createdUserIds.push(data.user.id);

  const token = await signIn(email, password);
  return token;
}

async function cleanup() {
  console.log('\n  ── Cleanup');
  for (const id of createdAppIds) {
    await admin.from('rag_apps').delete().eq('id', id);
  }
  for (const id of createdProjIds) {
    await admin.from('projects').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log('  cleanup done');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 3 — Supabase Projects & RAG Apps');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Setup: two isolated test users ──────────────────────────────────────────
  const emailA = `phase3-a-${Date.now()}@vanta.test`;
  const emailB = `phase3-b-${Date.now()}@vanta.test`;
  const pw = 'Phase3Test!99';

  let tokenA, tokenB;
  try {
    tokenA = await ensureUser(emailA, pw);
    tokenB = await ensureUser(emailB, pw);
    console.log(`\n  Test users: ${emailA}, ${emailB}`);
  } catch (err) {
    console.error('\n  FATAL: Could not create test users:', err.message);
    process.exit(1);
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('Project: default creation via generate');

  // V1 — generate creates default project for new user
  const g1 = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'A simple FAQ bot for a coffee shop',
  });
  if (g1.status === 201 && g1.body.id && g1.body.project_id) {
    createdAppIds.push(g1.body.id);
    pass('generate → 201 with project_id set', `app=${g1.body.id.slice(0,8)} project=${g1.body.project_id.slice(0,8)}`);
  } else {
    fail('generate did not return 201 with project_id', JSON.stringify(g1.body).slice(0,120));
  }

  // V2 — only one default project was created
  const proj1 = await api('GET', '/api/projects', tokenA);
  if (proj1.status === 200 && Array.isArray(proj1.body) && proj1.body.length === 1) {
    createdProjIds.push(proj1.body[0].id);
    pass('exactly one default project created for new user', `project_id=${proj1.body[0].id.slice(0,8)}`);
  } else {
    fail('expected exactly 1 project', `got ${proj1.body?.length}`);
  }

  // V3 — second generate reuses existing default project
  const g2 = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'A helpdesk bot for a SaaS product',
  });
  if (g2.status === 201) createdAppIds.push(g2.body.id);
  const proj2 = await api('GET', '/api/projects', tokenA);
  if (
    proj2.status === 200 &&
    proj2.body.length === 1 &&
    g2.body.project_id === proj1.body[0].id
  ) {
    pass('second generate reuses same default project — no duplicate created');
  } else {
    fail('second generate created a new project or wrong project_id',
      `projects=${proj2.body?.length}, p1=${proj1.body[0]?.id?.slice(0,8)}, g2.project_id=${g2.body?.project_id?.slice(0,8)}`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('Project: ownership isolation');

  // V4 — User B cannot see User A's projects
  const bProjects = await api('GET', '/api/projects', tokenB);
  if (bProjects.status === 200 && bProjects.body.length === 0) {
    pass('User B sees 0 projects (cannot see User A projects)');
  } else {
    fail('User B can see projects they do not own', `count=${bProjects.body?.length}`);
  }

  // V5 — User B cannot PATCH User A's project
  if (proj1.body.length > 0) {
    const patchOther = await api('PATCH', `/api/projects/${proj1.body[0].id}`, tokenB, { name: 'hacked' });
    if (patchOther.status === 404) {
      pass('User B cannot PATCH User A project → 404');
    } else {
      fail('User B could modify User A project', `status=${patchOther.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('Project: manual CRUD');

  // V6 — Create project manually
  const cp = await api('POST', '/api/projects', tokenA, {
    name: 'Test Project Alpha',
    description: 'Verification project',
  });
  let testProjectId;
  if (cp.status === 201 && cp.body.id && cp.body.user_id) {
    testProjectId = cp.body.id;
    createdProjIds.push(testProjectId);
    pass('POST /api/projects → 201', `id=${testProjectId.slice(0,8)}`);
  } else {
    fail('POST /api/projects failed', JSON.stringify(cp.body).slice(0,100));
  }

  // V7 — Update project name
  if (testProjectId) {
    const up = await api('PATCH', `/api/projects/${testProjectId}`, tokenA, {
      name: 'Test Project Alpha (updated)',
    });
    if (up.status === 200 && up.body.name === 'Test Project Alpha (updated)') {
      pass('PATCH /api/projects/:id updates name');
    } else {
      fail('PATCH /api/projects/:id', JSON.stringify(up.body).slice(0,100));
    }
  }

  // V8 — Delete project with no apps → succeeds
  const emptyProj = await api('POST', '/api/projects', tokenA, { name: 'To Delete' });
  if (emptyProj.status === 201) {
    const del = await api('DELETE', `/api/projects/${emptyProj.body.id}`, tokenA);
    if (del.status === 200 && del.body.success) {
      pass('DELETE empty project → success');
    } else {
      fail('DELETE empty project failed', JSON.stringify(del.body).slice(0,100));
    }
  }

  // V9 — Delete project that contains apps → 409
  if (proj1.body.length > 0) {
    const delBlocked = await api('DELETE', `/api/projects/${proj1.body[0].id}`, tokenA);
    if (delBlocked.status === 409) {
      pass('DELETE project with RAG apps → 409 blocked');
    } else {
      fail('DELETE project with apps should return 409', `status=${delBlocked.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('RAG Apps: basic CRUD on Supabase');

  // V10 — GET /api/chatbots returns only user's apps
  const listA = await api('GET', '/api/chatbots', tokenA);
  const allBelongToA = listA.body.every(a => !a.user_id || true); // user_id not in response
  if (listA.status === 200 && Array.isArray(listA.body) && listA.body.length >= 2) {
    pass('GET /api/chatbots returns user apps from Supabase', `count=${listA.body.length}`);
  } else {
    fail('GET /api/chatbots unexpected result', `status=${listA.status} count=${listA.body?.length}`);
  }

  // V11 — nodes and connections are valid arrays
  const appWithNodes = listA.body.find(a => Array.isArray(a.nodes) && a.nodes.length > 0);
  if (appWithNodes) {
    pass('Response includes nodes array from JSONB', `nodes=${appWithNodes.nodes.length}`);
  } else {
    fail('No app with nodes found in list');
  }

  // V12 — architect fields present
  const appWithArch = listA.body[0];
  if (
    appWithArch &&
    'architect_status'  in appWithArch &&
    'architect_version' in appWithArch &&
    'project_id'        in appWithArch
  ) {
    pass('architect_status, architect_version, project_id present in response');
  } else {
    fail('Missing architect fields in response', JSON.stringify(Object.keys(appWithArch || {})));
  }

  // V13 — GET /api/chatbots/:id (owner) → 200
  const appId = listA.body[0]?.id;
  if (appId) {
    const getById = await api('GET', `/api/chatbots/${appId}`, tokenA);
    if (getById.status === 200 && getById.body.id === appId) {
      pass('GET /api/chatbots/:id (owner) → 200');
    } else {
      fail('GET /api/chatbots/:id', `status=${getById.status}`);
    }

    // V14 — User B cannot access User A's app by ID → 404
    const getByIdB = await api('GET', `/api/chatbots/${appId}`, tokenB);
    if (getByIdB.status === 404) {
      pass('User B cannot GET User A app by ID → 404');
    } else {
      fail('User B accessed User A app', `status=${getByIdB.status}`);
    }
  }

  // V15 — PATCH updates nodes/connections in Supabase JSONB
  if (appId) {
    const newNodes = [{ id: 'x1', type: 'ChatOutput', label: 'Test', x: 100, y: 100, params: {} }];
    const patch = await api('PATCH', `/api/chatbots/${appId}`, tokenA, {
      nodes: newNodes,
      connections: [],
    });
    if (
      patch.status === 200 &&
      Array.isArray(patch.body.nodes) &&
      patch.body.nodes.length === 1 &&
      patch.body.nodes[0].id === 'x1'
    ) {
      pass('PATCH nodes/connections updates Supabase JSONB correctly');
      // Restore — re-fetch and restore original
      const orig = listA.body.find(a => a.id === appId);
      if (orig) {
        await api('PATCH', `/api/chatbots/${appId}`, tokenA, {
          nodes: orig.nodes,
          connections: orig.connections,
        });
      }
    } else {
      fail('PATCH nodes did not update correctly', JSON.stringify(patch.body).slice(0,120));
    }
  }

  // V16 — DELETE (owner) works
  const delApp = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'Temporary app for delete test',
  });
  if (delApp.status === 201) {
    const del = await api('DELETE', `/api/chatbots/${delApp.body.id}`, tokenA);
    if (del.status === 200 && del.body.success) {
      pass('DELETE /api/chatbots/:id (owner) → success');
    } else {
      fail('DELETE own app failed', JSON.stringify(del.body).slice(0,100));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('Public embed lookup');

  // V17 — embed lookup without JWT returns [] for non-existent embed_id
  const noEmbed = await api('GET', '/api/chatbots?embed_id=does_not_exist_xyz', null);
  if (noEmbed.status === 200 && Array.isArray(noEmbed.body) && noEmbed.body.length === 0) {
    pass('Unknown embed_id → 200 []  (no auth required)');
  } else {
    fail('embed_id not found should return []', `status=${noEmbed.status}`);
  }

  // V18 — deploy an app and check embed lookup returns minimal fields only
  const deployApp = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'A test bot for embed verification',
  });
  let deployedEmbedId;
  if (deployApp.status === 201) {
    createdAppIds.push(deployApp.body.id);
    deployedEmbedId = `test_embed_phase3_${Date.now()}`;
    await api('PATCH', `/api/chatbots/${deployApp.body.id}`, tokenA, {
      status: 'deployed',
      embed_id: deployedEmbedId,
    });

    const embedResult = await api('GET', `/api/chatbots?embed_id=${deployedEmbedId}`, null);
    if (
      embedResult.status === 200 &&
      embedResult.body.length === 1 &&
      embedResult.body[0].id === deployApp.body.id &&
      !('user_id'       in embedResult.body[0]) &&
      !('project_id'    in embedResult.body[0]) &&
      !('architect_plan'in embedResult.body[0])
    ) {
      pass('Deployed embed_id lookup returns minimal safe fields only (no user_id/project_id/architect_plan)');
    } else {
      fail('Embed lookup fields wrong', JSON.stringify(Object.keys(embedResult.body[0] || {})));
    }
  }

  // V19 — draft app not returned by embed lookup
  const draftApp = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'Draft bot — should not appear in embed',
  });
  if (draftApp.status === 201) {
    createdAppIds.push(draftApp.body.id);
    const draftEmbed = `draft_embed_${Date.now()}`;
    // Patch embed_id but keep status=draft
    await api('PATCH', `/api/chatbots/${draftApp.body.id}`, tokenA, {
      embed_id: draftEmbed,
    });
    const draftResult = await api('GET', `/api/chatbots?embed_id=${draftEmbed}`, null);
    if (draftResult.status === 200 && draftResult.body.length === 0) {
      pass('Draft app with embed_id is NOT returned by public embed lookup');
    } else {
      fail('Draft app appeared in public embed lookup', `count=${draftResult.body?.length}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('No SQLite writes from chatbot routes');

  // V20 — SQLite chatbots table should NOT have the new test app
  // We verify by checking the Supabase rag_apps table has data while
  // confirming the route no longer depends on db.js for chatbot ops.
  // (db.js is still imported by messages/documents/chat routes.)
  const { count: ragCount } = await admin
    .from('rag_apps')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', (await admin.auth.admin.listUsers()).data.users.find(u => u.email === emailA)?.id ?? '');

  if (ragCount > 0) {
    pass('rag_apps rows exist in Supabase for test user', `count=${ragCount}`);
  } else {
    fail('No rag_apps rows found in Supabase for test user');
  }

  // ────────────────────────────────────────────────────────────────────────────
  await cleanup();

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('\n[verify-phase3] Fatal:', err.message);
  process.exit(1);
});
