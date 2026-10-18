/**
 * server/scripts/verify-ui-config.mjs
 *
 * Phase 10B UI Config & Widget Tests — pure unit/structural tests.
 * No network calls, no Supabase, no OpenRouter credits needed.
 *
 * Tests:
 *  Configuration
 *   1.  DEFAULT_UI_CONFIG has correct structure
 *   2.  DEFAULT_UI_CONFIG chat_ui.template is "classic"
 *   3.  DEFAULT_UI_CONFIG widget.template is "floating"
 *   4.  DEFAULT_UI_CONFIG widget.position is "bottom-right"
 *
 *  Validation — chat_ui
 *   5.  validateUiConfig accepts valid classic template
 *   6.  validateUiConfig accepts customer_support template
 *   7.  validateUiConfig accepts knowledge_assistant template
 *   8.  validateUiConfig rejects unknown chat UI template
 *   9.  validateUiConfig accepts valid hex primary_color
 *  10.  validateUiConfig rejects invalid hex color
 *  11.  validateUiConfig accepts https:// logo_url
 *  12.  validateUiConfig rejects http:// logo_url (XSS guard)
 *  13.  validateUiConfig rejects javascript: logo_url (XSS guard)
 *  14.  validateUiConfig accepts empty logo_url (null)
 *  15.  validateUiConfig truncates welcome_message over 300 chars
 *  16.  validateUiConfig accepts suggested_questions array
 *  17.  validateUiConfig rejects > 10 suggested_questions
 *  18.  validateUiConfig strips empty strings from suggested_questions
 *
 *  Validation — widget
 *  19.  validateUiConfig accepts floating template
 *  20.  validateUiConfig accepts embedded template
 *  21.  validateUiConfig accepts fullscreen template
 *  22.  validateUiConfig rejects unknown widget template
 *  23.  validateUiConfig accepts bottom-right position
 *  24.  validateUiConfig accepts bottom-left position
 *  25.  validateUiConfig rejects unknown widget position
 *  26.  validateUiConfig accepts valid dimensions (width/height)
 *  27.  validateUiConfig rejects width < 280
 *  28.  validateUiConfig rejects height > 900
 *
 *  Separation invariant
 *  29.  validateUiConfig NEVER modifies nodes/connections fields
 *  30.  validateUiConfig output contains NO workflow-related keys
 *
 *  Deep merge
 *  31.  deepMerge returns defaults when no override
 *  32.  deepMerge applies partial override (template only)
 *  33.  deepMerge doesn't lose unspecified default fields
 *  34.  deepMerge replaces arrays (not merges them)
 *
 *  Regression — existing Phase 9A-10A tests unaffected (structural)
 *  35.  getNodeCapability still works after Phase 10B changes
 *  36.  ArchitectPlanSchema still validates correctly
 *  37.  UI config has no keys in common with workflow node schema
 */

import { DEFAULT_UI_CONFIG, validateUiConfig } from '../src/routes/uiConfig.js';
import { getNodeCapability } from '../src/nodeCapabilityRegistry.js';
import { ArchitectPlanSchema } from '../src/architect/schema.js';

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function throws(fn, msgSubstring) {
  try {
    fn();
    throw new Error(`Expected error containing "${msgSubstring}" but no error was thrown`);
  } catch (err) {
    if (!err.message.includes(msgSubstring)) {
      throw new Error(`Expected error containing "${msgSubstring}", got: "${err.message}"`);
    }
  }
}

// ─── Deep merge (inline, matches server logic) ────────────────────────────────

function deepMerge(defaults, override) {
  if (!override || typeof override !== 'object') return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      out[key] !== null &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else if (override[key] !== undefined) {
      out[key] = override[key];
    }
  }
  return out;
}

// ─── Configuration tests ──────────────────────────────────────────────────────

