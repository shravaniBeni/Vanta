-- =============================================================================
-- Vanta Platform — 003_functions.sql
-- PostgreSQL RPC functions for the Express backend.
-- Run AFTER 001_schema.sql and 002_rls.sql.
--
-- These functions are called from the Express API via:
--   supabase.rpc('function_name', { param: value })
-- All functions execute with the privileges of the calling role.
-- The Express server uses the service role key, so RLS is bypassed.
-- =============================================================================


-- =============================================================================
-- FUNCTION: match_chunks
-- Performs exact cosine similarity search over document_chunks for a given
-- RAG application.
--
-- Parameters:
--   query_embedding  vector(384)  — the embedded query from @huggingface/transformers
--   p_rag_app_id     UUID         — restricts search to one RAG app's chunks
--   match_count      INT          — maximum number of results to return (default 5)
--
-- Returns:
--   id         UUID   — document_chunks.id
--   content    TEXT   — chunk text
--   file_name  TEXT   — source filename (display only)
--   score      FLOAT  — cosine similarity in [0, 1]; higher = more similar
--
-- Search method: EXACT (operator <=>  = cosine distance; score = 1 - distance)
-- No ANN index is used during Phase 0. Exact search is acceptable for MVP
-- dataset sizes. See 001_schema.sql for the future HNSW migration note.
--
-- BGE model note:
-- BAAI/bge-small-en-v1.5 requires a query prefix for retrieval queries:
--   "Represent this sentence for searching relevant passages: <query>"
-- This prefix must be applied in the Express embedQuery() function BEFORE
-- calling this RPC. Document chunk embeddings do NOT use the prefix.
-- The database function is prefix-agnostic.
-- =============================================================================

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding  vector(384),
  p_rag_app_id     UUID,
  match_count      INT DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  file_name  TEXT,
  score      FLOAT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    dc.id,
    dc.content,
    dc.file_name,
    (1 - (dc.embedding <=> query_embedding))::FLOAT AS score
  FROM document_chunks dc
  WHERE dc.rag_app_id = p_rag_app_id
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_chunks(vector, UUID, INT)
  IS 'Exact cosine similarity search over document_chunks for a single RAG app. '
     'Returns up to match_count chunks ordered by descending similarity. '
     'Apply BGE query prefix before calling: '
     '"Represent this sentence for searching relevant passages: <query>"';


-- =============================================================================
-- FUNCTION: get_rag_app_for_embed
-- Returns the minimal rag_app fields required by the public chat widget,
-- identified by embed_id.
--
-- This function is called by the Express /api/chat route for public embed
-- access. It does NOT require the caller to be the owner of the app.
-- The Express route uses the service role key (bypasses RLS).
--
-- Returning only the fields the chat widget needs (id, title, description,
-- status, nodes) avoids exposing internal fields like user_id, project_id,
-- architect_plan to the public chat endpoint response.
--
-- The Express route must verify status = 'deployed' before proceeding
-- with retrieval and generation.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rag_app_for_embed(
  p_embed_id TEXT
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  description TEXT,
  status      TEXT,
  nodes       JSONB,
  connections JSONB
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    ra.id,
    ra.title,
    ra.description,
    ra.status,
    ra.nodes,
    ra.connections
  FROM rag_apps ra
  WHERE ra.embed_id = p_embed_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_rag_app_for_embed(TEXT)
  IS 'Returns minimal rag_app fields for the public chat widget identified by embed_id. '
     'Express must verify status = deployed before serving the chat. '
     'Called with service role key — RLS is bypassed intentionally.';
