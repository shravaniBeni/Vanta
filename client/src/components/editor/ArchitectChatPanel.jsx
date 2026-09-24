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
import ReactMarkdown from 'react-markdown';
import {
  X, Send, Bot, User, Cpu, RefreshCw, XCircle,
  CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  GitBranch, Zap, Loader, Play,
} from 'lucide-react';
import { architectChatApi } from '@/api/apiClient';
import { useAppTheme } from '@/lib/ThemeContext';

// ─── Markdown components ──────────────────────────────────────────────────────

const mdComponents = {
  p:        ({ node, ...p }) => <p style={{ margin: '0 0 5px 0', lineHeight: 1.65 }} {...p} />,
  strong:   ({ node, ...p }) => <strong style={{ fontWeight: 700 }} {...p} />,
  em:       ({ node, ...p }) => <em style={{ fontStyle: 'italic' }} {...p} />,
  code:     ({ node, inline, children, ...p }) => inline
    ? <code style={{ background: 'rgba(99,102,241,0.18)', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code>
    : <pre style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '10px', marginTop: 6, overflow: 'auto' }}><code style={{ fontSize: '0.85em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code></pre>,
  ul:       ({ node, ...p }) => <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  ol:       ({ node, ...p }) => <ol style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  li:       ({ node, ...p }) => <li style={{ marginBottom: 3 }} {...p} />,
  a:        ({ node, ...p }) => <a style={{ color: '#a78bfa', textDecoration: 'underline' }} {...p} />,
  blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '2px solid rgba(124,58,237,0.4)', paddingLeft: 10, margin: '6px 0', color: 'inherit', opacity: 0.85 }} {...p} />,
};

// ─── Proposal Display ─────────────────────────────────────────────────────────

function ProposalSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const { C } = useAppTheme();
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 0', background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.t3, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
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

