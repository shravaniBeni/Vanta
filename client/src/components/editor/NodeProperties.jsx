import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Settings, Upload, FileText, Trash2, AlertCircle, RefreshCw, ScanText, CheckCircle, Clock, XCircle, MessageSquare, Plus } from 'lucide-react';
import { documentsApi } from '@/api/apiClient';
import { useAppTheme } from '@/lib/ThemeContext';
import { createPageUrl } from '@/utils';

// inputStyle / labelStyle / selectStyle are now functions of C, called inside the component
function makeStyles(C) {
  const inputStyle = {
    width: '100%',
    padding: '7px 10px',
    background: C.input,
    border: `1px solid ${C.inputBorder}`,
    borderRadius: 7,
    color: C.t1,
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle = {
    fontSize: 10,
    fontWeight: 600,
    color: C.t2,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 5,
    display: 'block',
    fontFamily: 'JetBrains Mono, monospace',
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer' };
  return { inputStyle, labelStyle, selectStyle };
}

function Field({ label, children, C }) {
  const labelSt = {
    fontSize: 10, fontWeight: 600,
    color: C ? C.t2 : '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 5, display: 'block',
    fontFamily: 'JetBrains Mono, monospace',
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <span style={labelSt}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, C }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20,
        background: checked ? C.accent : C.bgSub,
        border: `1px solid ${checked ? C.accent : C.panelBorder}`,
        borderRadius: 10,
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.2s',
        flexShrink: 0,
        boxShadow: checked ? `0 0 10px ${C.accentBg}` : 'none'
      }}
    >
      <div style={{
        width: 14, height: 14,
        background: 'white',
        borderRadius: '50%',
        position: 'absolute',
        top: 2,
        left: checked ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ─── KnowledgeSourceManager ───────────────────────────────────────────────────
// Parts 7–11: Persistent, live document manager for the DocumentUpload node.
// Shows all documents for the chatbot, supports add/delete/reprocess.
// New uploads use the active workflow to determine OCR/indexing path.

function KnowledgeSourceManager({ chatbotId, C }) {
  const [docs, setDocs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState('');
  const fileInputRef              = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await documentsApi.list(chatbotId);
      setDocs(data || []);
    } catch (err) {
      setError('Failed to load documents: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => { load(); }, [load]);

  // Stats
  const indexed    = docs.filter(d => d.status === 'indexed');
  const reviewing  = docs.filter(d => d.status === 'needs_architecture_review');
  const processing = docs.filter(d => ['indexing','profiling','profiled','uploaded'].includes(d.status));
  const errored    = docs.filter(d => d.status === 'error');
  const totalChunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);

  // Upload new document — uses existing documents/upload route
  // The server determines OCR/indexing path from active workflow
  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setError('');
    for (const file of files) {
      try {
        await documentsApi.upload(file, chatbotId, 'knowledge-source');
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
    setUploading(false);
    e.target.value = '';
    await load();
  };

  // Delete document
  const handleDelete = async (docId) => {
    try {
      await documentsApi.delete(docId);
      setDocs(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  // Reprocess: re-index a document using current active workflow
  const handleReprocess = async (docId) => {
    setError('');
    try {
      await documentsApi.reprocess(docId);
      await load();
    } catch (err) {
      setError('Reprocess failed: ' + err.message);
    }
  };

  const formatSize = (b) => {
    if (!b) return '';
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Per-document status icon + color
  const statusInfo = (doc) => {
    switch (doc.status) {
      case 'indexed':
        return { icon: <CheckCircle size={10} />, color: C.green, label: `${doc.chunk_count || 0} chunks` };
      case 'needs_architecture_review':
        return { icon: <ScanText size={10} />, color: '#fbbf24', label: `${doc.profile_data?.classification ?? 'scanned'} · OCR required` };
      case 'indexing':
        return { icon: <RefreshCw size={10} style={{ animation:'spin 0.7s linear infinite' }} />, color: C.accentLt, label: 'indexing…' };
      case 'profiled':
        return { icon: <Clock size={10} />, color: C.t3, label: 'waiting for pipeline' };
      case 'error':
        return { icon: <XCircle size={10} />, color: '#ef4444', label: doc.error_message?.slice(0, 40) || 'error' };
      default:
        return { icon: <Clock size={10} />, color: C.t3, label: doc.status };
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Stats header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', background:C.bgSub, borderRadius:8, border:`1px solid ${C.border}` }}>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:C.t1 }}>Knowledge Source</div>
          <div style={{ fontSize:10, color:C.t3, fontFamily:'JetBrains Mono, monospace', marginTop:2 }}>
            {docs.length} document{docs.length !== 1 ? 's' : ''} · {totalChunks.toLocaleString()} chunks
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {indexed.length > 0 && (
            <span style={{ fontSize:9, color:C.green, fontFamily:'JetBrains Mono, monospace' }}>✓ {indexed.length} indexed</span>
          )}
          {reviewing.length > 0 && (
            <span style={{ fontSize:9, color:'#fbbf24', fontFamily:'JetBrains Mono, monospace' }}>⚠ {reviewing.length} OCR</span>
          )}
          <button onClick={load} title="Refresh" style={{ background:'transparent', border:'none', cursor:'pointer', color:C.t3, padding:2, borderRadius:4 }}
            onMouseEnter={e => e.currentTarget.style.color = C.t1}
            onMouseLeave={e => e.currentTarget.style.color = C.t3}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding:'6px 8px', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:6, display:'flex', alignItems:'center', gap:5 }}>
          <AlertCircle size={10} color="#ef4444" />
          <span style={{ fontSize:9, color:'#fca5a5', flex:1, fontFamily:'JetBrains Mono, monospace', lineHeight:1.4 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background:'transparent', border:'none', cursor:'pointer', color:'#ef4444', fontSize:10 }}>✕</button>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 0' }}>
          <div style={{ width:10, height:10, border:`2px solid ${C.accent}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
          <span style={{ fontSize:10, color:C.t3, fontFamily:'JetBrains Mono, monospace' }}>Loading…</span>
        </div>
      ) : docs.length === 0 ? (
        <p style={{ fontSize:10, color:C.t3, fontFamily:'JetBrains Mono, monospace', textAlign:'center', padding:'8px 0', margin:0 }}>
          No documents yet. Add some below.
        </p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:200, overflowY:'auto' }}>
          {docs.map(doc => {
            const si = statusInfo(doc);
            const canReprocess = ['error','needs_architecture_review','profiled'].includes(doc.status);
            return (
              <div key={doc.id} style={{
                display:'flex', alignItems:'flex-start', gap:7, padding:'7px 9px',
                background: doc.status === 'error' ? 'rgba(239,68,68,0.04)'
                          : doc.status === 'needs_architecture_review' ? 'rgba(251,191,36,0.04)'
                          : C.bgSub,
                border: `1px solid ${doc.status === 'error' ? 'rgba(239,68,68,0.2)'
                          : doc.status === 'needs_architecture_review' ? 'rgba(251,191,36,0.2)'
                          : C.border}`,
                borderRadius: 7,
              }}>
                <FileText size={11} color={si.color} style={{ flexShrink:0, marginTop:1 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:10, color:C.t1, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {doc.file_name}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:2 }}>
                    <span style={{ color:si.color }}>{si.icon}</span>
                    <span style={{ fontSize:9, color:si.color, fontFamily:'JetBrains Mono, monospace' }}>{si.label}</span>
                    {doc.size_bytes > 0 && (
                      <span style={{ fontSize:9, color:C.t3, fontFamily:'JetBrains Mono, monospace' }}>· {formatSize(doc.size_bytes)}</span>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                  {canReprocess && (
                    <button onClick={() => handleReprocess(doc.id)} title="Reprocess with current workflow"
                      style={{ background:'transparent', border:'none', cursor:'pointer', color:C.t3, padding:2, borderRadius:3 }}
                      onMouseEnter={e => e.currentTarget.style.color = C.accentLt}
                      onMouseLeave={e => e.currentTarget.style.color = C.t3}
                    >
                      <RefreshCw size={10} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(doc.id)} title="Remove document"
                    style={{ background:'transparent', border:'none', cursor:'pointer', color:C.t3, padding:2, borderRadius:3 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = C.t3}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add documents */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.csv"
          style={{ display:'none' }}
          onChange={handleUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            width:'100%', padding:'9px 0', borderRadius:8,
            border:`1px dashed ${C.borderHi}`, background:C.accentBg,
            cursor: uploading ? 'wait' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            color: C.accentLt, fontSize:11, fontWeight:600, transition:'all 0.15s',
          }}
          onMouseEnter={e => { if(!uploading) e.currentTarget.style.background = `rgba(109,40,217,0.14)`; }}
          onMouseLeave={e => e.currentTarget.style.background = C.accentBg}
        >
          {uploading ? (
            <>
              <div style={{ width:12, height:12, border:`2px solid ${C.accent}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
              Uploading…
            </>
          ) : (
            <><Plus size={12} /> Add documents</>
          )}
        </button>
        <p style={{ fontSize:8, color:C.t3, fontFamily:'JetBrains Mono, monospace', textAlign:'center', marginTop:4, lineHeight:1.4 }}>
          New documents use the current active workflow · PDF, DOCX, TXT, CSV
        </p>
      </div>
    </div>
  );
}

export default function NodeProperties({ node, chatbotId, onUpdate, onClose }) {
  const [params, setParams] = useState(node.params || {});
  const [uploading, setUploading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const fileInputRef = useRef(null);
  const { C } = useAppTheme();
  const { inputStyle, labelStyle, selectStyle } = makeStyles(C);

  // Rehydrate document list from backend when DocumentUpload node opens
  useEffect(() => {
    if (node.type === 'DocumentUpload' && chatbotId) {
      loadPersistedDocuments();
    }
  }, [node.id, chatbotId]);

  const loadPersistedDocuments = async () => {
    setDocsLoading(true);
    setDocsError('');
    try {
      const docs = await documentsApi.list(chatbotId);
      // Filter to this node's documents (or all if node_id is 'default')
      const nodeId = node.id;
      const filtered = docs.filter(d => d.node_id === nodeId || d.node_id === 'default');
      // Use whichever set is larger — node-specific or all
      const relevant = filtered.length > 0 ? filtered : docs;
      const uploaded = relevant.map(d => ({
        id:     d.id,
        name:   d.file_name,
        size:   d.size_bytes || 0,
        chunks: d.chunk_count || 0,
        status: d.status,
        error:  d.error_message,
      }));
      const newParams = { ...params, uploaded_files: uploaded };
      setParams(newParams);
      // Don't call onUpdate here — this is a read-only rehydration, not a user edit
    } catch (err) {
      console.error('[NodeProperties] failed to load documents:', err.message);
      setDocsError('Failed to load documents from server');
    } finally {
      setDocsLoading(false);
    }
  };

  const set = (key, value) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    onUpdate(node.id, newParams);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const uploaded = [...(params.uploaded_files || [])];
    for (const file of files) {
      try {
        const result = await documentsApi.upload(file, chatbotId, node.id);
        uploaded.push({
          name:    result.file_name || file.name,
          id:      result.id,
          size:    result.size_bytes || file.size,
          chunks:  result.chunk_count,
          status:  result.status,
        });
      } catch (err) {
        console.error('Upload failed:', err);
        alert(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
    set('uploaded_files', uploaded);
    setUploading(false);
    e.target.value = '';
  };

  const removeFile = (idx) => {
    const updated = [...(params.uploaded_files || [])];
    updated.splice(idx, 1);
    set('uploaded_files', updated);
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderParams = () => {
    switch (node.type) {
      case 'DocumentUpload':
        // ── Architect-generated workflows: live persistent document manager ──
        // Both architect-generated (params.architect_version set) and plain nodes
        // use the same live manager when chatbotId is present.
        if (chatbotId) {
          return <KnowledgeSourceManager chatbotId={chatbotId} C={C} />;
        }
        // Fallback: no chatbotId (shouldn't happen in practice)
        return (
          <p style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            // Connect to a chatbot to manage documents.
          </p>
        );

      case 'OCR':
        return (
          <Field C={C} label="AMD Ryzen AI NPU">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: C.t2 }}>Enable NPU acceleration</span>
              <Toggle C={C} checked={params.amd_npu || false} onChange={v => set('amd_npu', v)} />
            </div>
          </Field>
        );
      case 'VoiceRecognition':
        return (
          <Field C={C} label="Language">
            <select style={selectStyle} value={params.language || 'en-US'} onChange={e => set('language', e.target.value)}>
              <option value="en-US">English (US)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
            </select>
          </Field>
        );
      case 'WebCrawler':
        return (
          <>
            <Field C={C} label="Max Pages">
              <input type="number" style={inputStyle} value={params.max_pages || 10} onChange={e => set('max_pages', parseInt(e.target.value))} />
            </Field>
            <Field C={C} label="Depth Limit">
              <input type="number" style={inputStyle} value={params.depth || 2} onChange={e => set('depth', parseInt(e.target.value))} />
            </Field>
          </>
        );
      case 'Translator':
        return (
          <Field C={C} label="Target Language">
            <select style={selectStyle} value={params.target_language || 'en'} onChange={e => set('target_language', e.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="zh">Chinese</option>
            </select>
          </Field>
        );
      case 'ImageAnalysis':
        return (
          <Field C={C} label="Object Detection">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: C.t2 }}>Enable object detection</span>
              <Toggle C={C} checked={params.object_detection || false} onChange={v => set('object_detection', v)} />
            </div>
          </Field>
        );
      case 'DataFilter':
        return (
          <Field C={C} label="Filter Condition">
            <input style={inputStyle} placeholder="e.g., length > 100" value={params.condition || ''} onChange={e => set('condition', e.target.value)} />
          </Field>
        );
      case 'APIIntegration':
        return (
          <>
            <Field C={C} label="API Endpoint">
              <input style={inputStyle} placeholder="https://api.example.com" value={params.endpoint || ''} onChange={e => set('endpoint', e.target.value)} />
            </Field>
            <Field C={C} label="Method">
              <select style={selectStyle} value={params.method || 'GET'} onChange={e => set('method', e.target.value)}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>
            </Field>
          </>
        );
      case 'CustomCode':
        return (
          <Field C={C} label="Code Snippet">
            <textarea
              style={{ ...inputStyle, height: 120, resize: 'none' }}
              placeholder={"def process(data):\n    return data"}
              value={params.code || ''}
              onChange={e => set('code', e.target.value)}
            />
          </Field>
        );
      case 'TextSplitter':
        // For Architect-generated workflows (has params.architect_version), show actual plan values
        if (params.architect_version !== undefined) {
          const SUPPORTED = ['fixed', 'recursive', 'structure-aware'];
          return (
            <>
              <Field C={C} label="Strategy">
                {SUPPORTED.includes(params.strategy) ? (
                  <div style={{ ...inputStyle, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px #a855f7' }} />
                    {params.strategy}
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: C.t3 }}>read-only</span>
                  </div>
                ) : (
                  <input style={inputStyle} value={params.strategy || ''} readOnly />
                )}
              </Field>
              <Field C={C} label="Chunk Size">
                <input type="number" style={inputStyle} value={params.chunk_size || 1000} onChange={e => set('chunk_size', parseInt(e.target.value))} />
              </Field>
              <Field C={C} label="Overlap">
                <input type="number" style={inputStyle} value={params.overlap ?? params.chunk_overlap ?? 200} onChange={e => { set('overlap', parseInt(e.target.value)); set('chunk_overlap', parseInt(e.target.value)); }} />
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: C.t2, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Generated by Architect v{params.architect_version}. Changing chunk_size or overlap here does not re-index documents. Use "Build RAG Pipeline" after editing.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original editable UI
        return (
          <>
            <Field C={C} label="Chunk Size">
              <input type="number" style={inputStyle} value={params.chunk_size || 1000} onChange={e => set('chunk_size', parseInt(e.target.value))} />
            </Field>
            <Field C={C} label="Overlap">
              <input type="number" style={inputStyle} value={params.overlap || 200} onChange={e => set('overlap', parseInt(e.target.value))} />
            </Field>
          </>
        );
      case 'Embeddings':
        // For Architect-generated workflows, show actual BGE runtime config (read-only)
        if (params.architect_version !== undefined || params.provider === 'local') {
          return (
            <>
              <Field C={C} label="Provider">
                <div style={{ ...inputStyle, color: '#a855f7' }}>Local · @huggingface/transformers.js</div>
              </Field>
              <Field C={C} label="Model">
                <div style={{ ...inputStyle, color: '#a855f7' }}>{params.model || 'Xenova/bge-small-en-v1.5'}</div>
              </Field>
              <Field C={C} label="Dimension">
                <div style={{ ...inputStyle, color: '#a855f7' }}>{params.dimension || 384}</div>
              </Field>
              <Field C={C} label="Normalization">
                <div style={{ ...inputStyle, color: '#22c55e' }}>Enabled</div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: C.t2, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Embedding model is fixed at the platform runtime level. All values are read-only.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original selector (kept for backward compatibility)
        return (
          <Field C={C} label="Model">
            <select style={selectStyle} value={params.model || 'text-embedding-ada-002'} onChange={e => set('model', e.target.value)}>
              <option value="text-embedding-ada-002">text-embedding-ada-002</option>
              <option value="text-embedding-3-small">text-embedding-3-small</option>
              <option value="text-embedding-3-large">text-embedding-3-large</option>
            </select>
          </Field>
        );
      case 'VectorStore':
        // For Architect-generated workflows, show actual pgvector runtime config
        if (params.architect_version !== undefined || params.type === 'pgvector') {
          return (
            <>
              <Field C={C} label="Store">
                <div style={{ ...inputStyle, color: '#f97316' }}>PostgreSQL + pgvector</div>
              </Field>
              <Field C={C} label="Retrieval Strategy">
                <div style={{ ...inputStyle, color: '#f97316' }}>similarity (exact cosine)</div>
              </Field>
              <Field C={C} label="Similarity Metric">
                <div style={{ ...inputStyle, color: '#f97316' }}>{params.metric || 'cosine'}</div>
              </Field>
              <Field C={C} label="Top-K">
                <input type="number" style={inputStyle} min="1" max="10" value={params.top_k || 5} onChange={e => set('top_k', parseInt(e.target.value))} />
              </Field>
              <Field C={C} label="Reranking">
                <div style={{ ...inputStyle, color: C.t3 }}>Disabled</div>
              </Field>
              <Field C={C} label="Vector Dimension">
                <div style={{ ...inputStyle, color: '#f97316' }}>{params.vector_dimension || 384}</div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: C.t2, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Vanta uses Supabase pgvector with exact cosine similarity. Top-K is configurable.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original selector
        return (
          <Field C={C} label="Store Type">
            <select style={selectStyle} value={params.type || 'FAISS'} onChange={e => set('type', e.target.value)}>
              <option value="FAISS">FAISS</option>
              <option value="ChromaDB">ChromaDB</option>
              <option value="Pinecone">Pinecone</option>
            </select>
          </Field>
        );
      case 'LLM':
        // For Architect-generated workflows, show all fields including response_style and grounding
        if (params.architect_version !== undefined) {
          return (
            <>
              <Field C={C} label="Model">
                <input style={inputStyle} value={params.model || 'openai/gpt-4o-mini'} onChange={e => set('model', e.target.value)} />
              </Field>
              <Field C={C} label="Temperature">
                <input type="number" style={inputStyle} step="0.1" min="0" max="2" value={params.temperature ?? 0.4} onChange={e => set('temperature', parseFloat(e.target.value))} />
              </Field>
              <Field C={C} label="Response Style">
                <input style={{ ...inputStyle, color: '#06b6d4' }} value={params.response_style || ''} onChange={e => set('response_style', e.target.value)} />
              </Field>
              <Field C={C} label="Grounding">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: params.grounding_required ? '#22c55e' : '#94a3b8' }}>
                    {params.grounding_required ? 'Strict (knowledge base only)' : 'Flexible (general knowledge allowed)'}
                  </span>
                  <Toggle C={C} checked={params.grounding_required || false} onChange={v => set('grounding_required', v)} />
                </div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: C.t2, fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  response_style and temperature are independent fields. Generated by Architect v{params.architect_version}.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow
        return (
          <>
            <Field C={C} label="Model">
              <select style={selectStyle} value={params.model || 'gpt-3.5-turbo'} onChange={e => set('model', e.target.value)}>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
              </select>
            </Field>
            <Field C={C} label="Temperature">
              <input type="number" style={inputStyle} step="0.1" min="0" max="2" value={params.temperature || 0.7} onChange={e => set('temperature', parseFloat(e.target.value))} />
            </Field>
            <Field C={C} label="AMD ROCm Acceleration">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.t2 }}>Enable ROCm GPU</span>
                <Toggle C={C} checked={params.amd_enabled || false} onChange={v => set('amd_enabled', v)} />
              </div>
            </Field>
          </>
        );
      case 'DocumentProcessor':
        return (
          <>
            <Field C={C} label="Supported File Types">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['PDF', 'DOCX', 'TXT'].map(ft => (
                  <div key={ft} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: C.t2 }}>{ft}</span>
                    <Toggle
                      checked={params[`allow_${ft.toLowerCase()}`] !== false}
                      onChange={v => set(`allow_${ft.toLowerCase()}`, v)}
                    />
                  </div>
                ))}
              </div>
            </Field>
            <Field C={C} label="Extraction Mode">
              <select style={selectStyle} value={params.extraction_mode || 'text'} onChange={e => set('extraction_mode', e.target.value)}>
                <option value="text">Text Only</option>
                <option value="text_and_tables">Text + Tables</option>
                <option value="full">Full (Text, Tables, Images)</option>
              </select>
            </Field>
            <Field C={C} label="Preserve Formatting">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.t2 }}>Keep original layout</span>
                <Toggle C={C} checked={params.preserve_formatting || false} onChange={v => set('preserve_formatting', v)} />
              </div>
            </Field>
          </>
        );

      case 'DataValidation':
        return (
          <>
            <Field C={C} label="Schema Type">
              <select style={selectStyle} value={params.schema_type || 'json'} onChange={e => set('schema_type', e.target.value)}>
                <option value="json">JSON Schema</option>
                <option value="pydantic">Pydantic Model</option>
                <option value="custom">Custom Rules</option>
              </select>
            </Field>
            <Field C={C} label="Schema / Rules">
              <textarea
                style={{ ...inputStyle, height: 100, resize: 'none' }}
                placeholder={'{\n  "type": "object",\n  "required": ["text"]\n}'}
                value={params.schema || ''}
                onChange={e => set('schema', e.target.value)}
              />
            </Field>
            <Field C={C} label="On Validation Failure">
              <select style={selectStyle} value={params.on_failure || 'skip'} onChange={e => set('on_failure', e.target.value)}>
                <option value="skip">Skip record</option>
                <option value="raise">Raise error</option>
                <option value="log">Log & continue</option>
              </select>
            </Field>
            <Field C={C} label="Strict Mode">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.t2 }}>Reject extra fields</span>
                <Toggle C={C} checked={params.strict || false} onChange={v => set('strict', v)} />
              </div>
            </Field>
          </>
        );

      case 'CodeExecution':
        return (
          <>
            <Field C={C} label="Python Script">
              <textarea
                style={{ ...inputStyle, height: 130, resize: 'none' }}
                placeholder={'def run(data):\n    # data: dict with pipeline context\n    result = data[\'text\'].upper()\n    return {\'text\': result}'}
                value={params.script || ''}
                onChange={e => set('script', e.target.value)}
              />
            </Field>
            <Field C={C} label="Timeout (seconds)">
              <input type="number" style={inputStyle} min="1" max="300" value={params.timeout || 30} onChange={e => set('timeout', parseInt(e.target.value))} />
            </Field>
            <Field C={C} label="Python Version">
              <select style={selectStyle} value={params.python_version || '3.11'} onChange={e => set('python_version', e.target.value)}>
                <option value="3.10">Python 3.10</option>
                <option value="3.11">Python 3.11</option>
                <option value="3.12">Python 3.12</option>
              </select>
            </Field>
            <Field C={C} label="Allow Network Access">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.t2 }}>Enable outbound requests</span>
                <Toggle C={C} checked={params.allow_network || false} onChange={v => set('allow_network', v)} />
              </div>
            </Field>
          </>
        );

      default:
        return <p style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>// No configurable parameters</p>;
    }
  };

  return (
    <div style={{
      width: 260, height: '100%',
      background: C.panel,
      borderLeft: `1px solid ${C.panelBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px', borderBottom: `1px solid ${C.panelBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0,
        background: C.panel, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Settings size={13} color={C.accent} />
          <span style={{ fontSize: 11, fontWeight: 700, color: C.t2, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
            Properties
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.t3, padding: 2 }}
          onMouseEnter={e => e.currentTarget.style.color = C.t1}
          onMouseLeave={e => e.currentTarget.style.color = C.t3}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '14px' }}>
        {/* Node identity */}
        <div style={{
          padding: '10px 12px',
          background: C.accentBg,
          border: `1px solid ${C.panelBorder}`,
          borderRadius: 9, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 2 }}>{node.label}</div>
          <div style={{ fontSize: 10, color: C.accent, fontFamily: 'JetBrains Mono, monospace' }}>{node.type}</div>
        </div>

        {/* Divider */}
        <div style={{ fontSize: 10, fontWeight: 700, color: C.t3, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>
          // Parameters
        </div>

        {renderParams()}
      </div>
    </div>
  );
}