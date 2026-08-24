/**
 * server/src/documentParser.js
 *
 * Phase 4: Document parsing operates entirely from in-memory Buffers.
 * No temporary disk files are written by this module.
 *
 * Supported types: PDF, DOCX/DOC, TXT/MD, CSV
 *
 * Public API:
 *   extractTextFromBuffer(buffer, originalName)  — parse text from a Buffer
 *   chunkText(text, chunkSize, overlap)           — split into overlapping chunks
 */

import path from 'path';

/**
 * Extract plain text from an in-memory Buffer.
 * originalName is used only to determine the file type via extension.
 * The buffer is never written to disk.
 *
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<string>}
 */
export async function extractTextFromBuffer(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === '.csv') {
    const { parse } = await import('csv-parse/sync');
    const raw = buffer.toString('utf-8');
    try {
      const records = parse(raw, { columns: true, skip_empty_lines: true });
      return records
        .map(r => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' | '))
        .join('\n');
    } catch {
      return raw;
    }
  }

  // TXT, MD, and any other text type — decode as UTF-8
  return buffer.toString('utf-8');
}

/**
 * Split text into overlapping chunks.
 * This is the simple fixed-character implementation (used internally).
 *
 * @param {string} text
 * @param {number} chunkSize   — target character length per chunk
 * @param {number} overlap     — overlap between consecutive chunks
 * @returns {string[]}
 */
export function chunkText(text, chunkSize = 1000, overlap = 200) {
  if (!text || text.trim().length === 0) return [];

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = [];
  let start = 0;

  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }
    if (end >= cleanText.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

// ─── Strategy dispatcher ──────────────────────────────────────────────────────

/**
 * Chunk a document using the strategy from an approved Architect plan.
 *
 * Executable strategies for the current runtime:
 *   fixed            — character-window chunking (always available)
 *   recursive        — natural separator hierarchy before fixed fallback
 *   structure-aware  — preserve document structural units before fixed fallback
 *
 * 'semantic' is NOT a valid input here. normalizeRawPlan() in schema.js
 * redirects it to 'recursive' before the plan is persisted, so it can never
 * reach this function via an approved architect_plan.
 * An unknown strategy value falls back to 'fixed' with a logged warning.
 *
 * @param {string} text
 * @param {{ strategy: string, chunk_size: number, chunk_overlap: number }} plan
 * @returns {string[]}
 */
export function chunkDocument(text, { strategy = 'fixed', chunk_size = 1000, chunk_overlap = 200 } = {}) {
  if (!text || text.trim().length === 0) return [];

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  switch (strategy) {
    case 'recursive':
      return _chunkRecursive(cleanText, chunk_size, chunk_overlap);
    case 'structure-aware':
      return _chunkStructureAware(cleanText, chunk_size, chunk_overlap);
    case 'fixed':
      return _chunkFixed(cleanText, chunk_size, chunk_overlap);
    default:
      // 'semantic' must never reach here — normalizeRawPlan handles it.
      // Any other unexpected value falls back to fixed with a clear warning.
      console.warn(
        `[documentParser] chunkDocument: unknown strategy '${strategy}'. ` +
        `Falling back to 'fixed'. This indicates a plan that bypassed normalizeRawPlan().`
      );
      return _chunkFixed(cleanText, chunk_size, chunk_overlap);
  }
}

/**
 * Detect whether a document_chunks row was created by the legacy eager-indexing
 * pipeline (before deferred indexing was introduced) rather than by an
 * approved Architect plan.
 *
 * A chunk is considered legacy if its metadata lacks the 'architect_version' field
 * that the new indexer always writes.
 *
 * @param {object} chunkMetadata — the metadata JSONB from a document_chunks row
 * @returns {boolean}
 */
export function isLegacyChunk(chunkMetadata) {
  if (!chunkMetadata || typeof chunkMetadata !== 'object') return true;
  return chunkMetadata.architect_version === undefined || chunkMetadata.architect_version === null;
}

// ─── Fixed chunking ───────────────────────────────────────────────────────────

function _chunkFixed(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk);
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// ─── Recursive chunking ───────────────────────────────────────────────────────
// Splits on natural separators in priority order:
//   double newline (paragraph) → single newline → sentence → fixed fallback

function _chunkRecursive(text, chunkSize, overlap) {
  // Try to split on double newlines (paragraphs) first
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);

  if (paragraphs.length <= 1) {
    // No paragraph breaks — fall back to fixed
    return _chunkFixed(text, chunkSize, overlap);
  }

  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      // Flush what we have
      if (current.trim().length > 20) chunks.push(current.trim());

      // If the paragraph itself exceeds chunkSize, split it on sentences first,
      // then fall back to fixed
      if (para.length > chunkSize) {
        const sentenceChunks = _splitOnSentences(para, chunkSize, overlap);
        chunks.push(...sentenceChunks);
        current = '';
      } else {
        current = para;
      }
    }
  }

  if (current.trim().length > 20) chunks.push(current.trim());

  // Apply overlap: prepend tail of previous chunk to give context continuity
  if (overlap > 0 && chunks.length > 1) {
    return _applyOverlap(chunks, overlap);
  }
  return chunks;
}

