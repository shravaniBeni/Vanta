-- =============================================================================
-- Vanta Platform — 005_document_status_lifecycle.sql
--
-- Separates document profiling from final indexing.
-- The old 3-state lifecycle (processing | indexed | error) is replaced with
-- a 6-state lifecycle that distinguishes:
--   - uploaded:  file in Storage, metadata row created
--   - profiling: text extraction + Architect profiling in progress
--   - profiled:  Architect can analyze; NO final document_chunks yet
--   - indexing:  approved-plan-driven chunking + embedding in progress
--   - indexed:   final document_chunks exist; pgvector retrieval ready
--   - error:     any stage failed; error_message populated
--
-- Run in Supabase SQL Editor after confirming current constraint name.
-- Verify constraint name first:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'documents'::regclass AND contype = 'c';
--
-- Expected output: documents_status_check
-- =============================================================================

-- Drop the old CHECK constraint (3-state: processing | indexed | error)
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

-- Add new CHECK constraint (6-state lifecycle)
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'profiling', 'profiled', 'indexing', 'indexed', 'error'));

-- Update the column comment to reflect the new lifecycle
COMMENT ON COLUMN documents.status IS
  'Document lifecycle: uploaded | profiling | profiled | indexing | indexed | error. '
  'Profiled = file stored, text extracted, Architect can analyze; no final chunks yet. '
  'Indexed = final document_chunks created from approved architect_plan.';

-- Migrate any existing rows:
-- 'processing' → 'profiling' (were mid-upload, treat as equivalent transition state)
-- 'indexed'    → 'indexed'   (already have final chunks, keep as-is)
-- 'error'      → 'error'     (keep)
UPDATE documents SET status = 'profiling' WHERE status = 'processing';