function ProposalDisplay({ proposal, proposalStatus, onContinue, onApprove, approving }) {
  if (!proposal) return null;
  const { C } = useAppTheme();

  const isActivated    = proposalStatus === 'activated';
  const isActivating   = proposalStatus === 'activating' || approving;
  const isError        = proposalStatus === 'activation_error';
  const isBlocked      = !proposal.executable;
  const executableColor = proposal.executable ? '#22c55e' : C.accentLt;

  // Progress steps shown during/after activation
  const steps = [
    'Validating proposal',
    'Building candidate workflow',
    'Analyzing impact',
    proposal.requires_reindex ? 'Re-indexing knowledge' : null,
    'Activating workflow',
  ].filter(Boolean);

  return (
    <div style={{
      margin: '10px 0',
      padding: '12px',
      background: isActivated
        ? 'rgba(34,197,94,0.06)'
        : 'rgba(124,58,237,0.06)',
      border: `1px solid ${isActivated ? 'rgba(34,197,94,0.25)' : 'rgba(124,58,237,0.2)'}`,
      borderRadius: 10,
      fontSize: 11,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Cpu size={12} color={isActivated ? '#22c55e' : '#7c3aed'} />
        <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 12 }}>
          {isActivated ? 'Architecture Activated' : 'Architecture Proposal'}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
          color: isActivated ? '#22c55e' : executableColor,
          background: `${isActivated ? '#22c55e' : executableColor}18`,
          border: `1px solid ${isActivated ? '#22c55e' : executableColor}44`,
          padding: '2px 6px', borderRadius: 4,
        }}>
          {isActivated ? 'ACTIVATED' : proposal.executable ? 'EXECUTABLE' : 'NOT EXECUTABLE'}
        </span>
      </div>

      {/* Summary */}
      <p style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
        {proposal.summary}
      </p>

      {/* Blocked explanation */}
      {isBlocked && !isActivated && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)',
          borderRadius: 6, marginBottom: 8,
        }}>
          <AlertTriangle size={11} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600 }}>Cannot activate: </span>
            <span style={{ fontSize: 10, color: '#a78bfa' }}>
              {proposal.unsupported_capabilities?.join(', ')} not available in current runtime.
              This proposal is saved for future review when these capabilities become available.
            </span>
          </div>
        </div>
      )}

      {/* Unsupported warning when executable */}
      {!isBlocked && proposal.unsupported_capabilities?.length > 0 && !isActivated && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)',
          borderRadius: 6, marginBottom: 8,
        }}>
          <AlertTriangle size={11} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10, color: '#a78bfa' }}>
            {proposal.unsupported_capabilities.join(', ')} will not be active in production.
          </span>
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
              <span style={{ color: '#7c3aed', fontSize: 10 }}>~</span>
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

      {/* Re-index notice */}
      {proposal.requires_reindex && !isActivated && (
        <div style={{
          fontSize: 9, color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', marginTop: 6,
        }}>
          ⚠ Activation will re-index all knowledge documents.
        </div>
      )}

      {/* Activation progress (shown while activating) */}
      {isActivating && (
        <div style={{
          marginTop: 8, padding: '8px 10px',
          background: 'rgba(124,58,237,0.08)', borderRadius: 7,
          border: '1px solid rgba(124,58,237,0.2)',
        }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginBottom: i < steps.length - 1 ? 5 : 0,
            }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                border: '2px solid #7c3aed', borderTopColor: 'transparent',
                animation: 'spin 0.7s linear infinite', flexShrink: 0,
              }} />
              <span style={{ fontSize: 10, color: '#818cf8', fontFamily: 'JetBrains Mono, monospace' }}>
                {step}...
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: 'rgba(239,68,68,0.08)', borderRadius: 7,
          border: '1px solid rgba(239,68,68,0.2)', fontSize: 10, color: '#fca5a5',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          ✕ Activation failed. Active workflow is unchanged. You may retry.
        </div>
      )}

      {/* Activated confirmation */}
      {isActivated && (
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          background: 'rgba(34,197,94,0.08)', borderRadius: 7,
          border: '1px solid rgba(34,197,94,0.2)', fontSize: 10, color: '#86efac',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <CheckCircle size={11} color="#22c55e" />
          Workflow activated. Preview and deployed chat now use the new configuration.
        </div>
      )}

      {/* Actions */}
      {!isActivated && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            onClick={onContinue}
            disabled={isActivating}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 7,
              border: '1px solid rgba(124,58,237,0.3)',
              background: 'transparent', color: isActivating ? '#334155' : '#818cf8',
              fontSize: 13, fontWeight: 600, cursor: isActivating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <RefreshCw size={10} /> Continue Discussion
          </button>

          {/* Approve Proposal button — disabled when not executable */}
          <button
            onClick={!isBlocked && !isActivating ? onApprove : undefined}
            disabled={isBlocked || isActivating}
            title={isBlocked
              ? `Cannot activate: ${proposal.unsupported_capabilities?.join(', ')} not supported`
              : isActivating ? 'Activating...'
              : 'Approve and activate this proposal'}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 7,
              background: isBlocked
                ? 'rgba(71,85,105,0.15)'
                : isActivating
                  ? 'rgba(124,58,237,0.2)'
                  : 'rgba(124,58,237,0.85)',
              border: `1px solid ${isBlocked ? 'rgba(71,85,105,0.3)' : 'rgba(124,58,237,0.5)'}`,
              color: isBlocked ? '#475569' : '#fff',
              fontSize: 11, fontWeight: 700,
              cursor: isBlocked || isActivating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              if (!isBlocked && !isActivating)
                e.currentTarget.style.background = 'rgba(124,58,237,0.95)';
            }}
            onMouseLeave={e => {
              if (!isBlocked && !isActivating)
                e.currentTarget.style.background = 'rgba(124,58,237,0.85)';
            }}
          >
            {isActivating
              ? <><div style={{ width: 10, height: 10, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Activating...</>
              : isBlocked
                ? <><AlertTriangle size={10} /> Activation Blocked</>
                : <><Play size={10} /> Approve Proposal</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isArchitect = msg.role === 'architect';
  const { C } = useAppTheme();
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      flexDirection: isArchitect ? 'row' : 'row-reverse',
      marginBottom: 10,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        background: isArchitect ? C.accentBg : 'rgba(34,197,94,0.1)',
        border: `1px solid ${isArchitect ? C.borderHi : 'rgba(34,197,94,0.3)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isArchitect ? <Bot size={11} color={C.accent} /> : <User size={11} color="#22c55e" />}
      </div>
      <div style={{
        maxWidth: '80%',
        padding: '8px 11px',
        borderRadius: isArchitect ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
        background: isArchitect ? C.accentBg : C.surface,
        border: `1px solid ${isArchitect ? C.panelBorder : C.border}`,
        fontSize: 13, color: C.t1, lineHeight: 1.65,
      }}>
        <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ArchitectChatPanel({ chatbotId, hasDraft, onClose, onActivated }) {
  const [messages,     setMessages]     = useState([]);
  const [proposal,     setProposal]     = useState(null);
  const [chatStatus,   setChatStatus]   = useState('idle');
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [approving,    setApproving]    = useState(false);
  const [error,        setError]        = useState('');
  const [initialized,  setInitialized]  = useState(false);
  const bottomRef = useRef(null);
  const { C } = useAppTheme();

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
        // Filter system messages; suppress proposal-announcement bubbles when
        // the structured ProposalDisplay card is already present.
        const hasProposal = !!data.proposed_plan;
        const visible = data.messages.filter(m => {
          if (m.role === 'system') return false;
          if (hasProposal && m.metadata?.is_proposal_announcement) return false;
          return true;
        });
        setMessages(visible);
        // Restore full status from DB, including activation states
        const dbStatus = data.proposed_status;
        if (dbStatus === 'activated') setChatStatus('activated');
        else if (dbStatus === 'activation_error') setChatStatus('activation_error');
        else if (dbStatus === 'ready_for_review') setChatStatus('ready_for_review');
        else if (dbStatus) setChatStatus('clarifying');
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
      // Build the visible message list:
      // [0] user opening message
      // [1] context-ack (Architect's canvas summary — always first)
      // [2] Architect's first real response
      const msgs = [
        { role: 'user',      content: 'Please review my draft workflow changes.', created_at: new Date().toISOString() },
      ];
      if (result.context_ack) {
        msgs.push({ role: 'architect', content: result.context_ack, created_at: new Date().toISOString() });
      }
      // Only add the Architect's response as a bubble if it's NOT a proposal announcement.
      // When a proposal is produced, the ProposalDisplay card is the authoritative UI.
      if (!result.proposal) {
        msgs.push({ role: 'architect', content: result.message, created_at: new Date().toISOString() });
      }
      setMessages(msgs);
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
      // If proposal arrived, the ProposalDisplay card is authoritative.
      // Suppress the short announcement bubble — the card renders instead.
      if (!result.proposal) {
        addMessage('architect', result.message);
      }
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

  const handleApprove = async () => {
    if (approving || !proposal) return;
    setApproving(true);
    setChatStatus('activating');
    setError('');
    try {
      const result = await architectChatApi.approveProposal(chatbotId);

      if (result.activation_blocked || result.approved === false) {
        // Blocked — unsupported capabilities
        setChatStatus('ready_for_review');
        setError(
          `Activation blocked: ${result.unsupported_capabilities?.join(', ')} ` +
          `not supported in current runtime.`
        );
        return;
      }

      if (result.activated) {
        setChatStatus('activated');
        // Notify parent so Editor can reload the active workflow
        if (onActivated) onActivated(result);
      }
    } catch (err) {
      setChatStatus('activation_error');
      setError('Activation failed: ' + err.message);
    } finally {
      setApproving(false);
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
        padding: '12px 14px',
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
            <Cpu size={13} color={C.accent} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, letterSpacing: '-0.01em' }}>Architect Chat</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background:
                  chatStatus === 'activated'        ? '#22c55e' :
                  chatStatus === 'ready_for_review' ? C.accentLt :
                  chatStatus === 'activating'       ? C.accentLt :
                  chatStatus === 'activation_error' ? '#ef4444' :
                  chatStatus === 'clarifying'       ? C.accentLt : C.t3,
                boxShadow:
                  chatStatus === 'activated'        ? '0 0 5px #22c55e' :
                  chatStatus === 'activating'       ? `0 0 5px ${C.accentLt}` :
                  chatStatus === 'ready_for_review' ? `0 0 5px ${C.accentLt}` :
                  chatStatus === 'activation_error' ? '0 0 5px #ef4444' : 'none',
              }} />
              <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                {chatStatus === 'activated'        ? 'activated'
                  : chatStatus === 'activating'    ? 'activating...'
                  : chatStatus === 'activation_error' ? 'activation failed'
                  : chatStatus === 'ready_for_review' ? 'proposal ready'
                  : chatStatus === 'clarifying'    ? 'clarifying'
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
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.t3, padding: '3px 5px', borderRadius: 5 }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = C.t3}
            >
              <XCircle size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.t3, padding: '3px 5px' }}
            onMouseEnter={e => e.currentTarget.style.color = C.t1}
            onMouseLeave={e => e.currentTarget.style.color = C.t3}
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
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.panelBorder}`, flexShrink: 0 }}>
          <button
            onClick={handleReviewDraft}
            disabled={loading}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: C.accentBg, border: `1px solid ${C.borderHi}`,
              color: C.accentLt, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = `rgba(124,58,237,0.2)`}
            onMouseLeave={e => e.currentTarget.style.background = C.accentBg}
          >
            {loading ? (
              <><div style={{ width: 12, height: 12, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Reviewing...</>
            ) : (
              <><GitBranch size={12} /> Review Draft with Architect</>
            )}
          </button>
          <p style={{ fontSize: 9, color: C.t3, fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', marginTop: 5 }}>
            Or type a message below to start a direct conversation.
          </p>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', marginTop: 30 }}>
            <Cpu size={28} color={C.t3} style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>
              Ask me to review your workflow changes, or tell me what capability you'd like to add.
            </p>
            <p style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>
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
              background: C.accentBg, border: `1px solid ${C.borderHi}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={11} color={C.accent} />
            </div>
            <div style={{
              padding: '8px 12px', background: C.accentBg,
              border: `1px solid ${C.panelBorder}`,
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

        {/* Proposal display */}
        {proposal && ['ready_for_review', 'activating', 'activated', 'activation_error'].includes(chatStatus) && (
          <ProposalDisplay
            proposal={proposal}
            proposalStatus={chatStatus}
            onContinue={handleContinueDiscussion}
            onApprove={handleApprove}
            approving={approving}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 14px', borderTop: `1px solid ${C.panelBorder}`,
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
            background: C.input, border: `1px solid ${C.inputBorder}`,
            borderRadius: 8, color: C.t1, fontSize: 12, outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = C.borderHi}
          onBlur={e => e.target.style.borderColor = C.inputBorder}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            width: 32, height: 32,
            background: input.trim() && !loading ? 'rgba(124,58,237,0.8)' : C.accentBg,
            border: `1px solid ${C.panelBorder}`,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
          }}
        >
          <Send size={13} color={input.trim() && !loading ? '#fff' : C.t3} />
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%, 100% { transform: translateY(0); opacity:0.5; } 50% { transform: translateY(-4px); opacity:1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
