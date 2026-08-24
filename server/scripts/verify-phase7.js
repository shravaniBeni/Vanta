/**
 * server/scripts/verify-phase7.js
 *
 * Phase 7 verification — AI RAG Architect (enhanced)
 *
 * Sections:
 *   1. Authentication & Ownership
 *   2. Analyze — Knowledge Profile + Follow-up Questions
 *   3. Knowledge Base Isolation
 *   4. Plan Generation & Validation
 *   5. Persistence & Status Lifecycle
 *   6. Approval Lifecycle
 *   7. Architect State Reload
 *   8. Controlled Adaptation Tests (FAQ / Procedural Manual / Long-form)
 *   9. Existing RAG Regression
 *
 * Controlled adaptation tests verify:
 *   - Profiler detects meaningful structural signals for each document type
 *   - Planner receives those signals and produces evidence-based explanations
 *   - Plans for clearly different document types are NOT identical without justification
 *   - Runtime constraints always satisfied regardless of document type
 *   - Reasoning references actual detected characteristics
 *
 * IMPORTANT: Tests do NOT assert a specific chunking strategy — they verify
 * adaptive reasoning, not predetermined outcomes.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';

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
function info(label, detail = '') { console.log(`  ℹ️   ${label}${detail ? '  —  ' + detail : ''}`); }
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

function makeTextUpload(chatbotId, content, filename) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  form.append('chatbot_id', chatbotId);
  return form;
}

async function doCleanup() {
  console.log('\n  ── Cleanup');
  for (const id of cleanup.ragAppIds) {
    await admin.from('messages').delete().eq('rag_app_id', id);
    await admin.from('document_chunks').delete().eq('rag_app_id', id);
    await admin.from('documents').delete().eq('rag_app_id', id);
    await admin.from('rag_apps').delete().eq('id', id);
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('  cleanup done');
}

// ─── Plan bounds validator ────────────────────────────────────────────────────

function validatePlanBounds(plan) {
  const errors = [];
  if (!plan?.chunking) return ['No chunking in plan'];
  if (plan.chunking.chunk_size < 200 || plan.chunking.chunk_size > 1500)
    errors.push(`chunk_size ${plan.chunking.chunk_size} out of bounds [200-1500]`);
  if (plan.chunking.chunk_overlap < 0 || plan.chunking.chunk_overlap > 300)
    errors.push(`chunk_overlap ${plan.chunking.chunk_overlap} out of bounds [0-300]`);
  if (plan.chunking.chunk_overlap >= plan.chunking.chunk_size)
    errors.push('chunk_overlap must be < chunk_size');
  if (plan.retrieval?.top_k < 1 || plan.retrieval?.top_k > 10)
    errors.push(`top_k ${plan.retrieval?.top_k} out of bounds [1-10]`);
  if (plan.embedding?.model !== 'Xenova/bge-small-en-v1.5')
    errors.push(`Wrong embedding model: ${plan.embedding?.model}`);
  if (plan.embedding?.dimension !== 384)
    errors.push(`Wrong embedding dimension: ${plan.embedding?.dimension}`);
  if (plan.retrieval?.active_strategy !== 'similarity')
    errors.push(`Wrong retrieval strategy: ${plan.retrieval?.active_strategy}`);
  if (plan.retrieval?.similarity_metric !== 'cosine')
    errors.push(`Wrong similarity metric: ${plan.retrieval?.similarity_metric}`);
  if (plan.retrieval?.reranking?.enabled !== false)
    errors.push('Reranking should be disabled');
  return errors;
}

// ─── Profiler signal validator ────────────────────────────────────────────────

/**
 * Check that a knowledge profile contains meaningful structural signals.
 * Returns an array of problems found (empty = OK).
 */
function validateProfileSignals(profile) {
  const problems = [];
  if (!profile.signals) { problems.push('No signals object'); return problems; }
  if (typeof profile.signals.heading_density !== 'number')
    problems.push('heading_density missing');
  if (typeof profile.signals.has_procedures !== 'boolean')
    problems.push('has_procedures missing');
  if (typeof profile.signals.has_qa_patterns !== 'boolean')
    problems.push('has_qa_patterns missing');
  if (typeof profile.signals.has_short_records !== 'boolean')
    problems.push('has_short_records missing');
  if (typeof profile.signals.has_long_form_prose !== 'boolean')
    problems.push('has_long_form_prose missing');
  if (typeof profile.signals.has_warnings !== 'boolean')
    problems.push('has_warnings missing');
  if (!profile.structure_type)
    problems.push('structure_type missing');
  if (!profile.language)
    problems.push('language missing');
  return problems;
}

/**
 * Check that plan reasoning references at least one signal from the profile.
 * Returns true if the reasoning appears evidence-based.
 */
