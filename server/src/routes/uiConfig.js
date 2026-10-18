/**
 * server/src/routes/uiConfig.js
 *
 * Phase 10B: Chatbot UI & Widget Configuration API.
 *
 * GET  /api/chatbots/:id/ui-config  — read current ui_config
 * PUT  /api/chatbots/:id/ui-config  — save full ui_config (validated)
 *
 * INVARIANT: These routes NEVER touch nodes, connections, draft_nodes,
 * draft_connections, architect_plan, or any RAG workflow state.
 *
 * Security:
 *   - requireAuth middleware is applied in index.js
 *   - Ownership is checked via getOwnedRagApp
 *   - User-supplied values are validated and sanitized
 *   - No arbitrary HTML rendering from config values
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';

const router = Router({ mergeParams: true });

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_UI_CONFIG = {
  chat_ui: {
    template: 'classic',
    branding: {
      name:                 null,
      logo_url:             null,
      primary_color:        '#7c3aed',
      accent_color:         '#a78bfa',
      background_color:     '#08080e',
      user_message_color:   '#7c3aed',
      bot_message_color:    '#14141f',
      font_family:          'system',
    },
    messages: {
      welcome_message:     'Hi! How can I help you?',
      placeholder:         'Ask me anything...',
      empty_state_message: 'Ask me anything about our knowledge base.',
    },
    behavior: {
      show_sources:              true,
      show_suggested_questions:  true,
      suggested_questions:       [],
      show_typing_indicator:     true,
      allow_file_upload:         false,
    },
  },
  widget: {
    template:  'floating',
    position:  'bottom-right',
    launcher: {
      enabled: true,
      label:   'Chat',
      icon:    'chat',
    },
    dimensions: {
      width:  440,
      height: 660,
    },
  },
};

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_CHAT_UI_TEMPLATES  = new Set(['classic', 'customer_support', 'knowledge_assistant']);
const VALID_WIDGET_TEMPLATES   = new Set(['floating', 'embedded', 'fullscreen']);
const VALID_WIDGET_POSITIONS   = new Set(['bottom-right', 'bottom-left']);
const VALID_FONT_FAMILIES      = new Set(['system', 'inter', 'sans', 'mono']);
const COLOR_REGEX              = /^#[0-9a-fA-F]{3,8}$/;

function validateColor(val, fieldName) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') throw new Error(`${fieldName} must be a string or null`);
  if (!COLOR_REGEX.test(val)) throw new Error(`${fieldName} must be a valid hex color (e.g. #7c3aed)`);
  return val;
}

function validateString(val, fieldName, maxLen = 500) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') throw new Error(`${fieldName} must be a string`);
  const trimmed = val.trim();
  if (trimmed.length > maxLen) throw new Error(`${fieldName} must not exceed ${maxLen} characters`);
  return trimmed;
}

function validateUrl(val, fieldName) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') throw new Error(`${fieldName} must be a string or null`);
  const trimmed = val.trim();
  if (trimmed === '') return null;
  // Only allow https:// URLs to prevent javascript: injection
  if (!trimmed.startsWith('https://')) throw new Error(`${fieldName} must be a https:// URL`);
  if (trimmed.length > 2048) throw new Error(`${fieldName} URL too long`);
  return trimmed;
}

function validateSuggestedQuestions(arr) {
  if (!Array.isArray(arr)) throw new Error('suggested_questions must be an array');
  if (arr.length > 10) throw new Error('suggested_questions: max 10 questions');
  return arr
    .filter(q => typeof q === 'string' && q.trim().length > 0)
    .map(q => q.trim().slice(0, 200));
}

/**
 * Validates and normalizes a raw ui_config input.
 * Returns the validated config merged with safe defaults.
 * Throws with a descriptive message on validation failure.
 */
function validateUiConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ui_config must be an object');

  const out = structuredClone(DEFAULT_UI_CONFIG);

  // ── chat_ui ──────────────────────────────────────────────────────────────
  if (raw.chat_ui) {
    const cu = raw.chat_ui;

    if (cu.template !== undefined) {
      if (!VALID_CHAT_UI_TEMPLATES.has(cu.template)) {
        throw new Error(`chat_ui.template must be one of: ${[...VALID_CHAT_UI_TEMPLATES].join(', ')}`);
      }
      out.chat_ui.template = cu.template;
    }

    if (cu.branding) {
      const b = cu.branding;
      if (b.name       !== undefined) out.chat_ui.branding.name               = validateString(b.name, 'branding.name', 80);
      if (b.logo_url   !== undefined) out.chat_ui.branding.logo_url            = validateUrl(b.logo_url, 'branding.logo_url');
      if (b.primary_color       !== undefined) out.chat_ui.branding.primary_color       = validateColor(b.primary_color, 'branding.primary_color');
      if (b.accent_color        !== undefined) out.chat_ui.branding.accent_color        = validateColor(b.accent_color, 'branding.accent_color');
      if (b.background_color    !== undefined) out.chat_ui.branding.background_color    = validateColor(b.background_color, 'branding.background_color');
      if (b.user_message_color  !== undefined) out.chat_ui.branding.user_message_color  = validateColor(b.user_message_color, 'branding.user_message_color');
      if (b.bot_message_color   !== undefined) out.chat_ui.branding.bot_message_color   = validateColor(b.bot_message_color, 'branding.bot_message_color');
      if (b.font_family         !== undefined) {
        if (!VALID_FONT_FAMILIES.has(b.font_family)) {
          throw new Error(`branding.font_family must be one of: ${[...VALID_FONT_FAMILIES].join(', ')}`);
        }
        out.chat_ui.branding.font_family = b.font_family;
      }
    }

    if (cu.messages) {
      const m = cu.messages;
      if (m.welcome_message     !== undefined) out.chat_ui.messages.welcome_message     = validateString(m.welcome_message, 'messages.welcome_message', 300);
      if (m.placeholder         !== undefined) out.chat_ui.messages.placeholder         = validateString(m.placeholder, 'messages.placeholder', 120);
      if (m.empty_state_message !== undefined) out.chat_ui.messages.empty_state_message = validateString(m.empty_state_message, 'messages.empty_state_message', 300);
    }

    if (cu.behavior) {
      const bv = cu.behavior;
      if (bv.show_sources             !== undefined) out.chat_ui.behavior.show_sources             = Boolean(bv.show_sources);
      if (bv.show_suggested_questions !== undefined) out.chat_ui.behavior.show_suggested_questions = Boolean(bv.show_suggested_questions);
      if (bv.suggested_questions      !== undefined) out.chat_ui.behavior.suggested_questions      = validateSuggestedQuestions(bv.suggested_questions);
      if (bv.show_typing_indicator    !== undefined) out.chat_ui.behavior.show_typing_indicator    = Boolean(bv.show_typing_indicator);
      if (bv.allow_file_upload        !== undefined) out.chat_ui.behavior.allow_file_upload        = Boolean(bv.allow_file_upload);
    }
  }

  // ── widget ───────────────────────────────────────────────────────────────
  if (raw.widget) {
    const w = raw.widget;

    if (w.template !== undefined) {
      if (!VALID_WIDGET_TEMPLATES.has(w.template)) {
        throw new Error(`widget.template must be one of: ${[...VALID_WIDGET_TEMPLATES].join(', ')}`);
      }
      out.widget.template = w.template;
    }

    if (w.position !== undefined) {
      if (!VALID_WIDGET_POSITIONS.has(w.position)) {
        throw new Error(`widget.position must be one of: ${[...VALID_WIDGET_POSITIONS].join(', ')}`);
      }
      out.widget.position = w.position;
    }

    if (w.launcher) {
      const l = w.launcher;
      if (l.enabled !== undefined) out.widget.launcher.enabled = Boolean(l.enabled);
      if (l.label   !== undefined) out.widget.launcher.label   = validateString(l.label, 'launcher.label', 30);
      if (l.icon    !== undefined) out.widget.launcher.icon    = validateString(l.icon, 'launcher.icon', 20);
    }

    if (w.dimensions) {
      const d = w.dimensions;
      if (d.width !== undefined) {
        const w_ = Number(d.width);
        if (!Number.isInteger(w_) || w_ < 280 || w_ > 800) throw new Error('widget.dimensions.width must be 280–800');
        out.widget.dimensions.width = w_;
      }
      if (d.height !== undefined) {
        const h = Number(d.height);
        if (!Number.isInteger(h) || h < 400 || h > 900) throw new Error('widget.dimensions.height must be 400–900');
        out.widget.dimensions.height = h;
      }
    }
  }

  return out;
}

// ─── GET /api/chatbots/:id/ui-config ─────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const app = await getOwnedRagApp(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Chatbot not found' });

    // Merge persisted config with defaults to handle null/missing fields
    const persisted = app.ui_config ?? {};
    const config    = deepMerge(DEFAULT_UI_CONFIG, persisted);
    res.json(config);
  } catch (err) {
    console.error('[uiConfig GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/chatbots/:id/ui-config ─────────────────────────────────────────

router.put('/', async (req, res) => {
  try {
    const app = await getOwnedRagApp(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Chatbot not found' });

    // Validate and normalize
    let validated;
    try {
      validated = validateUiConfig(req.body);
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    // Update ONLY ui_config — never touch workflow fields
    const { data, error } = await supabase
      .from('rag_apps')
      .update({
        ui_config:  validated,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id, ui_config')
      .single();

    if (error || !data) {
      console.error('[uiConfig PUT]', error?.message);
      return res.status(500).json({ error: 'Failed to save UI configuration' });
    }

    res.json(data.ui_config);
  } catch (err) {
    console.error('[uiConfig PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Deep merge helper (defaults → persisted) ─────────────────────────────────

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

export { validateUiConfig };
export default router;
