/**
 * server/src/documentParser.js
 *
 * Phase 10A additions:
 *   profileDocument(buffer, fileName)  — classify document for OCR routing
 *
 * Existing public API (unchanged):
 *   extractTextFromBuffer(buffer, originalName)
 *   chunkText(text, chunkSize, overlap)
 *   chunkDocument(text, plan)
 *   isLegacyChunk(chunkMetadata)
 *   sanitizeFilename(originalName)
 */

import path from 'path';

// ─── Document Profiler (Phase 10A) ───────────────────────────────────────────

/**
 * Classification constants for document profiling.
 */
export const DOC_CLASSIFICATION = {
  TEXT_EXTRACTABLE: 'TEXT_EXTRACTABLE',
  SCANNED:          'SCANNED',
  MIXED:            'MIXED',
  IMAGE_HEAVY:      'IMAGE_HEAVY',
  NOT_PDF:          'NOT_PDF',  // Non-PDF types are always text-extractable via their parser
};

// Thresholds — isolated here so they can be tuned without touching logic.
const PROFILER_THRESHOLDS = {
  // A page with fewer than this many meaningful characters is considered blank/scanned.
  // Form-feed chars (\f) are counted as 0. Whitespace-only pages count as 0.
  BLANK_PAGE_CHAR_THRESHOLD: 50,

  // If this percentage or more of pages are blank, the document is SCANNED.
  // 0.80 = 80%
  SCANNED_PAGE_RATIO: 0.80,

  // If >= this percentage of pages are blank (but < SCANNED_PAGE_RATIO), it's IMAGE_HEAVY.
  IMAGE_HEAVY_PAGE_RATIO: 0.40,

  // Minimum page count before ratio-based classification triggers.
  // Single-page short documents (e.g. 30-char cover sheet) should not be classified SCANNED.
  MIN_PAGES_FOR_RATIO_CLASSIFICATION: 2,
};

/**
 * Profile a document to determine if OCR is needed.
 *
 * For PDFs: inspects page-level character counts using pdf-parse's page-feed structure.
 * For non-PDFs (DOCX, TXT, CSV, MD): always returns TEXT_EXTRACTABLE.
 *
 * Returns:
 *   {
 *     classification: 'TEXT_EXTRACTABLE'|'SCANNED'|'MIXED'|'IMAGE_HEAVY'|'NOT_PDF',
 *     signals: {
 *       page_count,
 *       chars_total,
 *       chars_per_page,   // number[] — char count per page
 *       text_pages,       // pages with >= BLANK_PAGE_CHAR_THRESHOLD chars
 *       scanned_pages,    // pages with < BLANK_PAGE_CHAR_THRESHOLD chars
 *     }
 *   }
 *
 * @param {Buffer} buffer
 * @param {string} fileName
 * @returns {Promise<{ classification: string, signals: object }>}
 */
export async function profileDocument(buffer, fileName) {
  const ext = path.extname(fileName).toLowerCase();

  // Non-PDF types are handled by their respective parsers, always text-extractable.
  if (ext !== '.pdf') {
    return {
      classification: DOC_CLASSIFICATION.NOT_PDF,
      signals: { page_count: 1, chars_total: buffer.length, chars_per_page: [buffer.length], text_pages: 1, scanned_pages: 0 },
    };
  }

  // ── PDF profiling via pdf-parse ──────────────────────────────────────────
  // pdf-parse separates pages with form-feed (\f = \x0C) in data.text.
  // We split on \f to get per-page text, then count meaningful characters.

  let pdfData;
  try {
    const pdfParse = (await import('pdf-parse')).default;
    pdfData = await Promise.race([
      pdfParse(buffer, { max: 0 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF profiling timed out')), 30000)),
    ]);
  } catch (err) {
    // If pdf-parse fails (encrypted, malformed), we can't profile — assume it needs review.
    console.warn('[profileDocument] pdf-parse failed:', err.message);
    return {
      classification: DOC_CLASSIFICATION.SCANNED,
      signals: { page_count: 0, chars_total: 0, chars_per_page: [], text_pages: 0, scanned_pages: 0, parse_error: err.message },
    };
  }

  const fullText  = pdfData.text || '';
  const pageCount = pdfData.numpages || 1;

  // Split on form-feed to get per-page text segments.
  // pdf-parse uses \f as a page separator. The last segment may be empty if text ends with \f.
  const pageSegments = fullText.split('\f');

  // Count meaningful characters per page (strip whitespace/form-feeds before counting).
  const charsPerPage = pageSegments
    .slice(0, pageCount)  // guard against extra segments
    .map(seg => seg.replace(/[\s\f]/g, '').length);

  // Pad if pdf-parse returned fewer segments than pages (can happen with some PDFs).
  while (charsPerPage.length < pageCount) charsPerPage.push(0);

  const T = PROFILER_THRESHOLDS;
  const blankPages = charsPerPage.filter(c => c < T.BLANK_PAGE_CHAR_THRESHOLD).length;
  const textPages  = pageCount - blankPages;
  const charsTotal = charsPerPage.reduce((s, c) => s + c, 0);

  const signals = {
    page_count:     pageCount,
    chars_total:    charsTotal,
    chars_per_page: charsPerPage,
    text_pages:     textPages,
    scanned_pages:  blankPages,
  };

  // ── Classification ───────────────────────────────────────────────────────
  let classification;

  if (pageCount < T.MIN_PAGES_FOR_RATIO_CLASSIFICATION) {
    // Single-page document: use absolute char count, not ratio.
    // A one-page doc with 30 chars might be a legitimate short text; only call it
    // SCANNED if it has literally zero meaningful characters.
    classification = charsTotal === 0
      ? DOC_CLASSIFICATION.SCANNED
      : DOC_CLASSIFICATION.TEXT_EXTRACTABLE;
  } else {
    const blankRatio = blankPages / pageCount;

    if (blankRatio >= T.SCANNED_PAGE_RATIO) {
      classification = DOC_CLASSIFICATION.SCANNED;
    } else if (blankRatio >= T.IMAGE_HEAVY_PAGE_RATIO) {
      classification = DOC_CLASSIFICATION.IMAGE_HEAVY;
    } else if (blankPages > 0) {
      classification = DOC_CLASSIFICATION.MIXED;
    } else {
      classification = DOC_CLASSIFICATION.TEXT_EXTRACTABLE;
    }
  }

  return { classification, signals };
}

/**
 * Returns true if a document classification indicates OCR is needed.
 * @param {string} classification
 */
export function classificationNeedsOcr(classification) {
  return classification === DOC_CLASSIFICATION.SCANNED ||
         classification === DOC_CLASSIFICATION.IMAGE_HEAVY ||
         classification === DOC_CLASSIFICATION.MIXED;
}

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
    try {
      const pdfParse = (await import('pdf-parse')).default;
      // pdf-parse can crash on some PDFs (encrypted, malformed, large XObjects).
      // Wrap in a timeout to prevent hanging, and catch any thrown error cleanly.
      // The `max: 0` option disables the default test-suite file scan.
      const data = await Promise.race([
        pdfParse(buffer, { max: 0 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PDF parsing timed out after 30s')), 30000)
        ),
      ]);
      if (!data?.text) throw new Error('pdf-parse returned no text content');
      return data.text;
    } catch (err) {
      // Re-throw with a descriptive message so the upload handler surfaces it properly
      throw new Error(`PDF parsing failed: ${err.message}`);
    }
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
