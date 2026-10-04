-- =============================================================================
-- Vanta Platform — 009_document_profile.sql
--
-- Phase 10A: Document profiling support.
--
-- Changes:
--   1. Add profile_data JSONB column to documents table.
--      Stores the result of profileDocument() after upload:
--      {
--        classification: 'TEXT_EXTRACTABLE'|'SCANNED'|'MIXED'|'IMAGE_HEAVY'|'NOT_PDF',
--        signals: {
--          page_count, chars_total, chars_per_page[],
--          text_pages, scanned_pages
--        }
--      }
--
--   2. Extend the documents.status CHECK constraint to include
--      'needs_architecture_review' — set when a document is classified as
--      SCANNED/MIXED/IMAGE_HEAVY and the active workflow has no OCR node.
--      The document remains in Storage; the user must add OCR via the Architect.
--
-- Run in Supabase SQL Editor AFTER 001-008 migrations.
-- =============================================================================

-- ── 1. Add profile_data column ────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS profile_data JSONB;

COMMENT ON COLUMN documents.profile_data IS
  'Phase 10A document profiling result. '
  'Structure: { classification, signals: { page_count, chars_total, chars_per_page[], text_pages, scanned_pages } }. '
  'Set during upload by profileDocument(). NULL for documents uploaded before Phase 10A.';

-- ── 2. Extend status CHECK constraint ────────────────────────────────────────
-- Drop the existing 6-state constraint (added in 005_document_status_lifecycle.sql)
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

-- Add new 7-state constraint
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN (
    'uploaded',
    'profiling',
    'profiled',
    'needs_architecture_review',
    'indexing',
    'indexed',
    'error'
  ));

COMMENT ON COLUMN documents.status IS
  'Document lifecycle: '
  'uploaded | profiling | profiled | needs_architecture_review | indexing | indexed | error. '
  'needs_architecture_review: document is SCANNED/MIXED/IMAGE_HEAVY and active workflow has no OCR node. '
  'profiled: text-extractable document ready for indexing. '
  'indexed: final document_chunks created from approved architect_plan.';

-- ── 3. Index for profile queries ─────────────────────────────────────────────
-- Allows efficient retrieval of documents needing architecture review.
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(status);

CREATE INDEX IF NOT EXISTS idx_documents_profile_classification
  ON documents USING gin(profile_data);