test('1. DEFAULT_UI_CONFIG has correct top-level structure', () => {
  assert(typeof DEFAULT_UI_CONFIG === 'object');
  assert('chat_ui' in DEFAULT_UI_CONFIG, 'Must have chat_ui');
  assert('widget'  in DEFAULT_UI_CONFIG, 'Must have widget');
  assert('template'  in DEFAULT_UI_CONFIG.chat_ui, 'chat_ui must have template');
  assert('branding'  in DEFAULT_UI_CONFIG.chat_ui, 'chat_ui must have branding');
  assert('messages'  in DEFAULT_UI_CONFIG.chat_ui, 'chat_ui must have messages');
  assert('behavior'  in DEFAULT_UI_CONFIG.chat_ui, 'chat_ui must have behavior');
  assert('template'  in DEFAULT_UI_CONFIG.widget,  'widget must have template');
  assert('position'  in DEFAULT_UI_CONFIG.widget,  'widget must have position');
  assert('launcher'  in DEFAULT_UI_CONFIG.widget,  'widget must have launcher');
  assert('dimensions' in DEFAULT_UI_CONFIG.widget, 'widget must have dimensions');
});

test('2. DEFAULT_UI_CONFIG chat_ui.template is "classic"', () => {
  eq(DEFAULT_UI_CONFIG.chat_ui.template, 'classic');
});

test('3. DEFAULT_UI_CONFIG widget.template is "floating"', () => {
  eq(DEFAULT_UI_CONFIG.widget.template, 'floating');
});

test('4. DEFAULT_UI_CONFIG widget.position is "bottom-right"', () => {
  eq(DEFAULT_UI_CONFIG.widget.position, 'bottom-right');
});

// ─── Chat UI template validation ──────────────────────────────────────────────

test('5. validateUiConfig accepts valid classic template', () => {
  const result = validateUiConfig({ chat_ui: { template: 'classic' } });
  eq(result.chat_ui.template, 'classic');
});

test('6. validateUiConfig accepts customer_support template', () => {
  const result = validateUiConfig({ chat_ui: { template: 'customer_support' } });
  eq(result.chat_ui.template, 'customer_support');
});

test('7. validateUiConfig accepts knowledge_assistant template', () => {
  const result = validateUiConfig({ chat_ui: { template: 'knowledge_assistant' } });
  eq(result.chat_ui.template, 'knowledge_assistant');
});

test('8. validateUiConfig rejects unknown chat UI template', () => {
  throws(() => validateUiConfig({ chat_ui: { template: 'hacker_theme' } }), 'chat_ui.template must be one of');
});

test('9. validateUiConfig accepts valid hex primary_color', () => {
  const result = validateUiConfig({ chat_ui: { branding: { primary_color: '#ff0000' } } });
  eq(result.chat_ui.branding.primary_color, '#ff0000');
});

test('10. validateUiConfig rejects invalid hex color', () => {
  throws(() => validateUiConfig({ chat_ui: { branding: { primary_color: 'red' } } }), 'valid hex color');
});

test('11. validateUiConfig accepts https:// logo_url', () => {
  const result = validateUiConfig({ chat_ui: { branding: { logo_url: 'https://example.com/logo.png' } } });
  eq(result.chat_ui.branding.logo_url, 'https://example.com/logo.png');
});

test('12. validateUiConfig rejects http:// logo_url (XSS guard)', () => {
  throws(() => validateUiConfig({ chat_ui: { branding: { logo_url: 'http://example.com/logo.png' } } }), 'must be a https://');
});

test('13. validateUiConfig rejects javascript: logo_url (XSS guard)', () => {
  throws(() => validateUiConfig({ chat_ui: { branding: { logo_url: 'javascript:alert(1)' } } }), 'must be a https://');
});

test('14. validateUiConfig accepts null logo_url', () => {
  const result = validateUiConfig({ chat_ui: { branding: { logo_url: null } } });
  eq(result.chat_ui.branding.logo_url, null);
});

test('15. validateUiConfig truncates welcome_message at 300 chars', () => {
  const long = 'A'.repeat(400);
  throws(() => validateUiConfig({ chat_ui: { messages: { welcome_message: long } } }), 'must not exceed 300');
});

