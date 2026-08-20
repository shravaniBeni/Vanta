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
