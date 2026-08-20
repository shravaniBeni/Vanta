/**
 * server/src/routes/messages.js
 *
 * Phase 5: Message persistence fully migrated to Supabase messages table.
 * SQLite is no longer used by this file.
 *
 * GET  /api/messages?chatbot_id=<ragAppId>  — list messages for owner
 * POST /api/messages                        — create a message (internal use)
 *
 * All routes require authentication (applied in index.js).
 * Users can only access messages belonging to their own RAG apps.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';

const router = Router();

// ─── GET /api/messages ────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { chatbot_id, session_id } = req.query;
  if (!chatbot_id) return res.status(400).json({ error: 'chatbot_id is required' });

  try {
    // Verify ownership — return 404 if app doesn't exist or belongs to someone else
    const ragApp = await getOwnedRagApp(chatbot_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    let query = supabase
      .from('messages')
      .select('id, rag_app_id, session_id, role, content, confidence, retrieved_chunk_ids, diagnostic, created_at')
      .eq('rag_app_id', chatbot_id)
      .order('created_at', { ascending: true });

    if (session_id) {
      query = query.eq('session_id', session_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[messages GET /]', error.message);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }

    res.json(data ?? []);
  } catch (err) {
    console.error('[messages GET /]', err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── POST /api/messages ───────────────────────────────────────────────────────
// Internal endpoint for the frontend Chat.jsx to persist messages directly.
// Requires auth. Validates ownership of the target RAG app.

router.post('/', async (req, res) => {
  const { chatbot_id, role, content, confidence, retrieved_chunks, diagnostic, session_id } = req.body;

  if (!chatbot_id || !role || !content) {
    return res.status(400).json({ error: 'chatbot_id, role, and content are required' });
  }
  if (!['user', 'assistant'].includes(role)) {
    return res.status(400).json({ error: 'role must be "user" or "assistant"' });
  }

  try {
    // Verify ownership
    const ragApp = await getOwnedRagApp(chatbot_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const { data, error } = await supabase
      .from('messages')
      .insert({
        id:                   uuidv4(),
        user_id:              req.user.id,
        rag_app_id:           chatbot_id,
        session_id:           session_id || uuidv4(),
        role,
        content,
        confidence:           confidence ?? null,
        retrieved_chunk_ids:  Array.isArray(retrieved_chunks) ? retrieved_chunks : null,
        diagnostic:           diagnostic ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[messages POST /]', error?.message);
      return res.status(500).json({ error: 'Failed to create message' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('[messages POST /]', err.message);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

export default router;
