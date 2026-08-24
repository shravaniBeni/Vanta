-- =============================================================================
-- Vanta Platform — 008_proposal_activation.sql
--
-- Phase 9C: Proposal approval + safe workflow activation.
--
-- Changes:
--   1. Extend proposed_architect_status CHECK constraint to include
--      the activation lifecycle states.
--   2. Add proposed_architect_activated_at to track when activation completed.
--
-- Lifecycle: none → clarifying → ready_for_review → approved →
--            activating → activated | activation_error
--   + cancelled (from any pre-activated state)
--
-- Run in Supabase SQL Editor.
-- =============================================================================

-- ── Drop old constraint + add new one ─────────────────────────────────────────
-- Supabase PostgreSQL does not support IF EXISTS on DROP CONSTRAINT in older
-- versions, so we drop unconditionally (idempotent via the next ADD).

ALTER TABLE rag_apps
  DROP CONSTRAINT IF EXISTS rag_apps_proposed_architect_status_check;

ALTER TABLE rag_apps
  ADD CONSTRAINT rag_apps_proposed_architect_status_check
  CHECK (proposed_architect_status IN (
    'clarifying',
    'ready_for_review',
    'approved',
    'activating',
    'activated',
    'activation_error',
    'cancelled'
  ));

-- ── Activation timestamp ──────────────────────────────────────────────────────
ALTER TABLE rag_apps
  ADD COLUMN IF NOT EXISTS proposed_architect_activated_at TIMESTAMPTZ;

-- ── Activation error message ──────────────────────────────────────────────────
-- Stores the reason when proposed_architect_status = 'activation_error'
ALTER TABLE rag_apps
  ADD COLUMN IF NOT EXISTS proposed_architect_error TEXT;

COMMENT ON COLUMN rag_apps.proposed_architect_activated_at
  IS 'Set when proposed_architect_status transitions to activated.';
COMMENT ON COLUMN rag_apps.proposed_architect_error
  IS 'Error message when proposed_architect_status = activation_error.';
