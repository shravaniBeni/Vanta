-- =============================================================================
-- Vanta Platform — 004_architect_approved_status.sql
--
-- Adds 'approved' to the rag_apps.architect_status CHECK constraint.
--
-- Required for Phase 7: the AI RAG Architect approval endpoint sets
-- architect_status = 'approved', which was missing from the original constraint.
--
-- Run in Supabase SQL Editor ONLY if 'approved' is not already in the constraint.
-- Verify first with:
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'rag_apps_architect_status_check';
--
-- Expected result after this migration:
--   CHECK ((architect_status = ANY (ARRAY['pending','generating','ready','approved','error'])))
-- =============================================================================

ALTER TABLE rag_apps
  DROP CONSTRAINT IF EXISTS rag_apps_architect_status_check;

ALTER TABLE rag_apps
  ADD CONSTRAINT rag_apps_architect_status_check
  CHECK (architect_status IN ('pending', 'generating', 'ready', 'approved', 'error'));
