-- =============================================================================
-- Vanta Platform — 010_ui_config.sql
--
-- Phase 10B: Chatbot UI & Widget Configuration
--
-- Adds ui_config JSONB column to rag_apps.
-- Stores the complete chat UI template, branding, messages, behavior,
-- and widget configuration for each chatbot.
--
-- UI configuration is COMPLETELY SEPARATE from:
--   - nodes / connections  (active workflow)
--   - draft_nodes / draft_connections (draft workflow)
--   - architect_plan (AI architecture plan)
--
-- Changing ui_config NEVER modifies the RAG workflow.
-- Changing the RAG workflow NEVER modifies ui_config.
--
-- Existing chatbots receive safe defaults automatically via DEFAULT.
--
-- Run in Supabase SQL Editor AFTER 001-009 migrations.
-- =============================================================================

ALTER TABLE rag_apps
  ADD COLUMN IF NOT EXISTS ui_config JSONB NOT NULL DEFAULT '{
    "chat_ui": {
      "template": "classic",
      "branding": {
        "name": null,
        "logo_url": null,
        "primary_color": "#7c3aed",
        "accent_color": "#a78bfa",
        "background_color": "#08080e",
        "user_message_color": "#7c3aed",
        "bot_message_color": "#14141f",
        "font_family": "system"
      },
      "messages": {
        "welcome_message": "Hi! How can I help you?",
        "placeholder": "Ask me anything...",
        "empty_state_message": "Ask me anything about our knowledge base."
      },
      "behavior": {
        "show_sources": true,
        "show_suggested_questions": true,
        "suggested_questions": [],
        "show_typing_indicator": true,
        "allow_file_upload": false
      }
    },
    "widget": {
      "template": "floating",
      "position": "bottom-right",
      "launcher": {
        "enabled": true,
        "label": "Chat",
        "icon": "chat"
      },
      "dimensions": {
        "width": 440,
        "height": 660
      }
    }
  }'::jsonb;

COMMENT ON COLUMN rag_apps.ui_config IS
  'Phase 10B Chat UI and Widget configuration. '
  'Completely separate from RAG workflow (nodes/connections). '
  'Structure: { chat_ui: { template, branding, messages, behavior }, widget: { template, position, launcher, dimensions } }. '
  'Templates: chat_ui = classic | customer_support | knowledge_assistant. '
  'Widget templates: floating | embedded | fullscreen.';

-- ── Index for querying by template type ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rag_apps_ui_template
  ON rag_apps USING gin(ui_config);
