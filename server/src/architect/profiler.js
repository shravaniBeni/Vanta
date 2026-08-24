/**
 * server/src/architect/profiler.js
 *
 * Deterministic document profiler — deferred-indexing version.
 *
 * IMPORTANT: This profiler no longer reads from document_chunks.
 * It fetches the ORIGINAL SOURCE FILE from Supabase Storage, extracts text,
 * and runs all signal detection on that extracted text.
 *
 * This ensures profiling works correctly for documents with status='profiled'
 * (i.e. after upload but BEFORE approved-plan final indexing).
 *
 * Analysis pipeline:
 *   documents table (metadata + storage_path)
 *   → Supabase Storage download (original file buffer)
 *   → extractTextFromBuffer() (reuses existing parser)
 *   → detectSignals() (deterministic, no LLM)
 *   → classifyStructure() (scoring model)
 *   → returns rich profile
 *
 * Structural signals detected:
 *   - heading density (markdown, numbered sections, ALL-CAPS titles)
 *   - numbered sections / subsections
 *   - multi-step procedure detection
 *   - warning/caution/note blocks
 *   - cross-reference detection
 *   - Q&A / FAQ patterns
 *   - table-like content
 *   - short independent records
 *   - long-form prose
 *   - procedural language
 *   - decision logic
 *
 * Classification labels:
 *   faq | hierarchical_manual | procedural_manual | policy_document |
 *   reference_document | tabular_records | long_form_prose | mixed
 *
 * Never analyzes documents from other RAG apps.
 */

import supabase from '../supabase.js';
import path from 'path';
import { extractTextFromBuffer } from '../documentParser.js';

const STORAGE_BUCKET = 'knowledge-docs';

// ─── Structural signal detectors ─────────────────────────────────────────────

/**
 * Extract rich structural signals from an array of text samples.
 * All analysis is purely deterministic — no LLM involved.
 */
