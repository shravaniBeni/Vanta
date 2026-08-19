-- =============================================================================
-- Vanta Platform — 001_schema.sql
-- Target schema for the Supabase PostgreSQL migration.
-- Run order: 001_schema.sql → 002_rls.sql → 003_functions.sql
--
-- Execute in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Do NOT run this against the existing SQLite-backed server.
-- The SQLite application continues operating unchanged until subsequent
-- migration phases wire the application to Supabase.
-- =============================================================================

-- ── Extension ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;


-- =============================================================================
-- TABLE: profiles
-- One row per authenticated user, auto-created by trigger (see bottom).
-- =============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID        PRIMARY KEY
                            REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  avatar_url    TEXT,
  plan          TEXT        NOT NULL DEFAULT 'free'
                            CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  profiles       IS 'One profile row per Supabase Auth user.';
COMMENT ON COLUMN profiles.plan  IS 'Billing plan: free | pro | enterprise.';


-- =============================================================================
-- TABLE: projects
-- Core platform entity. project_id is the cross-module join key for the
-- Website Builder and AutoOps/DevOps modules in future phases.
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  slug          TEXT        UNIQUE,
  -- Reserved for future subdomain routing. NULL until assigned.
  plan          TEXT        NOT NULL DEFAULT 'free'
                            CHECK (plan IN ('free', 'pro', 'enterprise')),
  metadata      JSONB       NOT NULL DEFAULT '{}',
  -- Extension point for Website Builder / AutoOps modules.
  -- Those modules store their own project-level config here under
  -- namespaced keys: { "website_builder": {...}, "autoops": {...} }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

COMMENT ON TABLE  projects          IS 'Top-level platform container shared across all Vanta modules.';
COMMENT ON COLUMN projects.slug     IS 'Future vanity URL slug. NULL until explicitly set.';
COMMENT ON COLUMN projects.metadata IS 'Namespaced extension point for cross-module project config.';


-- =============================================================================
-- TABLE: rag_apps
-- Replaces the legacy SQLite "chatbots" table.
-- Every RAG application belongs to exactly one project (project_id NOT NULL).
--
-- AI Architect fields are reserved for the future AI RAG Architect module.
-- The Architect is NOT implemented in this migration phase.
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_apps (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT: deleting a project that still owns RAG apps is blocked.

  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL DEFAULT '',

  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'deployed', 'archived')),

  embed_id          TEXT        UNIQUE,
  -- Set when the app is deployed. Public access is mediated exclusively by
  -- the Express API using embed_id. No anonymous RLS policy exposes this.

  nodes             JSONB       NOT NULL DEFAULT '[]',
  connections       JSONB       NOT NULL DEFAULT '[]',

  -- ── AI RAG Architect fields (reserved, not implemented this phase) ──────
  architect_plan    JSONB,
  -- Future structure (not schema-enforced):
  -- {
  --   "chunking_strategy": "recursive"|"semantic"|"fixed",
  --   "chunk_size": <int>,
  --   "chunk_overlap": <int>,
  --   "embedding_model": <string>,
  --   "vector_dimension": <int>,
  --   "retrieval_strategy": "similarity"|"hybrid"|"mmr",
  --   "similarity_metric": "cosine"|"l2"|"dot",
  --   "top_k": <int>,
  --   "reranking": {"enabled": <bool>, "model": <string>} | null,
  --   "explanations": {"<field>": "<reasoning>"}
  -- }

  architect_status  TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (architect_status IN (
                                  'pending', 'generating', 'ready', 'error'
                                )),

  architect_version INT         NOT NULL DEFAULT 0,
  -- Incremented each time the Architect regenerates a plan for this app.

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_apps_user_id    ON rag_apps(user_id);
CREATE INDEX IF NOT EXISTS idx_rag_apps_project_id ON rag_apps(project_id);
CREATE INDEX IF NOT EXISTS idx_rag_apps_embed_id
  ON rag_apps(embed_id)
  WHERE embed_id IS NOT NULL;

