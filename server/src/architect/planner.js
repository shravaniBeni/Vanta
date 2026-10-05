/**
 * server/src/architect/planner.js
 *
 * AI RAG Architect — LLM calls for follow-up questions and plan generation.
 *
 * LLM call budget per typical flow:
 *   1. POST /api/architect/analyze  → 1 call (follow-up questions, if needed)
 *   2. POST /api/architect/plan     → 1 call (structured plan generation)
 *   Total: 1–2 LLM calls per onboarding session.
 *
 * Token saving measures:
 *   - Document profiler is 100% deterministic (no LLM)
 *   - Only compact structural signals (not raw document text) sent to LLM
 *   - JSON response_format used for plan output
 *   - Follow-up questions and analysis merged into one call
 */

import { invokeLLMJson } from '../openai.js';

// ─── Compact profile serializer ───────────────────────────────────────────────

/**
 * Convert the rich profiler output into a compact but evidence-rich
 * summary for the LLM. Avoids dumping the full signals object verbatim.
 */
function buildProfileSummary(profile) {
  const s = profile.signals || {};

  // ── Phase 10A: OCR/scan section ──────────────────────────────────────────
  let ocrSection = '';
  if (profile.ocr_required || (profile.document_scan_profiles?.length > 0)) {
    const scanDocs = (profile.document_scan_profiles || []).filter(d => d.needs_ocr);
    const normalDocs = (profile.document_scan_profiles || []).filter(d => !d.needs_ocr);
    ocrSection = [
      '',
      '--- OCR / Scan classification (Phase 10A) ---',
      `ocr_required: ${profile.ocr_required ?? false}`,
      `scanned_or_mixed_documents: ${scanDocs.length}`,
      `normal_text_documents: ${normalDocs.length}`,
    ];
    for (const d of profile.document_scan_profiles || []) {
      ocrSection.push(
        `  ${d.file_name}: classification=${d.classification ?? 'unknown'}` +
        (d.page_count != null ? ` pages=${d.page_count}` : '') +
        (d.scanned_pages != null ? ` scanned_pages=${d.scanned_pages}` : '') +
        (d.text_pages != null ? ` text_pages=${d.text_pages}` : '') +
        ` needs_ocr=${d.needs_ocr}`
      );
    }
    ocrSection = ocrSection.join('\n');
  }

  const evidenceLines = [
    `document_count: ${profile.document_count}`,
    `document_types: ${(profile.document_types || []).join(', ') || 'unknown'}`,
    `structure_type: ${profile.structure_type || 'unknown'}  ← PRIMARY CLASSIFICATION — use this to anchor your chunking strategy decision`,
    `language: ${profile.language || 'English'}`,
    `total_chunks: ${profile.total_chunks}`,
    `avg_line_length: ${s.avg_line_length || 'unknown'} chars`,
    `total_lines_sampled: ${s.total_lines_sampled || 'unknown'}`,
    ocrSection,
    '',
    '--- Structural signals ---',
    `heading_density: ${s.heading_density != null ? s.heading_density.toFixed(3) : 'n/a'} (ratio of heading-like lines)`,
    `has_numbered_sections: ${s.has_numbered_sections}`,
    `has_numbered_subsections: ${s.has_numbered_subsections}`,
    `has_allcaps_headings: ${s.has_allcaps_headings}`,
    `total_heading_count: ${s.total_heading_count}`,
    '',
    '--- Procedural signals ---',
    `has_procedures: ${s.has_procedures}`,
    `explicit_step_count: ${s.explicit_step_count}`,
    `numbered_action_count: ${s.numbered_action_count}`,
    `has_warnings: ${s.has_warnings} (warning/caution/danger blocks: ${s.warning_count})`,
    `has_cross_references: ${s.has_cross_references}`,
    `has_procedural_language: ${s.has_procedural_language}`,
    `has_decision_logic: ${s.has_decision_logic}`,
    '',
    '--- Content type signals ---',
    `has_qa_patterns: ${s.has_qa_patterns} (faq_density: ${s.faq_density != null ? s.faq_density.toFixed(3) : 'n/a'})`,
    `has_tabular_content: ${s.has_tabular_content}`,
    `has_short_records: ${s.has_short_records} (short_record_ratio: ${s.short_record_ratio != null ? s.short_record_ratio.toFixed(2) : 'n/a'})`,
    `has_long_form_prose: ${s.has_long_form_prose} (prose_ratio: ${s.prose_ratio != null ? s.prose_ratio.toFixed(2) : 'n/a'})`,
    '',
    `notes: ${profile.notes || 'none'}`,
  ];

  return evidenceLines.filter(l => l !== null && l !== undefined).join('\n');
}