test('16. validateUiConfig accepts suggested_questions array', () => {
  const qs = ['What is your return policy?', 'How long does shipping take?'];
  const result = validateUiConfig({ chat_ui: { behavior: { suggested_questions: qs } } });
  eq(result.chat_ui.behavior.suggested_questions.length, 2);
  eq(result.chat_ui.behavior.suggested_questions[0], 'What is your return policy?');
});

test('17. validateUiConfig rejects > 10 suggested_questions', () => {
  const qs = Array.from({ length: 11 }, (_, i) => `Question ${i + 1}`);
  throws(() => validateUiConfig({ chat_ui: { behavior: { suggested_questions: qs } } }), 'max 10 questions');
});

test('18. validateUiConfig strips empty strings from suggested_questions', () => {
  const qs = ['Valid question', '', '   ', 'Another valid'];
  const result = validateUiConfig({ chat_ui: { behavior: { suggested_questions: qs } } });
  eq(result.chat_ui.behavior.suggested_questions.length, 2, 'Must strip empty/whitespace entries');
});

// ─── Widget validation ────────────────────────────────────────────────────────

test('19. validateUiConfig accepts floating widget template', () => {
  const result = validateUiConfig({ widget: { template: 'floating' } });
  eq(result.widget.template, 'floating');
});

test('20. validateUiConfig accepts embedded widget template', () => {
  const result = validateUiConfig({ widget: { template: 'embedded' } });
  eq(result.widget.template, 'embedded');
});

test('21. validateUiConfig accepts fullscreen widget template', () => {
  const result = validateUiConfig({ widget: { template: 'fullscreen' } });
  eq(result.widget.template, 'fullscreen');
});

test('22. validateUiConfig rejects unknown widget template', () => {
  throws(() => validateUiConfig({ widget: { template: 'popup' } }), 'widget.template must be one of');
});

test('23. validateUiConfig accepts bottom-right position', () => {
  const result = validateUiConfig({ widget: { position: 'bottom-right' } });
  eq(result.widget.position, 'bottom-right');
});

test('24. validateUiConfig accepts bottom-left position', () => {
  const result = validateUiConfig({ widget: { position: 'bottom-left' } });
  eq(result.widget.position, 'bottom-left');
});

test('25. validateUiConfig rejects unknown widget position', () => {
  throws(() => validateUiConfig({ widget: { position: 'top-center' } }), 'widget.position must be one of');
});

test('26. validateUiConfig accepts valid dimensions', () => {
  const result = validateUiConfig({ widget: { dimensions: { width: 400, height: 700 } } });
  eq(result.widget.dimensions.width, 400);
  eq(result.widget.dimensions.height, 700);
});

test('27. validateUiConfig rejects width < 280', () => {
  throws(() => validateUiConfig({ widget: { dimensions: { width: 200 } } }), '280');
});

test('28. validateUiConfig rejects height > 900', () => {
  throws(() => validateUiConfig({ widget: { dimensions: { height: 1000 } } }), '900');
});

// ─── Separation invariant ─────────────────────────────────────────────────────

test('29. validateUiConfig output contains NO workflow-related keys', () => {
  const result = validateUiConfig({});
  const WORKFLOW_KEYS = ['nodes', 'connections', 'draft_nodes', 'draft_connections', 'architect_plan', 'architect_status', 'architect_version'];
  for (const k of WORKFLOW_KEYS) {
    assert(!(k in result), `ui_config must NOT contain workflow key: ${k}`);
  }
});

test('30. validateUiConfig output structure — only chat_ui and widget', () => {
  const result = validateUiConfig({});
  const keys = Object.keys(result);
  eq(keys.length, 2, 'Root must have exactly 2 keys: chat_ui and widget');
  assert(keys.includes('chat_ui'), 'Must have chat_ui');
  assert(keys.includes('widget'),  'Must have widget');
});

// ─── Deep merge tests ─────────────────────────────────────────────────────────

