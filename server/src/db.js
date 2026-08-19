/**
 * Database module using @libsql/client (pure-JS, no native compilation).
 * Provides synchronous-style helpers wrapping the async libsql client.
 */

import { createClient } from '@libsql/client';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/vanta.db');

// Ensure data directory exists
mkdirSync(path.dirname(dbPath), { recursive: true });

// libsql uses file: URI for local SQLite files
const client = createClient({
  url: `file:${dbPath}`,
});

// ─── Schema migration ─────────────────────────────────────────────────────────

export async function migrate() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS chatbots (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      embed_id TEXT UNIQUE,
      nodes TEXT DEFAULT '[]',
      connections TEXT DEFAULT '[]',
      amd_enabled INTEGER DEFAULT 0,
      sample_documents TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chatbot_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL,
      retrieved_chunks TEXT,
      diagnostic TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      chatbot_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_chatbot ON document_chunks(chatbot_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_chatbot ON chat_messages(chatbot_id)`,
  ], 'deferred');
}

export { client };
export default client;
