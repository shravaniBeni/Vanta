# Vanta — Visual RAG Workflow Builder

Build AI chatbots by describing them in plain English. Vanta generates a RAG pipeline, lets you edit it visually, upload documents, and deploy.

## Quick Start

### 1. Set up the server

```bash
cd server
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
npm install
npm run dev
```

Server runs on **http://localhost:3001**

### 2. Set up the client

```bash
cd client
npm install
npm run dev
```

Client runs on **http://localhost:5173**

---

## How it works

1. **Describe** your chatbot on the Home page
2. **Edit** the generated workflow in the visual editor — drag nodes, connect them, configure parameters
3. **Upload** documents in the DocumentUpload node properties panel (PDF, DOCX, TXT, CSV)
4. **Preview** the chatbot in the editor sidebar
5. **Deploy** to get an embed URL and Python export

## Stack

- **Frontend**: React + Vite + Tailwind + @xyflow/react
- **Backend**: Node.js + Express
- **Database**: SQLite via @libsql/client
- **AI**: OpenAI (GPT-3.5/GPT-4 + embeddings)
- **Vector search**: Cosine similarity over persisted embeddings

## Environment

```
OPENAI_API_KEY=sk-...   # Required
PORT=3001                # Optional, default 3001
DB_PATH=./data/vanta.db  # Optional
```
