import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Zap, ZapOff } from 'lucide-react';
import { chatbotsApi, chatApi } from '@/api/apiClient';
import DiagnosticPanel from '../components/diagnostic/DiagnosticPanel';
import { runDiagnostics, buildTelemetry } from '../components/diagnostic/ragDiagnostics';

export default function Chat() {
  const [chatbot, setChatbot] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [amdLocal, setAmdLocal] = useState(false);
  const messagesEndRef = useRef(null);

  const embedId = new URLSearchParams(window.location.search).get('id');

  useEffect(() => { loadChatbot(); }, [embedId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadChatbot = async () => {
    try {
      const bots = await chatbotsApi.filter({ embed_id: embedId });
      if (bots.length > 0) {
        setChatbot(bots[0]);
        setMessages([{
          role: 'assistant',
          content: `Hi! I'm ${bots[0].title}. How can I help you today?`,
        }]);
      }
    } catch (err) {
      console.error('Failed to load chatbot:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const query = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setInput('');
    setLoading(true);

    try {
      // Use public embed path — server persists messages automatically
      const result = await chatApi.sendPublic(embedId, query);

      const telemetry = buildTelemetry({
        query,
        llmResponse: result.answer,
        similarityScores: result.similarityScores || [],
        retrievedChunks: result.retrievedChunks || [],
        configUsed: result.telemetry?.configUsed || {},
      });

      const diagnostics = runDiagnostics(telemetry);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        confidence: result.avgSimilarity,
        telemetry,
        diagnostics,
      }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        diagnostics: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!chatbot) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#09090f', color: '#94a3b8', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
        Loading chatbot...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#09090f', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '12px 20px', background: '#0d0d1c', borderBottom: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{chatbot.title}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{chatbot.description}</div>
        </div>
        <button
          onClick={() => setAmdLocal(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px',
            background: amdLocal ? 'rgba(239,68,68,0.12)' : 'rgba(124,58,237,0.08)',
            border: `1px solid ${amdLocal ? 'rgba(239,68,68,0.35)' : 'rgba(124,58,237,0.25)'}`,
            borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {amdLocal ? <Zap size={12} color="#ef4444" /> : <ZapOff size={12} color="#475569" />}
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: amdLocal ? '#ef4444' : '#475569', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }}>
              {amdLocal ? 'Diagnostics · ON' : 'Diagnostics · OFF'}
            </div>
            <div style={{ fontSize: 9, color: '#334155' }}>
              {amdLocal ? 'showing rag telemetry' : 'hide diagnostics'}
            </div>
          </div>
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((msg, idx) => (
          <div key={idx}>
            <div style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%', padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                background: msg.role === 'user' ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)'}`,
                fontSize: 13, color: msg.role === 'user' ? '#fff' : '#cbd5e1',
                lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
                {msg.role === 'assistant' && msg.confidence !== undefined && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ConfidenceBar value={msg.confidence} />
                    <span style={{ fontSize: 10, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                      {(msg.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                )}
              </div>
            </div>

            {msg.role === 'assistant' && msg.diagnostics?.length > 0 && amdLocal && (
              <div style={{ marginTop: 6 }}>
                <DiagnosticPanel diagnostics={msg.diagnostics} amdLocal={amdLocal} telemetry={msg.telemetry} />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px 14px 14px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(d => (
                <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: '#7c3aed', animation: `bounce 1s ease-in-out ${d * 0.18}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', background: '#0d0d1c', borderTop: '1px solid rgba(124,58,237,0.15)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type your message..."
          disabled={loading}
          style={{ flex: 1, padding: '10px 14px', background: '#0c0c1a', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 10, color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Inter, sans-serif' }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            width: 38, height: 38,
            background: input.trim() && !loading ? 'rgba(124,58,237,0.8)' : 'rgba(124,58,237,0.12)',
            border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          {loading
            ? <Loader2 size={14} color="#7c3aed" style={{ animation: 'spin 1s linear infinite' }} />
            : <Send size={14} color={input.trim() ? '#fff' : '#334155'} />}
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%,100% { transform:translateY(0); opacity:.5; } 50% { transform:translateY(-4px); opacity:1; } }
        @keyframes spin { to { transform:rotate(360deg); } }
      `}</style>
    </div>
  );
}

function ConfidenceBar({ value }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct > 0.7 ? '#22c55e' : pct > 0.45 ? '#a78bfa' : '#ef4444';
  return (
    <div style={{ width: 60, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
    </div>
  );
}
