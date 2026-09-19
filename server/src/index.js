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
import { loadEmbedder } from './embeddings.js';

import chatbotRoutes       from './routes/chatbots.js';
import messageRoutes       from './routes/messages.js';
import documentRoutes      from './routes/documents.js';
import chatRoutes          from './routes/chat.js';
import projectRoutes       from './routes/projects.js';
import architectRoutes     from './routes/architect.js';
import workflowRoutes      from './routes/workflow.js';
import architectChatRoutes from './routes/architectChat.js';

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

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));

// ─── Public routes ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);
app.use('/api/chat', chatRoutes);

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
app.use('/api/documents',      requireAuth,  documentRoutes);
app.use('/api/projects',       requireAuth,  projectRoutes);
app.use('/api/architect',      requireAuth,  architectRoutes);
app.use('/api/workflow',       requireAuth,  workflowRoutes);
app.use('/api/architect-chat', requireAuth,  architectChatRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

/**
 * Kill any stale process bound to PORT before binding.
 * Prevents the EADDRINUSE ghost-process ECONNRESET bug.
 */
function killStaleOnPort(port) {
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
