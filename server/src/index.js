import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrate } from './db.js';

import chatbotRoutes from './routes/chatbots.js';
import messageRoutes from './routes/messages.js';
import documentRoutes from './routes/documents.js';
import chatRoutes from './routes/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
const uploadsDir = path.join(__dirname, '../../data/uploads');
app.use('/data/uploads', express.static(uploadsDir));

app.use('/api/chatbots', chatbotRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Run DB migrations then start
migrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Vanta server → http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error('Failed to run migrations:', err);
  process.exit(1);
});
