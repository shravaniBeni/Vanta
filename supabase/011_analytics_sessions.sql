-- ============================================================
-- Migration 011: Phase 10C — Multi-User Session Memory,
--                Privacy-Conscious Analytics & Chatbot Insights
--
-- NEW TABLES:
--   visitor_sessions    — per-visitor session records (isolated per chatbot)
--   interaction_events  — compact analytics events (no raw text by default)
--   topic_aggregates    — normalized topic counts by chatbot + day
--   feedback_events     — explicit helpful/unhelpful signals
--
-- MODIFIED TABLES:
--   messages — add session_memory_version (link to summarized context)
--
-- INVARIANTS:
--   - All analytics scoped to chatbot_id (= rag_app_id)
--   - Raw question text NEVER stored in interaction_events
--   - visitor sessions isolated: no cross-session data access
--   - RLS: owners see their own chatbot data only
--   - Anonymous visitors supported (no account required)
--   - All foreign keys cascade from rag_apps
-- ============================================================

-- ─── 1. visitor_sessions ─────────────────────────────────────────────────────
-- One row per visitor conversation session per chatbot.
-- session_token is a server-generated UUID returned to the client.
-- It is NOT an auth credential — it is scoped strictly to one chatbot.

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership + scoping
  rag_app_id        UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,

  -- The session token sent back to the client (opaque, not guessable).
  -- Stored as TEXT so we can add a prefix for readability if needed.
  session_token     TEXT        NOT NULL UNIQUE,

  -- Optional anonymous visitor fingerprint (disabled by default).
  -- NULL unless the chatbot owner has enabled persistent visitor tracking.
  visitor_fingerprint TEXT      NULL,

  -- Lifecycle
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  session_status    TEXT        NOT NULL DEFAULT 'active'
                    CHECK (session_status IN ('active', 'expired', 'terminated')),

  -- Rolling memory: short summary of older messages in this session.
  -- NULL until the session exceeds the summarization threshold.
  memory_summary    TEXT        NULL,
  memory_version    INT         NOT NULL DEFAULT 0,   -- incremented on every summarization
  memory_token_count INT        NOT NULL DEFAULT 0,   -- approximate tokens used in summary
  summarized_through_message_id UUID NULL,            -- last message included in summary

  -- Metadata (non-sensitive only)
  metadata          JSONB       NOT NULL DEFAULT '{}'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_rag_app_id
  ON visitor_sessions(rag_app_id);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_token
  ON visitor_sessions(session_token);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_activity
  ON visitor_sessions(rag_app_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_status
  ON visitor_sessions(rag_app_id, session_status);

-- ─── 2. interaction_events ───────────────────────────────────────────────────
-- Compact analytics record per question/answer turn.
-- raw_question is NULL by default (privacy default).
-- Chatbot owners may enable diagnostic_logging to populate it.

CREATE TABLE IF NOT EXISTS interaction_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scoping (every row tied to chatbot + session)
  rag_app_id          UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  session_id          UUID        NOT NULL REFERENCES visitor_sessions(id) ON DELETE CASCADE,

  -- Timing
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Event classification
  event_type          TEXT        NOT NULL DEFAULT 'question_answered'
                      CHECK (event_type IN (
                        'question_answered',
                        'retrieval_failed',
                        'llm_failed',
                        'abstained',
                        'session_started',
                        'session_expired'
                      )),

  -- Topic (set by async classifier, NULL until classified)
  topic_category      TEXT        NULL,      -- normalized topic slug, e.g. "pointers"
  topic_label         TEXT        NULL,      -- human-readable, e.g. "Pointers & References"
  topic_confidence    REAL        NULL,      -- classifier confidence [0,1]

  -- Quality signals
  retrieval_status    TEXT        NOT NULL DEFAULT 'ok'
                      CHECK (retrieval_status IN ('ok', 'no_results', 'low_confidence', 'error')),
  retrieval_chunk_count INT       NOT NULL DEFAULT 0,
  avg_similarity_score  REAL      NULL,      -- avg cosine score of retrieved chunks

  -- Response quality
  response_status     TEXT        NOT NULL DEFAULT 'answered'
                      CHECK (response_status IN ('answered', 'abstained', 'failed')),
  abstained           BOOLEAN     NOT NULL DEFAULT false,

  -- Performance
  latency_ms          INT         NULL,      -- wall-clock time for the full request

  -- Token usage (when available from LLM provider)
  input_tokens        INT         NULL,
  output_tokens       INT         NULL,

  -- Workflow version at time of interaction
  architect_version   INT         NULL,

  -- Diagnostic: raw question ONLY if diagnostic_logging enabled on the chatbot.
  -- NULL by default. Never stored in analytics aggregates.
  raw_question        TEXT        NULL,

  -- Idempotency: prevent duplicate events during retries.
  -- Callers pass a client-generated idempotency_key; duplicates are ignored.
  idempotency_key     TEXT        NULL UNIQUE,

  metadata            JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_interaction_events_rag_app_id
  ON interaction_events(rag_app_id);

CREATE INDEX IF NOT EXISTS idx_interaction_events_session
  ON interaction_events(session_id);

CREATE INDEX IF NOT EXISTS idx_interaction_events_created_at
  ON interaction_events(rag_app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interaction_events_topic
  ON interaction_events(rag_app_id, topic_category)
  WHERE topic_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interaction_events_type
  ON interaction_events(rag_app_id, event_type, created_at DESC);

-- ─── 3. topic_aggregates ─────────────────────────────────────────────────────
-- Pre-aggregated topic counts per chatbot per day.
-- Updated by the analytics worker (upsert pattern).
-- Prevents repeated expensive GROUP BY queries on interaction_events.

CREATE TABLE IF NOT EXISTS topic_aggregates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rag_app_id        UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,

  -- Time bucket: truncated to the day (UTC)
  bucket_date       DATE        NOT NULL,

  -- Topic identity
  topic_category    TEXT        NOT NULL,   -- normalized slug
  topic_label       TEXT        NOT NULL,   -- human-readable label

  -- Counts (cumulative for the day)
  question_count    INT         NOT NULL DEFAULT 0,
  answered_count    INT         NOT NULL DEFAULT 0,
  abstained_count   INT         NOT NULL DEFAULT 0,
  retrieval_fail_count INT      NOT NULL DEFAULT 0,
  helpful_count     INT         NOT NULL DEFAULT 0,
  unhelpful_count   INT         NOT NULL DEFAULT 0,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per chatbot + topic + day
  UNIQUE (rag_app_id, topic_category, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_topic_aggregates_rag_app_date
  ON topic_aggregates(rag_app_id, bucket_date DESC);

CREATE INDEX IF NOT EXISTS idx_topic_aggregates_topic
  ON topic_aggregates(rag_app_id, topic_category);

-- ─── 4. feedback_events ──────────────────────────────────────────────────────
-- Explicit helpful / unhelpful signals from visitors.
-- Linked to a specific interaction_event, not to raw message text.

CREATE TABLE IF NOT EXISTS feedback_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rag_app_id        UUID        NOT NULL REFERENCES rag_apps(id) ON DELETE CASCADE,
  session_id        UUID        NOT NULL REFERENCES visitor_sessions(id) ON DELETE CASCADE,
  interaction_event_id UUID     NOT NULL REFERENCES interaction_events(id) ON DELETE CASCADE,

  -- helpful = true, unhelpful = false
  feedback_value    BOOLEAN     NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One feedback per interaction (no spamming)
  UNIQUE (interaction_event_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_rag_app_id
  ON feedback_events(rag_app_id);

CREATE INDEX IF NOT EXISTS idx_feedback_events_interaction
  ON feedback_events(interaction_event_id);

-- ─── 5. analytics_settings ───────────────────────────────────────────────────
-- Per-chatbot analytics configuration owned by the chatbot owner.
-- diagnostic_logging: stores raw_question in interaction_events.
-- session_expiry_days: how long sessions stay active.
-- data_retention_days: how long interaction_events are kept.

CREATE TABLE IF NOT EXISTS analytics_settings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rag_app_id            UUID        NOT NULL UNIQUE REFERENCES rag_apps(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Privacy defaults
  diagnostic_logging    BOOLEAN     NOT NULL DEFAULT false,  -- false = no raw question text
  session_expiry_days   INT         NOT NULL DEFAULT 30,
  data_retention_days   INT         NOT NULL DEFAULT 90,

  -- Memory configuration
  memory_enabled        BOOLEAN     NOT NULL DEFAULT true,
  memory_token_threshold INT        NOT NULL DEFAULT 2000,   -- tokens before summarization
  memory_recent_messages INT        NOT NULL DEFAULT 6,      -- messages kept verbatim after summarization

  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_settings_rag_app
  ON analytics_settings(rag_app_id);

-- ─── 6. RLS Policies ────────────────────────────────────────────────────────
-- All tables: Enable RLS. Express uses service role (bypasses RLS).
-- These policies protect against any accidental direct Supabase client access.

ALTER TABLE visitor_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE interaction_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_aggregates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_settings   ENABLE ROW LEVEL SECURITY;

-- Owners can read analytics for their own chatbots
-- (rag_apps.user_id = auth.uid())
CREATE POLICY "owners_read_visitor_sessions" ON visitor_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rag_apps
      WHERE rag_apps.id = visitor_sessions.rag_app_id
        AND rag_apps.user_id = auth.uid()
    )
  );

CREATE POLICY "owners_read_interaction_events" ON interaction_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rag_apps
      WHERE rag_apps.id = interaction_events.rag_app_id
        AND rag_apps.user_id = auth.uid()
    )
  );

CREATE POLICY "owners_read_topic_aggregates" ON topic_aggregates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rag_apps
      WHERE rag_apps.id = topic_aggregates.rag_app_id
        AND rag_apps.user_id = auth.uid()
    )
  );

