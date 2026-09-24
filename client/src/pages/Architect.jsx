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
import { useAppTheme } from '@/lib/ThemeContext';

const STEPS = { DESCRIBE: 0, QUESTIONS: 1, GENERATING: 2, REVIEW: 3, APPROVED: 4 };

// ─── UI sub-components ────────────────────────────────────────────────────────

function PlanSection({ icon: Icon, color, title, children, defaultOpen = true, C }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', background: C.bgSub, border: 'none', cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = C.surfaceHi}
        onMouseLeave={e => e.currentTarget.style.background = C.bgSub}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} style={{ color }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.t1, letterSpacing: '-0.01em' }}>{title}</span>
        </div>
        {open
          ? <ChevronUp size={13} style={{ color: C.t3 }} />
          : <ChevronDown size={13} style={{ color: C.t3 }} />}
      </button>
      {open && <div style={{ padding: '14px 20px', background: C.surface }}>{children}</div>}
    </div>
  );
}

function Val({ label, value, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: C.t1, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{String(value)}</span>
    </div>
  );
}

function Reason({ text, C }) {
  return (
    <p style={{ marginTop: 8, fontSize: 12, color: C.accentLt, lineHeight: 1.6, fontStyle: 'italic', borderLeft: `2px solid ${C.borderHi}`, paddingLeft: 12, opacity: 0.85 }}>
      {text}
    </p>
  );
}

