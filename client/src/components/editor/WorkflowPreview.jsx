/**
 * client/src/components/editor/WorkflowPreview.jsx
 *
 * Phase 10B update: Live Preview now renders using the chatbot's ui_config
 * (template, branding, behavior) when available.
 *
 * The RAG call path is unchanged — still uses chatApi.preview().
 * Only the presentation layer (header, bubbles, colors) respects ui_config.
 *
 * Props unchanged from Phase 9:
 *   chatbot  — active chatbot object (includes ui_config after Phase 10B migration)
 *   onClose  — callback
 */

import React, { useState, useEffect } from 'react';
import { X, MessageSquare, AlertTriangle, Info } from 'lucide-react';
import { chatApi, documentsApi } from '@/api/apiClient';
import { useAppTheme } from '@/lib/ThemeContext';
import { resolveUiConfig } from '@/lib/uiConfig';
import ChatRenderer from '../chatbot/ChatRenderer';

export default function WorkflowPreview({ chatbot, onClose }) {
  const { C } = useAppTheme();

  // Resolve ui_config — falls back to clean defaults if not present
  const uiConfig = resolveUiConfig(chatbot?.ui_config ?? {});

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: uiConfig.chat_ui.messages.welcome_message ?? `Hi! I'm **${chatbot.title}**.\n\nAsk me anything to test this workflow.`,
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);

  // ── Document status check ─────────────────────────────────────────────────
  const [docStatus, setDocStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    documentsApi.list(chatbot.id).then(docs => {
      if (cancelled) return;
      const indexed    = docs.filter(d => d.status === 'indexed');
      const reviewing  = docs.filter(d => d.status === 'needs_architecture_review');
      const processing = docs.filter(d => ['indexing', 'profiling', 'profiled', 'uploaded'].includes(d.status));
      const errored    = docs.filter(d => d.status === 'error');
      setDocStatus({ total: docs.length, indexed, reviewing, processing, errored });
    }).catch(() => setDocStatus({ total: 0, indexed: [], reviewing: [], processing: [], errored: [] }));
    return () => { cancelled = true; };
  }, [chatbot.id]);

  const send = async (text) => {
    if (!text?.trim() || loading) return;
    const query = text.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const result = await chatApi.preview(chatbot.id, query);
      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    result.answer,
        confidence: result.avgSimilarity,
        sources:    result.retrievedChunks?.slice(0, 3) ?? [],
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Preview failed: ' + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend              = () => send(input);
  const handleSuggestedQuestion = (q) => { setInput(q); send(q); };

  return (
    <div style={{
      width: 380, height: '100%',
      background: C.panel,
      borderLeft: `1px solid ${C.panelBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* ── Preview header bar ─────────────────────────────────────────────── */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${C.panelBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.panel, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: C.accentBg, border: `1px solid ${C.borderHi}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageSquare size={12} color={C.accent} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>Live Preview</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
              <span style={{ fontSize: 9, color: '#34d399', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                Live · Active Workflow
              </span>
            </div>
          </div>
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

      {/* ── Document status banner ─────────────────────────────────────────── */}
      {docStatus && (() => {
        if (docStatus.total === 0) return (
          <div style={{ padding: '6px 12px', background: C.bgSub, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <Info size={10} color={C.t3} />
            <span style={{ fontSize: 9, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>No knowledge sources uploaded yet.</span>
          </div>
        );
        if (docStatus.reviewing.length > 0 && docStatus.indexed.length === 0) return (
          <div style={{ padding: '6px 12px', background: 'rgba(251,191,36,0.07)', borderBottom: `1px solid rgba(251,191,36,0.2)`, display: 'flex', alignItems: 'flex-start', gap: 7, flexShrink: 0 }}>
            <AlertTriangle size={10} color="#fbbf24" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
              {docStatus.reviewing.length} document{docStatus.reviewing.length > 1 ? 's' : ''} need OCR — add OCR node via Architect.
            </span>
          </div>
        );
        if (docStatus.processing.length > 0 && docStatus.indexed.length === 0) return (
          <div style={{ padding: '6px 12px', background: C.accentBg, borderBottom: `1px solid ${C.panelBorder}`, display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'wpv-spin 0.7s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.accentLt, fontFamily: 'JetBrains Mono, monospace' }}>Processing documents…</span>
          </div>
        );
        if (docStatus.errored.length > 0 && docStatus.indexed.length === 0) return (
          <div style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.07)', borderBottom: `1px solid rgba(239,68,68,0.2)`, display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <AlertTriangle size={10} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace' }}>
              {docStatus.errored.length} document{docStatus.errored.length > 1 ? 's' : ''} failed. Check Knowledge Source node.
            </span>
          </div>
        );
        if (docStatus.indexed.length > 0 && (docStatus.reviewing.length + docStatus.processing.length) > 0) return (
          <div style={{ padding: '6px 12px', background: 'rgba(251,191,36,0.07)', borderBottom: `1px solid rgba(251,191,36,0.2)`, display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <Info size={10} color="#fbbf24" />
            <span style={{ fontSize: 9, color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace' }}>
              {docStatus.indexed.length} indexed · {docStatus.reviewing.length + docStatus.processing.length} pending.
            </span>
          </div>
        );
        return null;
      })()}
      <style>{`@keyframes wpv-spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Chat rendered with ui_config ──────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ChatRenderer
          config={uiConfig}
          chatbotTitle={chatbot.title}
          messages={messages}
          loading={loading}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onSuggestedQuestion={handleSuggestedQuestion}
          compact={true}
        />
      </div>
    </div>
  );
}
