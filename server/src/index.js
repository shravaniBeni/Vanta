/**
 * server/src/index.js
 *
 * Phase 5: SQLite fully removed. All persistence is Supabase.
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import { chatRateLimit, sessionRateLimit, feedbackRateLimit, uploadRateLimit, generalRateLimit } from './middleware/rateLimit.js';
import { loadEmbedder } from './embeddings.js';

import chatbotRoutes       from './routes/chatbots.js';
import messageRoutes       from './routes/messages.js';
import documentRoutes      from './routes/documents.js';
import chatRoutes          from './routes/chat.js';
import projectRoutes       from './routes/projects.js';
import architectRoutes     from './routes/architect.js';
import workflowRoutes      from './routes/workflow.js';
import architectChatRoutes from './routes/architectChat.js';
import crawlRoutes         from './routes/crawl.js';
import uiConfigRoutes      from './routes/uiConfig.js';
import analyticsRoutes     from './routes/analytics.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Process-level crash guard ────────────────────────────────────────────────

const FATAL_CODES = new Set(['EADDRINUSE', 'EACCES', 'ENOENT', 'MODULE_NOT_FOUND']);

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] name=%s code=%s message=%s', err.name, err.code, err.message);
  console.error('[uncaughtException] stack:', err.stack?.slice(0, 800));
  if (FATAL_CODES.has(err.code)) {
    console.error('[uncaughtException] FATAL error — process will exit');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[unhandledRejection] name=%s code=%s message=%s', err.name, err.code, err.message);
  console.error('[unhandledRejection] stack:', err.stack?.slice(0, 800));
});

// ─── Global middleware ────────────────────────────────────────────────────────

// CORS: allow the configured frontend origin(s).
// In production, set CORS_ORIGIN to the deployed frontend URL (e.g. https://vanta.vercel.app).
// Multiple origins can be comma-separated: https://app.example.com,https://www.example.com
// In development, defaults to localhost origins.
const rawOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, same-origin server-to-server)
    if (!origin) return callback(null, true);
    if (rawOrigins.includes(origin)) return callback(null, true);
    console.warn(`[cors] Blocked origin: ${origin}`);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));

// ─── Public routes ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);
// Rate-limit public chat — 30 req/min per IP
app.use('/api/chat', chatRateLimit, chatRoutes);

// ─── Authenticated test endpoint ─────────────────────────────────────────────

app.get('/api/me', requireAuth, (req, res) =>
  res.json({ id: req.user.id, email: req.user.email })
);

// ─── Conditional auth for chatbots ───────────────────────────────────────────

function chatbotAuth(req, res, next) {
  const isPublicEmbedLookup =
    req.method === 'GET' &&
    !req.path.replace('/', '') &&
    req.query.embed_id &&
    !req.query.id;
  return isPublicEmbedLookup ? next() : requireAuth(req, res, next);
}

// ─── Protected routes ─────────────────────────────────────────────────────────

app.use('/api/chatbots',       chatbotAuth,  chatbotRoutes);
app.use('/api/messages',       requireAuth,  messageRoutes);
// Upload rate limit applied before auth so it runs on every request
app.use('/api/documents',      uploadRateLimit, requireAuth, documentRoutes);
app.use('/api/projects',       requireAuth,  projectRoutes);
app.use('/api/architect',      requireAuth,  architectRoutes);
app.use('/api/workflow',       requireAuth,  workflowRoutes);
app.use('/api/architect-chat', requireAuth,  architectChatRoutes);
app.use('/api/crawl',          requireAuth,  crawlRoutes);
app.use('/api/chatbots/:id/ui-config', requireAuth, uiConfigRoutes);
// Phase 10C: analytics — mixed auth (owner routes require auth, feedback/session are public)
// Session and feedback endpoints have their own rate limits applied inside the router
app.use('/api/analytics',      analyticsRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

/**
 * Kill any stale process bound to PORT before binding.
 * Windows-only (uses netstat/taskkill). Skipped on Linux/macOS production hosts
 * where process managers (Railway, Render, Fly) handle port lifecycle.
 */
function killStaleOnPort(port) {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 3000 });
    const match = out.match(new RegExp(`TCP.*:${port}[^0-9].*LISTENING[\\s]+(\\d+)`));
    if (match) {
      const stalePid = parseInt(match[1]);
      if (stalePid && stalePid !== process.pid) {
        try {
          execSync(`taskkill /F /PID ${stalePid}`, { stdio: 'pipe', timeout: 3000 });
        } catch {
          process.kill(stalePid);
        }
        console.log(`[startup] Killed stale PID ${stalePid} on port ${port}`);
        return true;
      }
    }
  } catch { /* no stale process */ }
  return false;
}

loadEmbedder()
  .then(async () => {
    const killed = killStaleOnPort(PORT);
    if (killed) await new Promise(r => setTimeout(r, 500));

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
