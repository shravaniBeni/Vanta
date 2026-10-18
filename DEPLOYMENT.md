# VANTA — Deployment Guide

## Architecture

```
Browser → Vercel (React SPA)   ←HTTPS→   Railway (Node.js + Express)
                                               ↕
                                         Supabase (Postgres + Auth + Storage)
                                               ↕
                                         OpenRouter (LLM)
```

The frontend and backend are deployed separately. They communicate via HTTPS.
The database, auth, and file storage are all hosted on Supabase — no extra infrastructure required.

---

## Prerequisites

- GitHub account (free)
- Vercel account (free) — vercel.com
- Railway account (free tier, credit card required for persistent sleep prevention) — railway.app
- Supabase project already running with migrations 001–011 applied
- OpenRouter API key — openrouter.ai

---

## Step 1: Apply all pending database migrations

Open the Supabase SQL Editor for your project and run these files **in order**:

```
supabase/009_document_profile.sql     (if not already applied)
supabase/010_ui_config.sql            (if not already applied)
supabase/011_analytics_sessions.sql   (new — Phase 10C)
```

To verify migration 011 applied:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('visitor_sessions','interaction_events','feedback_events','topic_aggregates','analytics_settings');
```
Should return 5 rows.

---

## Step 2: Configure Supabase Auth Redirect URLs

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. **Site URL**: set to your Vercel URL, e.g. `https://vanta.vercel.app`
3. **Redirect URLs**: add:
   - `https://vanta.vercel.app/**`
   - `https://vanta.vercel.app/Dashboard`
   - `http://localhost:5173/**` (keep for local dev)
4. Save

---

## Step 3: Deploy the backend to Railway

### 3a. Push to GitHub

Ensure your repo is on GitHub. Railway deploys from GitHub.

```bash
cd c:\Users\shrav\OneDrive\Desktop\Vanta
git add -A
git commit -m "chore: deployment configuration"
git push origin main
```

### 3b. Create Railway project

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select your repository
3. Railway will detect Node.js. When asked for the root directory, set it to **`server`**
4. Railway reads `server/railway.toml` and runs `node src/index.js`

### 3c. Set environment variables in Railway

In Railway dashboard → your service → Variables, add:

| Variable | Value |
|---|---|
| `PORT` | `3001` (Railway may override this automatically — leave it or remove it) |
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_KEY` | your service role key (from Supabase → Settings → API) |
| `OPENAI_API_KEY` | your OpenRouter key (`sk-or-v1-...`) |
| `TRANSFORMERS_CACHE` | `/app/data/model-cache` |
| `CORS_ORIGIN` | `https://your-vanta.vercel.app` (set after Vercel deploy, update this value) |

### 3d. Verify the backend is running

Railway gives you a public URL like `https://vanta-server-production.up.railway.app`.

Visit `https://your-railway-url.up.railway.app/api/health` — you should see:
```json
{"status":"ok","timestamp":"..."}
```

**Note on cold start**: The first request after deploy takes 15–45 seconds because Railway downloads and caches the BGE embedding model (~45 MB). Subsequent starts use the cached model and take ~5s.

---

## Step 4: Deploy the frontend to Vercel

### 4a. Import to Vercel

1. Go to vercel.com → New Project → Import Git Repository
2. Select your repository
3. **Root Directory**: set to `client`
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist`
6. **Framework**: Vite

### 4b. Set environment variables in Vercel

In Vercel → project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your anon/public key (from Supabase → Settings → API) |
| `VITE_API_URL` | `https://your-railway-url.up.railway.app` |

Apply to: Production, Preview, Development.

### 4c. Deploy

Click Deploy. Vercel builds with `npm run build` and serves from `dist/`.

The `client/vercel.json` rewrites all routes to `index.html` so React Router works correctly.

### 4d. Update CORS on Railway

Once you have your Vercel URL (e.g. `https://vanta.vercel.app`), go back to Railway and update:

```
CORS_ORIGIN = https://vanta.vercel.app
```

Redeploy the Railway service (or it will pick up the env change on next deploy).

---

## Step 5: Verify the full deployment

### Checklist

- [ ] `https://your-railway-url/api/health` → `{"status":"ok"}`
- [ ] `https://vanta.vercel.app` → loads the login page
- [ ] Sign up / sign in works (Supabase auth redirect returns to Vercel URL)
- [ ] Dashboard loads your projects and chatbots
- [ ] Create a new chatbot → Architect page works
- [ ] Upload a document → status becomes `profiled`
- [ ] Activate a workflow via Architect → status becomes `activated`
- [ ] Preview chat in Editor works
- [ ] Deploy a chatbot → get embed URL
- [ ] `https://vanta.vercel.app/Chat?id=<embed_id>` works without login
- [ ] Published chatbot responds to questions
- [ ] Analytics page shows data

---

## Local development (unchanged)

