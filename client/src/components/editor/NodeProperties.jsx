import React, { useState, useRef, useEffect } from 'react';
import { X, Settings, Upload, FileText, Trash2, AlertCircle } from 'lucide-react';
import { documentsApi } from '@/api/apiClient';

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  background: '#060a10',
  border: '1px solid rgba(99,102,241,0.25)',
  borderRadius: 7,
  color: '#e2e8f0',
  fontSize: 12,
  fontFamily: 'JetBrains Mono, monospace',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  fontSize: 10,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 5,
  display: 'block',
  fontFamily: 'JetBrains Mono, monospace',
};

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20,
        background: checked ? '#6366f1' : '#1e293b',
        border: `1px solid ${checked ? '#6366f1' : 'rgba(99,102,241,0.3)'}`,
        borderRadius: 10,
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.2s',
        flexShrink: 0,
        boxShadow: checked ? '0 0 10px rgba(99,102,241,0.4)' : 'none'
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

export default function NodeProperties({ node, chatbotId, onUpdate, onClose }) {
  const [params, setParams] = useState(node.params || {});
  const [uploading, setUploading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const fileInputRef = useRef(null);

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
        // For Architect-generated workflows (params.documents from workflowBuilder),
        // show the persisted document list from the knowledge source node params.
        if (params.architect_version !== undefined && Array.isArray(params.documents)) {
          return (
            <>
              <Field label="Knowledge Source">
                <div style={{ ...inputStyle, color: '#3b82f6' }}>
                  RAG App Knowledge Base
                </div>
              </Field>
              <Field label={`Documents (${params.documents.length})`}>
                {params.documents.length === 0 ? (
                  <p style={{ fontSize: 10, color: '#334155', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                    // No documents indexed
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {params.documents.map((doc, i) => {
                      const statusColor = doc.status === 'indexed' ? '#22c55e'
                        : doc.status === 'profiled' ? '#6366f1'
                        : doc.status === 'error' ? '#ef4444' : '#f59e0b';
                      return (
                        <div key={doc.id || i} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '6px 9px',
                          background: 'rgba(59,130,246,0.06)',
                          border: '1px solid rgba(59,130,246,0.15)',
                          borderRadius: 7,
                        }}>
                          <FileText size={11} color="#3b82f6" style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {doc.file_name}
                            </div>
                            <div style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                              {doc.status}
                              {doc.chunk_count > 0 ? ` · ${doc.chunk_count} chunks` : ''}
                            </div>
                          </div>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: `0 0 5px ${statusColor}`, flexShrink: 0 }} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Architect v{params.architect_version} · {params.document_count || 0} document(s). Manage knowledge in the Architect onboarding screen.
                </p>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </>
          );
        }
        // Legacy / non-architect DocumentUpload — original upload UI
        return (
          <>
            <Field label="Upload Documents">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.txt,.ppt,.pptx,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.webp,.md"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  width: '100%',
                  padding: '18px 12px',
                  background: 'rgba(99,102,241,0.05)',
                  border: '1px dashed rgba(99,102,241,0.35)',
                  borderRadius: 9,
                  cursor: uploading ? 'wait' : 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.05)'}
              >
                {uploading ? (
                  <>
                    <div style={{ width: 18, height: 18, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    <span style={{ fontSize: 11, color: '#6366f1', fontFamily: 'JetBrains Mono, monospace' }}>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload size={18} color="#6366f1" />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>Click to upload files</span>
                    <span style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>PDF, DOCX, TXT, PPT, CSV, images...</span>
                  </>
                )}
              </button>
            </Field>

            {/* Loading / error state */}
            {docsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}>
                <div style={{ width: 12, height: 12, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: 10, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>Loading documents...</span>
              </div>
            )}
            {docsError && !docsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, marginBottom: 8 }}>
                <AlertCircle size={11} color="#ef4444" />
                <span style={{ fontSize: 10, color: '#fca5a5' }}>{docsError}</span>
              </div>
            )}

            {(params.uploaded_files || []).length > 0 && (
              <Field label={`Files (${params.uploaded_files.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {params.uploaded_files.map((f, i) => (
                    <div key={f.id || i} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 9px',
                      background: f.status === 'error' ? 'rgba(239,68,68,0.06)' : 'rgba(99,102,241,0.06)',
                      border: `1px solid ${f.status === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.15)'}`,
                      borderRadius: 7,
                    }}>
                      <FileText size={11} color={f.status === 'error' ? '#ef4444' : '#6366f1'} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                        <div style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                          {formatSize(f.size)}
                          {f.status === 'indexed' && f.chunks ? ` · ${f.chunks} chunks` : ''}
                          {f.status === 'processing' ? ' · indexing...' : ''}
                          {f.status === 'error' ? ` · error` : ''}
                        </div>
                      </div>
                      <button onClick={() => removeFile(i)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: 0, flexShrink: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </Field>
            )}

            {!docsLoading && (params.uploaded_files || []).length === 0 && !docsError && (
              <p style={{ fontSize: 10, color: '#334155', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', marginTop: 4 }}>
                // No documents yet
              </p>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        );

      case 'OCR':
        return (
          <Field label="AMD Ryzen AI NPU">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Enable NPU acceleration</span>
              <Toggle checked={params.amd_npu || false} onChange={v => set('amd_npu', v)} />
            </div>
          </Field>
        );
      case 'VoiceRecognition':
        return (
          <Field label="Language">
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
            <Field label="Max Pages">
              <input type="number" style={inputStyle} value={params.max_pages || 10} onChange={e => set('max_pages', parseInt(e.target.value))} />
            </Field>
            <Field label="Depth Limit">
              <input type="number" style={inputStyle} value={params.depth || 2} onChange={e => set('depth', parseInt(e.target.value))} />
            </Field>
          </>
        );
      case 'Translator':
        return (
          <Field label="Target Language">
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
          <Field label="Object Detection">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Enable object detection</span>
              <Toggle checked={params.object_detection || false} onChange={v => set('object_detection', v)} />
            </div>
          </Field>
        );
      case 'DataFilter':
        return (
          <Field label="Filter Condition">
            <input style={inputStyle} placeholder="e.g., length > 100" value={params.condition || ''} onChange={e => set('condition', e.target.value)} />
          </Field>
        );
      case 'APIIntegration':
        return (
          <>
            <Field label="API Endpoint">
              <input style={inputStyle} placeholder="https://api.example.com" value={params.endpoint || ''} onChange={e => set('endpoint', e.target.value)} />
            </Field>
            <Field label="Method">
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
          <Field label="Code Snippet">
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
              <Field label="Strategy">
                {SUPPORTED.includes(params.strategy) ? (
                  <div style={{ ...inputStyle, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px #a855f7' }} />
                    {params.strategy}
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#475569' }}>read-only</span>
                  </div>
                ) : (
                  <input style={inputStyle} value={params.strategy || ''} readOnly />
                )}
              </Field>
              <Field label="Chunk Size">
                <input type="number" style={inputStyle} value={params.chunk_size || 1000} onChange={e => set('chunk_size', parseInt(e.target.value))} />
              </Field>
              <Field label="Overlap">
                <input type="number" style={inputStyle} value={params.overlap ?? params.chunk_overlap ?? 200} onChange={e => { set('overlap', parseInt(e.target.value)); set('chunk_overlap', parseInt(e.target.value)); }} />
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Generated by Architect v{params.architect_version}. Changing chunk_size or overlap here does not re-index documents. Use "Build RAG Pipeline" after editing.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original editable UI
        return (
          <>
            <Field label="Chunk Size">
              <input type="number" style={inputStyle} value={params.chunk_size || 1000} onChange={e => set('chunk_size', parseInt(e.target.value))} />
            </Field>
            <Field label="Overlap">
              <input type="number" style={inputStyle} value={params.overlap || 200} onChange={e => set('overlap', parseInt(e.target.value))} />
            </Field>
          </>
        );
      case 'Embeddings':
        // For Architect-generated workflows, show actual BGE runtime config (read-only)
        if (params.architect_version !== undefined || params.provider === 'local') {
          return (
            <>
              <Field label="Provider">
                <div style={{ ...inputStyle, color: '#a855f7' }}>Local · @huggingface/transformers.js</div>
              </Field>
              <Field label="Model">
                <div style={{ ...inputStyle, color: '#a855f7' }}>{params.model || 'Xenova/bge-small-en-v1.5'}</div>
              </Field>
              <Field label="Dimension">
                <div style={{ ...inputStyle, color: '#a855f7' }}>{params.dimension || 384}</div>
              </Field>
              <Field label="Normalization">
                <div style={{ ...inputStyle, color: '#22c55e' }}>Enabled</div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Embedding model is fixed at the platform runtime level. All values are read-only.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original selector (kept for backward compatibility)
        return (
          <Field label="Model">
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
              <Field label="Store">
                <div style={{ ...inputStyle, color: '#f97316' }}>PostgreSQL + pgvector</div>
              </Field>
              <Field label="Retrieval Strategy">
                <div style={{ ...inputStyle, color: '#f97316' }}>similarity (exact cosine)</div>
              </Field>
              <Field label="Similarity Metric">
                <div style={{ ...inputStyle, color: '#f97316' }}>{params.metric || 'cosine'}</div>
              </Field>
              <Field label="Top-K">
                <input type="number" style={inputStyle} min="1" max="10" value={params.top_k || 5} onChange={e => set('top_k', parseInt(e.target.value))} />
              </Field>
              <Field label="Reranking">
                <div style={{ ...inputStyle, color: '#64748b' }}>Disabled</div>
              </Field>
              <Field label="Vector Dimension">
                <div style={{ ...inputStyle, color: '#f97316' }}>{params.vector_dimension || 384}</div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  Vanta uses Supabase pgvector with exact cosine similarity. Top-K is configurable.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow — original selector
        return (
          <Field label="Store Type">
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
              <Field label="Model">
                <input style={inputStyle} value={params.model || 'openai/gpt-4o-mini'} onChange={e => set('model', e.target.value)} />
              </Field>
              <Field label="Temperature">
                <input type="number" style={inputStyle} step="0.1" min="0" max="2" value={params.temperature ?? 0.4} onChange={e => set('temperature', parseFloat(e.target.value))} />
              </Field>
              <Field label="Response Style">
                <input style={{ ...inputStyle, color: '#06b6d4' }} value={params.response_style || ''} onChange={e => set('response_style', e.target.value)} />
              </Field>
              <Field label="Grounding">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: params.grounding_required ? '#22c55e' : '#94a3b8' }}>
                    {params.grounding_required ? 'Strict (knowledge base only)' : 'Flexible (general knowledge allowed)'}
                  </span>
                  <Toggle checked={params.grounding_required || false} onChange={v => set('grounding_required', v)} />
                </div>
              </Field>
              <div style={{ padding: '6px 8px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 7, marginTop: 4 }}>
                <p style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                  response_style and temperature are independent fields. Generated by Architect v{params.architect_version}.
                </p>
              </div>
            </>
          );
        }
        // Legacy workflow
        return (
          <>
            <Field label="Model">
              <select style={selectStyle} value={params.model || 'gpt-3.5-turbo'} onChange={e => set('model', e.target.value)}>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
              </select>
            </Field>
            <Field label="Temperature">
              <input type="number" style={inputStyle} step="0.1" min="0" max="2" value={params.temperature || 0.7} onChange={e => set('temperature', parseFloat(e.target.value))} />
            </Field>
            <Field label="AMD ROCm Acceleration">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Enable ROCm GPU</span>
                <Toggle checked={params.amd_enabled || false} onChange={v => set('amd_enabled', v)} />
              </div>
            </Field>
          </>
        );
      case 'DocumentProcessor':
        return (
          <>
            <Field label="Supported File Types">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['PDF', 'DOCX', 'TXT'].map(ft => (
                  <div key={ft} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{ft}</span>
                    <Toggle
                      checked={params[`allow_${ft.toLowerCase()}`] !== false}
                      onChange={v => set(`allow_${ft.toLowerCase()}`, v)}
                    />
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Extraction Mode">
              <select style={selectStyle} value={params.extraction_mode || 'text'} onChange={e => set('extraction_mode', e.target.value)}>
                <option value="text">Text Only</option>
                <option value="text_and_tables">Text + Tables</option>
                <option value="full">Full (Text, Tables, Images)</option>
              </select>
            </Field>
            <Field label="Preserve Formatting">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Keep original layout</span>
                <Toggle checked={params.preserve_formatting || false} onChange={v => set('preserve_formatting', v)} />
              </div>
            </Field>
          </>
        );

      case 'DataValidation':
        return (
          <>
            <Field label="Schema Type">
              <select style={selectStyle} value={params.schema_type || 'json'} onChange={e => set('schema_type', e.target.value)}>
                <option value="json">JSON Schema</option>
                <option value="pydantic">Pydantic Model</option>
                <option value="custom">Custom Rules</option>
              </select>
            </Field>
            <Field label="Schema / Rules">
              <textarea
                style={{ ...inputStyle, height: 100, resize: 'none' }}
                placeholder={'{\n  "type": "object",\n  "required": ["text"]\n}'}
                value={params.schema || ''}
                onChange={e => set('schema', e.target.value)}
              />
            </Field>
            <Field label="On Validation Failure">
              <select style={selectStyle} value={params.on_failure || 'skip'} onChange={e => set('on_failure', e.target.value)}>
                <option value="skip">Skip record</option>
                <option value="raise">Raise error</option>
                <option value="log">Log & continue</option>
              </select>
            </Field>
            <Field label="Strict Mode">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Reject extra fields</span>
                <Toggle checked={params.strict || false} onChange={v => set('strict', v)} />
              </div>
            </Field>
          </>
        );

      case 'CodeExecution':
        return (
          <>
            <Field label="Python Script">
              <textarea
                style={{ ...inputStyle, height: 130, resize: 'none' }}
                placeholder={'def run(data):\n    # data: dict with pipeline context\n    result = data[\'text\'].upper()\n    return {\'text\': result}'}
                value={params.script || ''}
                onChange={e => set('script', e.target.value)}
              />
            </Field>
            <Field label="Timeout (seconds)">
              <input type="number" style={inputStyle} min="1" max="300" value={params.timeout || 30} onChange={e => set('timeout', parseInt(e.target.value))} />
            </Field>
            <Field label="Python Version">
              <select style={selectStyle} value={params.python_version || '3.11'} onChange={e => set('python_version', e.target.value)}>
                <option value="3.10">Python 3.10</option>
                <option value="3.11">Python 3.11</option>
                <option value="3.12">Python 3.12</option>
              </select>
            </Field>
            <Field label="Allow Network Access">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Enable outbound requests</span>
                <Toggle checked={params.allow_network || false} onChange={v => set('allow_network', v)} />
              </div>
            </Field>
          </>
        );

      default:
        return <p style={{ fontSize: 11, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>// No configurable parameters</p>;
    }
  };

  return (
    <div style={{
      width: 260,
      height: '100%',
      background: '#0a0e18',
      borderLeft: '1px solid rgba(99,102,241,0.2)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px',
        borderBottom: '1px solid rgba(99,102,241,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky', top: 0,
        background: '#0a0e18',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Settings size={13} color="#6366f1" />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
            Properties
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
          onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '14px' }}>
        {/* Node identity */}
        <div style={{
          padding: '10px 12px',
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 9,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{node.label}</div>
          <div style={{ fontSize: 10, color: '#6366f1', fontFamily: 'JetBrains Mono, monospace' }}>{node.type}</div>
        </div>

        {/* Divider */}
        <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>
          // Parameters
        </div>

        {renderParams()}
      </div>
    </div>
  );
}