function _splitOnSentences(text, chunkSize, overlap) {
  // Split on sentence boundaries
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current.trim().length > 20) chunks.push(current.trim());
      // If sentence alone exceeds chunkSize, use fixed on it
      if (sentence.length > chunkSize) {
        chunks.push(..._chunkFixed(sentence, chunkSize, overlap));
        current = '';
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks;
}

// ─── Structure-aware chunking ─────────────────────────────────────────────────
// Splits on structural boundaries in priority order:
//   ALL-CAPS headings → markdown headings (#/##/###) → numbered sections (1. / 1.1)
//   → numbered procedures (Step N:) → warnings → paragraphs → fixed fallback
//
// Goal: keep a procedure's steps and their warnings together where possible.

const STRUCTURAL_SEPARATORS = [
  // ALL-CAPS section headers (common in Word/PDF manuals)
  /^[A-Z][A-Z\s]{3,}[A-Z]$/m,
  // Markdown headings
  /^#{1,4}\s+\S/m,
  // Numbered top-level sections: "1. Title"
  /^\d{1,2}\.\s+[A-Z][a-zA-Z]/m,
  // Numbered subsections: "1.1 " or "1.2.3 "
  /^\d+\.\d+(\.\d+)?\s+/m,
  // Explicit step markers: "Step 1:", "Step 2 —"
  /^Step\s+\d+[\s:.]/im,
];

function _chunkStructureAware(text, chunkSize, overlap) {
  // Find all structural boundaries
  const lines = text.split('\n');
  const sectionStarts = [0]; // always include start

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isStructural = STRUCTURAL_SEPARATORS.some(re => re.test(line));
    if (isStructural && i > 0) {
      // Record the character offset where this section starts
      const charOffset = lines.slice(0, i).join('\n').length + 1;
      sectionStarts.push(charOffset);
    }
  }

  if (sectionStarts.length <= 1) {
    // No structural boundaries detected — fall back to recursive
    return _chunkRecursive(text, chunkSize, overlap);
  }

  // Split text at structural boundaries
  const sections = [];
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i];
    const end   = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : text.length;
    const section = text.slice(start, end).trim();
    if (section.length > 0) sections.push(section);
  }

  // Now pack sections into chunks respecting chunkSize
  const chunks = [];
  let current = '';

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;

    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current.trim().length > 20) chunks.push(current.trim());

      // Section alone larger than chunkSize — use recursive on it
      if (section.length > chunkSize) {
        const subChunks = _chunkRecursive(section, chunkSize, overlap);
        chunks.push(...subChunks);
        current = '';
      } else {
        current = section;
      }
    }
  }

  if (current.trim().length > 20) chunks.push(current.trim());

  if (overlap > 0 && chunks.length > 1) {
    return _applyOverlap(chunks, overlap);
  }
  return chunks;
}

// ─── Overlap helper ───────────────────────────────────────────────────────────
// Prepends the last `overlap` characters of the previous chunk to the current chunk,
// giving context continuity at boundaries without full duplicate content.

function _applyOverlap(chunks, overlap) {
  if (overlap <= 0 || chunks.length <= 1) return chunks;
  const result = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const tail = prev.length > overlap ? prev.slice(prev.length - overlap) : prev;
    result.push(`${tail}\n${chunks[i]}`);
  }
  return result;
}

/**
 * Produce a safe filename for Storage paths.
 * Retains the original file extension.
 * Replaces all non-alphanumeric characters (except dot and hyphen) with underscores.
 * Truncates the base name to 80 characters to avoid path length issues.
 *
 * NEVER use originalName directly in a Storage path without sanitizing first.
 *
 * @param {string} originalName
 * @returns {string}
 */
export function sanitizeFilename(originalName) {
  const ext  = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return `${base}${ext}`;
}