// ─── Follow-up question generation ───────────────────────────────────────────

/**
 * Analyze requirements + knowledge profile and determine if follow-up
 * questions are needed. Returns 0–4 specific, architecture-relevant questions.
 *
 * @param {string} requirement
 * @param {object} knowledgeProfile - output from profiler.js
 * @param {object[]} [previousAnswers=[]]
 * @returns {Promise<{ needs_clarification: boolean, questions: object[] }>}
 */
export async function generateFollowUpQuestions(requirement, knowledgeProfile, previousAnswers = []) {
  const profileSummary = buildProfileSummary(knowledgeProfile);

  const answeredContext = previousAnswers.length > 0
    ? `\nAlready answered:\n${previousAnswers.map(a => `- ${a.question_id}: ${a.answer}`).join('\n')}`
    : '';

  const raw = await invokeLLMJson(`
You are the AI RAG Architect for Vanta, an intelligent RAG pipeline configurator.

The user wants to build a RAG chatbot with this requirement:
"${requirement}"

Structural knowledge profile of their uploaded documents:
${profileSummary}
${answeredContext}

Your task: Determine if you need clarification to generate an optimal RAG configuration.

Rules:
1. Return 0 questions if the requirement and profile together provide enough signal.
2. Return 1–4 questions MAXIMUM. Never more than 4.
3. Only ask questions that will DIRECTLY affect architecture decisions.
4. Do NOT ask generic questions. Be specific and architecture-relevant.
5. If no clarification is needed, return needs_clarification: false with empty questions array.

Useful clarification areas (only when genuinely unclear from the requirement + profile):
- Should the assistant strictly use only uploaded knowledge, or may it use general model knowledge?
- What is the expected query style: short factual lookups, deep procedure queries, or multi-turn?
- Is accuracy or response speed the higher priority?
- What language should responses be delivered in?
- For procedural/safety documents: should the assistant quote exact steps, or paraphrase?

Return JSON:
{
  "needs_clarification": true or false,
  "questions": [
    {
      "id": "short_snake_case_id",
      "question": "Specific useful question text",
      "type": "single_choice | free_text",
      "options": ["option1", "option2"]
    }
  ]
}
`);

  const questions = (raw.questions || []).slice(0, 4);
  return {
    needs_clarification: questions.length > 0,
    questions,
  };
}

// ─── Architect plan generation ────────────────────────────────────────────────

/**
 * Generate a structured RAG architect plan with evidence-based explanations.
 * Returns raw JSON to be validated by ArchitectPlanSchema before persistence.
 *
 * @param {string} requirement
 * @param {object} knowledgeProfile - rich profile from profiler.js
 * @param {object[]} answers - [{question_id, answer}]
 * @returns {Promise<object>} raw plan (not yet Zod-validated)
 */
