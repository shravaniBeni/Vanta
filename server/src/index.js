import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrate } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { loadEmbedder } from './embeddings.js';

import chatbotRoutes from './routes/chatbots.js';
import messageRoutes from './routes/messages.js';
import documentRoutes from './routes/documents.js';
import chatRoutes from './routes/chat.js';
import projectRoutes from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files (legacy SQLite path — removed in Phase 4)
const uploadsDir = path.join(__dirname, '../../data/uploads');
app.use('/data/uploads', express.static(uploadsDir));

// ─── Public routes ────────────────────────────────────────────────────────────

// Health check — no auth required
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// /api/chat — POST / and POST /preview remain open.
// - POST / is used by the deployed public chat widget (embed_id based access).
// - POST /preview is used by the workflow editor's live preview panel.
// Both paths will receive explicit per-route auth enforcement in Phase 5
// when the chat routes are migrated to Supabase. For now they remain
// unauthenticated to preserve all existing editor and embed functionality.
app.use('/api/chat', chatRoutes);

// ─── Authenticated test endpoint ─────────────────────────────────────────────

// GET /api/me — requires a valid Supabase JWT.
// Returns the authenticated user's id and email.
// Used to verify Phase 1 auth integration. Remains useful in later phases.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// ─── Protected routes ─────────────────────────────────────────────────────────
//
// /api/chatbots — requires auth on all methods EXCEPT:
//   GET /api/chatbots?embed_id=<id>
//   This path is used by Chat.jsx (deployed widget) to load chatbot metadata
//   without a user session. It is carved out with a conditional middleware
//   that bypasses requireAuth only for that specific lookup.
//
// /api/messages and /api/documents — all operations require authentication.

// Conditional auth: skip requireAuth only for the public embed lookup.
// All other chatbot operations (list, create, update, delete, generate)
// require authentication.
function chatbotAuth(req, res, next) {
  const isPublicEmbedLookup =
    req.method === 'GET' &&
    !req.path.replace('/', '') && // root path only, not /:id
    req.query.embed_id &&
    !req.query.id; // embed_id lookup, not id lookup

  if (isPublicEmbedLookup) {
    return next(); // exempt — no auth required
  }
  return requireAuth(req, res, next);
}

app.use('/api/chatbots', chatbotAuth, chatbotRoutes);
app.use('/api/messages', requireAuth, messageRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
// Phase 3: projects now on Supabase
// Temporary persistence split:
//   /api/projects  → Supabase rag_apps + projects   ✅
//   /api/chatbots  → Supabase rag_apps               ✅
//   /api/documents → SQLite document_chunks          (migrated Phase 4)
//   /api/messages  → SQLite chat_messages            (migrated Phase 5)
//   /api/chat      → SQLite retrieval                (migrated Phase 5)
app.use('/api/projects', requireAuth, projectRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

migrate()
  .then(() => loadEmbedder())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Vanta server → http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Auth test: GET http://localhost:${PORT}/api/me\n`);
    });
  })
  .catch(err => {
    console.error('[startup] Fatal error:', err.message);
    process.exit(1);
  });
