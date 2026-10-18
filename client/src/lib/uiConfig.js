/**
 * client/src/lib/uiConfig.js
 *
 * Phase 10B: UI Configuration defaults and helpers.
 *
 * This module mirrors server/src/routes/uiConfig.js's DEFAULT_UI_CONFIG.
 * These defaults are used client-side to:
 *   - Populate the Appearance panel with sensible starting values
 *   - Render the chat UI when no config is saved yet
 *   - Provide fallbacks for missing/partial config fields
 *
 * INVARIANT: This config is COMPLETELY SEPARATE from RAG workflow state.
 * Changing ui_config NEVER modifies nodes/connections/architect_plan.
 */

export const DEFAULT_UI_CONFIG = {
  chat_ui: {
    template: 'classic',
    branding: {
      name:               null,
      logo_url:           null,
      primary_color:      '#7c3aed',
      accent_color:       '#a78bfa',
      background_color:   '#08080e',
      user_message_color: '#7c3aed',
      bot_message_color:  '#14141f',
      font_family:        'system',
    },
    messages: {
      welcome_message:     'Hi! How can I help you?',
      placeholder:         'Ask me anything...',
      empty_state_message: 'Ask me anything about our knowledge base.',
    },
    behavior: {
      show_sources:             true,
      show_suggested_questions: true,
      suggested_questions:      [],
      show_typing_indicator:    true,
      allow_file_upload:        false,
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

/**
 * Deep-merge two objects. Override values win over defaults.
 * Arrays are not merged — override array replaces default array entirely.
 */
export function deepMerge(defaults, override) {
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

/**
 * Resolve the effective UI config for a chatbot.
 * Merges persisted config (which may be partial) with defaults.
 * Returns a complete config object safe to use in UI rendering.
 */
export function resolveUiConfig(persisted) {
  return deepMerge(DEFAULT_UI_CONFIG, persisted ?? {});
}

/**
 * UI template definitions — used for template picker cards.
 */
export const CHAT_UI_TEMPLATES = [
  {
    id:          'classic',
    label:       'Classic',
    description: 'Clean general-purpose chatbot for any use case.',
    icon:        '💬',
    preview:     {
      headerStyle: 'minimal',
      bubbleStyle: 'rounded',
      colors:      ['#7c3aed', '#14141f'],
    },
  },
  {
    id:          'customer_support',
    label:       'Customer Support',
    description: 'Support-focused interface with prominent branding and suggested questions.',
    icon:        '🎧',
    preview:     {
      headerStyle: 'branded',
      bubbleStyle: 'soft',
      colors:      ['#0284c7', '#082f49'],
    },
  },
  {
    id:          'knowledge_assistant',
    label:       'Knowledge Assistant',
    description: 'Documentation-focused with visible sources and structured answers.',
    icon:        '📚',
    preview:     {
      headerStyle: 'clean',
      bubbleStyle: 'sharp',
      colors:      ['#059669', '#022c22'],
    },
  },
];

/**
 * Widget template definitions.
 */
export const WIDGET_TEMPLATES = [
  {
    id:          'floating',
    label:       'Floating',
    description: 'A launcher button in the corner of the page that opens a chat panel.',
    icon:        '💬',
  },
  {
    id:          'embedded',
    label:       'Embedded',
    description: 'Renders the chatbot inline as a panel — suitable for portals and sidebars.',
    icon:        '🔲',
  },
  {
    id:          'fullscreen',
    label:       'Full Screen',
    description: 'A full-page chat experience — ideal for dedicated chat pages.',
    icon:        '⛶',
  },
];

/**
 * Font family options.
 */
export const FONT_FAMILIES = [
  { id: 'system', label: 'System Default' },
  { id: 'inter',  label: 'Inter' },
  { id: 'sans',   label: 'Sans-Serif' },
  { id: 'mono',   label: 'Monospace' },
];

/**
 * Map font_family id → CSS font-family string.
 */
export function getFontFamilyCss(fontFamily) {
  switch (fontFamily) {
    case 'inter':  return "'Inter', 'Plus Jakarta Sans', sans-serif";
    case 'sans':   return "'Plus Jakarta Sans', system-ui, sans-serif";
    case 'mono':   return "'JetBrains Mono', 'Fira Code', monospace";
    default:       return "system-ui, -apple-system, 'Plus Jakarta Sans', sans-serif";
  }
}
