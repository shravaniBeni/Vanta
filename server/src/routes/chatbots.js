import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { client } from '../db.js';
import { invokeLLMJson } from '../openai.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function parseChatbot(row) {
  return {
    ...row,
    nodes: safeJson(row.nodes, []),
    connections: safeJson(row.connections, []),
    sample_documents: safeJson(row.sample_documents, []),
    amd_enabled: Boolean(row.amd_enabled),
  };
}

// ─── List / Filter ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { id, embed_id } = req.query;
    let result;

    if (id) {
      result = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [id] });
    } else if (embed_id) {
      result = await client.execute({ sql: 'SELECT * FROM chatbots WHERE embed_id = ?', args: [embed_id] });
    } else {
      result = await client.execute('SELECT * FROM chatbots ORDER BY created_at DESC');
    }

    res.json(result.rows.map(parseChatbot));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const result = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [req.params.id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(parseChatbot(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate workflow from description ───────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required' });

  try {
    const result = await invokeLLMJson(`
You are a RAG workflow generator. Given a user's plain English description of a chatbot, generate a complete RAG workflow.

User description: "${description}"

Generate a workflow with appropriate nodes from: DocumentUpload, WebCrawler, OCR, TextSplitter, DocumentProcessor, Embeddings, VectorStore, LLM, APIIntegration, ChatOutput

Rules:
- Always include at minimum: DocumentUpload, TextSplitter, Embeddings, VectorStore, LLM, ChatOutput
- Add APIIntegration if the use case needs real-time external data (orders, inventory, live prices)
- Position nodes left-to-right. x from 100 to 900, y between 150 and 350
- chunk_size: FAQ=500, Legal=1500, General=1000
- LLM temperature: factual/support=0.3, conversational=0.7

Return ONLY valid JSON:
{
  "title": "descriptive title",
  "nodes": [
    {"id":"1","type":"DocumentUpload","label":"Upload Documents","x":100,"y":200,"params":{}},
    {"id":"2","type":"TextSplitter","label":"Split Text","x":300,"y":200,"params":{"chunk_size":1000,"overlap":200}},
    {"id":"3","type":"Embeddings","label":"Embeddings","x":500,"y":200,"params":{"model":"text-embedding-3-small"}},
    {"id":"4","type":"VectorStore","label":"Vector Store","x":700,"y":200,"params":{"type":"FAISS"}},
    {"id":"5","type":"LLM","label":"Language Model","x":500,"y":350,"params":{"model":"gpt-3.5-turbo","temperature":0.7}},
    {"id":"6","type":"ChatOutput","label":"Chat Output","x":700,"y":350,"params":{}}
  ],
  "connections":[
    {"from":"1","to":"2"},{"from":"2","to":"3"},{"from":"3","to":"4"},
    {"from":"4","to":"5"},{"from":"5","to":"6"}
  ]
}
`);

    const id = uuidv4();
    await client.execute({
      sql: `INSERT INTO chatbots (id, title, description, status, nodes, connections) VALUES (?, ?, ?, 'draft', ?, ?)`,
      args: [id, result.title || 'Untitled Chatbot', description, JSON.stringify(result.nodes || []), JSON.stringify(result.connections || [])],
    });

    const row = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [id] });
    res.status(201).json(parseChatbot(row.rows[0]));
  } catch (err) {
    console.error('[generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { title, description, status, nodes, connections, amd_enabled, sample_documents } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const id = uuidv4();
    await client.execute({
      sql: `INSERT INTO chatbots (id, title, description, status, nodes, connections, amd_enabled, sample_documents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, title, description || '', status || 'draft', JSON.stringify(nodes || []), JSON.stringify(connections || []), amd_enabled ? 1 : 0, JSON.stringify(sample_documents || [])],
    });
    const row = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [id] });
    res.status(201).json(parseChatbot(row.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  try {
    const existing = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [req.params.id] });
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });

    const allowed = ['title', 'description', 'status', 'nodes', 'connections', 'amd_enabled', 'sample_documents', 'embed_id'];
    const updates = [];
    const values = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        const val = req.body[key];
        values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
      }
    }

    if (updates.length === 0) return res.json(parseChatbot(existing.rows[0]));

    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);

    await client.execute({ sql: `UPDATE chatbots SET ${updates.join(', ')} WHERE id = ?`, args: values });
    const updated = await client.execute({ sql: 'SELECT * FROM chatbots WHERE id = ?', args: [req.params.id] });
    res.json(parseChatbot(updated.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    await client.execute({ sql: 'DELETE FROM chatbots WHERE id = ?', args: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
