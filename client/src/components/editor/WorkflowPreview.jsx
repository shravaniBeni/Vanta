import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Send, Bot, User, MessageSquare } from 'lucide-react';
import { chatApi } from '@/api/apiClient';
import { useAppTheme } from '@/lib/ThemeContext';


const mdComponentsWP = {
  p:      ({ node, ...p }) => <p style={{ margin: '0 0 6px 0', lineHeight: 1.65 }} {...p} />,
  strong: ({ node, ...p }) => <strong style={{ color: '#f0f0ff', fontWeight: 700 }} {...p} />,
  em:     ({ node, ...p }) => <em style={{ color: '#c4b5fd' }} {...p} />,
  code:   ({ node, inline, children, ...p }) => inline
    ? <code style={{ background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code>
    : <pre style={{ background: '#0b0b18', borderRadius: 8, padding: '10px 13px', marginTop: 6 }}><code style={{ color: '#c4b5fd', fontSize: '0.85em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code></pre>,
  ul:     ({ node, ...p }) => <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  ol:     ({ node, ...p }) => <ol style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  li:     ({ node, ...p }) => <li style={{ marginBottom: 3 }} {...p} />,
};

export default function WorkflowPreview({ chatbot, onClose }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hi! I'm **${chatbot.title}**.\n${chatbot.description}\n\nAsk me anything to test this workflow.` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const { C } = useAppTheme();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const result = await chatApi.preview(chatbot.id, text);
      const content = result.answer;
      const confidence = result.avgSimilarity;
      const chunks = result.retrievedChunks?.length ?? 0;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content,
        confidence,
        chunks,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Preview failed: ' + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: 380, height: '100%',
      background: C.panel,
      borderLeft: `1px solid ${C.panelBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${C.panelBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.panel, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: C.accentBg, border: `1px solid ${C.borderHi}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageSquare size={13} color={C.accent} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, letterSpacing: '-0.01em' }}>Live Preview</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
              <span style={{ fontSize: 10, color: '#34d399', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>Live · Active Workflow</span>
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

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{
              width: 28, height: 28, borderRadius: 9, flexShrink: 0,
              background: msg.role === 'user' ? C.accentBg : 'rgba(34,197,94,0.12)',
              border: `1px solid ${msg.role === 'user' ? C.borderHi : 'rgba(34,197,94,0.3)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {msg.role === 'user'
                ? <User size={11} color={C.accent} />
                : <Bot size={11} color="#22c55e" />}
            </div>
            <div style={{
              maxWidth: '78%', padding: '8px 11px',
              borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
              background: msg.role === 'user' ? C.accentBg : C.surface,
              border: `1px solid ${msg.role === 'user' ? C.panelBorder : C.border}`,
              fontSize: 12, color: C.t1, lineHeight: 1.65,
            }}>
              <ReactMarkdown components={mdComponentsWP}>{msg.content}</ReactMarkdown>
              {msg.role === 'assistant' && msg.confidence !== undefined && (
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 50, height: 2, background: C.border, borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(1, msg.confidence)) * 100}%`, height: '100%', background: msg.confidence > 0.6 ? '#22c55e' : msg.confidence > 0.3 ? C.accentLt : '#ef4444', borderRadius: 1 }} />
                  </div>
                  <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
                    {(msg.confidence * 100).toFixed(0)}% · {msg.chunks ?? 0} chunks
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={11} color="#22c55e" />
            </div>
            <div style={{
              padding: '8px 12px', background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: '4px 12px 12px 12px',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(d => (
                <div key={d} style={{
                  width: 5, height: 5, borderRadius: '50%', background: C.accent,
                  animation: `bounce 1s ease-in-out ${d * 0.15}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: `1px solid ${C.panelBorder}`,
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Test your workflow..."
          disabled={loading}
          style={{
            flex: 1, padding: '8px 11px',
            background: C.input, border: `1px solid ${C.inputBorder}`,
            borderRadius: 8, color: C.t1, fontSize: 12, outline: 'none',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
          }}
          onFocus={e => e.target.style.borderColor = C.borderHi}
          onBlur={e => e.target.style.borderColor = C.inputBorder}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            width: 32, height: 32,
            background: input.trim() && !loading ? 'rgba(124,58,237,0.8)' : C.accentBg,
            border: `1px solid ${C.panelBorder}`,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          <Send size={14} color={input.trim() && !loading ? '#fff' : C.t3} />
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%, 100% { transform: translateY(0); opacity: 0.5; } 50% { transform: translateY(-4px); opacity: 1; } }
      `}</style>
    </div>
  );
}