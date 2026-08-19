/**
 * Document parsing & chunking utilities.
 * Supports: PDF, DOCX, TXT, MD, CSV
 */

import fs from 'fs';
import path from 'path';

/**
 * Extract plain text from a file buffer based on mime/extension.
 */
export async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.csv') {
    const { parse } = await import('csv-parse/sync');
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      const records = parse(raw, { columns: true, skip_empty_lines: true });
      return records.map(r => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' | ')).join('\n');
    } catch {
      return raw;
    }
  }

  // txt, md, and anything else — read as plain text
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Split text into overlapping chunks.
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} overlap
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
    if (chunk.length > 20) { // ignore tiny fragments
      chunks.push(chunk);
    }
    if (end >= cleanText.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}