function detectSignals(samples) {
  const combined = samples.join('\n');
  const lines = combined.split('\n').filter(l => l.trim().length > 0);
  const totalLines = Math.max(lines.length, 1);

  // ── Heading detection ──────────────────────────────────────────────────────
  const markdownHeadings = lines.filter(l => /^#{1,4}\s+\S/.test(l.trim()));
  const numberedSections = lines.filter(l =>
    /^\d{1,2}\.\s+[A-Z]/.test(l.trim()) && l.trim().length < 80
  );
  const numberedSubsections = lines.filter(l =>
    /^\d+\.\d+(\.\d+)?\s+\S/.test(l.trim()) && l.trim().length < 100
  );
  const allCapsHeadings = lines.filter(l => {
    const t = l.trim();
    return t.length >= 4 && t.length < 60 && t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/^[\d\s\W]+$/.test(t);
  });
  const totalHeadings = markdownHeadings.length + numberedSections.length + allCapsHeadings.length;
  const headingDensity = totalHeadings / totalLines;
  const hasNumberedSubsections = numberedSubsections.length >= 2;

  // ── Multi-step procedure detection ────────────────────────────────────────
  const explicitSteps = lines.filter(l =>
    /^step\s+\d+[\s:.]/i.test(l.trim()) ||
    /^\d+\.\s+(ensure|check|verify|connect|install|remove|replace|press|turn|open|close|start|stop|set|configure|enter|select|click|attach|detach|tighten|loosen|apply|clean|inspect|test|measure|adjust|enable|disable)/i.test(l.trim())
  );
  const numberedActions = lines.filter(l =>
    /^\d+[\.)]\s+[A-Z][a-z]/.test(l.trim()) && l.trim().length < 200
  );
  const hasProcedures = explicitSteps.length >= 2 || numberedActions.length >= 3;

  // ── Warning / Caution / Note blocks ───────────────────────────────────────
  const warningBlocks = lines.filter(l =>
    /^(WARNING|CAUTION|DANGER|NOTE|IMPORTANT|NOTICE|ATTENTION)[:\s!]/i.test(l.trim()) ||
    /^⚠|^🔴|^‼/.test(l.trim())
  );
  const hasWarnings = warningBlocks.length >= 1;

  // ── Cross-reference detection ──────────────────────────────────────────────
  const crossRefs = lines.filter(l =>
    /\bsee\s+(section|chapter|figure|table|appendix|step)\s+[\d.]+/i.test(l) ||
    /\brefer\s+to\s+(section|chapter|figure|table|appendix)/i.test(l) ||
    /\(see\s+(above|below|section|figure|table)/i.test(l) ||
    /as\s+described\s+in\s+section/i.test(l)
  );
  const hasCrossReferences = crossRefs.length >= 1;

  // ── Q&A / FAQ patterns ────────────────────────────────────────────────────
  const qaLines = lines.filter(l => {
    const t = l.trim();
    return /^Q[:：\d]/i.test(t) ||
      /^(What|How|Why|When|Where|Who|Can|Should|Is|Are|Does|Do|Will|Would)\s+.{10,}\?$/.test(t) ||
      /^FAQ/i.test(t);
  });
  const hasQAPatterns = qaLines.length >= 2;
  const faqDensity = qaLines.length / totalLines;

  // ── Table-like content ────────────────────────────────────────────────────
  const tableLines = lines.filter(l =>
    (l.match(/\|/g) || []).length >= 2 ||
    (l.includes('\t') && l.split('\t').length >= 3) ||
    /^\s{2,}\S.+\s{3,}\S/.test(l)
  );
  const hasTabularContent = tableLines.length >= 3;

  // ── Short independent records ─────────────────────────────────────────────
  const shortLines = lines.filter(l => {
    const t = l.trim();
    return t.length > 10 && t.length < 120;
  });
  const shortRecordRatio = shortLines.length / totalLines;
  const hasShortRecords = shortRecordRatio > 0.65;

  // ── Long-form prose ───────────────────────────────────────────────────────
  const longLines = lines.filter(l => l.trim().length > 180);
  const proseRatio = longLines.length / totalLines;
  const hasProse = proseRatio > 0.15;

  // ── Procedural language ────────────────────────────────────────────────────
  const proceduralLines = lines.filter(l =>
    /^(ensure|check|verify|connect|install|remove|replace|press|turn|open|close|start|stop|set|configure|enter|select|click|attach|detach|apply|clean|inspect|test|measure|adjust|enable|disable|perform|complete|confirm|review|update|restart|shutdown|power|reset|initialize)/i.test(l.trim())
  );
  const hasProceduralLanguage = proceduralLines.length >= 2 || hasProcedures;

  // ── Average line length ────────────────────────────────────────────────────
  const avgLineLength = lines.reduce((s, l) => s + l.trim().length, 0) / totalLines;

  // ── Decision logic ────────────────────────────────────────────────────────
  const decisionLines = lines.filter(l =>
    /\bif\s+.{5,}\bthen\b/i.test(l) ||
    /\b(yes|no)\s*[→:—|]/i.test(l) ||
    /^\s*(if|otherwise|else|when|in case)/i.test(l.trim())
  );
  const hasDecisionLogic = decisionLines.length >= 2;

  // ── Language detection ─────────────────────────────────────────────────────
  const nonAsciiChars = (combined.match(/[^\x00-\x7F]/g) || []).length;
  const nonAsciiRatio = nonAsciiChars / Math.max(combined.length, 1);
  const language = nonAsciiRatio > 0.15 ? 'non-English (detected)' : 'English';

  return {
    heading_density:           headingDensity,
    has_markdown_headings:     markdownHeadings.length >= 2,
    has_numbered_sections:     numberedSections.length >= 2,
    has_numbered_subsections:  hasNumberedSubsections,
    has_allcaps_headings:      allCapsHeadings.length >= 2,
    total_heading_count:       totalHeadings,
    has_procedures:            hasProcedures,
    explicit_step_count:       explicitSteps.length,
    numbered_action_count:     numberedActions.length,
    has_warnings:              hasWarnings,
    warning_count:             warningBlocks.length,
    has_cross_references:      hasCrossReferences,
    has_procedural_language:   hasProceduralLanguage,
    has_decision_logic:        hasDecisionLogic,
    has_qa_patterns:           hasQAPatterns,
    faq_density:               faqDensity,
    has_tabular_content:       hasTabularContent,
    has_short_records:         hasShortRecords,
    short_record_ratio:        shortRecordRatio,
    has_long_form_prose:       hasProse,
    prose_ratio:               proseRatio,
    avg_line_length:           Math.round(avgLineLength),
    total_lines_sampled:       totalLines,
    language,
  };
}

/**
 * Classify document structure type from detected signals.
 */
function classifyStructure(signals, docTypes) {
  const scores = {
    faq:                 0,
    hierarchical_manual: 0,
    procedural_manual:   0,
    policy_document:     0,
    reference_document:  0,
    tabular_records:     0,
    long_form_prose:     0,
  };

  if (signals.has_qa_patterns)      scores.faq += 3;
  if (signals.faq_density > 0.05)   scores.faq += 2;
  if (signals.has_short_records)    scores.faq += 1;
  if (!signals.has_procedures)      scores.faq += 1;

  if (signals.has_numbered_sections)    scores.hierarchical_manual += 3;
  if (signals.has_numbered_subsections) scores.hierarchical_manual += 3;
  if (signals.has_allcaps_headings)     scores.hierarchical_manual += 2;
  if (signals.heading_density > 0.08)   scores.hierarchical_manual += 2;
  if (signals.has_warnings)            scores.hierarchical_manual += 1;
  if (signals.has_cross_references)    scores.hierarchical_manual += 2;

  if (signals.has_procedures)           scores.procedural_manual += 4;
  if (signals.explicit_step_count >= 3) scores.procedural_manual += 3;
  if (signals.has_warnings)             scores.procedural_manual += 2;
  if (signals.has_procedural_language)  scores.procedural_manual += 2;
  if (signals.has_decision_logic)       scores.procedural_manual += 1;
  if (signals.has_numbered_subsections) scores.procedural_manual += 1;

  if (!signals.has_procedures && !signals.has_qa_patterns && signals.has_long_form_prose)
    scores.policy_document += 2;
  if (signals.has_numbered_sections && !signals.has_procedures)
    scores.policy_document += 1;
  if (signals.prose_ratio > 0.25) scores.policy_document += 1;

  if (signals.has_cross_references && !signals.has_procedures)
    scores.reference_document += 2;
  if (signals.has_tabular_content) scores.reference_document += 2;
  if (signals.has_numbered_sections && signals.has_cross_references)
    scores.reference_document += 1;

  if (docTypes.includes('csv'))    scores.tabular_records += 5;
  if (signals.has_tabular_content) scores.tabular_records += 3;
  if (signals.has_short_records && !signals.has_procedures && !signals.has_qa_patterns)
    scores.tabular_records += 1;

  if (signals.has_long_form_prose && signals.prose_ratio > 0.3)
    scores.long_form_prose += 3;
  if (!signals.has_numbered_sections && !signals.has_procedures && !signals.has_qa_patterns)
    scores.long_form_prose += 2;
  if (signals.avg_line_length > 150) scores.long_form_prose += 1;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = sorted;
  if (top[1] > 0 && second[1] > 0 && (top[1] - second[1]) <= 2 && top[1] >= 3) return 'mixed';
  return top[1] > 0 ? top[0] : 'mixed';
}

function getExtension(fileName) {
  return path.extname(fileName || '').toLowerCase().replace('.', '') || 'unknown';
}

// ─── Main profiler ────────────────────────────────────────────────────────────

/**
 * Build a rich deterministic knowledge profile for a RAG app.
 *
 * Source: reads ORIGINAL FILES from Supabase Storage.
 * Does NOT depend on document_chunks being present.
 * Works for documents with status in: profiled, indexed, uploading (any).
 *
 * Strictly scoped to rag_app_id — never reads another app's data.
 *
 * @param {string} ragAppId
 * @returns {Promise<object>} profile
 */
export async function profileDocuments(ragAppId) {
  // Fetch all profiled (or indexed) documents for this app
  // Accept profiled + indexed — both have original files in Storage
  const { data: docs, error: docsErr } = await supabase
    .from('documents')
    .select('id, file_name, size_bytes, mime_type, chunk_count, status, storage_path')
    .eq('rag_app_id', ragAppId)
    .in('status', ['profiled', 'indexed', 'indexing']);

  if (docsErr) throw new Error(`[profiler] Failed to fetch documents: ${docsErr.message}`);

  if (!docs || docs.length === 0) {
    return {
      document_count:          0,
      document_types:          [],
      total_characters:        0,
      average_document_length: 0,
      total_chunks:            0,
      language:                'unknown',
      structure_type:          'unknown',
      signals:                 {},
      notes:                   'No profiled documents found.',
    };
  }

  // Extract text from original Storage files (sample up to first 20k chars per doc)
  // This avoids downloading huge PDFs unnecessarily while still getting
  // sufficient content for structural signal detection.
  const textSamples = [];
  const MAX_SAMPLE_CHARS = 20000;

  for (const doc of docs) {
    try {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(doc.storage_path);

      if (dlErr || !fileData) {
        console.warn(`[profiler] Could not download ${doc.storage_path}: ${dlErr?.message}`);
        continue;
      }

      // Convert Blob to Buffer
      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Extract text using the existing parser (PDF, DOCX, TXT, CSV)
      const text = await extractTextFromBuffer(buffer, doc.file_name);
      if (text && text.trim().length > 0) {
        // Take a representative sample: first 8k + middle 6k + last 6k chars
        const len = text.length;
        if (len <= MAX_SAMPLE_CHARS) {
          textSamples.push(text.trim());
        } else {
          const head   = text.slice(0, 8000);
          const mid    = text.slice(Math.floor(len / 2) - 3000, Math.floor(len / 2) + 3000);
          const tail   = text.slice(len - 6000);
          textSamples.push(`${head}\n\n${mid}\n\n${tail}`);
        }
      }
    } catch (err) {
      console.warn(`[profiler] Error profiling doc ${doc.id.slice(0,8)}: ${err.message}`);
    }
  }

  if (textSamples.length === 0) {
    return {
      document_count:          docs.length,
      document_types:          [...new Set(docs.map(d => getExtension(d.file_name)))],
      total_characters:        0,
      average_document_length: 0,
      total_chunks:            0,
      language:                'unknown',
      structure_type:          'unknown',
      signals:                 {},
      notes:                   'Could not extract text from documents for profiling.',
    };
  }

  // Aggregate metadata
  const docTypes = [...new Set(docs.map(d => getExtension(d.file_name)))];
  const totalBytes = docs.reduce((s, d) => s + (d.size_bytes || 0), 0);
  const estimatedTotalChars = textSamples.reduce((s, t) => s + t.length, 0);
  const avgDocLength = textSamples.length > 0
    ? Math.round(estimatedTotalChars / textSamples.length) : 0;

  // Total indexed chunks (may be 0 for profiled-but-not-yet-indexed docs)
  const totalChunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);

  // Detect structural signals from extracted text
  const signals = detectSignals(textSamples);
  const structureType = classifyStructure(signals, docTypes);

  // Build human-readable notes
  const notesList = [];
  if (docs.length === 1) notesList.push('Single document knowledge base.');
  if (docTypes.includes('csv')) notesList.push('CSV files detected — likely tabular/structured data.');
  if (signals.has_warnings) notesList.push(`${signals.warning_count} warning/caution block(s) detected.`);
  if (signals.has_cross_references) notesList.push('Cross-references detected between sections.');
  if (signals.has_procedures)
    notesList.push(`${signals.explicit_step_count + signals.numbered_action_count} procedural step(s) detected.`);
  if (signals.has_numbered_subsections) notesList.push('Numbered subsections detected (e.g. 1.1, 2.3.1).');
  if (signals.has_tabular_content) notesList.push('Table-like content detected.');
  if (signals.has_qa_patterns) notesList.push('Q&A / FAQ patterns detected.');
  if (signals.has_decision_logic) notesList.push('Decision/branch logic detected (if/then/else patterns).');

  return {
    document_count:          docs.length,
    document_types:          docTypes,
    total_chunks:            totalChunks,
    total_characters:        estimatedTotalChars,
    average_document_length: avgDocLength,
    language:                signals.language,
    structure_type:          structureType,
    signals: {
      heading_density:           signals.heading_density,
      has_markdown_headings:     signals.has_markdown_headings,
      has_numbered_sections:     signals.has_numbered_sections,
      has_numbered_subsections:  signals.has_numbered_subsections,
      has_allcaps_headings:      signals.has_allcaps_headings,
      total_heading_count:       signals.total_heading_count,
      has_procedures:            signals.has_procedures,
      explicit_step_count:       signals.explicit_step_count,
      numbered_action_count:     signals.numbered_action_count,
      has_warnings:              signals.has_warnings,
      warning_count:             signals.warning_count,
      has_cross_references:      signals.has_cross_references,
      has_procedural_language:   signals.has_procedural_language,
      has_decision_logic:        signals.has_decision_logic,
      has_qa_patterns:           signals.has_qa_patterns,
      faq_density:               signals.faq_density,
      has_tabular_content:       signals.has_tabular_content,
      has_short_records:         signals.has_short_records,
      short_record_ratio:        signals.short_record_ratio,
      has_long_form_prose:       signals.has_long_form_prose,
      prose_ratio:               signals.prose_ratio,
      avg_line_length:           signals.avg_line_length,
      total_lines_sampled:       signals.total_lines_sampled,
    },
    sample_count: textSamples.length,
    notes: notesList.join(' ') || '',
  };
}