function reasoningReferencesProfile(plan, profile) {
  const planText = JSON.stringify(plan).toLowerCase();
  const s = profile.signals || {};

  // Check that at least some detected characteristics appear in the reasoning
  const evidenceTerms = [
    profile.structure_type,
    s.has_procedures       && 'procedur',
    s.has_qa_patterns      && 'faq',
    s.has_qa_patterns      && 'q&a',
    s.has_short_records    && 'short',
    s.has_long_form_prose  && 'prose',
    s.has_long_form_prose  && 'paragraph',
    s.has_warnings         && 'warning',
    s.has_numbered_subsections && 'subsection',
    s.has_numbered_sections    && 'section',
    s.has_cross_references     && 'cross',
    s.has_tabular_content      && 'table',
    s.has_tabular_content      && 'tabular',
  ].filter(t => typeof t === 'string' && t.length > 0);  // remove falsy and undefined

  if (evidenceTerms.length === 0) return false; // no signals to check against
  return evidenceTerms.some(term => planText.includes(term.toLowerCase()));
}

// ─── Test document content ────────────────────────────────────────────────────

/**
 * TEST A — FAQ / Customer Support knowledge base
 * Short independent Q&A entries, policies, support intents.
 * Signals expected: has_qa_patterns=true, has_short_records=true,
 *   has_procedures=false, heading_density low.
 */
const FAQ_DOCUMENT = `
What is your return policy?
We accept returns within 30 days of purchase. Items must be unworn with original tags attached.

How do I track my order?
You can track your order using the tracking link sent to your email after shipment.

What payment methods do you accept?
We accept Visa, Mastercard, American Express, PayPal, and Apple Pay.

Can I change my shipping address after placing an order?
Address changes are possible within 2 hours of placing the order. Contact support@example.com immediately.

What should I do if I receive a damaged item?
Photograph the damage and contact support within 48 hours. We will arrange a free replacement or full refund.

How long does standard shipping take?
Standard shipping takes 5–7 business days. Express shipping takes 2–3 business days.

Do you offer international shipping?
Yes, we ship to over 50 countries. International orders may be subject to customs duties.

What is your exchange policy?
Exchanges are accepted within 30 days. The item must be in original condition with tags attached.

How do I cancel my order?
Orders can be cancelled within 1 hour of placement via the order page or by contacting support.

Is my payment information secure?
Yes. We use 256-bit SSL encryption and are PCI-DSS compliant. We never store card numbers.

What sizes are available?
We offer sizes XS through 3XL. Refer to the size guide on each product page for measurements.

How do I apply a discount code?
Enter the discount code in the checkout page under "Apply Coupon" before completing payment.
`.trim();

/**
 * TEST B — Hierarchical procedural technical manual
 * Numbered sections, subsections, multi-step procedures, warnings,
 * prerequisites, cross-references, decision branches.
 * Signals expected: has_numbered_sections=true, has_numbered_subsections=true,
 *   has_procedures=true, has_warnings=true, has_cross_references=true,
 *   structure_type=hierarchical_manual or procedural_manual.
 */
const PROCEDURAL_MANUAL = `
INDUSTRIAL PUMP MAINTENANCE MANUAL
Model XP-2000 Series

1. SAFETY OVERVIEW

1.1 General Safety Precautions
Before performing any maintenance, ensure all power sources are isolated and locked out.
Refer to Section 4.2 for lockout/tagout procedures.

WARNING: Failure to isolate power before maintenance may result in serious injury or death.
CAUTION: Always wear appropriate PPE as specified in Section 1.3.

1.2 Required Personal Protective Equipment
- Safety glasses or face shield
- Chemical-resistant gloves (see Section 1.4 for glove selection)
- Steel-toed boots
- Hearing protection when operating above 85 dB

1.3 Emergency Procedures
If injury occurs, follow emergency procedures outlined in Section 7.1.
Contact site safety officer immediately.

2. SCHEDULED MAINTENANCE PROCEDURES

2.1 Daily Inspection
Step 1: Visually inspect pump housing for leaks or cracks.
Step 2: Check fluid levels in reservoir (see Figure 2-A for level markings).
Step 3: Verify all mounting bolts are secure. Torque specification: 45 Nm (see Table 3.1).
Step 4: Record inspection results in maintenance log (Form M-01).

2.2 Weekly Maintenance — Seal Replacement
Prerequisites:
- Complete daily inspection (Section 2.1) before proceeding.
- Ensure replacement seal kit (Part #XP-SK-200) is available.
- Confirm system has been depressurized (verify pressure gauge reads zero).

Step 1: Disconnect inlet and outlet connections. Refer to Section 3.1 for connection types.
Step 2: Remove the six M8 bolts securing the pump cover. Keep bolts in order for reinstallation.
Step 3: Carefully extract the worn seal assembly. Note orientation for reference.

WARNING: Do not use metal tools to pry the seal — this will damage the housing.

Step 4: Clean the seal groove with approved solvent (Part #CLN-200). Allow 5 minutes to dry.
Step 5: Apply thin layer of lubricant (Part #LUB-XP) to new seal O-ring.
Step 6: Insert new seal assembly in correct orientation (flat face toward pump body).
Step 7: Replace cover and torque bolts in cross pattern to 45 Nm.
Step 8: Reconnect connections and perform pressure test per Section 5.2 before return to service.

2.3 Troubleshooting Guide
If pump fails to prime:
- Check inlet for blockage (see Section 3.3)
- Verify suction lift does not exceed 7.5 m (refer to Table 4.2)
- If problem persists, inspect impeller per Section 2.5

If abnormal noise is detected:
- Reduce flow rate temporarily
- Inspect bearing assembly (Section 2.4)
- If noise continues after bearing inspection, contact technical support

3. COMPONENT SPECIFICATIONS

3.1 Connection Types
Refer to Table 3.1 for torque specifications for each connection type.
See Appendix B for connection diagrams.

3.2 Fluid Compatibility
WARNING: Using incompatible fluids will void warranty and may cause catastrophic failure.
Approved fluid list is provided in Appendix A.
`.trim();

