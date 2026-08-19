import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { client } from '../db.js';

const router = Router();

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function parseMessage(row) {
  return {
    ...row,
    retrieved_chunks: safeJson(row.retrieved_chunks, []),
    diagnostic: safeJson(row.diagnostic, null),
  };
}

router.get('/', async (req, res) => {
  const { chatbot_id } = req.query;
  if (!chatbot_id) return res.status(400).json({ error: 'chatbot_id is required' });
  try {
    const result = await client.execute({
      sql: 'SELECT * FROM chat_messages WHERE chatbot_id = ? ORDER BY created_at ASC',
      args: [chatbot_id],
    });
    res.json(result.rows.map(parseMessage));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { chatbot_id, role, content, confidence, retrieved_chunks, diagnostic } = req.body;
  if (!chatbot_id || !role || !content) {
    return res.status(400).json({ error: 'chatbot_id, role, and content are required' });
  }
  try {
    const id = uuidv4();
    await client.execute({
      sql: `INSERT INTO chat_messages (id, chatbot_id, role, content, confidence, retrieved_chunks, diagnostic)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, chatbot_id, role, content, confidence ?? null,
        retrieved_chunks ? JSON.stringify(retrieved_chunks) : null,
        diagnostic ? JSON.stringify(diagnostic) : null],
    });
    const row = await client.execute({ sql: 'SELECT * FROM chat_messages WHERE id = ?', args: [id] });
    res.status(201).json(parseMessage(row.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