// Full plan display — used in both REVIEW and APPROVED steps
function PlanDisplay({ plan, planVersion, statusLabel, statusColor }) {
  const { C } = useAppTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Plan header */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: statusColor }}>
                v{planVersion} · {statusLabel}
              </span>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.t1, letterSpacing: '-0.01em', margin: 0 }}>{plan.domain}</h2>
            <p style={{ color: C.t2, fontSize: 13, marginTop: 4 }}>{plan.use_case}</p>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.accentBg, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}>
            <Cpu size={16} color={C.accentLt} />
          </div>
        </div>
        <p style={{ marginTop: 16, color: C.t2, fontSize: 13, lineHeight: 1.65, borderLeft: `2px solid ${C.borderHi}`, paddingLeft: 12 }}>
          {plan.summary}
        </p>
      </div>

      {/* Knowledge Profile */}
      <PlanSection icon={BookOpen} color="#7c3aed" title="Knowledge Profile" C={C}>
        <Val label="Documents" value={plan.knowledge_profile.document_count} C={C} />
        <Val label="Types" value={(plan.knowledge_profile.document_types || []).join(', ') || '—'} C={C} />
        <Val label="Structure" value={plan.knowledge_profile.structure || '—'} C={C} />
        <Val label="Language" value={plan.knowledge_profile.language || 'English'} C={C} />
        {plan.knowledge_profile.notes && (
          <p style={{ fontSize: 11, color: C.accentLt, marginTop: 8, fontStyle: 'italic', lineHeight: 1.6, opacity: 0.85 }}>
            {plan.knowledge_profile.notes}
          </p>
        )}
      </PlanSection>

      {/* Chunking */}
      <PlanSection icon={Scissors} color="#6ee7b7" title="Chunking Strategy" C={C}>
        <Val label="Strategy" value={plan.chunking.strategy} C={C} />
        <Val label="Chunk Size" value={`${plan.chunking.chunk_size} chars`} C={C} />
        <Val label="Overlap" value={`${plan.chunking.chunk_overlap} chars`} C={C} />
        <Reason text={plan.chunking.reason} C={C} />
      </PlanSection>

      {/* Embedding */}
      <PlanSection icon={Sparkles} color="#c4b5fd" title="Embedding Configuration" C={C}>
        <Val label="Model" value={plan.embedding.model} C={C} />
        <Val label="Dimension" value={plan.embedding.dimension} C={C} />
        <Reason text={plan.embedding.reason} C={C} />
      </PlanSection>

      {/* Retrieval */}
      <PlanSection icon={Search} color="#a78bfa" title="Retrieval Configuration" C={C}>
        <Val label="Strategy" value={plan.retrieval.active_strategy} C={C} />
        <Val label="Metric" value={plan.retrieval.similarity_metric} C={C} />
        <Val label="Top-K" value={plan.retrieval.top_k} C={C} />
        <Val label="Reranking" value="disabled" C={C} />
        <Reason text={plan.retrieval.reason} C={C} />
      </PlanSection>

      {/* Generation */}
      <PlanSection icon={MessageSquare} color="#93c5fd" title="Generation Behavior" C={C}>
        <Val
          label="Grounding"
          value={plan.generation.grounding_required
            ? 'Strict (uploaded knowledge only)'
            : 'Flexible (general knowledge allowed)'}
          C={C}
        />
        <Val label="Response Style" value={plan.generation.response_style} C={C} />
        <Reason text={plan.generation.reason} C={C} />
      </PlanSection>

      {/* Future Recommendations */}
      {plan.future_recommendations?.length > 0 && (
        <PlanSection
          icon={TrendingUp}
          color={C.t3}
          title={`Future Recommendations (${plan.future_recommendations.length})`}
          defaultOpen={false}
          C={C}
        >
          <p style={{ fontSize: 12, color: C.t2, marginBottom: 12 }}>
            These features could improve this use case but are not yet implemented in the current runtime.
          </p>
          {plan.future_recommendations.map((rec, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 11, color: C.t2, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>{rec.feature}</p>
              <p style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{rec.reason}</p>
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
  const { C } = useAppTheme();

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
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'Plus Jakarta Sans, sans-serif' }} className="grid-bg">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-purple-600/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>

        {/* Back nav */}
        <button
          onClick={() => navigate(createPageUrl('Dashboard'))}
          style={{ color: C.t2, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 32 }}
          onMouseEnter={e => e.currentTarget.style.color = C.t1}
          onMouseLeave={e => e.currentTarget.style.color = C.t2}
        >
          <ArrowLeft size={14} /> Dashboard
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
            <Cpu size={18} className="text-slate-100" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.t1, letterSpacing: '-0.02em', margin: 0 }}>AI RAG Architect</h1>
            <p style={{ color: C.t2, fontSize: 13, marginTop: 2 }}>Design your optimal RAG pipeline</p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ marginBottom: 24, padding: '10px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            {error}
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13 }}>✕</button>
          </div>
        )}

        {/* ── STEP 0: Describe + Upload ─────────────────────────────────────── */}
        {step === STEPS.DESCRIBE && (
          <div className="space-y-6">
            {/* Show previous approved plan as reminder when creating a new version */}
            {plan && planStatus === 'approved' && (
              <div style={{ padding: '10px 16px', borderRadius: 12, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', color: '#6ee7b7', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={13} style={{ flexShrink: 0 }} />
                <span>Creating new version. Current approved plan is v{planVersion} — it will only be replaced after a successful generation.</span>
              </div>
            )}

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: `1px solid ${C.border}`, background: C.bgSub }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(239,68,68,0.7)' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(100,116,139,0.5)' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(34,197,94,0.7)' }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3, marginLeft: 8 }}>requirement.describe</span>
              </div>
              <div style={{ padding: 24 }}>
                <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.t3, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  Describe your assistant
                </label>
                <div style={{ position: 'relative' }}>
                  <textarea
                    value={requirement}
                    onChange={e => { setRequirement(e.target.value); setCharCount(e.target.value.length); }}
                    placeholder="e.g. A customer support chatbot for my saree e-commerce store that answers questions about products, shipping, returns, and policies. Accuracy is more important than speed."
                    rows={5}
                    style={{
                      width: '100%', padding: '12px 16px',
                      background: C.input, border: `1px solid ${C.inputBorder}`,
                      borderRadius: 12, color: C.t1, fontSize: 13,
                      fontFamily: 'JetBrains Mono, monospace',
                      outline: 'none', resize: 'none', lineHeight: 1.65, boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = C.borderHi}
                    onBlur={e => e.target.style.borderColor = C.inputBorder}
                  />
                  <span style={{ position: 'absolute', bottom: 12, right: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3 }}>{charCount}</span>
                </div>
              </div>
            </div>

            {/* Knowledge sources */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}` }}>
                <h2 style={{ color: C.t1, fontWeight: 600, fontSize: 14, margin: 0 }}>Knowledge Sources</h2>
                <p style={{ color: C.t2, fontSize: 12, marginTop: 3 }}>Upload documents for the Architect to analyze (optional but recommended)</p>
              </div>
              <div style={{ padding: 24 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.csv,.md"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{
                    width: '100%', padding: '24px 0',
                    borderRadius: 12, border: `2px dashed ${C.borderHi}`,
                    background: C.accentBg, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = `rgba(124,58,237,0.14)`}
                  onMouseLeave={e => e.currentTarget.style.background = C.accentBg}
                >
                  {uploading ? (
                    <>
                      <div style={{ width: 20, height: 20, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      <span style={{ fontSize: 12, color: C.accentLt, fontFamily: 'JetBrains Mono, monospace' }}>Uploading & profiling...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={20} color={C.accentLt} />
                      <span style={{ fontSize: 13, color: C.t2 }}>Click to upload files</span>
                      <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>PDF, DOCX, TXT, CSV</span>
                    </>
                  )}
                </button>

                {uploadedDocs.length > 0 && (
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {uploadedDocs.map(doc => {
                      const statusMeta = {
                        profiled: { text: 'profiled', color: C.accentLt },
                        indexing: { text: 'indexing...', color: C.accentLt },
                        indexed:  { text: 'indexed', color: C.green },
                      }[doc.status] || { text: doc.status, color: C.t3 };
                      return (
                        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: C.bgSub, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                          <FileText size={12} color={C.accentLt} style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, color: C.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{doc.file_name}</p>
                            <p style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                              {formatSize(doc.size_bytes)}{doc.chunk_count > 0 ? ` · ${doc.chunk_count} chunks` : ''}
                            </p>
                          </div>
                          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: statusMeta.color, flexShrink: 0 }}>
                            {statusMeta.text}
                          </span>
                          <button
                            onClick={() => removeDoc(doc.id)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.t3, padding: 4, borderRadius: 4, flexShrink: 0 }}
                            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={e => e.currentTarget.style.color = C.t3}
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
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12,
                fontWeight: 700, fontSize: 14, cursor: analyzeLoading || !requirement.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.15s',
                background: analyzeLoading || !requirement.trim() ? C.surface : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                border: analyzeLoading || !requirement.trim() ? `1px solid ${C.border}` : 'none',
                color: analyzeLoading || !requirement.trim() ? C.t3 : '#fff',
                boxShadow: analyzeLoading || !requirement.trim() ? 'none' : '0 0 20px rgba(124,58,237,0.3)',
              }}
            >
              {analyzeLoading
                ? <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Analyzing...</>
                : <><Zap size={15} /> Analyze & Continue <ArrowRight size={14} /></>}
            </button>
          </div>
        )}

        {/* ── STEP 1: Follow-up Questions ──────────────────────────────────── */}
        {step === STEPS.QUESTIONS && (
          <div className="space-y-6">
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <MessageSquare size={15} color={C.accentLt} />
                <h2 style={{ fontSize: 14, fontWeight: 600, color: C.t1, margin: 0 }}>A few clarifying questions</h2>
                <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3 }}>
                  {questions.length} question{questions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p style={{ color: C.t2, fontSize: 12, marginBottom: 24, lineHeight: 1.6 }}>
                These answers help the Architect tailor the configuration to your specific needs.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {questions.map((q, i) => (
                  <div key={q.id}>
                    <label style={{ display: 'block', fontSize: 13, color: C.t1, marginBottom: 12, lineHeight: 1.5 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.accentLt, marginRight: 8 }}>{i + 1}.</span>{q.question}
                    </label>
                    {q.type === 'single_choice' && q.options?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {q.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                            style={{
                              width: '100%', textAlign: 'left', padding: '10px 14px',
                              borderRadius: 8, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                              border: `1px solid ${answers[q.id] === opt ? C.borderHi : C.border}`,
                              background: answers[q.id] === opt ? C.accentBg : C.bgSub,
                              color: answers[q.id] === opt ? C.accentLt : C.t2,
                            }}
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
                        style={{
                          width: '100%', padding: '10px 14px',
                          background: C.input, border: `1px solid ${C.inputBorder}`,
                          borderRadius: 8, color: C.t1, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                        }}
                        onFocus={e => e.target.style.borderColor = C.borderHi}
                        onBlur={e => e.target.style.borderColor = C.inputBorder}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleEditRequirements}
                style={{
                  padding: '12px 20px', borderRadius: 12,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.t2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHi}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
              >
                <ArrowLeft size={13} /> Back
              </button>
              <button
                onClick={() => handleGenerate()}
                disabled={generateLoading}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: generateLoading ? C.surface : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  border: generateLoading ? `1px solid ${C.border}` : 'none',
                  color: generateLoading ? C.t3 : '#fff',
                  fontSize: 13, fontWeight: 700, cursor: generateLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: generateLoading ? 0.7 : 1,
                }}
              >
                {generateLoading
                  ? <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating...</>
                  : <><Cpu size={14} /> Generate Architecture Plan</>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Generating ───────────────────────────────────────────── */}
        {step === STEPS.GENERATING && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(124,58,237,0.15)', border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
              <Cpu size={28} color={C.accentLt} style={{ animation: 'pulse 2s ease-in-out infinite' }} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 8 }}>Generating Architecture Plan</h2>
            <p style={{ color: C.t2, fontSize: 13, marginBottom: 24 }}>Analyzing your requirements and knowledge base...</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
              {['Profiling documents', 'Selecting chunking strategy', 'Configuring retrieval', 'Writing explanations'].map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.t2, fontFamily: 'JetBrains Mono, monospace' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accentLt, animation: `bounce 1s ease-in-out ${i * 0.3}s infinite` }} />
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

            <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
              <button
                onClick={handleEditRequirements}
                style={{ padding: '12px 16px', borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.t2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHi}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
              >
                <Edit3 size={13} /> Edit Requirements
              </button>
              <button
                onClick={handleRegenerate}
                disabled={generateLoading}
                style={{ padding: '12px 16px', borderRadius: 12, border: `1px solid ${C.borderHi}`, background: 'transparent', color: C.accentLt, fontSize: 13, cursor: generateLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: generateLoading ? 0.5 : 1 }}
              >
                <RefreshCw size={13} style={{ animation: generateLoading ? 'spin 0.7s linear infinite' : 'none' }} />
                Regenerate
              </button>
              <button
                onClick={handleApprove}
                disabled={approveLoading}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: approveLoading ? C.surface : 'linear-gradient(135deg, #059669, #047857)',
                  border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: approveLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: approveLoading ? 0.7 : 1,
                }}
              >
                {approveLoading
                  ? <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Approving...</>
                  : <><CheckCircle size={14} /> Approve Plan</>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Approved — full plan remains visible ─────────────────── */}
        {step === STEPS.APPROVED && plan && (
          <div className="space-y-4">
            {/* Approval status banner */}
            <div style={{ background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.25)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(5,150,105,0.15)', border: '1px solid rgba(5,150,105,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Lock size={13} color="#34d399" />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#34d399', margin: 0 }}>Approved Architect Plan — v{planVersion}</p>
                  <p style={{ fontSize: 11, color: '#6ee7b7', marginTop: 2, opacity: 0.8 }}>
                    Plan locked. Click "Build RAG Pipeline" to generate the workflow and index your knowledge.
                  </p>
                </div>
              </div>
            </div>

            {/* Build progress banner */}
            {buildPipelineLoading && (
              <div style={{ background: C.accentBg, border: `1px solid ${C.borderHi}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 20, height: 20, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.accentLt, margin: 0 }}>
                    {buildStage === 'workflow'  && 'Building workflow...'}
                    {buildStage === 'indexing'  && 'Indexing knowledge...'}
                    {buildStage === 'opening'   && 'Opening editor...'}
                    {!buildStage && 'Building pipeline...'}
                  </p>
                  <p style={{ fontSize: 11, color: C.t2, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
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
              statusColor="#34d399"
            />

            {/* New version confirmation */}
            {showNewVersionConfirm ? (
              <div style={{ background: C.surface, border: `1px solid ${C.borderHi}`, borderRadius: 12, padding: 20 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 4 }}>Create a new version?</p>
                <p style={{ fontSize: 12, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
                  This will start a new onboarding flow. The current approved plan (v{planVersion}) will only be
                  replaced after you generate and approve a new plan.
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => setShowNewVersionConfirm(false)}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.t2, fontSize: 13, cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    onClick={handleCreateNewVersion}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'rgba(217,119,6,0.15)', border: `1px solid rgba(217,119,6,0.35)`, color: '#fbbf24', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >Yes, create new version</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
                <button
                  onClick={() => navigate(createPageUrl('Dashboard'))}
                  style={{ padding: '12px 20px', borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.t2, fontSize: 13, cursor: 'pointer' }}
                  disabled={buildPipelineLoading}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHi}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >Dashboard</button>
                <button
                  onClick={() => setShowNewVersionConfirm(true)}
                  disabled={buildPipelineLoading}
                  style={{ padding: '12px 16px', borderRadius: 12, border: `1px solid ${C.borderHi}`, background: 'transparent', color: C.accentLt, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: buildPipelineLoading ? 0.4 : 1 }}
                >
                  <PlusCircle size={13} /> New Version
                </button>
                <button
                  onClick={handleBuildPipeline}
                  disabled={buildPipelineLoading}
                  style={{
                    flex: 1, padding: '12px 0', borderRadius: 12,
                    background: buildPipelineLoading ? C.surface : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    border: buildPipelineLoading ? `1px solid ${C.border}` : 'none',
                    color: buildPipelineLoading ? C.t3 : '#fff',
                    fontSize: 13, fontWeight: 700, cursor: buildPipelineLoading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: buildPipelineLoading ? 0.7 : 1,
                  }}
                >
                  {buildPipelineLoading ? (
                    <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
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
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes bounce { 0%,100% { transform:translateY(0); opacity:0.5; } 50% { transform:translateY(-3px); opacity:1; } }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
    `}</style>
  );
}