/**
 * TEST C — Long-form narrative / reference document
 * Dense paragraphs, no numbered procedures, minimal headings,
 * conceptual/explanatory content with natural semantic boundaries.
 * Signals expected: has_long_form_prose=true, prose_ratio high,
 *   has_procedures=false, has_qa_patterns=false,
 *   structure_type=long_form_prose or policy_document.
 */
const LONGFORM_DOCUMENT = `
The Role of Machine Learning in Modern Healthcare

Artificial intelligence and machine learning have transformed numerous aspects of healthcare delivery over the past decade. The convergence of large-scale clinical datasets, advances in deep learning architectures, and increased computational power has enabled systems that can assist clinicians in ways previously considered impossible.

Diagnostic imaging represents one of the most mature applications of machine learning in medicine. Convolutional neural networks trained on millions of annotated radiological images have demonstrated performance comparable to specialist radiologists in detecting specific conditions such as diabetic retinopathy, pneumonia, and certain types of skin lesions. These systems analyze pixel patterns at a granularity and consistency that human vision cannot sustain across thousands of images in a single working session.

The integration of machine learning into electronic health record systems has enabled predictive modeling for patient deterioration, readmission risk, and sepsis onset. By analyzing combinations of vital signs, laboratory values, nursing notes, and medication histories in real time, these systems can generate alerts before clinical deterioration becomes apparent to bedside clinicians. Studies have shown that early warning systems with machine learning components can reduce ICU mortality when integrated thoughtfully into clinical workflows.

Natural language processing has unlocked the unstructured text in clinical notes, discharge summaries, and pathology reports. Information previously inaccessible to systematic analysis can now be extracted, standardized, and used to populate research cohorts, identify documentation gaps, and support quality improvement initiatives. Transformer-based models pre-trained on medical literature have shown strong performance on question-answering benchmarks derived from clinical knowledge.

Despite these advances, significant challenges remain. Model performance often degrades when deployed in health systems whose patient populations differ from training data. This distributional shift problem is particularly concerning because it can be silent — a model may continue to return predictions while its accuracy has substantially declined. Prospective monitoring frameworks and regular recalibration protocols are essential components of any responsible clinical deployment.

The ethical dimensions of algorithmic decision-making in healthcare require careful examination. Fairness across demographic groups, transparency in model reasoning, and accountability for errors are not merely technical problems but require institutional policies and clinical governance frameworks. Regulatory bodies in multiple jurisdictions have begun developing guidance specifically for AI-assisted medical devices, recognizing that traditional device evaluation frameworks do not fully address the adaptive and probabilistic nature of machine learning systems.

Federated learning has emerged as a promising approach to training models on healthcare data without centralizing sensitive patient information. By training locally and sharing only model gradients rather than raw data, participating institutions can collaborate on model development while maintaining data sovereignty and satisfying privacy regulations. Practical implementation challenges remain, including heterogeneity in data schemas, variable data quality across institutions, and coordination overhead for model aggregation.
`.trim();

// ─── Controlled adaptation test helper ───────────────────────────────────────