export async function generateArchitectPlan(requirement, knowledgeProfile, answers = []) {
  const answersText = answers.length > 0
    ? answers.map(a => `${a.question_id}: ${a.answer}`).join('\n')
    : 'None provided.';

  const profileSummary = buildProfileSummary(knowledgeProfile);

  const raw = await invokeLLMJson(`
You are the AI RAG Architect for Vanta. Generate a precise, evidence-based RAG pipeline configuration.

USER REQUIREMENT:
"${requirement}"

DOCUMENT STRUCTURAL PROFILE:
${profileSummary}

FOLLOW-UP ANSWERS:
${answersText}

═══════════════════════════════════════════════
HARD RUNTIME CONSTRAINTS — DO NOT DEVIATE
═══════════════════════════════════════════════
- embedding.model = "Xenova/bge-small-en-v1.5"
- embedding.dimension = 384
- retrieval.active_strategy = "similarity"
- retrieval.similarity_metric = "cosine"
- retrieval.reranking.enabled = false
- retrieval.reranking.model = null
- chunk_size: integer 200–1500
- chunk_overlap: integer 0–300, MUST be less than chunk_size
- top_k: integer 1–10

If an unsupported feature (hybrid search, reranking, MMR, custom embedding, metadata filtering)
would benefit this use case, list it under future_recommendations ONLY. Never activate it.

═══════════════════════════════════════════════
OCR REQUIREMENT (CRITICAL — READ FIRST)
═══════════════════════════════════════════════
Check the "OCR / Scan classification" section in the document profile above.

If ocr_required = true OR any document has classification = SCANNED, MIXED, or IMAGE_HEAVY:
  - The document cannot be read by normal text extraction
  - Normal text extraction will return empty or near-empty text
  - OCR (Optical Character Recognition) MUST be part of the pipeline
  - Set requires_ocr = true in your response
  - Set ocr_reason to explain which documents are scanned and why OCR is needed
  - The pipeline order will be: DocumentUpload → OCR → TextSplitter → Embeddings → VectorStore → LLM → ChatOutput
  - OCR is a SUPPORTED capability in the Vanta runtime (not experimental)

If all documents are TEXT_EXTRACTABLE or NOT_PDF:
  - Set requires_ocr = false
  - Leave ocr_reason as an empty string

Do NOT ask for clarification about OCR if the scan profile already tells you.
Do NOT set requires_ocr = false when scanned documents are present.

═══════════════════════════════════════════════
CHUNKING STRATEGY DECISION GUIDE
═══════════════════════════════════════════════
Use the structural signals to choose deliberately. Do not default to "fixed" without justification.

AVAILABLE EXECUTABLE STRATEGIES (current runtime):
  fixed | recursive | structure-aware

NOTE: "semantic" is NOT an available strategy in the current runtime.
Do NOT output "semantic" as the active chunking.strategy.
If the content would benefit from semantic segmentation, choose the closest
executable strategy below and add "semantic_chunking" to future_recommendations.

FIXED is appropriate when:
- Records are short and relatively uniform (FAQ entries, product listings, policies)
- Content has weak or absent hierarchy
- Short_record_ratio > 0.6 and has_procedures = false
- Independent entries that do not depend on surrounding context
- Predictable chunk sizes match query granularity

RECURSIVE is appropriate when:
- Content has natural paragraph/section boundaries but not rigid procedural structure
- Sections vary significantly in length
- has_numbered_sections = true but has_procedures = false
- has_long_form_prose = true
- Preserving semantic paragraph boundaries matters more than exact sizes
- Would have been "semantic" but no embedding-based segmentation available

STRUCTURE-AWARE is appropriate when:
- has_numbered_sections = true AND (has_numbered_subsections = true OR has_procedures = true)
- Numbered procedures must remain intact (splitting a step from its prerequisite loses context)
- has_warnings = true (warnings belong with the procedure they govern)
- has_cross_references = true (section boundaries carry semantic meaning)
- heading_density > 0.05 (strong hierarchical structure present)
- Splitting on fixed character boundaries would likely separate dependent steps, prerequisites, or warnings

IMPORTANT: If you choose fixed chunking despite has_procedures = true or has_numbered_subsections = true,
you MUST explicitly justify why fixed boundaries are preferable DESPITE the hierarchical/procedural structure.
Generic statements ("fixed chunking is good for this") are NOT acceptable.

═══════════════════════════════════════════════
CHUNK SIZE AND OVERLAP GUIDANCE
═══════════════════════════════════════════════
Connect your values to observed document characteristics:

- FAQ / short records (short_record_ratio > 0.6): chunk_size 200–500, overlap 20–60
  Reason: independent entries, small overlap to avoid double-counting

- Policy / prose (has_long_form_prose = true): chunk_size 800–1200, overlap 100–200
  Reason: preserve paragraph context, overlap ensures boundary sentences appear in adjacent chunks

- Procedural / hierarchical manual (has_procedures = true or has_numbered_subsections = true):
  chunk_size 800–1400, overlap 150–250
  Reason: procedures span multiple lines; overlap preserves prerequisite-to-step continuity
  and prevents warnings from being severed from the steps they govern

- Technical reference / tabular: chunk_size 400–800, overlap 50–100
  Reason: table rows are self-contained but surrounding context aids disambiguation

Overlap rule: overlap should be 15–25% of chunk_size for most cases.
For highly interdependent procedural content, up to 30% is justified.
For very independent short records, 10% or less is fine.

═══════════════════════════════════════════════
TOP-K AND RETRIEVAL GUIDANCE
═══════════════════════════════════════════════
- Procedural / safety queries: top_k 3–4. Precision matters; returning wrong steps is worse than returning fewer.
- FAQ / factual lookup: top_k 3–5. Entries are independent, modest top_k sufficient.
- Policy / broad synthesis: top_k 5–8. Multiple sections often contribute to one answer.
- Research / long-form reference: top_k 6–10. Dense cross-referenced content needs breadth.

Your reasoning MUST reference the specific use case and document type.

═══════════════════════════════════════════════
EXPLAINABILITY REQUIREMENTS
═══════════════════════════════════════════════
Every reason field MUST:
1. Reference specific observed evidence from the structural profile
   (e.g. "has_numbered_subsections = true", "warning_count = 3", "short_record_ratio = 0.72")
2. Connect that evidence to the parameter choice
3. Avoid generic phrases like "this is optimal" or "this improves performance"

Bad example: "Fixed chunking with 500 chars provides good retrieval."
Good example: "The document has short_record_ratio = 0.72 and no detected procedures (has_procedures = false),
indicating independent FAQ-style entries. Fixed 400-char chunks align with typical entry length.
Low overlap (40 chars) avoids redundant retrieval of adjacent unrelated entries."

═══════════════════════════════════════════════
OUTPUT SCHEMA
═══════════════════════════════════════════════
Return valid JSON matching EXACTLY this schema:
{
  "domain": "short domain label (e.g. industrial maintenance, e-commerce, healthcare)",
  "use_case": "one concise sentence describing the assistant's purpose",
  "knowledge_profile": {
    "document_count": <integer>,
    "document_types": ["txt","pdf"],
    "structure": "<structure_type from profile>",
    "language": "<language from profile>",
    "notes": "<key observations from structural signals>"
  },
  "requires_ocr": true or false,
  "ocr_reason": "<explain which documents are scanned and why OCR is needed, or empty string if not required>",
  "chunking": {
    "strategy": "fixed | recursive | structure-aware",
    "chunk_size": <200-1500>,
    "chunk_overlap": <0-300>,
    "reason": "<evidence-based explanation referencing specific signals>"
  },
  "embedding": {
    "model": "Xenova/bge-small-en-v1.5",
    "dimension": 384,
    "reason": "<brief explanation>"
  },
  "retrieval": {
    "active_strategy": "similarity",
    "similarity_metric": "cosine",
    "top_k": <1-10>,
    "reranking": { "enabled": false, "model": null },
    "reason": "<evidence-based explanation referencing use case and query type>"
  },
  "generation": {
    "grounding_required": true or false,
    "response_style": "concise and factual | conversational | detailed | step-by-step",
    "reason": "<explanation referencing use case, safety requirements, or grounding needs>"
  },
  "future_recommendations": [
    { "feature": "feature_name", "reason": "why it would help this specific use case" }
  ],
  "summary": "2-3 sentence plain-English explanation of the recommended configuration and the key evidence that drove it"
}
`);
Use the structural signals to choose deliberately. Do not default to "fixed" without justification.

AVAILABLE EXECUTABLE STRATEGIES (current runtime):
  fixed | recursive | structure-aware

NOTE: "semantic" is NOT an available strategy in the current runtime.
Do NOT output "semantic" as the active chunking.strategy.
If the content would benefit from semantic segmentation, choose the closest
executable strategy below and add "semantic_chunking" to future_recommendations.

FIXED is appropriate when:
- Records are short and relatively uniform (FAQ entries, product listings, policies)
- Content has weak or absent hierarchy
- Short_record_ratio > 0.6 and has_procedures = false
- Independent entries that do not depend on surrounding context
- Predictable chunk sizes match query granularity

RECURSIVE is appropriate when:
- Content has natural paragraph/section boundaries but not rigid procedural structure
- Sections vary significantly in length
- has_numbered_sections = true but has_procedures = false
- has_long_form_prose = true
- Preserving semantic paragraph boundaries matters more than exact sizes
- Would have been "semantic" but no embedding-based segmentation available

STRUCTURE-AWARE is appropriate when:
- has_numbered_sections = true AND (has_numbered_subsections = true OR has_procedures = true)
- Numbered procedures must remain intact (splitting a step from its prerequisite loses context)
- has_warnings = true (warnings belong with the procedure they govern)
- has_cross_references = true (section boundaries carry semantic meaning)
- heading_density > 0.05 (strong hierarchical structure present)
- Splitting on fixed character boundaries would likely separate dependent steps, prerequisites, or warnings

IMPORTANT: If you choose fixed chunking despite has_procedures = true or has_numbered_subsections = true,
you MUST explicitly justify why fixed boundaries are preferable DESPITE the hierarchical/procedural structure.
Generic statements ("fixed chunking is good for this") are NOT acceptable.

═══════════════════════════════════════════════
CHUNK SIZE AND OVERLAP GUIDANCE
═══════════════════════════════════════════════
Connect your values to observed document characteristics:

- FAQ / short records (short_record_ratio > 0.6): chunk_size 200–500, overlap 20–60
  Reason: independent entries, small overlap to avoid double-counting

- Policy / prose (has_long_form_prose = true): chunk_size 800–1200, overlap 100–200
  Reason: preserve paragraph context, overlap ensures boundary sentences appear in adjacent chunks

- Procedural / hierarchical manual (has_procedures = true or has_numbered_subsections = true):
  chunk_size 800–1400, overlap 150–250
  Reason: procedures span multiple lines; overlap preserves prerequisite-to-step continuity
  and prevents warnings from being severed from the steps they govern

- Technical reference / tabular: chunk_size 400–800, overlap 50–100
  Reason: table rows are self-contained but surrounding context aids disambiguation

Overlap rule: overlap should be 15–25% of chunk_size for most cases.
For highly interdependent procedural content, up to 30% is justified.
For very independent short records, 10% or less is fine.

═══════════════════════════════════════════════
TOP-K AND RETRIEVAL GUIDANCE
═══════════════════════════════════════════════
- Procedural / safety queries: top_k 3–4. Precision matters; returning wrong steps is worse than returning fewer.
- FAQ / factual lookup: top_k 3–5. Entries are independent, modest top_k sufficient.
- Policy / broad synthesis: top_k 5–8. Multiple sections often contribute to one answer.
- Research / long-form reference: top_k 6–10. Dense cross-referenced content needs breadth.

Your reasoning MUST reference the specific use case and document type.

═══════════════════════════════════════════════
EXPLAINABILITY REQUIREMENTS
═══════════════════════════════════════════════
Every reason field MUST:
1. Reference specific observed evidence from the structural profile
   (e.g. "has_numbered_subsections = true", "warning_count = 3", "short_record_ratio = 0.72")
2. Connect that evidence to the parameter choice
3. Avoid generic phrases like "this is optimal" or "this improves performance"

Bad example: "Fixed chunking with 500 chars provides good retrieval."
Good example: "The document has short_record_ratio = 0.72 and no detected procedures (has_procedures = false),
indicating independent FAQ-style entries. Fixed 400-char chunks align with typical entry length.
Low overlap (40 chars) avoids redundant retrieval of adjacent unrelated entries."

═══════════════════════════════════════════════
OUTPUT SCHEMA
═══════════════════════════════════════════════
Return valid JSON matching EXACTLY this schema:
{
  "domain": "short domain label (e.g. industrial maintenance, e-commerce, healthcare)",
  "use_case": "one concise sentence describing the assistant's purpose",
  "knowledge_profile": {
    "document_count": <integer>,
    "document_types": ["txt","pdf"],
    "structure": "<structure_type from profile>",
    "language": "<language from profile>",
    "notes": "<key observations from structural signals>"
  },
  "chunking": {
    "strategy": "fixed | recursive | structure-aware",
    "chunk_size": <200-1500>,
    "chunk_overlap": <0-300>,
    "reason": "<evidence-based explanation referencing specific signals>"
  },
  "embedding": {
    "model": "Xenova/bge-small-en-v1.5",
    "dimension": 384,
    "reason": "<brief explanation>"
  },
  "retrieval": {
    "active_strategy": "similarity",
    "similarity_metric": "cosine",
    "top_k": <1-10>,
    "reranking": { "enabled": false, "model": null },
    "reason": "<evidence-based explanation referencing use case and query type>"
  },
  "generation": {
    "grounding_required": true or false,
    "response_style": "concise and factual | conversational | detailed | step-by-step",
    "reason": "<explanation referencing use case, safety requirements, or grounding needs>"
  },
  "future_recommendations": [
    { "feature": "feature_name", "reason": "why it would help this specific use case" }
  ],
  "summary": "2-3 sentence plain-English explanation of the recommended configuration and the key evidence that drove it"
}
`);

  return raw;
}
