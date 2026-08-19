import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { extractText, chunkText } from '../documentParser.js';
import { indexChunk, clearChunks } from '../vectorStore.js';
import { client } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../../data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${ext}`));
  },
});

const router = Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { chatbot_id, node_id } = req.body;
  if (!chatbot_id) return res.status(400).json({ error: 'chatbot_id is required' });

  try {
    const chatbotResult = await client.execute({
      sql: 'SELECT * FROM chatbots WHERE id = ?',
      args: [chatbot_id],
    });
    if (!chatbotResult.rows.length) return res.status(404).json({ error: 'Chatbot not found' });

    const chatbot = chatbotResult.rows[0];
    const nodes = safeJson(chatbot.nodes, []);
    const embNode = nodes.find(n => n.type === 'Embeddings');
    const embeddingModel = embNode?.params?.model || 'text-embedding-3-small';
    const splitterNode = nodes.find(n => n.type === 'TextSplitter');
    const chunkSize = splitterNode?.params?.chunk_size || 1000;
    const overlap = splitterNode?.params?.overlap || 200;

    const text = await extractText(req.file.path, req.file.originalname);
    if (!text || text.trim().length === 0) {
      return res.status(422).json({ error: 'Could not extract text from this document.' });
    }

    const chunks = chunkText(text, chunkSize, overlap);
    const nodeId = node_id || 'default';

    for (const chunk of chunks) {
      await indexChunk(chatbot_id, nodeId, req.file.originalname, chunk, embeddingModel);
    }

    res.json({
      file_url: `/data/uploads/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      chunks_indexed: chunks.length,
    });
  } catch (err) {
    console.error('[documents/upload]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:chatbotId', async (req, res) => {
  try {
    await clearChunks(req.params.chatbotId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

export default router;