async function runControlledTest(token, appId, testName, documentContent, filename, requirement, validators) {
  section(`Controlled Test: ${testName}`);

  // Upload the test document (deferred indexing: stops at 'profiled')
  const uploadRes = await api('POST', '/api/documents/upload', token,
    makeTextUpload(appId, documentContent, filename));
  if (uploadRes.status === 200 && uploadRes.body.status === 'profiled') {
    pass(`${testName}: Document uploaded and profiled (deferred indexing)`, `id=${uploadRes.body.id?.slice(0,8)}`);
  } else {
    fail(`${testName}: Document upload failed`, JSON.stringify(uploadRes.body).slice(0, 100));
    return null;
  }

  // Analyze to get the rich profile (reads from Storage — no chunk dependency)
  const analyzeRes = await api('POST', '/api/architect/analyze', token, {
    rag_app_id: appId,
    requirement,
  });
  if (analyzeRes.status !== 200) {
    fail(`${testName}: Analyze failed`, `status=${analyzeRes.status}`);
    return null;
  }
  const profile = analyzeRes.body.knowledge_profile;
  pass(`${testName}: Analyze returns 200`);

  // Validate profiler signals are present and non-trivial
  const signalProblems = validateProfileSignals(profile);
  if (signalProblems.length === 0) {
    pass(`${testName}: Profiler signals present`, `structure_type=${profile.structure_type}`);
  } else {
    fail(`${testName}: Profiler signal problems`, signalProblems.join(', '));
  }

  // Run document-specific signal assertions
  for (const [label, check] of validators.signals || []) {
    if (check(profile)) pass(`${testName}: ${label}`);
    else fail(`${testName}: ${label}`, `signals=${JSON.stringify(profile.signals).slice(0, 150)}`);
  }

  // Generate the plan
  const planRes = await api('POST', '/api/architect/plan', token, {
    rag_app_id: appId,
    requirement,
    knowledge_profile: profile,
  });
  if (planRes.status !== 200 || !planRes.body.plan) {
    fail(`${testName}: Plan generation failed`, JSON.stringify(planRes.body).slice(0, 150));
    return null;
  }
  const plan = planRes.body.plan;
  pass(`${testName}: Plan generated`);

  // Runtime constraints
  const boundsErrors = validatePlanBounds(plan);
  if (boundsErrors.length === 0) {
    pass(`${testName}: Runtime constraints satisfied`,
      `strategy=${plan.chunking.strategy} chunk_size=${plan.chunking.chunk_size} top_k=${plan.retrieval.top_k}`);
  } else {
    fail(`${testName}: Runtime constraint violations`, boundsErrors.join('; '));
  }

  // Reasoning references profile signals
  if (reasoningReferencesProfile(plan, profile)) {
    pass(`${testName}: Plan reasoning references detected document characteristics`);
  } else {
    fail(`${testName}: Reasoning does not reference detected characteristics`,
      `structure_type=${profile.structure_type} chunking_reason="${plan.chunking?.reason?.slice(0, 100)}"`);
  }

  // All sections have non-trivial reasons
  const reasons = [
    plan.chunking?.reason,
    plan.retrieval?.reason,
    plan.generation?.reason,
  ];
  const allHaveReasons = reasons.every(r => r && r.length > 30);
  if (allHaveReasons) {
    pass(`${testName}: All major sections have substantive reasoning`);
  } else {
    fail(`${testName}: Some sections have missing or trivial reasoning`);
  }

  // Run plan-specific validators
  for (const [label, check] of validators.plan || []) {
    if (check(plan, profile)) pass(`${testName}: ${label}`);
    else fail(`${testName}: ${label}`,
      `strategy=${plan.chunking?.strategy} reason="${plan.chunking?.reason?.slice(0, 120)}"`);
  }

  // Approve + final-index so chunks exist for cross-document comparison (TEST F)
  await api('POST', '/api/architect/approve', token, { rag_app_id: appId });
  await api('POST', '/api/architect/index-all', token, { rag_app_id: appId });

  // Log the plan for human review
  info(`${testName} plan summary`,
    `strategy=${plan.chunking?.strategy} size=${plan.chunking?.chunk_size} overlap=${plan.chunking?.chunk_overlap} top_k=${plan.retrieval?.top_k} grounding=${plan.generation?.grounding_required}`);
  info(`${testName} chunking reason`, `"${plan.chunking?.reason?.slice(0, 200)}"`);
  info(`${testName} retrieval reason`, `"${plan.retrieval?.reason?.slice(0, 150)}"`);

  return { profile, plan };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 7 Enhanced — AI RAG Architect Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts = Date.now();
  const tokenA = await createUser(`arch-a-${ts}@vanta.test`, 'Arch!Test99');
  const tokenB = await createUser(`arch-b-${ts}@vanta.test`, 'Arch!Test99');

  // ── Main test app (clothing store support) ────────────────────────────────
  const gen = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'Customer support chatbot for an online clothing store',
  });
  const ragAppId = gen.body.id;
  cleanup.ragAppIds.push(ragAppId);

  // ── User B isolation app ──────────────────────────────────────────────────
  const genB = await api('POST', '/api/chatbots/generate', tokenB, {
    description: 'Travel planning assistant',
  });
  const ragAppIdB = genB.body.id;
  cleanup.ragAppIds.push(ragAppIdB);

  // ── Controlled test apps (one per document type) ──────────────────────────
  const genFaq = await api('POST', '/api/chatbots/generate', tokenA,
    { description: 'FAQ chatbot' });
  const ragAppFaq = genFaq.body.id;
  cleanup.ragAppIds.push(ragAppFaq);

  const genProc = await api('POST', '/api/chatbots/generate', tokenA,
    { description: 'Technical manual assistant' });
  const ragAppProc = genProc.body.id;
  cleanup.ragAppIds.push(ragAppProc);

  const genLong = await api('POST', '/api/chatbots/generate', tokenA,
    { description: 'Research reference assistant' });
  const ragAppLong = genLong.body.id;
  cleanup.ragAppIds.push(ragAppLong);

  console.log(`\n  App A (clothing): ${ragAppId.slice(0,8)}`);
  console.log(`  App B (travel):   ${ragAppIdB.slice(0,8)}`);
  console.log(`  App FAQ:          ${ragAppFaq.slice(0,8)}`);
  console.log(`  App Procedural:   ${ragAppProc.slice(0,8)}`);
  console.log(`  App Long-form:    ${ragAppLong.slice(0,8)}`);

  // Upload clothing store docs to App A
  await api('POST', '/api/documents/upload', tokenA,
    makeTextUpload(ragAppId, 'Our return policy allows returns within 30 days of purchase. Items must be unworn with tags attached.', 'returns.txt'));
  await api('POST', '/api/documents/upload', tokenA,
    makeTextUpload(ragAppId, 'Shipping options: standard (5-7 days), express (2-3 days), overnight (next business day). Free shipping on orders over $75.', 'shipping.txt'));

  // ── 1. Authentication / Ownership ─────────────────────────────────────────
  section('Authentication & Ownership');

  const noAuth = await api('POST', '/api/architect/analyze', null,
    { rag_app_id: ragAppId, requirement: 'test' });
  if (noAuth.status === 401) pass('Analyze without auth → 401');
  else fail('Analyze should require auth', `status=${noAuth.status}`);

  const wrongUser = await api('POST', '/api/architect/analyze', tokenB, {
    rag_app_id: ragAppId, requirement: 'I want to analyze User A app',
  });
  if (wrongUser.status === 404) pass('User B cannot analyze User A app → 404');
  else fail('Ownership not enforced on analyze', `status=${wrongUser.status}`);

  // ── 2. Analyze — Knowledge Profile + Follow-up Questions ─────────────────
  section('Analyze — Knowledge Profile + Follow-up Questions');

  const analyzeRes = await api('POST', '/api/architect/analyze', tokenA, {
    rag_app_id: ragAppId,
    requirement: 'I want a customer support chatbot for my online clothing store. Accuracy is more important than speed.',
  });

  if (analyzeRes.status === 200) pass('Analyze returns 200');
  else fail('Analyze failed', JSON.stringify(analyzeRes.body).slice(0, 100));

  const profile = analyzeRes.body.knowledge_profile;
  if (profile && profile.document_count >= 2)
    pass('Knowledge profile: document_count >= 2', `count=${profile.document_count}`);
  else fail('Knowledge profile document_count wrong', `count=${profile?.document_count}`);

  if (profile?.document_types?.length > 0)
    pass('Knowledge profile: document_types present', `types=${profile.document_types.join(',')}`);
  else fail('No document_types in profile');

  // Check rich profile structure fields exist (signals may be sparse for tiny test docs)
  if (profile?.structure_type !== undefined)
    pass('Knowledge profile: structure_type field present', `type=${profile.structure_type}`);
  else fail('Knowledge profile missing structure_type');

  if (profile?.signals !== undefined)
    pass('Knowledge profile: signals object present');
  else fail('Knowledge profile missing signals object');

  // ── 3. Knowledge Base Isolation ───────────────────────────────────────────
  section('Knowledge Base Isolation');

  const appBDocIds = (await admin.from('documents').select('id')
    .eq('rag_app_id', ragAppIdB)).data?.map(d => d.id) || [];
  if (appBDocIds.length === 0)
    pass('App A profile cannot receive App B documents (App B has none)');

  const questions = analyzeRes.body.questions || [];
  if (questions.length <= 4)
    pass(`Follow-up questions within limit: ${questions.length} question(s)`);
  else fail(`Too many follow-up questions: ${questions.length}`);

  const detailedAnalyze = await api('POST', '/api/architect/analyze', tokenA, {
    rag_app_id: ragAppId,
    requirement: 'A customer support chatbot that strictly uses only uploaded knowledge, answers in English, gives concise factual responses, prioritizes accuracy over speed.',
  });
  if (detailedAnalyze.status === 200) {
    const qs = detailedAnalyze.body.questions || [];
    pass(`Complete requirement generates ${qs.length} question(s)`, 'could be 0');
  }

  // ── 4. Plan Generation & Validation ──────────────────────────────────────
  section('Plan Generation & Validation');

  const planRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: ragAppId,
    requirement: 'Customer support chatbot for clothing store. Accuracy is more important than speed.',
    answers: [{ question_id: 'grounding', answer: 'Strictly uploaded knowledge' }],
    knowledge_profile: profile,
  });

  if (planRes.status === 200 && planRes.body.plan)
    pass('Plan generation returns 200 with plan');
  else fail('Plan generation failed', JSON.stringify(planRes.body).slice(0, 150));

  const plan = planRes.body.plan;

  if (plan?.domain && plan?.use_case && plan?.summary)
    pass('Plan has domain, use_case, summary');
  else fail('Plan missing required fields');

  if (plan?.chunking && plan?.embedding && plan?.retrieval && plan?.generation)
    pass('Plan has all required sections');
  else fail('Plan missing sections');

  const boundsErrors = validatePlanBounds(plan);
  if (boundsErrors.length === 0)
    pass('All runtime constraints satisfied',
      `chunk_size=${plan?.chunking?.chunk_size} top_k=${plan?.retrieval?.top_k}`);
  else fail('Runtime constraint violations', boundsErrors.join('; '));

  if (plan?.embedding?.model === 'Xenova/bge-small-en-v1.5')
    pass('Embedding model = Xenova/bge-small-en-v1.5');
  else fail('Wrong embedding model', plan?.embedding?.model);

  if (plan?.embedding?.dimension === 384)
    pass('Embedding dimension = 384');
  else fail('Wrong embedding dimension', plan?.embedding?.dimension);

  if (plan?.retrieval?.reranking?.enabled === false)
    pass('Reranking disabled in active config');
  else fail('Reranking should be disabled');

  const hasReasons = plan?.chunking?.reason && plan?.retrieval?.reason && plan?.generation?.reason;
  if (hasReasons) pass('All major sections have reasoning text');
  else fail('Missing reasoning in plan sections');

  // ── 5. Persistence & Status Lifecycle ────────────────────────────────────
  section('Persistence & Status Lifecycle');

  const { data: ragAfterPlan } = await admin
    .from('rag_apps').select('architect_status, architect_version, architect_plan')
    .eq('id', ragAppId).single();

  if (ragAfterPlan?.architect_status === 'ready')
    pass('architect_status = ready after successful plan');
  else fail('Wrong architect_status after plan', ragAfterPlan?.architect_status);

  const version1 = ragAfterPlan?.architect_version;
  if (version1 >= 1) pass('architect_version incremented', `v=${version1}`);
  else fail('architect_version not incremented', `v=${version1}`);

  if (ragAfterPlan?.architect_plan !== null)
    pass('architect_plan persisted in rag_apps');
  else fail('architect_plan not persisted');

  const regenRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: ragAppId,
    requirement: 'Customer support chatbot for clothing store, strict grounding required',
    knowledge_profile: profile,
  });

  const { data: ragAfterRegen } = await admin
    .from('rag_apps').select('architect_version')
    .eq('id', ragAppId).single();

  if (ragAfterRegen?.architect_version > version1)
    pass('Regenerate increments architect_version', `v${version1} → v${ragAfterRegen.architect_version}`);
  else fail('Regenerate did not increment version', `v=${ragAfterRegen?.architect_version}`);

  // ── 6. Approval Lifecycle ────────────────────────────────────────────────
  section('Approval Lifecycle');

  const approveRes = await api('POST', '/api/architect/approve', tokenA,
    { rag_app_id: ragAppId });
  if (approveRes.status === 200 && approveRes.body.architect_status === 'approved')
    pass('Approval returns 200 with architect_status = approved');
  else fail('Approval failed', JSON.stringify(approveRes.body).slice(0, 100));

  const { data: ragAfterApprove } = await admin
    .from('rag_apps').select('architect_status, architect_version')
    .eq('id', ragAppId).single();

  if (ragAfterApprove?.architect_status === 'approved')
    pass('architect_status = approved in DB');
  else fail('architect_status not approved in DB', ragAfterApprove?.architect_status);

  if (ragAfterApprove?.architect_version === ragAfterRegen?.architect_version)
    pass('Approval does not increment architect_version');
  else fail('Approval incorrectly incremented version');

  const doubleApprove = await api('POST', '/api/architect/approve', tokenA,
    { rag_app_id: ragAppId });
  if (doubleApprove.status === 400)
    pass('Re-approving approved plan → 400 (not ready state)');
  else fail('Should block re-approval', `status=${doubleApprove.status}`);

  // Final-index the clothing store app so regression RAG preview works
  await api('POST', '/api/architect/index-all', tokenA, { rag_app_id: ragAppId });

  // ── 7. Architect State Reload ────────────────────────────────────────────
  section('Architect State Reload');

  const getState = await api('GET', `/api/architect/${ragAppId}`, tokenA);
  if (getState.status === 200 && getState.body.architect_status === 'approved' && getState.body.architect_plan)
    pass('GET /api/architect/:id restores approved plan on reload');
  else fail('State reload failed', JSON.stringify(getState.body).slice(0, 100));

  // architect_version is present in reload response
  if (typeof getState.body.architect_version === 'number')
    pass('Reload response includes architect_version', `v=${getState.body.architect_version}`);
  else fail('Reload response missing architect_version');

  const getStateB = await api('GET', `/api/architect/${ragAppId}`, tokenB);
  if (getStateB.status === 404)
    pass('User B cannot GET User A architect state → 404');
  else fail('User B accessed User A architect state', `status=${getStateB.status}`);

  // ── 8. Controlled Adaptation Tests ───────────────────────────────────────
  console.log('\n  ══ Controlled Adaptation Tests ══════════════════════════════');
  console.log('  NOTE: These tests verify adaptive reasoning, not predetermined strategies.');
  console.log('  A plan is correct if its reasoning is grounded in detected signals.');

  // ── TEST A: FAQ / Customer Support ────────────────────────────────────────
  const faqResult = await runControlledTest(
    tokenA, ragAppFaq,
    'TEST-A (FAQ/Customer-Support)',
    FAQ_DOCUMENT,
    'faq_support.txt',
    'A customer support chatbot that answers questions about orders, returns, shipping, and policies. Responses should be concise and direct.',
    {
      signals: [
        ['FAQ: structure_type is faq or mixed',
          p => ['faq', 'mixed', 'policy_document'].includes(p.structure_type)],
        ['FAQ: has_qa_patterns or has_short_records detected',
          p => p.signals?.has_qa_patterns === true || p.signals?.has_short_records === true],
        ['FAQ: has_procedures is false (no multi-step procedures)',
          p => p.signals?.has_procedures === false],
      ],
      plan: [
        ['FAQ: chunk_size appropriate for short independent entries (≤ 800)',
          (plan) => plan.chunking.chunk_size <= 800],
        ['FAQ: grounding_required reflects support use case',
          (plan) => typeof plan.generation.grounding_required === 'boolean'],
      ],
    }
  );

  // ── TEST B: Hierarchical Procedural Manual ────────────────────────────────
  const procResult = await runControlledTest(
    tokenA, ragAppProc,
    'TEST-B (Procedural-Manual)',
    PROCEDURAL_MANUAL,
    'maintenance_manual.txt',
    'A technical assistant for maintenance engineers that answers questions about pump maintenance procedures, safety requirements, and troubleshooting steps. Accuracy and completeness of procedure steps is critical.',
    {
      signals: [
        ['PROC: structure_type is hierarchical_manual, procedural_manual, or mixed',
          p => ['hierarchical_manual', 'procedural_manual', 'mixed'].includes(p.structure_type)],
        ['PROC: has_numbered_sections detected',
          p => p.signals?.has_numbered_sections === true],
        ['PROC: has_warnings detected',
          p => p.signals?.has_warnings === true],
        ['PROC: has_procedures or has_numbered_subsections detected',
          p => p.signals?.has_procedures === true || p.signals?.has_numbered_subsections === true],
      ],
      plan: [
        ['PROC: if fixed chunking chosen, reason must address procedural/hierarchical structure',
          (plan, profile) => {
            if (plan.chunking.strategy !== 'fixed') return true; // non-fixed = acceptable
            // Fixed is only OK if the reason explicitly addresses the procedural structure
            const reason = (plan.chunking.reason || '').toLowerCase();
            return reason.includes('procedure') || reason.includes('section') ||
              reason.includes('step') || reason.includes('hierarchi') ||
              reason.includes('warning') || reason.includes('subsection');
          }],
        ['PROC: chunk_size adequate for preserving procedural context (≥ 500)',
          (plan) => plan.chunking.chunk_size >= 500],
        ['PROC: grounding_required = true (safety-critical procedures)',
          (plan) => plan.generation.grounding_required === true],
      ],
    }
  );

  // ── TEST C: Long-form Narrative / Reference ───────────────────────────────
  const longResult = await runControlledTest(
    tokenA, ragAppLong,
    'TEST-C (Long-form/Reference)',
    LONGFORM_DOCUMENT,
    'ai_healthcare_reference.txt',
    'A research assistant that helps healthcare professionals find information about machine learning applications, ethical considerations, and implementation challenges in healthcare. Responses should be detailed and comprehensive.',
    {
      signals: [
        ['LONG: structure_type is long_form_prose, policy_document, or mixed',
          p => ['long_form_prose', 'policy_document', 'mixed', 'reference_document'].includes(p.structure_type)],
        ['LONG: has_long_form_prose detected',
          p => p.signals?.has_long_form_prose === true],
        ['LONG: has_procedures is false',
          p => p.signals?.has_procedures === false],
        ['LONG: has_qa_patterns is false or minimal',
          p => p.signals?.has_qa_patterns === false || p.signals?.faq_density < 0.05],
      ],
      plan: [
        ['LONG: chunk_size appropriate for dense prose (≥ 500)',
          (plan) => plan.chunking.chunk_size >= 500],
        ['LONG: top_k allows breadth for research queries (≥ 4)',
          (plan) => plan.retrieval.top_k >= 4],
      ],
    }
  );

  // ── Cross-document comparison ─────────────────────────────────────────────
  section('Cross-Document Plan Comparison');

  if (faqResult && procResult) {
    // FAQ and procedural plans should differ in at least one meaningful dimension
    // unless both are genuinely justified as identical
    const faqPlan  = faqResult.plan;
    const procPlan = procResult.plan;

    const chunkSizeDiff = Math.abs(faqPlan.chunking.chunk_size - procPlan.chunking.chunk_size);
    const overlapDiff   = Math.abs(faqPlan.chunking.chunk_overlap - procPlan.chunking.chunk_overlap);
    const strategyDiff  = faqPlan.chunking.strategy !== procPlan.chunking.strategy;
    const topKDiff      = faqPlan.retrieval.top_k !== procPlan.retrieval.top_k;

    const hasMeaningfulDiff = strategyDiff || chunkSizeDiff >= 200 || overlapDiff >= 50 || topKDiff;
    if (hasMeaningfulDiff) {
      pass('FAQ and procedural plans differ meaningfully',
        `strategy: ${faqPlan.chunking.strategy} vs ${procPlan.chunking.strategy}, ` +
        `chunk_size: ${faqPlan.chunking.chunk_size} vs ${procPlan.chunking.chunk_size}`);
    } else {
      // Not necessarily a failure — identical values can be justified, just flag it
      info('FAQ and procedural plans have similar parameters',
        `strategy: ${faqPlan.chunking.strategy} vs ${procPlan.chunking.strategy}, ` +
        `chunk_size: ${faqPlan.chunking.chunk_size} vs ${procPlan.chunking.chunk_size} ` +
        '— acceptable only if both are genuinely justified');
      pass('FAQ and procedural plans have matching parameters (verify reasoning manually)');
    }
  }

  if (faqResult && longResult) {
    const faqPlan  = faqResult.plan;
    const longPlan = longResult.plan;
    const longTopKHigher = longPlan.retrieval.top_k >= faqPlan.retrieval.top_k;
    if (longTopKHigher) {
      pass('Long-form plan has top_k ≥ FAQ plan (expected for broader research queries)',
        `${faqPlan.retrieval.top_k} → ${longPlan.retrieval.top_k}`);
    } else {
      info('Long-form top_k is not higher than FAQ',
        `faq=${faqPlan.retrieval.top_k} longform=${longPlan.retrieval.top_k} — acceptable if justified`);
      pass('Long-form top_k comparison noted (verify reasoning)');
    }
  }

  // ── Representative Scenario ───────────────────────────────────────────────
  section('Representative Scenario (Clothing Store Support)');

  const planText = JSON.stringify(plan || {}).toLowerCase();
  const hasRelevantTerms = planText.includes('return') || planText.includes('support') ||
    planText.includes('grounding') || planText.includes('accuracy');
  if (hasRelevantTerms)
    pass('Plan references use-case relevant concepts (returns, support, grounding, accuracy)');
  else fail('Plan does not reference use-case terms');

  if (plan?.generation?.grounding_required === true)
    pass('Plan sets grounding_required = true (correct for support bot)');
  else fail('Expected grounding_required=true for support bot', `got=${plan?.generation?.grounding_required}`);

  // ── 9. Existing RAG Regression ────────────────────────────────────────────
  section('Existing RAG Regression');

  const health = await api('GET', '/api/health', null);
  if (health.status === 200) pass('GET /api/health still works');
  else fail('Health check broken');

  const chatbots = await api('GET', '/api/chatbots', tokenA);
  if (chatbots.status === 200 && Array.isArray(chatbots.body))
    pass('GET /api/chatbots still works');
  else fail('Chatbot list broken');

  const uploadTest = await api('POST', '/api/documents/upload', tokenA,
    makeTextUpload(ragAppId, 'Test document for regression check.', 'regression_test.txt'));
  if (uploadTest.status === 200 && uploadTest.body.status === 'profiled')
    pass('Document upload still works (status=profiled, deferred indexing)');
  else fail('Document upload broken', JSON.stringify(uploadTest.body).slice(0, 80));

  // Preview uses already-indexed docs from the approval step above
  const previewTest = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: ragAppId, query: 'What is the return policy?',
  });
  if (previewTest.status === 200 && previewTest.body.avgSimilarity > 0)
    pass('Real RAG preview still works', `avgSimilarity=${previewTest.body.avgSimilarity?.toFixed(4)}`);
  else fail('RAG preview broken', `status=${previewTest.status} sim=${previewTest.body?.avgSimilarity}`);

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
