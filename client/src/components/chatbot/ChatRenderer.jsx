/**
 * client/src/components/chatbot/ChatRenderer.jsx
 *
 * Phase 10B — Redesigned chat UI.
 * Polished, minimal, and cool — with an animated robot avatar.
 */

import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Loader2, BookOpen, ArrowUp } from 'lucide-react';
import { getFontFamilyCss } from '@/lib/uiConfig';

// ─── Animated Robot Avatar ────────────────────────────────────────────────────
// A clean SVG robot head with animated scanning eyes.

function RobotAvatar({ size = 32, primaryColor = '#7c3aed', animated = true, pulse = false }) {
  const s = size;
  const bodySize = Math.round(s * 0.62);
  const earSize  = Math.round(s * 0.11);
  const eyeW     = Math.round(s * 0.13);
  const eyeH     = Math.round(s * 0.07);
  const antennaH = Math.round(s * 0.16);

  return (
    <div style={{
      width: s, height: s,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', flexShrink: 0,
    }}>
      {/* Pulse ring when active */}
      {pulse && (
        <div style={{
          position: 'absolute', inset: -3,
          borderRadius: '50%',
          border: `2px solid ${primaryColor}`,
          animation: 'vbot-pulse 2s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      <svg
        width={s} height={s}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        {/* Antenna */}
        <line x1="16" y1="2" x2="16" y2="7" stroke={primaryColor} strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="16" cy="2" r="1.5" fill={primaryColor}/>

        {/* Ear left */}
        <rect x="4" y="12" width="3" height="7" rx="1.5" fill={primaryColor} opacity="0.7"/>
        {/* Ear right */}
        <rect x="25" y="12" width="3" height="7" rx="1.5" fill={primaryColor} opacity="0.7"/>

        {/* Head */}
        <rect x="7" y="7" width="18" height="16" rx="4" fill={`${primaryColor}18`} stroke={primaryColor} strokeWidth="1.2"/>

        {/* Eyes — scanning left to right */}
        {animated ? (
          <>
            <rect rx={eyeH / 2} height={eyeH} width={eyeW} y={13} x={9} fill={primaryColor} opacity="0.9">
              <animate attributeName="x" values="9;12;9" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
              <animate attributeName="opacity" values="0.9;1;0.9" dur="2.4s" repeatCount="indefinite"/>
            </rect>
            <rect rx={eyeH / 2} height={eyeH} width={eyeW} y={13} x={19} fill={primaryColor} opacity="0.9">
              <animate attributeName="x" values="19;22;19" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
              <animate attributeName="opacity" values="0.9;1;0.9" dur="2.4s" repeatCount="indefinite"/>
            </rect>
          </>
        ) : (
          <>
            <rect rx={eyeH / 2} height={eyeH} width={eyeW} y={13} x={10} fill={primaryColor} opacity="0.9"/>
            <rect rx={eyeH / 2} height={eyeH} width={eyeW} y={13} x={20} fill={primaryColor} opacity="0.9"/>
          </>
        )}

        {/* Mouth — thin line */}
        <path d="M12 19.5 Q16 21.5 20 19.5" stroke={primaryColor} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.7"/>
      </svg>
    </div>
  );
}

// ─── Markdown components ──────────────────────────────────────────────────────

function makeMdComponents(primaryColor) {
  return {
    p:      ({ node, ...p }) => <p style={{ margin: '0 0 6px 0', lineHeight: 1.7 }} {...p} />,
    strong: ({ node, ...p }) => <strong style={{ fontWeight: 700, color: '#fff' }} {...p} />,
    em:     ({ node, ...p }) => <em style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.75)' }} {...p} />,
    code:   ({ node, inline, children, ...p }) => inline
      ? <code style={{ background: `${primaryColor}25`, color: `${primaryColor}`, padding: '2px 6px', borderRadius: 5, fontSize: '0.87em', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.01em' }}>{children}</code>
      : <pre style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '12px 14px', margin: '8px 0 2px', overflow: 'auto' }}><code style={{ fontSize: '0.83em', fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>{children}</code></pre>,
    ul:     ({ node, ...p }) => <ul style={{ margin: '4px 0 4px 0', paddingLeft: 18, lineHeight: 1.7 }} {...p} />,
    ol:     ({ node, ...p }) => <ol style={{ margin: '4px 0 4px 0', paddingLeft: 18, lineHeight: 1.7 }} {...p} />,
    li:     ({ node, ...p }) => <li style={{ marginBottom: 4 }} {...p} />,
    h1:     ({ node, ...p }) => <h1 style={{ fontSize: '1.1em', fontWeight: 700, margin: '10px 0 6px', color: '#fff' }} {...p} />,
    h2:     ({ node, ...p }) => <h2 style={{ fontSize: '1.0em', fontWeight: 700, margin: '8px 0 4px', color: '#fff' }} {...p} />,
    h3:     ({ node, ...p }) => <h3 style={{ fontSize: '0.95em', fontWeight: 700, margin: '6px 0 4px', color: '#fff' }} {...p} />,
    blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: `3px solid ${primaryColor}`, marginLeft: 0, paddingLeft: 12, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }} {...p} />,
  };
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ primaryColor }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(d => (
        <div key={d} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: primaryColor,
          animation: `vbot-typing 1.2s ease-in-out ${d * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── Source citations ─────────────────────────────────────────────────────────

function SourceCitations({ sources, primaryColor }) {
  if (!sources?.length) return null;
  return (
    <div style={{
      marginTop: 10, paddingTop: 10,
      borderTop: `1px solid rgba(255,255,255,0.07)`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        color: primaryColor, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace',
      }}>
        <BookOpen size={9} />
        Sources
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sources.map((s, i) => (
          <div key={i} style={{
            fontSize: 11, color: 'rgba(255,255,255,0.45)',
            display: 'flex', gap: 6, alignItems: 'baseline',
            paddingLeft: 2,
          }}>
            <span style={{ color: primaryColor, fontSize: 9, fontWeight: 700, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ lineHeight: 1.4 }}>
              {typeof s === 'string' ? s.slice(0, 120) : (s.file_name ?? s.source ?? 'Source')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Confidence indicator ─────────────────────────────────────────────────────

function ConfidencePill({ value, primaryColor }) {
  const pct   = Math.max(0, Math.min(1, value));
  const color = pct > 0.65 ? '#22c55e' : pct > 0.35 ? primaryColor : '#f59e0b';
  const label = pct > 0.65 ? 'High' : pct > 0.35 ? 'Good' : 'Low';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      marginTop: 8, padding: '3px 8px',
      background: `${color}15`,
      border: `1px solid ${color}30`,
      borderRadius: 20,
    }}>
      <div style={{ width: 36, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: 9, color, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em' }}>
        {label} · {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Suggested questions ──────────────────────────────────────────────────────

function SuggestedQuestions({ questions, primaryColor, onSelect, isFollowUp = false }) {
  if (!questions?.length) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: isFollowUp ? '8px 0 4px' : '6px 0 4px',
      // Follow-up chips are indented under the bot message
      marginLeft: isFollowUp ? 42 : 0,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700,
        color: isFollowUp ? `${primaryColor}90` : 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase', letterSpacing: '0.08em', paddingLeft: 2,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {isFollowUp ? (
          <>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1 4.5h7M5 1.5l3 3-3 3" stroke={primaryColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            You might also ask
          </>
        ) : 'Suggested'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {questions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSelect(q)}
            style={{
              fontSize: 12, padding: '8px 12px',
              background: isFollowUp ? `${primaryColor}0d` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isFollowUp ? `${primaryColor}28` : 'rgba(255,255,255,0.09)'}`,
              borderRadius: 10, color: 'rgba(255,255,255,0.72)',
              cursor: 'pointer', textAlign: 'left', lineHeight: 1.4,
              transition: 'all 0.15s', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = `${primaryColor}20`;
              e.currentTarget.style.borderColor = `${primaryColor}55`;
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = isFollowUp ? `${primaryColor}0d` : 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderColor = isFollowUp ? `${primaryColor}28` : 'rgba(255,255,255,0.09)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.72)';
            }}
          >
            <span style={{
              width: 17, height: 17, borderRadius: 5, flexShrink: 0,
              background: `${primaryColor}22`, border: `1px solid ${primaryColor}44`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: primaryColor, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
            }}>
              {i + 1}
            </span>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, config, compact, template }) {
  const { branding, behavior } = config.chat_ui;
  const isUser       = msg.role === 'user';
  const primaryColor = branding.primary_color;

  const botBubbleBg  = 'rgba(255,255,255,0.05)';
  const userBubbleBg = primaryColor;

  const mdComponents = makeMdComponents(primaryColor);

  // Timestamp-style label (optional enhancement)
  const robotSize = compact ? 28 : 34;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: compact ? 8 : 10,
      alignItems: 'flex-start',
      animation: 'vbot-fadein 0.2s ease',
    }}>
      {/* Avatar */}
      {!isUser ? (
        <div style={{ flexShrink: 0 }}>
          {branding.logo_url ? (
            <div style={{
              width: robotSize, height: robotSize, borderRadius: 10,
              overflow: 'hidden', border: `1.5px solid ${primaryColor}44`,
              background: `${primaryColor}15`,
            }}>
              <img
                src={branding.logo_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
          ) : (
            <div style={{
              width: robotSize, height: robotSize,
              background: `${primaryColor}12`,
              border: `1.5px solid ${primaryColor}30`,
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RobotAvatar size={robotSize - 8} primaryColor={primaryColor} animated={true} />
            </div>
          )}
        </div>
      ) : (
        <div style={{
          width: compact ? 28 : 34, height: compact ? 28 : 34, borderRadius: 10, flexShrink: 0,
          background: `${primaryColor}20`, border: `1.5px solid ${primaryColor}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: compact ? 13 : 15,
        }}>
          👤
        </div>
      )}

      {/* Bubble */}
      <div style={{ maxWidth: compact ? '82%' : '76%', minWidth: 0 }}>
        <div style={{
          padding: compact ? '9px 12px' : '12px 16px',
          borderRadius: isUser
            ? (compact ? '14px 4px 14px 14px' : '18px 4px 18px 18px')
            : (compact ? '4px 14px 14px 14px' : '4px 18px 18px 18px'),
          background: isUser ? userBubbleBg : botBubbleBg,
          border: `1px solid ${isUser ? `${primaryColor}60` : 'rgba(255,255,255,0.07)'}`,
          fontSize: compact ? 12 : 14,
          lineHeight: 1.65,
          color: isUser ? '#fff' : 'rgba(255,255,255,0.88)',
          letterSpacing: '-0.01em',
          // Subtle inner glow on bot messages
          boxShadow: isUser
            ? `0 2px 16px ${primaryColor}30`
            : 'none',
        }}>
          {msg.role === 'assistant'
            ? <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
            : msg.content}

          {/* Confidence pill */}
          {!isUser && msg.confidence !== undefined && !compact && (
            <ConfidencePill value={msg.confidence} primaryColor={primaryColor} />
          )}

          {/* Sources */}
          {!isUser && behavior.show_sources && msg.sources?.length > 0 && (
            <SourceCitations sources={msg.sources} primaryColor={primaryColor} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Chat headers ─────────────────────────────────────────────────────────────

function ChatHeader({ config, chatbotTitle, compact, template, onClose }) {
  const { branding } = config.chat_ui;
  const primaryColor = branding.primary_color;
  const displayName  = branding.name || chatbotTitle || 'Assistant';
  const avatarSize   = compact ? 32 : 40;

  // ── Classic ───────────────────────────────────────────────────────────────
  if (template === 'classic') {
    return (
      <div style={{
        padding: compact ? '12px 14px' : '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
        background: 'rgba(0,0,0,0.15)',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: avatarSize, height: avatarSize,
            background: `${primaryColor}12`,
            border: `1.5px solid ${primaryColor}35`,
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="" style={{ width: '100%', height: '100%', borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <RobotAvatar size={avatarSize - 8} primaryColor={primaryColor} animated={true} pulse={true} />
            )}
          </div>
          <div>
            <div style={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {displayName}
            </div>
            <div style={{ fontSize: compact ? 10 : 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e' }} />
              Online · AI Assistant
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 8, border: 'none',
              background: 'rgba(255,255,255,0.06)', cursor: 'pointer',
              color: 'rgba(255,255,255,0.45)', fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // ── Customer Support ──────────────────────────────────────────────────────
  if (template === 'customer_support') {
    return (
      <div style={{
        padding: compact ? '14px 16px' : '18px 22px',
        background: `linear-gradient(135deg, ${primaryColor}ee, ${primaryColor}99)`,
        flexShrink: 0, position: 'relative', overflow: 'hidden',
      }}>
        {/* Decorative blobs */}
        <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -20, right: 40, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: compact ? 36 : 46, height: compact ? 36 : 46, borderRadius: 14,
              background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {branding.logo_url
                ? <img src={branding.logo_url} alt="" style={{ width: '100%', height: '100%', borderRadius: 12, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                : <RobotAvatar size={compact ? 24 : 30} primaryColor="rgba(255,255,255,0.9)" animated={true} />}
            </div>
            <div>
              <div style={{ fontSize: compact ? 14 : 16, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>{displayName}</div>
              <div style={{ fontSize: compact ? 10 : 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>Support · Replies instantly</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.15)', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, transition: 'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            >×</button>
          )}
        </div>
      </div>
    );
  }

  // ── Knowledge Assistant ────────────────────────────────────────────────────
  return (
    <div style={{
      padding: compact ? '12px 16px' : '16px 22px',
      borderBottom: `1px solid ${primaryColor}25`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
      background: 'rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: compact ? 34 : 42, height: compact ? 34 : 42, borderRadius: 12,
          background: `${primaryColor}14`, border: `1.5px solid ${primaryColor}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {branding.logo_url
            ? <img src={branding.logo_url} alt="" style={{ width: '100%', height: '100%', borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
            : <RobotAvatar size={compact ? 22 : 28} primaryColor={primaryColor} animated={true} />}
        </div>
        <div>
          <div style={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>{displayName}</div>
          <div style={{ fontSize: compact ? 9 : 10, color: primaryColor, fontFamily: 'JetBrains Mono, monospace', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Knowledge Base
          </div>
        </div>
      </div>
      {onClose && (
        <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
        >×</button>
      )}
    </div>
  );
}

// ─── Main ChatRenderer ────────────────────────────────────────────────────────

export default function ChatRenderer({
  config,
  chatbotTitle = 'Assistant',
  messages     = [],
  loading      = false,
  input        = '',
  onInputChange,
  onSend,
  onSuggestedQuestion,
  compact      = false,
  onClose,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const { branding, messages: msgConfig, behavior } = config.chat_ui;
  const template     = config.chat_ui.template;
  const primaryColor = branding.primary_color;
  const bgColor      = branding.background_color;
  const fontFamily   = getFontFamilyCss(branding.font_family);

  const showSuggested = behavior.show_suggested_questions
    && behavior.suggested_questions?.length > 0
    && messages.length <= 1;

  const hasInput = input.trim().length > 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', width: '100%',
      background: bgColor,
      fontFamily,
      overflow: 'hidden',
      borderRadius: 'inherit',
    }}>
      {/* Header */}
      <ChatHeader
        config={config}
        chatbotTitle={chatbotTitle}
        compact={compact}
        template={template}
        onClose={onClose}
      />

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: compact ? '12px 12px' : '20px 18px',
        display: 'flex', flexDirection: 'column',
        gap: compact ? 12 : 16,
        // Custom scrollbar
        scrollbarWidth: 'thin',
        scrollbarColor: `${primaryColor}30 transparent`,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '30px 20px', gap: 12, textAlign: 'center',
          }}>
            <RobotAvatar size={compact ? 40 : 52} primaryColor={primaryColor} animated={true} pulse={true} />
            <div style={{ fontSize: compact ? 12 : 14, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, maxWidth: 240 }}>
              {msgConfig.empty_state_message}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Is this the last assistant message and not loading?
          const isLastAssistant = !loading
            && msg.role === 'assistant'
            && i === messages.length - 1
            && msg.suggestedQuestions?.length > 0;

          return (
            <React.Fragment key={i}>
              <MessageBubble msg={msg} config={config} compact={compact} template={template} />
              {isLastAssistant && (
                <SuggestedQuestions
                  questions={msg.suggestedQuestions}
                  primaryColor={primaryColor}
                  onSelect={onSuggestedQuestion ?? (() => {})}
                  isFollowUp={true}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* Typing indicator */}
        {loading && behavior.show_typing_indicator && (
          <div style={{ display: 'flex', gap: compact ? 8 : 10, alignItems: 'flex-start', animation: 'vbot-fadein 0.2s ease' }}>
            <div style={{
              width: compact ? 28 : 34, height: compact ? 28 : 34,
              background: `${primaryColor}12`, border: `1.5px solid ${primaryColor}30`,
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <RobotAvatar size={compact ? 18 : 22} primaryColor={primaryColor} animated={true} />
            </div>
            <div style={{
              padding: compact ? '10px 14px' : '13px 18px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: compact ? '4px 14px 14px 14px' : '4px 18px 18px 18px',
              display: 'flex', alignItems: 'center',
            }}>
              <TypingIndicator primaryColor={primaryColor} />
            </div>
          </div>
        )}

        {/* Suggested questions */}
        {showSuggested && !loading && (
          <SuggestedQuestions
            questions={behavior.suggested_questions}
            primaryColor={primaryColor}
            onSelect={onSuggestedQuestion ?? (() => {})}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: compact ? '10px 12px' : '14px 18px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.12)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          background: 'rgba(255,255,255,0.06)',
          border: `1.5px solid ${hasInput ? `${primaryColor}50` : 'rgba(255,255,255,0.1)'}`,
          borderRadius: compact ? 12 : 16,
          padding: compact ? '6px 6px 6px 12px' : '8px 8px 8px 16px',
          transition: 'border-color 0.2s',
        }}
          onFocus={() => {}}
        >
          <input
            value={input}
            onChange={e => onInputChange?.(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !loading && hasInput && onSend?.()}
            placeholder={msgConfig.placeholder}
            disabled={loading}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: compact ? 12 : 14,
              fontFamily, lineHeight: 1.5,
              padding: compact ? '2px 0' : '3px 0',
              caretColor: primaryColor,
              '::placeholder': { color: 'rgba(255,255,255,0.3)' },
            }}
          />
          <button
            onClick={onSend}
            disabled={loading || !hasInput}
            style={{
              width: compact ? 30 : 36, height: compact ? 30 : 36, flexShrink: 0,
              background: hasInput && !loading
                ? `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`
                : 'rgba(255,255,255,0.06)',
              border: `1px solid ${hasInput && !loading ? primaryColor : 'rgba(255,255,255,0.1)'}`,
              borderRadius: compact ? 9 : 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: hasInput && !loading ? 'pointer' : 'default',
              transition: 'all 0.2s',
              boxShadow: hasInput && !loading ? `0 0 14px ${primaryColor}50` : 'none',
            }}
            onMouseEnter={e => { if (hasInput && !loading) e.currentTarget.style.transform = 'scale(1.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {loading
              ? <Loader2 size={compact ? 12 : 14} color={primaryColor} style={{ animation: 'vbot-spin 0.9s linear infinite' }} />
              : <ArrowUp size={compact ? 12 : 14} color={hasInput ? '#fff' : 'rgba(255,255,255,0.25)'} />}
          </button>
        </div>
        {!compact && (
          <div style={{ textAlign: 'center', marginTop: 7, fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.02em' }}>
            Powered by Vanta AI
          </div>
        )}
      </div>

      <style>{`
        @keyframes vbot-typing  { 0%,80%,100% { transform:translateY(0); opacity:.4; } 40% { transform:translateY(-5px); opacity:1; } }
        @keyframes vbot-spin    { to { transform:rotate(360deg); } }
        @keyframes vbot-fadein  { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes vbot-pulse   { 0%,100% { opacity:0.4; transform:scale(1); } 50% { opacity:0.8; transform:scale(1.08); } }
        @keyframes vbot-slideup { from { opacity:0; transform:translateY(12px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}
