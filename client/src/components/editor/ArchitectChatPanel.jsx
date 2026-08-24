/**
 * client/src/components/editor/ArchitectChatPanel.jsx
 *
 * Phase 9B: Architect Chat right-side panel.
 *
 * Supports both user intent paths:
 *   PATH A — Review with Architect: user has a draft, clicks "Review with Architect"
 *   PATH B — Direct chat: user opens panel and types a request directly
 *
 * INVARIANTS:
 *   - Never modifies active workflow
 *   - Never activates proposed architecture
 *   - Proposal display is read-only
 *   - Cancel preserves the user's draft
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Send, Bot, User, Cpu, RefreshCw, XCircle,
  CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  GitBranch, Zap,
} from 'lucide-react';
import { architectChatApi } from '@/api/apiClient';

// ─── Proposal Display ─────────────────────────────────────────────────────────

function ProposalSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 0', background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#94a3b8', fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        {title}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && <div style={{ paddingLeft: 8, paddingBottom: 6 }}>{children}</div>}
    </div>
  );
}

function ProposalDisplay({ proposal, onContinue }) {
  if (!proposal) return null;

  const executableColor = proposal.executable ? '#22c55e' : '#f59e0b';

  return (
    <div style={{
      margin: '10px 0',
      padding: '12px',
      background: 'rgba(99,102,241,0.06)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 10,
      fontSize: 11,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Cpu size={12} color="#6366f1" />
        <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 12 }}>Architecture Proposal</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
          color: executableColor,
          background: `${executableColor}18`,
          border: `1px solid ${executableColor}44`,
          padding: '2px 6px', borderRadius: 4,
        }}>
          {proposal.executable ? 'EXECUTABLE' : 'NOT EXECUTABLE'}
        </span>
      </div>

      {/* Summary */}
      <p style={{ color: '#cbd5e1', fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
        {proposal.summary}
      </p>

      {/* Unsupported capabilities warning */}
      {proposal.unsupported_capabilities?.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 6, marginBottom: 8,
        }}>
          <AlertTriangle size={11} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600 }}>Not executable: </span>
            <span style={{ fontSize: 10, color: '#fbbf24' }}>
              {proposal.unsupported_capabilities.join(', ')} not available in current runtime.
            </span>
          </div>
        </div>
      )}

      {/* Recommended changes */}
      {(proposal.recommended_changes?.add_nodes?.length > 0 ||
        proposal.recommended_changes?.remove_nodes?.length > 0 ||
        proposal.recommended_changes?.reconfigure_nodes?.length > 0) && (
        <ProposalSection title="Recommended Changes" defaultOpen={true}>
          {proposal.recommended_changes.add_nodes?.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 3 }}>
              <span style={{ color: '#22c55e', fontSize: 10 }}>+</span>
              <span style={{ color: '#cbd5e1', fontSize: 10 }}>{n.label || n.type}: {n.reason}</span>
            </div>
          ))}
          {proposal.recommended_changes.remove_nodes?.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 3 }}>
              <span style={{ color: '#ef4444', fontSize: 10 }}>−</span>
              <span style={{ color: '#cbd5e1', fontSize: 10 }}>{n}</span>
            </div>
          ))}
          {proposal.recommended_changes.reconfigure_nodes?.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 3 }}>
              <span style={{ color: '#6366f1', fontSize: 10 }}>~</span>
              <span style={{ color: '#cbd5e1', fontSize: 10 }}>{n.type}: {n.reason}</span>
            </div>
          ))}
        </ProposalSection>
      )}

      {/* Future recommendations */}
      {proposal.future_recommendations?.length > 0 && (
        <ProposalSection title={`Future Recommendations (${proposal.future_recommendations.length})`}>
          {proposal.future_recommendations.map((r, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
                {r.feature}:
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}> {r.reason}</span>
            </div>
          ))}
        </ProposalSection>
      )}

      {/* Re-index warning */}
      {proposal.requires_reindex && (
        <div style={{
          fontSize: 9, color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace',
          marginTop: 6,
        }}>
          ⚠ This proposal would require document re-indexing when activated.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={onContinue}
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 7,
            border: '1px solid rgba(99,102,241,0.3)',
            background: 'transparent', color: '#818cf8',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          <RefreshCw size={10} /> Continue Discussion
        </button>
        <div style={{
          flex: 1, padding: '6px 10px', borderRadius: 7,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          color: '#64748b', fontSize: 11, textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <Zap size={10} /> Ready for 9C
        </div>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isArchitect = msg.role === 'architect';
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      flexDirection: isArchitect ? 'row' : 'row-reverse',
      marginBottom: 10,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        background: isArchitect ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.1)',
        border: `1px solid ${isArchitect ? 'rgba(99,102,241,0.4)' : 'rgba(34,197,94,0.3)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isArchitect ? <Bot size={11} color="#6366f1" /> : <User size={11} color="#22c55e" />}
      </div>
      <div style={{
        maxWidth: '80%',
        padding: '8px 11px',
        borderRadius: isArchitect ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
        background: isArchitect ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isArchitect ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)'}`,
        fontSize: 12, color: '#cbd5e1', lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ArchitectChatPanel({ chatbotId, hasDraft, onClose }) {
  const [messages,     setMessages]     = useState([]);
  const [proposal,     setProposal]     = useState(null);
  const [chatStatus,   setChatStatus]   = useState('idle');  // idle | clarifying | ready_for_review
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [initialized,  setInitialized]  = useState(false);
  const bottomRef = useRef(null);

  // Load existing conversation on mount
  useEffect(() => {
    if (chatbotId) loadConversation();
  }, [chatbotId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversation = async () => {
    try {
      const data = await architectChatApi.get(chatbotId);
      if (data.has_conversation && data.messages?.length > 0) {
        setMessages(data.messages);
        setChatStatus(data.proposed_status === 'ready_for_review' ? 'ready_for_review' : 'clarifying');
        if (data.proposed_plan) setProposal(data.proposed_plan);
        setInitialized(true);
      }
    } catch { /* no prior conversation — start fresh */ }
  };

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content, created_at: new Date().toISOString() }]);
  };

  // PATH A: Review draft
  const handleReviewDraft = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await architectChatApi.reviewDraft(chatbotId);
      setMessages([
        { role: 'user', content: 'Please review my draft workflow changes.', created_at: new Date().toISOString() },
        { role: 'architect', content: result.message, created_at: new Date().toISOString() },
      ]);
      setChatStatus(result.status);
      if (result.proposal) setProposal(result.proposal);
      setInitialized(true);
    } catch (err) {
      setError('Failed to start review: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  // PATH B: Direct message
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    addMessage('user', text);
    setLoading(true);
    setError('');

    try {
      let result;
      if (!initialized) {
        // Start fresh conversation
        result = await architectChatApi.start(chatbotId, text);
        setInitialized(true);
      } else {
        // Continue conversation
        result = await architectChatApi.message(chatbotId, text);
      }
      addMessage('architect', result.message);
      setChatStatus(result.status);
      if (result.proposal) setProposal(result.proposal);
    } catch (err) {
      addMessage('architect', 'Sorry, I encountered an error. Please try again.');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await architectChatApi.cancel(chatbotId);
      setMessages([]);
      setProposal(null);
      setChatStatus('idle');
      setInitialized(false);
      setError('');
    } catch (err) {
      setError('Cancel failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueDiscussion = async () => {
    setProposal(null); // hide proposal display temporarily
    addMessage('architect', 'Of course — what would you like to discuss further?');
  };

  return (
    <div style={{
      width: 320, height: '100%',
      background: '#0a0e18',
      borderLeft: '1px solid rgba(99,102,241,0.2)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid rgba(99,102,241,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#0a0e18', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Cpu size={13} color="#6366f1" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>Architect Chat</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: chatStatus === 'ready_for_review' ? '#22c55e' :
                            chatStatus === 'clarifying' ? '#f59e0b' : '#475569',
                boxShadow: chatStatus !== 'idle' ? `0 0 5px ${chatStatus === 'ready_for_review' ? '#22c55e' : '#f59e0b'}` : 'none',
              }} />
              <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
                {chatStatus === 'ready_for_review' ? 'proposal ready'
                  : chatStatus === 'clarifying' ? 'clarifying'
                  : 'advisory only — not activating'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {initialized && (
            <button
              onClick={handleCancel}
              disabled={loading}
              title="Cancel proposal (draft preserved)"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#475569', padding: '3px 5px', borderRadius: 5,
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#475569'}
            >
              <XCircle size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#475569', padding: '3px 5px' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#475569'}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '6px 12px', background: 'rgba(239,68,68,0.08)',
          borderBottom: '1px solid rgba(239,68,68,0.2)',
          display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0,
        }}>
          <AlertTriangle size={11} color="#ef4444" />
          <span style={{ fontSize: 10, color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace' }}>{error}</span>
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 10 }}>✕</button>
        </div>
      )}

      {/* PATH A: Review Draft button — shown when draft exists and not yet started */}
      {hasDraft && !initialized && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(99,102,241,0.1)', flexShrink: 0 }}>
          <button
            onClick={handleReviewDraft}
            disabled={loading}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
              color: '#818cf8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.15)'}
          >
            {loading ? (
              <><div style={{ width: 12, height: 12, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Reviewing...</>
            ) : (
              <><GitBranch size={12} /> Review Draft with Architect</>
            )}
          </button>
          <p style={{ fontSize: 9, color: '#334155', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', marginTop: 5 }}>
            Or type a message below to start a direct conversation.
          </p>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', marginTop: 30 }}>
            <Cpu size={28} color="#334155" style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
              Ask me to review your workflow changes, or tell me what capability you'd like to add.
            </p>
            <p style={{ fontSize: 10, color: '#334155', fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>
              I won't change anything — I propose only.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={11} color="#6366f1" />
            </div>
            <div style={{
              padding: '8px 12px', background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: '4px 12px 12px 12px',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(d => (
                <div key={d} style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#6366f1',
                  animation: `bounce 1s ease-in-out ${d * 0.15}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Proposal display */}
        {proposal && chatStatus === 'ready_for_review' && (
          <ProposalDisplay proposal={proposal} onContinue={handleContinueDiscussion} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid rgba(99,102,241,0.15)',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={hasDraft ? 'Ask Architect or use Review Draft above...' : 'Ask Architect anything...'}
          disabled={loading}
          style={{
            flex: 1, padding: '8px 11px',
            background: '#060a10', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 8, color: '#e2e8f0', fontSize: 12, outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            width: 32, height: 32,
            background: input.trim() && !loading ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
          }}
        >
          <Send size={13} color={input.trim() && !loading ? '#fff' : '#334155'} />
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%, 100% { transform: translateY(0); opacity:0.5; } 50% { transform: translateY(-4px); opacity:1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
