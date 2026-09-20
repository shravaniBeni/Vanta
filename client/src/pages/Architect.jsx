/**
 * client/src/pages/Architect.jsx
 *
 * Phase 7: AI RAG Architect onboarding flow — enhanced version.
 *
 * Steps:
 *   0. DESCRIBE  — requirement text + document upload
 *   1. QUESTIONS — 0–4 follow-up questions (may be skipped)
 *   2. GENERATING — spinner while LLM generates plan
 *   3. REVIEW    — full plan with explanations + approve / regenerate / edit
 *   4. APPROVED  — full approved plan remains visible (read-only), deliberate regeneration available
 *
 * Key behaviours:
 *   - Approved plan is fully displayed (not hidden behind a success screen)
 *   - architect_version is always visible
 *   - Regeneration from approved state is a deliberate "Create New Version" action
 *   - Page reload restores approved/ready plan from backend state
 *   - Failed generation does not destroy a previously approved plan
 *
 * Route: /Architect?id=<rag_app_id>
 * Requires auth.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, ArrowLeft, ArrowRight, Upload, FileText,
  Zap, CheckCircle, RefreshCw, Edit3, ChevronDown,
  ChevronUp, AlertCircle, Cpu, Scissors, Search,
  MessageSquare, BookOpen, TrendingUp, Lock, PlusCircle, Trash2,
} from 'lucide-react';
import { architectApi, documentsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';

const STEPS = { DESCRIBE: 0, QUESTIONS: 1, GENERATING: 2, REVIEW: 3, APPROVED: 4 };

// ─── UI sub-components ────────────────────────────────────────────────────────

function PlanSection({ icon: Icon, color, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="neon-border rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-[#13131f]/60 hover:bg-[#13131f]/90 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color }} />
          <span className="text-sm font-semibold text-slate-100 tracking-tight">{title}</span>
        </div>
        {open
          ? <ChevronUp size={13} className="text-slate-400" />
          : <ChevronDown size={13} className="text-slate-400" />}
      </button>
      {open && <div className="px-5 py-4 bg-[#09090f]/50">{children}</div>}
    </div>
  );
}

function Val({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-800/50 last:border-0">
      <span className="text-xs text-slate-500 font-mono uppercase tracking-widest flex-shrink-0">{label}</span>
      <span className="text-xs text-slate-100 text-right font-mono">{String(value)}</span>
    </div>
  );
}

function Reason({ text }) {
  return (
    <p className="mt-2 text-xs text-violet-300/80 leading-relaxed italic border-l-2 border-violet-500/30 pl-3">
      {text}
    </p>
  );
}

// Full plan display — used in both REVIEW and APPROVED steps
function PlanDisplay({ plan, planVersion, statusLabel, statusColor }) {
  return (
    <div className="space-y-4">
      {/* Plan header */}
      <div className="neon-border rounded-2xl bg-[#13131f]/80 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs uppercase tracking-wide" style={{ color: statusColor }}>
                v{planVersion} · {statusLabel}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">{plan.domain}</h2>
            <p className="text-slate-400 text-sm mt-1">{plan.use_case}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0 ml-4">
            <Cpu size={16} className="text-violet-300" />
          </div>
        </div>
        <p className="mt-4 text-slate-400 text-sm leading-relaxed border-l-2 border-violet-500/40 pl-3">
          {plan.summary}
        </p>
      </div>

      {/* Knowledge Profile */}
      <PlanSection icon={BookOpen} color="#7c3aed" title="Knowledge Profile">
        <Val label="Documents" value={plan.knowledge_profile.document_count} />
        <Val label="Types" value={(plan.knowledge_profile.document_types || []).join(', ') || '—'} />
        <Val label="Structure" value={plan.knowledge_profile.structure || '—'} />
        <Val label="Language" value={plan.knowledge_profile.language || 'English'} />
        {plan.knowledge_profile.notes && (
          <p className="text-xs text-violet-400/80 mt-2 italic leading-relaxed">
            {plan.knowledge_profile.notes}
          </p>
        )}
      </PlanSection>

      {/* Chunking */}
      <PlanSection icon={Scissors} color="#6ee7b7" title="Chunking Strategy">
        <Val label="Strategy" value={plan.chunking.strategy} />
        <Val label="Chunk Size" value={`${plan.chunking.chunk_size} chars`} />
        <Val label="Overlap" value={`${plan.chunking.chunk_overlap} chars`} />
        <Reason text={plan.chunking.reason} />
      </PlanSection>

      {/* Embedding */}
      <PlanSection icon={Sparkles} color="#c4b5fd" title="Embedding Configuration">
        <Val label="Model" value={plan.embedding.model} />
        <Val label="Dimension" value={plan.embedding.dimension} />
        <Reason text={plan.embedding.reason} />
      </PlanSection>

      {/* Retrieval */}
      <PlanSection icon={Search} color="#a78bfa" title="Retrieval Configuration">
        <Val label="Strategy" value={plan.retrieval.active_strategy} />
        <Val label="Metric" value={plan.retrieval.similarity_metric} />
        <Val label="Top-K" value={plan.retrieval.top_k} />
        <Val label="Reranking" value="disabled" />
        <Reason text={plan.retrieval.reason} />
      </PlanSection>

      {/* Generation */}
      <PlanSection icon={MessageSquare} color="#93c5fd" title="Generation Behavior">
        <Val
          label="Grounding"
          value={plan.generation.grounding_required
            ? 'Strict (uploaded knowledge only)'
            : 'Flexible (general knowledge allowed)'}
        />
        <Val label="Response Style" value={plan.generation.response_style} />
        <Reason text={plan.generation.reason} />
      </PlanSection>

      {/* Future Recommendations */}
      {plan.future_recommendations?.length > 0 && (
        <PlanSection
          icon={TrendingUp}
          color="#6b7280"
          title={`Future Recommendations (${plan.future_recommendations.length})`}
          defaultOpen={false}
        >
          <p className="text-xs text-slate-400 mb-3">
            These features could improve this use case but are not yet implemented in the current runtime.
          </p>
          {plan.future_recommendations.map((rec, i) => (
            <div key={i} className="py-2 border-b border-slate-800/50 last:border-0">
              <p className="text-xs text-slate-400 font-mono">{rec.feature}</p>
              <p className="text-xs text-slate-400 mt-0.5">{rec.reason}</p>
            </div>
          ))}
        </PlanSection>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Architect() {
  const navigate = useNavigate();
  const ragAppId = new URLSearchParams(window.location.search).get('id');
  const fileInputRef = useRef(null);

  // Flow state
  const [step, setStep]               = useState(STEPS.DESCRIBE);
  const [requirement, setRequirement] = useState('');
  const [charCount, setCharCount]     = useState(0);

  // Documents
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [uploading, setUploading]       = useState(false);

  // Analysis
  const [knowledgeProfile, setKnowledgeProfile] = useState(null);
  const [questions, setQuestions]               = useState([]);
  const [answers, setAnswers]                   = useState({});

  // Plan
  const [plan, setPlan]           = useState(null);
  const [planVersion, setPlanVersion] = useState(0);
  const [planStatus, setPlanStatus]   = useState('pending');

  // UI
  const [error, setError]                     = useState('');
  const [analyzeLoading, setAnalyzeLoading]   = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [approveLoading, setApproveLoading]   = useState(false);
  const [indexingAll, setIndexingAll]         = useState(false);
  const [buildPipelineLoading, setBuildPipelineLoading] = useState(false);
  const [buildStage, setBuildStage]           = useState(''); // 'workflow' | 'indexing' | ''
  const [showNewVersionConfirm, setShowNewVersionConfirm] = useState(false);

  // Restore state from backend on mount
  useEffect(() => {
    if (!ragAppId) return;
    restoreState();
    loadDocuments();
  }, [ragAppId]);

  const restoreState = async () => {
    try {
      const state = await architectApi.get(ragAppId);
      if (state.architect_plan) {
        setPlan(state.architect_plan);
        setPlanVersion(state.architect_version);
        setPlanStatus(state.architect_status);
        if (state.architect_status === 'approved') {
          setStep(STEPS.APPROVED);
        } else if (state.architect_status === 'ready') {
          setStep(STEPS.REVIEW);
        }
      }
    } catch { /* new app */ }
  };

  const loadDocuments = async () => {
    try {
      const docs = await documentsApi.list(ragAppId);
      // Show all non-error documents: profiled (ready for Architect) + indexed (final chunks exist)
      setUploadedDocs(docs.filter(d => ['profiled', 'indexing', 'indexed'].includes(d.status)));
    } catch { /* ignore */ }
  };

  // ── Document upload ──────────────────────────────────────────────────────────

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setError('');
    for (const file of files) {
      try {
        const result = await documentsApi.upload(file, ragAppId, 'architect-onboarding');
        setUploadedDocs(prev => [...prev, {
          id: result.id,
          file_name: result.file_name,
          size_bytes: result.size_bytes,
          chunk_count: result.chunk_count,
          status: result.status,
        }]);
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
    setUploading(false);
    e.target.value = '';
  };

  // ── Individual document removal ─────────────────────────────────────────────
  // Deletes only the selected document: chunks + Storage object + documents row.
  // Other documents belonging to this rag_app are NOT affected.

  const removeDoc = async (docId) => {
    try {
      await documentsApi.delete(docId);
      setUploadedDocs(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      setError(`Failed to remove document: ${err.message}`);
    }
  };

  // ── Step 1 → 2/3: Analyze ───────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!requirement.trim()) { setError('Please describe your chatbot.'); return; }
    setAnalyzeLoading(true);
    setError('');
    try {
      const result = await architectApi.analyze(ragAppId, requirement);
      setKnowledgeProfile(result.knowledge_profile);
      if (result.needs_clarification && result.questions.length > 0) {
        setQuestions(result.questions);
        setStep(STEPS.QUESTIONS);
      } else {
        await handleGenerate(result.knowledge_profile, []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzeLoading(false);
    }
  };

  // ── Step 2/3 → 4: Generate ──────────────────────────────────────────────────

  const handleGenerate = async (profile = knowledgeProfile, answerList = null) => {
    const finalAnswers = answerList ?? Object.entries(answers).map(([qId, ans]) => ({
      question_id: qId, answer: ans,
    }));
    setStep(STEPS.GENERATING);
    setGenerateLoading(true);
    setError('');
    try {
      const result = await architectApi.plan(ragAppId, requirement, finalAnswers, profile);
      setPlan(result.plan);
      setPlanVersion(result.architect_version);
      setPlanStatus(result.architect_status);
      setStep(STEPS.REVIEW);
    } catch (err) {
      setError(err.message);
      // Restore previous step; if there was an approved plan restore it
      if (planStatus === 'approved' && plan) {
        setStep(STEPS.APPROVED);
      } else {
        setStep(questions.length > 0 ? STEPS.QUESTIONS : STEPS.DESCRIBE);
      }
    } finally {
      setGenerateLoading(false);
      setShowNewVersionConfirm(false);
    }
  };

  // ── Approve ──────────────────────────────────────────────────────────────────
  // Phase 8: Approval only freezes the plan (architect_status = 'approved').
  // Indexing + workflow generation now happens via handleBuildPipeline.

  const handleApprove = async () => {
    setApproveLoading(true);
    setError('');
    try {
      await architectApi.approve(ragAppId);
      setPlanStatus('approved');
      setStep(STEPS.APPROVED);
    } catch (err) {
      setError(err.message);
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Regenerate (from REVIEW) ─────────────────────────────────────────────────

  const handleRegenerate = async () => {
    await handleGenerate(knowledgeProfile);
  };

  // ── Build RAG Pipeline (from APPROVED) ───────────────────────────────────────
  // Phase 8: Materializes workflow nodes + indexes all documents using approved plan.
  // Called after approval. Navigates to Editor on success.

  const handleBuildPipeline = async () => {
    setBuildPipelineLoading(true);
    setBuildStage('workflow');
    setError('');
    try {
      setBuildStage('indexing');
      const result = await architectApi.buildPipeline(ragAppId);

      if (result.indexing?.errors?.length > 0) {
        setError(`Pipeline built. Indexing warnings: ${result.indexing.errors.join('; ')}`);
      }

      // Reload document list to reflect indexed statuses
      await loadDocuments();

      setBuildStage('opening');
      // Brief pause so user can see "Opening editor..." before navigation
      await new Promise(r => setTimeout(r, 600));

      navigate(createPageUrl(`Editor?id=${ragAppId}`));
    } catch (err) {
      setError(`Pipeline build failed: ${err.message}`);
    } finally {
      setBuildPipelineLoading(false);
      setBuildStage('');
    }
  };

  // ── Create new version (from APPROVED — deliberate action) ───────────────────

  const handleCreateNewVersion = async () => {
    setShowNewVersionConfirm(false);
    setQuestions([]);
    setAnswers({});
    setStep(STEPS.DESCRIBE);
    setError('');
    // Keep plan/version visible in state so if the user cancels they can see what was approved
  };

  const handleEditRequirements = () => {
    setStep(STEPS.DESCRIBE);
    setQuestions([]);
    setAnswers({});
    setError('');
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const formatSize = (b) =>
    b < 1024 * 1024
      ? `${(b / 1024).toFixed(1)} KB`
      : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#09090f]">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-purple-600/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>

        {/* Back nav */}
        <button
          onClick={() => navigate(createPageUrl('Dashboard'))}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-200 text-sm mb-8 transition-colors font-medium"
        >
          <ArrowLeft size={14} /> Dashboard
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center ">
            <Cpu size={18} className="text-slate-100" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">AI RAG Architect</h1>
            <p className="text-slate-500 text-sm mt-0.5">Design your optimal RAG pipeline</p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            {error}
            <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
          </div>
        )}

        {/* ── STEP 0: Describe + Upload ─────────────────────────────────────── */}
        {step === STEPS.DESCRIBE && (
          <div className="space-y-6">
            {/* Show previous approved plan as reminder when creating a new version */}
            {plan && planStatus === 'approved' && (
              <div className="px-4 py-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle size={13} className="flex-shrink-0" />
                <span>Creating new version. Current approved plan is v{planVersion} — it will only be replaced after a successful generation.</span>
              </div>
            )}

            <div className="neon-border rounded-2xl bg-[#13131f]/80 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-violet-500/10 bg-violet-950/20">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-slate-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
                <span className="font-mono text-xs text-slate-400 ml-2">requirement.describe</span>
              </div>
              <div className="p-6">
                <label className="block font-mono text-xs text-slate-400 uppercase tracking-wider mb-2">
                  Describe your assistant
                </label>
                <div className="relative">
                  <textarea
                    value={requirement}
                    onChange={e => { setRequirement(e.target.value); setCharCount(e.target.value.length); }}
                    placeholder="e.g. A customer support chatbot for my saree e-commerce store that answers questions about products, shipping, returns, and policies. Accuracy is more important than speed."
                    rows={5}
                    className="w-full px-4 py-3 bg-slate-900/60 border border-violet-500/15 rounded-xl text-slate-100 text-sm font-mono focus:border-violet-500/50 focus:outline-none resize-none placeholder:text-slate-500 leading-relaxed"
                  />
                  <span className="absolute bottom-3 right-3 font-mono text-xs text-slate-400">{charCount}</span>
                </div>
              </div>
            </div>

            {/* Knowledge sources */}
            <div className="neon-border rounded-2xl bg-[#13131f]/80 overflow-hidden">
              <div className="px-6 py-4 border-b border-violet-500/10">
                <h2 className="text-sm font-semibold text-slate-200">Knowledge Sources</h2>
                <p className="text-slate-400 text-xs mt-0.5">Upload documents for the Architect to analyze (optional but recommended)</p>
              </div>
              <div className="p-6">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.csv,.md"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-6 rounded-xl border border-dashed border-violet-500/35 bg-violet-600/5 hover:bg-violet-600/10 transition-colors flex flex-col items-center gap-2 cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-violet-300 font-mono">Uploading & profiling...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={20} className="text-violet-300" />
                      <span className="text-sm text-slate-400">Click to upload files</span>
                      <span className="text-xs text-slate-400 font-mono">PDF, DOCX, TXT, CSV</span>
                    </>
                  )}
                </button>

                {uploadedDocs.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {uploadedDocs.map(doc => {
                      const statusLabel = {
                        profiled:  { text: 'profiled', color: 'text-violet-300' },
                        indexing:  { text: 'indexing...', color: 'text-violet-400' },
                        indexed:   { text: 'indexed', color: 'text-emerald-400' },
                      }[doc.status] || { text: doc.status, color: 'text-slate-400' };
                      return (
                        <div key={doc.id} className="flex items-center gap-3 px-3 py-2 bg-slate-900/60 border border-violet-500/15 rounded-lg">
                          <FileText size={12} className="text-violet-300 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-100 truncate">{doc.file_name}</p>
                            <p className="text-xs text-slate-400 font-mono">
                              {formatSize(doc.size_bytes)}
                              {doc.chunk_count > 0 ? ` · ${doc.chunk_count} chunks` : ''}
                            </p>
                          </div>
                          <span className={`text-xs font-mono flex-shrink-0 ${statusLabel.color}`}>
                            {statusLabel.text}
                          </span>
                          <button
                            onClick={() => removeDoc(doc.id)}
                            className="ml-1 p-1 rounded text-slate-400 hover:text-red-400 transition-colors flex-shrink-0"
                            title="Remove document"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={analyzeLoading || !requirement.trim()}
              className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                analyzeLoading || !requirement.trim()
                  ? 'bg-[#1a1a2e] text-slate-500 cursor-not-allowed'
                  : 'bg-violet-600 text-slate-100  hover:opacity-90'
              }`}
            >
              {analyzeLoading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analyzing...</>
                : <><Zap size={15} /> Analyze & Continue <ArrowRight size={14} /></>}
            </button>
          </div>
        )}

        {/* ── STEP 1: Follow-up Questions ──────────────────────────────────── */}
        {step === STEPS.QUESTIONS && (
          <div className="space-y-6">
            <div className="neon-border rounded-2xl bg-[#13131f]/80 p-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={15} className="text-violet-300" />
                <h2 className="text-sm font-semibold text-slate-200">A few clarifying questions</h2>
                <span className="ml-auto font-mono text-xs text-slate-400">
                  {questions.length} question{questions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                These answers help the Architect tailor the configuration to your specific needs.
              </p>
              <div className="space-y-6">
                {questions.map((q, i) => (
                  <div key={q.id}>
                    <label className="block text-sm text-slate-100 mb-3">
                      <span className="font-mono text-violet-300 mr-2">{i + 1}.</span>{q.question}
                    </label>
                    {q.type === 'single_choice' && q.options?.length > 0 ? (
                      <div className="space-y-2">
                        {q.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                            className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                              answers[q.id] === opt
                                ? 'border-violet-500/50 bg-violet-600/15 text-violet-200'
                                : 'border-violet-500/15 bg-slate-900/60 text-slate-400 hover:border-violet-500/30'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={answers[q.id] || ''}
                        onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                        placeholder="Your answer..."
                        className="w-full px-4 py-2.5 bg-slate-900/60 border border-violet-500/15 rounded-lg text-slate-100 text-sm focus:border-violet-500/50 focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleEditRequirements}
                className="py-3 px-5 rounded-xl border border-violet-500/15 text-slate-400 text-sm hover:border-violet-500/30 transition-colors"
              >
                <ArrowLeft size={13} className="inline mr-1" /> Back
              </button>
              <button
                onClick={() => handleGenerate()}
                disabled={generateLoading}
                className="flex-1 py-3 rounded-xl bg-violet-600 text-slate-100 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {generateLoading
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating...</>
                  : <><Cpu size={14} /> Generate Architecture Plan</>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Generating ───────────────────────────────────────────── */}
        {step === STEPS.GENERATING && (
          <div className="neon-border rounded-2xl bg-[#13131f]/80 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/30 to-violet-700/30 border border-violet-500/30 flex items-center justify-center mx-auto mb-6">
              <Cpu size={28} className="text-violet-300 animate-pulse" />
            </div>
            <h2 className="text-lg font-bold text-slate-100 mb-2">Generating Architecture Plan</h2>
            <p className="text-slate-400 text-sm mb-6">Analyzing your requirements and knowledge base...</p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {['Profiling documents', 'Selecting chunking strategy', 'Configuring retrieval', 'Writing explanations'].map((label, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"
                    style={{ animationDelay: `${i * 0.3}s` }}
                  />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3: Plan Review ──────────────────────────────────────────── */}
        {step === STEPS.REVIEW && plan && (
          <div className="space-y-4">
            <PlanDisplay
              plan={plan}
              planVersion={planVersion}
              statusLabel="ready for review"
              statusColor="#7c3aed"
            />

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleEditRequirements}
                className="py-3 px-4 rounded-xl border border-violet-500/15 text-slate-400 text-sm hover:border-violet-500/30 transition-colors flex items-center gap-1.5"
              >
                <Edit3 size={13} /> Edit Requirements
              </button>
              <button
                onClick={handleRegenerate}
                disabled={generateLoading}
                className="py-3 px-4 rounded-xl border border-violet-500/30 text-violet-300 text-sm hover:bg-violet-600/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={13} className={generateLoading ? 'animate-spin' : ''} />
                Regenerate
              </button>
              <button
                onClick={handleApprove}
                disabled={approveLoading}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                {approveLoading
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Approving...</>
                  : <><CheckCircle size={14} /> Approve Plan</>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Approved — full plan remains visible ─────────────────── */}
        {step === STEPS.APPROVED && plan && (
          <div className="space-y-4">
            {/* Approval status banner */}
            <div className="neon-border rounded-xl bg-emerald-900/10 border-emerald-500/25 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-emerald-900/10">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                  <Lock size={13} className="text-emerald-300" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-300">Approved Architect Plan — v{planVersion}</p>
                  <p className="text-xs text-emerald-500 mt-0.5">
                    Plan locked. Click "Build RAG Pipeline" to generate the workflow and index your knowledge.
                  </p>
                </div>
              </div>
            </div>

            {/* Build progress banner — shown while building */}
            {buildPipelineLoading && (
              <div className="neon-border rounded-xl bg-violet-900/10 border-violet-500/25 p-4 flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-violet-300">
                    {buildStage === 'workflow'  && 'Building workflow...'}
                    {buildStage === 'indexing'  && 'Indexing knowledge...'}
                    {buildStage === 'opening'   && 'Opening editor...'}
                    {!buildStage && 'Building pipeline...'}
                  </p>
                  <p className="text-xs text-violet-400 mt-0.5 font-mono">
                    {buildStage === 'workflow'  && 'Generating nodes from approved plan'}
                    {buildStage === 'indexing'  && 'Chunking + embedding documents with approved config'}
                    {buildStage === 'opening'   && 'Pipeline ready — navigating to editor'}
                    {!buildStage && 'Please wait...'}
                  </p>
                </div>
              </div>
            )}

            {/* Full plan displayed read-only */}
            <PlanDisplay
              plan={plan}
              planVersion={planVersion}
              statusLabel="approved"
              statusColor="#6ee7b7"
            />

            {/* New version confirmation */}
            {showNewVersionConfirm ? (
              <div className="neon-border rounded-xl bg-amber-900/10 border-violet-500/30 25 p-5">
                <p className="text-sm font-semibold text-amber-300 mb-1">Create a new version?</p>
                <p className="text-xs text-violet-400/80 mb-4 leading-relaxed">
                  This will start a new onboarding flow. The current approved plan (v{planVersion}) will only be
                  replaced after you generate and approve a new plan. Until then, v{planVersion} remains active.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowNewVersionConfirm(false)}
                    className="flex-1 py-2.5 rounded-lg border border-violet-500/15 text-slate-400 text-sm hover:border-violet-500/30 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateNewVersion}
                    className="flex-1 py-2.5 rounded-lg bg-amber-600/20 border border-violet-500/30 30 text-amber-300 text-sm font-semibold hover:bg-amber-600/30 transition-colors"
                  >
                    Yes, create new version
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => navigate(createPageUrl('Dashboard'))}
                  className="py-3 px-5 rounded-xl border border-violet-500/15 text-slate-400 text-sm hover:border-violet-500/30 transition-colors"
                  disabled={buildPipelineLoading}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setShowNewVersionConfirm(true)}
                  disabled={buildPipelineLoading}
                  className="py-3 px-4 rounded-xl border border-violet-500/30 25 text-violet-400 text-sm hover:bg-amber-600/10 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                >
                  <PlusCircle size={13} /> New Version
                </button>
                <button
                  onClick={handleBuildPipeline}
                  disabled={buildPipelineLoading}
                  className="flex-1 py-3 rounded-xl bg-violet-600 text-slate-100 text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {buildPipelineLoading ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {buildStage === 'workflow' && 'Building workflow...'}
                      {buildStage === 'indexing' && 'Indexing knowledge...'}
                      {buildStage === 'opening'  && 'Opening editor...'}
                      {!buildStage && 'Building...'}
                    </>
                  ) : (
                    <><Zap size={14} /> Build RAG Pipeline</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
