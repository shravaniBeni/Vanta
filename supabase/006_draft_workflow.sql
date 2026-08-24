-- =============================================================================
-- Vanta Platform — 006_draft_workflow.sql
--
-- Phase 9A: Active vs Draft Workflow
--
-- Adds draft_nodes, draft_connections, and draft_updated_at to rag_apps.
--
-- Semantics:
--   nodes / connections        — ACTIVE executable workflow (used by runtime)
--   draft_nodes / draft_connections — user canvas edits, not yet activated
--   draft_updated_at           — when the draft was last modified (NULL = no draft)
--
-- The runtime (chat.js / resolveRagRuntimeConfig) reads from nodes/connections.
-- The Editor writes canvas changes to draft_nodes/draft_connections.
-- Active workflow is only updated by the workflow materialization process.
--
-- Run in Supabase SQL Editor.
-- =============================================================================

ALTER TABLE rag_apps
  ADD COLUMN IF NOT EXISTS draft_nodes        JSONB,
  ADD COLUMN IF NOT EXISTS draft_connections  JSONB,
  ADD COLUMN IF NOT EXISTS draft_updated_at   TIMESTAMPTZ;

COMMENT ON COLUMN rag_apps.draft_nodes       IS 'Canvas draft workflow nodes — not yet activated. NULL = no pending draft.';
COMMENT ON COLUMN rag_apps.draft_connections IS 'Canvas draft workflow connections — not yet activated.';
COMMENT ON COLUMN rag_apps.draft_updated_at  IS 'When the draft was last saved. NULL = no draft exists.';