COMMENT ON TABLE  rag_apps                   IS 'RAG application definitions. Replaces legacy SQLite chatbots table.';
COMMENT ON COLUMN rag_apps.project_id        IS 'NOT NULL. Every app belongs to a project. project_id is the cross-module entity key.';
COMMENT ON COLUMN rag_apps.embed_id          IS 'Public chatbot identifier set on deploy. Express API mediates all public access.';
COMMENT ON COLUMN rag_apps.architect_plan    IS 'Reserved for AI RAG Architect. Stores chunking/embedding/retrieval config + explanations.';
COMMENT ON COLUMN rag_apps.architect_status  IS 'Lifecycle: pending | generating | ready | error.';
COMMENT ON COLUMN rag_apps.architect_version IS 'Incremented each time the Architect regenerates a plan.';


-- =============================================================================
-- TABLE: documents
-- Metadata for each uploaded knowledge-base file.
-- The actual file lives in Supabase Storage (private bucket: knowledge-docs).
--
-- Storage path convention:
--   {user_id}/{rag_app_id}/{document_id}/{safe_filename}
-- safe_filename is produced by the Express upload handler.
-- The unsanitized original file_name must NEVER appear directly in the path.
-- =============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rag_app_id    UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  node_id       TEXT        NOT NULL,
  -- The workflow node id (DocumentUpload node) that owns this document.

  file_name     TEXT        NOT NULL,
  -- Original filename for display purposes only. Not used in storage paths.

  storage_path  TEXT        NOT NULL,
  -- Full Supabase Storage path.
  -- Format: {user_id}/{rag_app_id}/{document_id}/{safe_filename}

  mime_type     TEXT,
  size_bytes    BIGINT,
  chunk_count   INTEGER     NOT NULL DEFAULT 0,

  status        TEXT        NOT NULL DEFAULT 'processing'
                            CHECK (status IN ('processing', 'indexed', 'error')),

  error_message TEXT,
  -- Populated when status = 'error'. NULL otherwise.

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_rag_app_id ON documents(rag_app_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id    ON documents(user_id);

COMMENT ON TABLE  documents               IS 'Metadata for uploaded knowledge docs. Files live in Supabase Storage.';
COMMENT ON COLUMN documents.storage_path  IS 'Private path. Format: {user_id}/{rag_app_id}/{document_id}/{safe_filename}.';
COMMENT ON COLUMN documents.file_name     IS 'Original filename for display. Never used directly in storage paths.';
COMMENT ON COLUMN documents.status        IS 'Indexing lifecycle: processing | indexed | error.';


-- =============================================================================
-- TABLE: document_chunks
-- One row per text chunk. embedding is vector(384) NOT NULL.
--
-- Embedding model: BAAI/bge-small-en-v1.5 via @huggingface/transformers (384-dim).
-- NOT NULL is intentional: if embedding generation fails, the Express handler
-- must set documents.status = 'error' and must NOT insert any chunk row.
-- Pseudo-embedding fallbacks are not permitted in the target architecture.
--
-- ANN index: NOT created during Phase 0 (exact search is used for MVP).
-- When exact search latency becomes a bottleneck (typically >10k chunks
-- per RAG app), add the following HNSW index:
--
--   CREATE INDEX idx_chunks_embedding
--     ON document_chunks
--     USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
--
-- HNSW is preferred over IVFFlat because:
--   - No training step / lists parameter to tune
--   - Supports incremental inserts without rebuild
--   - Better recall/latency tradeoff for moderate per-tenant datasets
-- =============================================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rag_app_id    UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  document_id   UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id       TEXT        NOT NULL,
  file_name     TEXT        NOT NULL,
  content       TEXT        NOT NULL,
  embedding     vector(384) NOT NULL,
  -- 384 dimensions: BAAI/bge-small-en-v1.5 output.
  -- If a future model uses a different dimension, add a new column rather
  -- than altering this one to avoid breaking existing data.
  chunk_index   INTEGER     NOT NULL DEFAULT 0,
  -- 0-based position of this chunk within the source document.
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_rag_app_id
  ON document_chunks(rag_app_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id
  ON document_chunks(document_id);

COMMENT ON TABLE  document_chunks            IS '384-dim embeddings from BAAI/bge-small-en-v1.5. NOT NULL prevents pseudo-embedding inserts.';
COMMENT ON COLUMN document_chunks.embedding  IS 'vector(384) NOT NULL. Exact pgvector search at MVP. See HNSW note above.';
COMMENT ON COLUMN document_chunks.chunk_index IS '0-based position of chunk in source document.';


-- =============================================================================
-- TABLE: messages
-- Chat messages for authenticated dashboard users and anonymous embed users.
-- user_id is nullable to support anonymous embed widget users.
-- All inserts go through the Express API (service role key).
-- No anonymous INSERT RLS policy. Express validates deployed status first.
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- NULL for anonymous embed users.
  rag_app_id          UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  session_id          TEXT        NOT NULL,
  -- Client-generated identifier grouping messages into a conversation.
  role                TEXT        NOT NULL
                                  CHECK (role IN ('user', 'assistant')),
  content             TEXT        NOT NULL,
  confidence          REAL,
  retrieved_chunk_ids UUID[],
  -- document_chunks.id values used to generate this assistant response.
  diagnostic          JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_rag_app_id ON messages(rag_app_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

COMMENT ON TABLE  messages                     IS 'Chat history. user_id NULL for anonymous embed users. All inserts via Express service role.';
COMMENT ON COLUMN messages.session_id          IS 'Client-generated session id. Group conversation turns by this value.';
COMMENT ON COLUMN messages.retrieved_chunk_ids IS 'document_chunks.id values used to generate this response.';


-- =============================================================================
-- TABLE: deployments
-- Immutable record of each deploy event.
-- config_snapshot captures nodes, connections, and architect_plan at deploy
-- time so the deployed behaviour is reproducible even after draft edits.
-- =============================================================================
CREATE TABLE IF NOT EXISTS deployments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rag_app_id       UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  embed_id         TEXT        UNIQUE NOT NULL,
  deployed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  config_snapshot  JSONB       NOT NULL
  -- Snapshot of nodes + connections + architect_plan at deployment time.
);

CREATE INDEX IF NOT EXISTS idx_deployments_rag_app_id ON deployments(rag_app_id);
CREATE INDEX IF NOT EXISTS idx_deployments_embed_id   ON deployments(embed_id);

COMMENT ON TABLE  deployments                  IS 'Immutable deployment records. config_snapshot preserves exact pipeline state.';
COMMENT ON COLUMN deployments.config_snapshot  IS 'nodes + connections + architect_plan snapshot for reproducible deployed behaviour.';


-- =============================================================================
-- TABLE: evaluations
-- Schema reserved for the future FRANQ evaluation layer.
-- No application logic uses this table in the current migration phase.
-- =============================================================================
CREATE TABLE IF NOT EXISTS evaluations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rag_app_id          UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  message_id          UUID        REFERENCES messages(id) ON DELETE SET NULL,
  faithfulness        REAL,
  factuality          REAL,
  hallucination_risk  REAL,
  evaluator           TEXT        NOT NULL DEFAULT 'franq-v1',
  metadata            JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_rag_app_id ON evaluations(rag_app_id);

COMMENT ON TABLE evaluations IS 'Reserved for FRANQ evaluation layer. Not implemented in current phase.';


-- =============================================================================
-- TRIGGER: auto-create profile on new Supabase Auth user signup
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user
  IS 'Auto-creates a profiles row when a new Supabase Auth user registers.';
