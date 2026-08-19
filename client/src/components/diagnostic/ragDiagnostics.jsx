/**
 * RAG Diagnostic Engine
 * Detects common RAG failure modes and returns structured feedback.
 * Modular: add new detectors to FAILURE_DETECTORS array.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Failure Detectors ──────────────────────────────────────────────────────

const FAILURE_DETECTORS = [
  {
    id: 'no_documents',
    title: 'No Documents Found',
    severity: 'error',
    detect: ({ retrievedChunks }) => !retrievedChunks || retrievedChunks.length === 0,
    explain: () => "No documents were found in the knowledge base for this chatbot.",
    suggest: () => "Upload relevant documents using the Document Upload node in your workflow, then re-deploy.",
  },
  {
    id: 'missing_content',
    title: 'Missing Content',
    severity: 'error',
    detect: ({ similarityScores, llmResponse }) => {
      const avgScore = average(similarityScores);
      const uncertaintyPhrases = [
        "i don't know", "i'm not sure", "i cannot find", "no information",
        "i don't have", "not able to", "unclear", "unable to answer",
        "i apologize", "unfortunately", "i don't have access",
      ];
      const hasUncertainty = uncertaintyPhrases.some(p => llmResponse.toLowerCase().includes(p));
      return avgScore < 0.35 && hasUncertainty;
    },
    explain: () => "I couldn't find relevant content in the knowledge base to answer this question.",
    suggest: () => "Upload documents that specifically cover this topic, or try rephrasing your question with different keywords.",
  },
  {
    id: 'low_confidence',
    title: 'Low Confidence',
    severity: 'warning',
    detect: ({ similarityScores, retrievedChunks }) => {
      if (!retrievedChunks?.length) return false;
      const avgScore = average(similarityScores);
      return avgScore >= 0.35 && avgScore < 0.55;
    },
    explain: ({ similarityScores }) => {
      const avg = (average(similarityScores) * 100).toFixed(0);
      return `The retrieved content only partially matches your question (average relevance: ${avg}%). My answer may be incomplete or imprecise.`;
    },
    suggest: () => "Try rephrasing your question, or upload more specific documents that directly address this topic.",
  },
  {
    id: 'scanned_pdf',
    title: 'Scanned PDF Detected',
    severity: 'warning',
    detect: ({ sourceMetadata }) => {
      if (!sourceMetadata) return false;
      return sourceMetadata.fileType === 'pdf' && sourceMetadata.avgCharsPerPage < 200;
    },
    explain: () => "One of your source documents appears to be a scanned PDF with minimal extractable text. OCR quality may be poor.",
    suggest: () => "Use a text-based PDF or run OCR pre-processing. You can add the OCR Layer node to your workflow to handle scanned documents.",
  },
  {
    id: 'context_overflow',
    title: 'Context Too Long',
    severity: 'info',
    detect: ({ retrievedChunks }) => {
      if (!retrievedChunks?.length) return false;
      return retrievedChunks.join('').length > 8000;
    },
    explain: () => "The retrieved context is very large, which may cause the LLM to lose focus on the most relevant parts.",
    suggest: () => "Reduce the chunk size in your Text Splitter node, or add a Data Filter node to limit retrieval to the top 3–5 chunks.",
  },
];

// ─── Telemetry Builder ───────────────────────────────────────────────────────

export function buildTelemetry({ query, llmResponse, similarityScores, retrievedChunks, sourceMetadata, configUsed }) {
  return {
    timestamp: new Date().toISOString(),
    query,
    llmResponse,
    similarityScores: similarityScores || [],
    avgSimilarity: average(similarityScores || []),
    retrievedChunks: retrievedChunks || [],
    chunkPreviews: (retrievedChunks || []).map(c => c.substring(0, 120) + (c.length > 120 ? '...' : '')),
    sourceMetadata: sourceMetadata || null,
    configUsed: configUsed || {},
  };
}

// ─── Main Diagnostic Runner ──────────────────────────────────────────────────

export function runDiagnostics(telemetry) {
  const results = [];
  for (const detector of FAILURE_DETECTORS) {
    if (detector.detect(telemetry)) {
      results.push({
        id: detector.id,
        title: detector.title,
        severity: detector.severity,
        explanation: typeof detector.explain === 'function' ? detector.explain(telemetry) : detector.explain,
        suggestion: typeof detector.suggest === 'function' ? detector.suggest(telemetry) : detector.suggest,
      });
    }
  }
  return results;
}

// ─── Simulate RAG Telemetry ──────────────────────────────────────────────────

export function simulateRagTelemetry({ chatbot, query, llmResponse }) {
  const hasDocuments = (chatbot.nodes || []).some(
    n => n.type === 'DocumentUpload' && n.params?.uploaded_files?.length > 0
  );
  const hasPdfSource = (chatbot.nodes || []).some(
    n => n.type === 'DocumentUpload' &&
    (n.params?.uploaded_files || []).some(f => f.name?.toLowerCase().endsWith('.pdf'))
  );

  const baseScore = hasDocuments ? 0.45 + Math.random() * 0.45 : 0.1 + Math.random() * 0.2;
  const numChunks = hasDocuments ? Math.floor(Math.random() * 4) + 1 : 0;
  const similarityScores = Array.from({ length: numChunks }, () =>
    Math.max(0, Math.min(1, baseScore + (Math.random() * 0.2 - 0.1)))
  );
  const retrievedChunks = Array.from({ length: numChunks }, (_, i) =>
    `Chunk ${i + 1}: Sample content related to "${query.substring(0, 40)}..." from knowledge base.`
  );
  const sourceMetadata = hasPdfSource
    ? { fileType: 'pdf', avgCharsPerPage: Math.random() > 0.5 ? 80 : 500 }
    : null;

  return buildTelemetry({
    query,
    llmResponse,
    similarityScores,
    retrievedChunks,
    sourceMetadata,
    configUsed: {
      model: 'llm-default',
      chunkSize: chatbot.nodes?.find(n => n.type === 'TextSplitter')?.params?.chunk_size || 512,
      topK: 5,
    },
  });
}