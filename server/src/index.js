/**
 * server/src/index.js
 *
 * Phase 5: SQLite fully removed. All persistence is Supabase.
 *
 * Persistence map (final after Phase 5):
 *   projects         → Supabase PostgreSQL
 *   rag_apps         → Supabase PostgreSQL
 *   documents        → Supabase Storage (files) + PostgreSQL (metadata)
 *   document_chunks  → Supabase pgvector vector(384)
 *   messages         → Supabase PostgreSQL
 *
 * Startup sequence:
 *   load env → Supabase client (module-level) → loadEmbedder() → app.listen()
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import { loadEmbedder } from './embeddings.js';

import chatbotRoutes  from './routes/chatbots.js';
import messageRoutes  from './routes/messages.js';
import documentRoutes from './routes/documents.js';
import chatRoutes     from './routes/chat.js';
import projectRoutes  from './routes/projects.js';
import architectRoutes from './routes/architect.js';
import workflowRoutes  from './routes/workflow.js';
import architectChatRoutes from './routes/architectChat.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Process-level crash guard ────────────────────────────────────────────────
// Catches unhandled errors from native modules (e.g. pdf-parse on malformed files)
// to prevent the server crashing on a single bad request.
//
// IMPORTANT: Fatal errors (EADDRINUSE, EACCES, startup failures) must still
// exit the process — never swallow them. Only log-and-continue for errors
// that occur during live request handling (not at startup).

const FATAL_CODES = new Set(['EADDRINUSE', 'EACCES', 'ENOENT', 'MODULE_NOT_FOUND']);

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] name=%s code=%s message=%s', err.name, err.code, err.message);
  console.error('[uncaughtException] stack:', err.stack?.slice(0, 800));
  if (FATAL_CODES.has(err.code)) {
    console.error('[uncaughtException] FATAL error — process will exit');
    process.exit(1);
  }
  // Non-fatal: log and continue (e.g. pdf-parse crash during a request)
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[unhandledRejection] name=%s code=%s message=%s', err.name, err.code, err.message);
  console.error('[unhandledRejection] stack:', err.stack?.slice(0, 800));
  // Do not exit — unhandled rejections in request handlers are logged but non-fatal
});

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));

// ─── Public routes ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// /api/chat — split:
//   POST /api/chat         — public (embed_id) + optional-auth (chatbot_id)
//   POST /api/chat/preview — requires authentication (Phase 6 closes the exception)
//   The preview route inside chatRoutes applies requireAuth internally.
app.use('/api/chat', chatRoutes);

// ─── Authenticated test endpoint ─────────────────────────────────────────────

app.get('/api/me', requireAuth, (req, res) =>
  res.json({ id: req.user.id, email: req.user.email })
);

// ─── Conditional auth for chatbots ───────────────────────────────────────────
// GET /api/chatbots?embed_id=<id> — public, used by deployed chat widget
// All other chatbot operations — require auth

function chatbotAuth(req, res, next) {
  const isPublicEmbedLookup =
    req.method === 'GET' &&
    !req.path.replace('/', '') &&
    req.query.embed_id &&
    !req.query.id;

  return isPublicEmbedLookup ? next() : requireAuth(req, res, next);
}

// ─── Protected routes ─────────────────────────────────────────────────────────

app.use('/api/chatbots',        chatbotAuth,   chatbotRoutes);
app.use('/api/messages',        requireAuth,   messageRoutes);
app.use('/api/documents',       requireAuth,   documentRoutes);
app.use('/api/projects',        requireAuth,   projectRoutes);
app.use('/api/architect',       requireAuth,   architectRoutes);
app.use('/api/workflow',        requireAuth,   workflowRoutes);
app.use('/api/architect-chat',  requireAuth,   architectChatRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
// No SQLite migration. No db.js. Supabase client initializes at module load.

loadEmbedder()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Vanta server → http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Auth:   GET http://localhost:${PORT}/api/me\n`);
    });
  })
  .catch(err => {
    console.error('[startup] Fatal error:', err.message);
    process.exit(1);
  });