```bash
# Terminal 1: backend
cd server
cp .env.example .env   # fill in real values
npm install
node start.js          # or: npm run dev

# Terminal 2: frontend
cd client
cp .env.example .env   # VITE_API_URL stays empty for local proxy
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend:  http://localhost:3001
API proxy: Vite forwards `/api/*` to `localhost:3001` automatically.

---

## Environment variables — complete reference

### Server (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default 3001; Railway sets this automatically) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key — **server only, never browser** |
| `OPENAI_API_KEY` | Yes | OpenRouter key (`sk-or-v1-...`) or standard OpenAI key |
| `TRANSFORMERS_CACHE` | Recommended | Model cache directory. Use `/app/data/model-cache` on Railway |
| `CORS_ORIGIN` | Yes (prod) | Comma-separated allowed frontend origins |

### Client (`client/.env` or Vercel dashboard)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL (same as server) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Anon/public key — safe to expose in browser |
| `VITE_API_URL` | Yes (prod) | Backend URL, e.g. `https://vanta-server.up.railway.app`. Leave empty locally. |

---

## Files changed in this deployment preparation

| File | Change |
|---|---|
| `server/src/index.js` | CORS reads from `CORS_ORIGIN` env; `killStaleOnPort` guarded to Windows only; rate limiters wired |
| `server/src/middleware/rateLimit.js` | New — zero-dependency rate limiter |
| `server/src/routes/analytics.js` | Session and feedback endpoints rate-limited |
| `server/package.json` | Added `sharp`, `cheerio`, `pdfjs-dist`, `tesseract.js` as explicit deps; added `engines` field |
| `server/.env.example` | New — complete env var reference with placeholders |
| `server/railway.toml` | New — Railway deployment config |
| `server/Procfile` | New — universal PaaS start command |
| `client/.env.example` | New — complete client env var reference |
| `client/vercel.json` | New — Vercel SPA rewrite config |
| `.gitignore` | Added `.env`, logs, `.idea/` |

---

## Known limits at this deployment tier

| Feature | Limit | Notes |
|---|---|---|
| File upload | 20 MB per file | Set in `multer` — sufficient for most PDFs |
| Embedding | In-process, synchronous | Large PDFs (100+ pages) will block the request for 30–120s. See AWS plan below. |
| OCR | In-process, synchronous | Very slow for large scanned PDFs. Timeout risk on Railway free tier. |
| Rate limit store | In-memory, single instance | Resets on restart. Sufficient for testing. For production scale, use Redis. |
| Model cold start | ~45s first boot | Railway caches the model on persistent disk between restarts. |

---

## AWS Ingestion Worker Plan (Phase 4 — implement after initial deployment is verified)

### Problem

Embedding 500 pages of PDFs in-process on an Express request will:
- Block the event loop for other users during that request
- Hit Railway/Render timeout limits (30–60s by default)
- Consume the server's entire CPU for minutes

### Proposed architecture

```
Browser → POST /api/documents/upload → Server (validates, uploads to S3, creates DB record)
                                            ↓
                                      SQS Queue (message: { doc_id, s3_key, rag_app_id })
                                            ↓
                                      ECS Fargate Task (ingestion worker)
                                        - Downloads from S3
                                        - Runs pdf-parse / OCR / chunking
                                        - Generates embeddings (BGE local)
                                        - Writes document_chunks to Supabase
                                        - Updates document status
                                            ↓
                                      Supabase (document_chunks table)
```

### Resource estimates

| Resource | Spec | Estimated cost |
|---|---|---|
| S3 bucket | Standard, ~50 GB storage | ~$1.15/month |
| SQS | Standard queue | ~$0.40 per million messages |
| ECS Fargate task | 1 vCPU / 2 GB RAM, triggered per document | ~$0.04 per task-hour |
| Data transfer | S3 → ECS (same region) | Free |

For a testing environment processing 100 documents/day average, total AWS cost is under **$10/month**.

### Implementation steps (not doing now — waiting for your approval)

1. Create S3 bucket `vanta-knowledge-docs` (replace Supabase Storage for large files)
2. Create SQS queue `vanta-ingestion`
3. Write `worker/index.js` — pulls from SQS, processes document, writes to Supabase
4. Build Docker image for worker, push to ECR
5. Create ECS task definition (Fargate)
6. Add `POST /api/documents/upload` modification to push to SQS instead of inline embedding
7. Add worker status polling to the VANTA UI (document status already supports `indexing`/`indexed`/`error`)

**No AWS resources will be created until you give explicit approval.**

---

## Remaining manual steps before going live

1. **Apply migration 011** in Supabase SQL Editor (run `supabase/011_analytics_sessions.sql`)
2. **Add Supabase redirect URLs** to your Supabase project auth settings
3. **Push to GitHub** and connect to Railway + Vercel
4. **Set all environment variables** in Railway and Vercel dashboards
5. **Update `CORS_ORIGIN`** on Railway once you have the Vercel URL
6. **Test the full flow** using the checklist in Step 5

None of these steps have been done automatically — they require access to your accounts.