CREATE POLICY "owners_read_feedback_events" ON feedback_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rag_apps
      WHERE rag_apps.id = feedback_events.rag_app_id
        AND rag_apps.user_id = auth.uid()
    )
  );

CREATE POLICY "owners_manage_analytics_settings" ON analytics_settings
  FOR ALL USING (user_id = auth.uid());

-- ─── 7. Helper function: get_analytics_summary ───────────────────────────────
-- Server-callable function to retrieve a chatbot's analytics summary
-- for a date range. Runs as the calling user's privilege level.

CREATE OR REPLACE FUNCTION get_analytics_summary(
  p_rag_app_id UUID,
  p_from       TIMESTAMPTZ,
  p_to         TIMESTAMPTZ
)
RETURNS TABLE (
  total_questions     BIGINT,
  answered_count      BIGINT,
  abstained_count     BIGINT,
  failed_count        BIGINT,
  retrieval_ok_count  BIGINT,
  retrieval_fail_count BIGINT,
  avg_latency_ms      NUMERIC,
  total_sessions      BIGINT,
  helpful_count       BIGINT,
  unhelpful_count     BIGINT,
  avg_similarity      NUMERIC
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    COUNT(*)                                                          AS total_questions,
    COUNT(*) FILTER (WHERE response_status = 'answered')             AS answered_count,
    COUNT(*) FILTER (WHERE abstained = true)                         AS abstained_count,
    COUNT(*) FILTER (WHERE response_status = 'failed')               AS failed_count,
    COUNT(*) FILTER (WHERE retrieval_status = 'ok')                  AS retrieval_ok_count,
    COUNT(*) FILTER (WHERE retrieval_status IN ('no_results','error','low_confidence')) AS retrieval_fail_count,
    ROUND(AVG(latency_ms)::NUMERIC, 0)                               AS avg_latency_ms,
    COUNT(DISTINCT session_id)                                       AS total_sessions,
    (SELECT COUNT(*) FROM feedback_events fe
      WHERE fe.rag_app_id = p_rag_app_id AND fe.feedback_value = true
        AND fe.created_at BETWEEN p_from AND p_to)                   AS helpful_count,
    (SELECT COUNT(*) FROM feedback_events fe
      WHERE fe.rag_app_id = p_rag_app_id AND fe.feedback_value = false
        AND fe.created_at BETWEEN p_from AND p_to)                   AS unhelpful_count,
    ROUND(AVG(avg_similarity_score)::NUMERIC, 4)                     AS avg_similarity
  FROM interaction_events
  WHERE rag_app_id = p_rag_app_id
    AND event_type = 'question_answered'
    AND created_at BETWEEN p_from AND p_to;
$$;

-- ─── 8. Helper function: expire_old_sessions ─────────────────────────────────
-- Marks sessions past their expires_at as 'expired'.
-- Called periodically by the server process.

CREATE OR REPLACE FUNCTION expire_old_sessions()
RETURNS INT
LANGUAGE SQL
AS $$
  WITH expired AS (
    UPDATE visitor_sessions
    SET session_status = 'expired'
    WHERE session_status = 'active'
      AND expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::INT FROM expired;
$$;
