/**
 * server/scripts/test-pdf-upload.js
 *
 * Creates a minimal valid PDF in memory and uploads it to test the full
 * PDF ingestion pipeline — no real PDF file needed.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';

const API          = process.env.VERIFY_API_URL || 'http://localhost:3002';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signIn(email, pw) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description || j.msg}`);
  return j.access_token;
}

async function api(method, path, token, body) {
  const opts = { method, headers: { ...(token && { Authorization: `Bearer ${token}` }) } };
  if (body instanceof FormData) { opts.body = body; }
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${API}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// Build a minimal text-based PDF that pdf-parse can extract text from
function buildMinimalPdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g,'')}) Tj ET`;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  const body  = `%PDF-1.4\n${obj1}${obj2}${obj3}${obj4}${obj5}`;
  const xref  = `xref\n0 6\n0000000000 65535 f \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'utf-8');
}

const cleanup = { userIds: [], ragAppIds: [] };

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  PDF Upload Debug Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await loadEmbedder();

  const ts = Date.now();
  const email = `pdf-test-${ts}@vanta.test`;
  const pw = 'PdfTest!99';

  const { data: ud } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (ud?.user?.id) cleanup.userIds.push(ud.user.id);
  const token = await signIn(email, pw);

  const gen = await api('POST', '/api/chatbots/generate', token, {
    description: 'A PDF test bot',
  });
  if (gen.status !== 201) throw new Error('Failed to create RAG app');
  const ragAppId = gen.body.id;
  cleanup.ragAppIds.push(ragAppId);
  console.log(`  RAG app: ${ragAppId.slice(0,8)}...`);

  // ── Test: PDF upload ──────────────────────────────────────────────────────
  console.log('\n  Uploading PDF...');

  const pdfContent = `Customer Support Knowledge Base\n\nReturn Policy\nCustomers may return items within 30 days. Items must be unworn with tags attached.\n\nShipping Policy\nStandard shipping takes 5-7 business days. Express shipping available for additional fee.\n\nContact Support\nEmail: support@blues.com. Phone: 1-800-BLUES. Hours: Mon-Fri 9am-6pm EST.`;

  // Use the minimal PDF builder
  const pdfBuffer = buildMinimalPdf(pdfContent);

  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'test.pdf');
  form.append('chatbot_id', ragAppId);

  const uploadRes = await api('POST', '/api/documents/upload', token, form);
  console.log(`  Response: status=${uploadRes.status}`);
  console.log(`  Body: ${JSON.stringify(uploadRes.body)}`);

  if (uploadRes.status === 200) {
    console.log('\n  ✅ PDF upload succeeded');

    const { data: chunks } = await admin
      .from('document_chunks')
      .select('id, chunk_index')
      .eq('rag_app_id', ragAppId);
    console.log(`  ✅ document_chunks: ${chunks?.length ?? 0} rows`);

    // Test retrieval
    const chatRes = await api('POST', '/api/chat', token, {
      chatbot_id: ragAppId,
      query: 'What is the return policy?',
    });
    if (chatRes.status === 200) {
      console.log(`  ✅ Retrieval works: avgSimilarity=${chatRes.body.avgSimilarity?.toFixed(4)}`);
    }
  } else {
    console.log('\n  ❌ PDF upload failed — check server logs above for the exact error');

    // Check what the documents row says
    const { data: docs } = await admin
      .from('documents')
      .select('status, error_message, chunk_count')
      .eq('rag_app_id', ragAppId);
    console.log(`  documents row: ${JSON.stringify(docs)}`);
  }

  await doCleanup();
}

async function doCleanup() {
  for (const id of cleanup.ragAppIds) {
    await admin.from('document_chunks').delete().eq('rag_app_id', id);
    await admin.from('documents').delete().eq('rag_app_id', id);
    await admin.from('rag_apps').delete().eq('id', id);
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('\n  cleanup done');
}

run().catch(async err => {
  console.error('\nFatal:', err.message);
  await doCleanup();
  process.exit(1);
});
