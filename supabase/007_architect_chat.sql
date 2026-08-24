-- =============================================================================
-- Vanta Platform — 007_architect_chat.sql
--
-- Phase 9B: Architect Chat + Proposed Architecture Revision
--
-- 1. architect_chat_messages table — persists conversation turns
-- 2. proposed_* columns on rag_apps — proposed revision state
--
-- Run in Supabase SQL Editor.
-- =============================================================================

-- ── Architect Chat Messages ───────────────────────────────────────────────────
-- Stores the conversation between the user and the Architect.
-- Scoped to user_id + rag_app_id so each user has their own conversation per app.
-- base_architect_version ties the conversation to a specific approved plan version.

CREATE TABLE IF NOT EXISTS architect_chat_messages (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rag_app_id            UUID        NOT NULL REFERENCES rag_apps(id)   ON DELETE CASCADE,
  base_architect_version INT        NOT NULL DEFAULT 0,
  -- Role: 'system' | 'user' | 'architect'
  -- 'system' = initial context injection (not shown to user)
  -- 'user'   = user message
  -- 'architect' = Architect response
  role                  TEXT        NOT NULL
                                    CHECK (role IN ('system', 'user', 'architect')),
  content               TEXT        NOT NULL,
  -- Optional metadata: proposal status after this turn, token counts, etc.
  metadata              JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_architect_chat_messages_rag_app_id
  ON architect_chat_messages(rag_app_id);
CREATE INDEX IF NOT EXISTS idx_architect_chat_messages_user_id
  ON architect_chat_messages(user_id);

COMMENT ON TABLE architect_chat_messages
  IS 'Architect conversational messages. Scoped to user_id + rag_app_id + base_architect_version.';

-- ── Proposed Architecture Revision on rag_apps ────────────────────────────────
-- Stores the Architect's structured proposal. Does NOT overwrite architect_plan.
-- Lifecycle: none → clarifying → ready_for_review → cancelled

ALTER TABLE rag_apps
  ADD COLUMN IF NOT EXISTS proposed_architect_plan          JSONB,
  ADD COLUMN IF NOT EXISTS proposed_architect_status        TEXT
                                                            CHECK (proposed_architect_status IN
                                                              ('clarifying', 'ready_for_review', 'cancelled')),
  ADD COLUMN IF NOT EXISTS proposed_architect_base_version  INT,
  ADD COLUMN IF NOT EXISTS proposed_architect_created_at    TIMESTAMPTZ;

COMMENT ON COLUMN rag_apps.proposed_architect_plan
  IS 'Phase 9B structured proposal from Architect chat. Does NOT replace architect_plan.';
COMMENT ON COLUMN rag_apps.proposed_architect_status
  IS 'Proposal lifecycle: clarifying | ready_for_review | cancelled.';
COMMENT ON COLUMN rag_apps.proposed_architect_base_version
  IS 'Which approved architect_version this proposal is based on.';