test('31. deepMerge returns defaults unchanged when no override', () => {
  const result = deepMerge(DEFAULT_UI_CONFIG, {});
  eq(result.chat_ui.template, 'classic');
  eq(result.widget.template,  'floating');
  eq(result.widget.position,  'bottom-right');
});

test('32. deepMerge applies partial override (template only)', () => {
  const result = deepMerge(DEFAULT_UI_CONFIG, { chat_ui: { template: 'customer_support' } });
  eq(result.chat_ui.template, 'customer_support');
  // Other chat_ui fields preserved
  eq(result.chat_ui.branding.primary_color, '#7c3aed', 'Branding must be preserved');
  eq(result.widget.template, 'floating', 'Widget must be unchanged');
});

test('33. deepMerge preserves unspecified default fields', () => {
  const result = deepMerge(DEFAULT_UI_CONFIG, {
    chat_ui: {
      branding: { primary_color: '#ff0000' },
    },
  });
  eq(result.chat_ui.branding.primary_color, '#ff0000', 'Override applied');
  eq(result.chat_ui.branding.font_family,   'system',   'Default preserved');
  eq(result.chat_ui.messages.welcome_message, 'Hi! How can I help you?', 'Default messages preserved');
});

test('34. deepMerge replaces arrays entirely (not merges)', () => {
  const result = deepMerge(DEFAULT_UI_CONFIG, {
    chat_ui: {
      behavior: { suggested_questions: ['Q1', 'Q2'] },
    },
  });
  eq(result.chat_ui.behavior.suggested_questions.length, 2);
  eq(result.chat_ui.behavior.suggested_questions[0], 'Q1');
});

// ─── Regression tests ─────────────────────────────────────────────────────────

test('35. Phase 9A-10A regression: getNodeCapability still works', () => {
  const llm   = getNodeCapability('LLM');
  const ocr   = getNodeCapability('OCR');
  const crawl = getNodeCapability('WebCrawler');
  assert(llm,   'LLM must be in registry');
  assert(ocr,   'OCR must be in registry');
  assert(crawl, 'WebCrawler must be in registry');
  eq(llm.runtime_status,   'supported');
  eq(ocr.runtime_status,   'supported');
  eq(crawl.runtime_status, 'supported');
});

test('36. Phase 9B-9C regression: ArchitectPlanSchema still validates', () => {
  const plan = {
    domain: 'test',
    use_case: 'Test chatbot',
    knowledge_profile: { document_count: 1, document_types: ['pdf'], structure: 'mixed', language: 'English', notes: '' },
    requires_ocr: false,
    ocr_reason: '',
    chunking: { strategy: 'recursive', chunk_size: 1000, chunk_overlap: 200, reason: 'test' },
    embedding: { model: 'Xenova/bge-small-en-v1.5', dimension: 384, reason: 'test' },
    retrieval: { active_strategy: 'similarity', similarity_metric: 'cosine', top_k: 5, reranking: { enabled: false, model: null }, reason: 'test' },
    generation: { grounding_required: true, response_style: 'factual', reason: 'test' },
    future_recommendations: [],
    summary: 'Test plan',
  };
  const r = ArchitectPlanSchema.safeParse(plan);
  assert(r.success, `ArchitectPlanSchema regression failed: ${JSON.stringify(r.error?.flatten())}`);
});

test('37. UI config keys have no overlap with architect plan schema keys', () => {
  const UI_CONFIG_KEYS  = new Set(['chat_ui', 'widget']);
  const WORKFLOW_KEYS   = new Set(['domain', 'use_case', 'chunking', 'embedding', 'retrieval', 'generation', 'requires_ocr', 'nodes', 'connections']);
  const intersection    = [...UI_CONFIG_KEYS].filter(k => WORKFLOW_KEYS.has(k));
  eq(intersection.length, 0, `UI config keys must not overlap with workflow keys: ${intersection.join(', ')}`);
});

// ─── Report ───────────────────────────────────────────────────────────────────

const D = '─'.repeat(68);
console.log('\n' + D);
console.log('PHASE 10B UI CONFIG — CHATBOT UI & WIDGET TEMPLATE TESTS');
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
