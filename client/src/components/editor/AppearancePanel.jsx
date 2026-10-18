/**
 * client/src/components/editor/AppearancePanel.jsx
 *
 * Phase 10B — Redesigned with visual template cards, URL-based website preview
 * (iframe + graceful fallback to demo), and a dark/light demo toggle.
 *
 * INVARIANT: Never reads/writes nodes, connections, or any RAG workflow state.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Palette, MessageSquare, Settings, Layout, Save, Check, Plus, Trash2,
  ChevronDown, ChevronRight, Monitor, Sun, Moon, Globe, X, ArrowRight,
} from 'lucide-react';
import { useAppTheme } from '@/lib/ThemeContext';
import WidgetRenderer from '../widget/WidgetRenderer';
import { CHAT_UI_TEMPLATES, WIDGET_TEMPLATES, FONT_FAMILIES } from '@/lib/uiConfig';

// ─── Section accordion ────────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true, C }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 7,
          padding: '11px 0', background: 'transparent', border: 'none',
          cursor: 'pointer', color: C.t2, fontSize: 10, fontWeight: 700,
          fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
          letterSpacing: '0.08em', textAlign: 'left',
        }}
      >
        {icon}
        <span style={{ flex: 1 }}>{title}</span>
        {open ? <ChevronDown size={11} color={C.t3} /> : <ChevronRight size={11} color={C.t3} />}
      </button>
      {open && <div style={{ paddingBottom: 12 }}>{children}</div>}
    </div>
  );
}

// ─── Form primitives ─────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 5, letterSpacing: '0.04em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, maxLength = 300 }) {
  return (
    <input
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '8px 11px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 8, color: '#eeeeff', fontSize: 12, outline: 'none',
        fontFamily: 'inherit', transition: 'border-color 0.15s',
      }}
      onFocus={e => e.target.style.borderColor = 'rgba(124,58,237,0.55)'}
      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
    />
  );
}

function ColorInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="color"
        value={value ?? '#7c3aed'}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', padding: 3, background: 'transparent', flexShrink: 0 }}
      />
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder="#7c3aed"
        maxLength={9}
        style={{
          flex: 1, padding: '6px 9px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 7, color: '#eeeeff', fontSize: 11, outline: 'none',
          fontFamily: 'JetBrains Mono, monospace',
        }}
        onFocus={e => e.target.style.borderColor = 'rgba(124,58,237,0.55)'}
        onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
      />
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 38, height: 21, borderRadius: 11, flexShrink: 0,
          background: value ? '#7c3aed' : 'rgba(255,255,255,0.1)',
          border: `1px solid ${value ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
          cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 2,
          left: value ? 19 : 2,
          width: 15, height: 15, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </button>
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '8px 10px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 8, color: '#eeeeff', fontSize: 12, outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => (
        <option key={o.id} value={o.id} style={{ background: '#14141f' }}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Chat template mini-preview ───────────────────────────────────────────────

function ChatTemplateMiniPreview({ templateId, primaryColor }) {
  const isSupport = templateId === 'customer_support';
  const isKnowl   = templateId === 'knowledge_assistant';

  const headerBg = isSupport
    ? `linear-gradient(135deg, ${primaryColor}, ${primaryColor}88)`
    : 'rgba(255,255,255,0.04)';
  const headerBorder = isKnowl ? `1px solid ${primaryColor}25` : '1px solid rgba(255,255,255,0.06)';

  return (
    <div style={{
      width: '100%', height: 88,
      background: '#0d0b1a', borderRadius: 8, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column',
      pointerEvents: 'none', userSelect: 'none', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '5px 8px', flexShrink: 0,
        background: headerBg,
        borderBottom: headerBorder,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: 5, flexShrink: 0,
          background: isSupport ? 'rgba(255,255,255,0.22)' : `${primaryColor}25`,
          border: isSupport ? '1px solid rgba(255,255,255,0.3)' : `1px solid ${primaryColor}45`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7,
        }}>🤖</div>
        <div style={{ flex: 1 }}>
          <div style={{ height: 4, width: 36, borderRadius: 2, background: isSupport ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)', marginBottom: 2 }} />
          <div style={{ height: 3, width: 22, borderRadius: 2, background: isSupport ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.22)' }} />
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 9, height: 9, borderRadius: 3, background: `${primaryColor}20`, flexShrink: 0, marginTop: 1 }} />
          <div style={{ height: 9, flex: 1, maxWidth: '62%', borderRadius: isKnowl ? '2px 6px 6px 6px' : '2px 8px 8px 8px', background: 'rgba(255,255,255,0.07)' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <div style={{ height: 9, width: '42%', borderRadius: isKnowl ? '6px 2px 6px 6px' : '8px 2px 8px 8px', background: primaryColor, opacity: 0.85 }} />
          <div style={{ width: 9, height: 9, borderRadius: 3, background: `${primaryColor}20`, flexShrink: 0, marginTop: 0 }} />
        </div>
        {isKnowl && (
          <div style={{ display: 'flex', gap: 4, marginTop: 1 }}>
            {[30, 22, 26].map((w, i) => (
              <div key={i} style={{ height: 7, width: w, borderRadius: 3, border: `1px solid ${primaryColor}35` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template, selected, onSelect, primaryColor }) {
  return (
    <button
      onClick={() => onSelect(template.id)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: '10px',
        borderRadius: 12,
        border: `1.5px solid ${selected ? `${primaryColor}80` : 'rgba(255,255,255,0.07)'}`,
        background: selected ? `${primaryColor}0e` : 'rgba(255,255,255,0.02)',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%', outline: 'none',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = `${primaryColor}45`; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
    >
      <ChatTemplateMiniPreview templateId={template.id} primaryColor={primaryColor} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: selected ? '#a78bfa' : '#d4d4e8', letterSpacing: '-0.01em' }}>
          {template.label}
        </span>
        {selected && <Check size={11} color="#a78bfa" style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      </div>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', margin: 0, lineHeight: 1.5 }}>{template.description}</p>
    </button>
  );
}

// ─── Widget template card ─────────────────────────────────────────────────────

function WidgetMiniPreview({ templateId }) {
  if (templateId === 'floating') return (
    <div style={{ width: '100%', height: 62, background: '#0a0814', borderRadius: 7, border: '1px solid rgba(255,255,255,0.07)', position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', bottom: 8, right: 10, width: 26, height: 26, borderRadius: '50%', background: 'rgba(124,58,237,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>🤖</div>
      <div style={{ position: 'absolute', bottom: 40, right: 10, width: 88, height: 42, borderRadius: '10px 10px 2px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
    </div>
  );
  if (templateId === 'embedded') return (
    <div style={{ width: '100%', height: 62, background: '#0a0814', borderRadius: 7, border: '1px solid rgba(255,255,255,0.07)', padding: '6px', display: 'flex', gap: 5, pointerEvents: 'none' }}>
      <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }} />
      <div style={{ width: 60, background: 'rgba(255,255,255,0.04)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 10, background: 'rgba(124,58,237,0.3)', borderBottom: '1px solid rgba(255,255,255,0.05)' }} />
        <div style={{ flex: 1, padding: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }} />
          <div style={{ height: 5, width: '65%', background: 'rgba(124,58,237,0.45)', borderRadius: 2, alignSelf: 'flex-end' }} />
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ width: '100%', height: 62, background: 'rgba(124,58,237,0.07)', borderRadius: 7, border: '1px solid rgba(124,58,237,0.2)', padding: '6px', display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
      <div style={{ height: 10, background: 'rgba(124,58,237,0.3)', borderRadius: 4 }} />
      <div style={{ height: 6, width: '70%', background: 'rgba(255,255,255,0.07)', borderRadius: 3 }} />
      <div style={{ height: 6, width: '50%', background: 'rgba(124,58,237,0.4)', borderRadius: 3, alignSelf: 'flex-end' }} />
    </div>
  );
}

function WidgetTemplateCard({ template, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(template.id)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 7, padding: '10px',
        borderRadius: 12,
        border: `1.5px solid ${selected ? 'rgba(124,58,237,0.75)' : 'rgba(255,255,255,0.07)'}`,
        background: selected ? 'rgba(124,58,237,0.09)' : 'rgba(255,255,255,0.02)',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%', outline: 'none',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'rgba(124,58,237,0.35)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
    >
      <WidgetMiniPreview templateId={template.id} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: selected ? '#a78bfa' : '#d4d4e8' }}>{template.label}</span>
        {selected && <Check size={11} color="#a78bfa" style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      </div>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', margin: 0, lineHeight: 1.5 }}>{template.description}</p>
    </button>
  );
}

// ─── Position picker ──────────────────────────────────────────────────────────

function PositionPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[{ id: 'bottom-right', label: 'Bottom Right' }, { id: 'bottom-left', label: 'Bottom Left' }].map(opt => (
        <button key={opt.id} onClick={() => onChange(opt.id)}
          style={{
            flex: 1, padding: '8px 6px', borderRadius: 8,
            border: `1.5px solid ${value === opt.id ? 'rgba(124,58,237,0.75)' : 'rgba(255,255,255,0.07)'}`,
            background: value === opt.id ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.02)',
            color: value === opt.id ? '#a78bfa' : 'rgba(255,255,255,0.4)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
          }}
        >{opt.label}</button>
      ))}
    </div>
  );
}

// ─── Suggested questions editor ───────────────────────────────────────────────

function SuggestedQuestionsEditor({ questions, onChange }) {
  const [newQ, setNewQ] = useState('');
  const add = () => {
    const q = newQ.trim().slice(0, 200);
    if (!q || questions.length >= 10) return;
    onChange([...questions, q]);
    setNewQ('');
  };
  return (
    <div style={{ marginTop: 6 }}>
      {questions.map((q, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <div style={{ flex: 1, padding: '5px 9px', fontSize: 11, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7 }}>{q}</div>
          <button onClick={() => onChange(questions.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      {questions.length < 10 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input value={newQ} onChange={e => setNewQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add a question…" maxLength={200}
            style={{ flex: 1, padding: '6px 9px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 7, color: '#eeeeff', fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
            onFocus={e => e.target.style.borderColor = 'rgba(124,58,237,0.5)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
          />
          <button onClick={add} disabled={!newQ.trim()} style={{ padding: '6px 10px', borderRadius: 7, border: 'none', cursor: newQ.trim() ? 'pointer' : 'default', background: newQ.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 12 }}>
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Demo website ─────────────────────────────────────────────────────────────

function DemoWebsite({ dark, primaryColor, chatbotName }) {
  const bg      = dark ? '#08070f' : '#f5f4fb';
  const navBg   = dark ? 'rgba(8,7,16,0.9)' : 'rgba(255,255,255,0.92)';
  const navBdr  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const txt1    = dark ? '#f5f4fa' : '#100e1a';
  const txt2    = dark ? 'rgba(255,255,255,0.45)' : '#3f3b5e';
  const txt3    = dark ? 'rgba(255,255,255,0.28)' : '#7a769a';
  const cardBg  = dark ? 'rgba(255,255,255,0.035)' : '#ffffff';
  const cardBdr = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const pc      = primaryColor;
  const pcDim   = `${pc}55`;
  const pcGlow  = dark ? `${pc}18` : `${pc}0a`;
  const font    = "'Inter', system-ui, sans-serif";

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: bg,
      fontFamily: font,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Animated background orbs (strictly behind everything) ── */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        pointerEvents: 'none', zIndex: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: '12%', left: '50%',
          width: 320, height: 320, marginLeft: -160, marginTop: -160,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${pcGlow} 0%, transparent 70%)`,
          animation: 'dw-float1 16s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '0%', right: '5%',
          width: 260, height: 260,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${pcGlow} 0%, transparent 70%)`,
          animation: 'dw-float2 20s ease-in-out infinite',
        }} />
      </div>

      {/* ── Grid overlay ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        backgroundImage: dark
          ? 'linear-gradient(rgba(255,255,255,0.01) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.01) 1px, transparent 1px)'
          : 'linear-gradient(rgba(0,0,0,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.012) 1px, transparent 1px)',
        backgroundSize: '42px 42px',
      }} />

      {/* ── Navbar ── */}
      <div style={{
        height: 50, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 28px', gap: 24,
        background: navBg,
        borderBottom: `1px solid ${navBdr}`,
        backdropFilter: 'blur(20px)',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: `linear-gradient(145deg, ${pc}, ${pcDim})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 2px 10px ${pc}50`,
          }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,255,255,0.85)' }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 800, color: txt1, letterSpacing: '-0.03em' }}>Acme</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flex: 1 }}>
          {['Product', 'Pricing', 'Docs'].map(l => (
            <span key={l} style={{ fontSize: 13, color: txt2, fontWeight: 500 }}>{l}</span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: txt2, fontWeight: 500 }}>Sign in</span>
          <div style={{
            height: 32, padding: '0 16px', borderRadius: 8,
            background: `linear-gradient(135deg, ${pc}, ${pcDim})`,
            display: 'flex', alignItems: 'center',
            boxShadow: `0 2px 12px ${pc}45`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Get started</span>
          </div>
        </div>
      </div>

      {/* ── Hero content — fills remaining, centers vertically ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px 32px', position: 'relative', zIndex: 10,
        gap: 18,
      }}>
        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '6px 16px', borderRadius: 24,
          background: dark ? `${pc}15` : `${pc}0a`,
          border: `1px solid ${pc}28`,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: pc, boxShadow: `0 0 6px ${pc}` }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: pc, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            AI-Powered
          </span>
        </div>

        {/* Headline */}
        <div style={{
          fontSize: 30, fontWeight: 900,
          color: txt1,
          letterSpacing: '-0.045em', lineHeight: 1.08,
          textAlign: 'center', maxWidth: 420,
        }}>
          Customer support that
          <span style={{ display: 'block', color: pc }}>
            answers instantly
          </span>
        </div>

        {/* Subtext */}
        <p style={{
          fontSize: 14, color: txt2, lineHeight: 1.6,
          maxWidth: 340, margin: 0, fontWeight: 400, textAlign: 'center',
        }}>
          Deploy an AI chatbot trained on your docs in minutes. No hallucinations. Cites sources.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            height: 42, padding: '0 22px', borderRadius: 11,
            background: `linear-gradient(135deg, ${pc}, ${pcDim})`,
            display: 'flex', alignItems: 'center',
            boxShadow: `0 8px 28px ${pc}55`,
          }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              Start for free
            </span>
          </div>
          <div style={{
            height: 42, padding: '0 18px', borderRadius: 11,
            border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            background: dark ? 'transparent' : 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: `${pc}18`, border: `1px solid ${pc}28`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: `6px solid ${pc}`, marginLeft: 1 }} />
            </div>
            <span style={{ fontSize: 14, color: txt2, fontWeight: 600 }}>Watch demo</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: 'flex', gap: 24,
          padding: '10px 24px', borderRadius: 14,
          background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)',
          border: `1px solid ${cardBdr}`,
        }}>
          {[
            { value: '94%', label: 'resolution' },
            { value: '<2s', label: 'response' },
            { value: '10k+', label: 'teams' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 19, fontWeight: 900, color: pc, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 9, color: txt3, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Feature cards */}
        <div style={{ display: 'flex', gap: 10, maxWidth: 520, width: '100%' }}>
          {[
            { icon: '⚡', title: 'Instant answers', sub: 'From your docs in <2s' },
            { icon: '🔗', title: 'Cites sources', sub: 'Links to exact docs' },
            { icon: '🛡️', title: 'Grounded', sub: 'Zero hallucinations' },
          ].map((c, i) => (
            <div key={i} style={{
              flex: 1, padding: '12px',
              borderRadius: 13,
              background: cardBg,
              border: `1px solid ${cardBdr}`,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9,
                background: `${pc}18`, border: `1px solid ${pc}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, marginBottom: 8,
              }}>{c.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: txt1, marginBottom: 3, letterSpacing: '-0.02em' }}>{c.title}</div>
              <div style={{ fontSize: 10, color: txt3, lineHeight: 1.5 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Widget hint ── */}
      <div style={{
        position: 'absolute', bottom: 76, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 14px', borderRadius: 22,
        background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.8)',
        border: dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.06)',
        pointerEvents: 'none', zIndex: 10,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: pc, animation: 'dw-ping 2s ease-in-out infinite' }} />
        <span style={{ fontSize: 10, color: txt3, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
          {chatbotName || 'Your widget'} → corner
        </span>
      </div>

      <style>{`
        @keyframes dw-ping   { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
        @keyframes dw-float1 { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(25px,-15px) scale(1.1); } 66% { transform: translate(-15px,10px) scale(0.95); } }
        @keyframes dw-float2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-20px,-20px) scale(1.12); } }
      `}</style>
    </div>
  );
}

// ─── Iframe preview with browser chrome ──────────────────────────────────────

function IframePreview({ url, onFallback }) {
  const [iframeStatus, setIframeStatus] = useState('loading'); // loading | loaded | blocked
  const iframeRef = useRef(null);
  const timerRef  = useRef(null);

  useEffect(() => {
    setIframeStatus('loading');
    // Give the iframe 4s to load. If it's still "loading" and we can peek at
    // the document and it's empty, flag as blocked.
    timerRef.current = setTimeout(() => {
      try {
        const doc = iframeRef.current?.contentDocument;
        if (doc && doc.body && doc.body.innerHTML.trim() === '') {
          setIframeStatus('blocked');
          onFallback?.();
        } else {
          setIframeStatus('loaded');
        }
      } catch {
        // Cross-origin — can't read doc, which typically means it loaded fine.
        setIframeStatus('loaded');
      }
    }, 4000);
    return () => clearTimeout(timerRef.current);
  }, [url]);

  const handleLoad = () => {
    clearTimeout(timerRef.current);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc && doc.body && doc.body.innerHTML.trim() === '') {
        setIframeStatus('blocked');
        onFallback?.();
        return;
      }
    } catch { /* cross-origin fine */ }
    setIframeStatus('loaded');
  };

  const handleError = () => {
    clearTimeout(timerRef.current);
    setIframeStatus('blocked');
    onFallback?.();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#07060f' }}>
      {/* Browser chrome */}
      <div style={{
        height: 38, flexShrink: 0,
        background: 'rgba(12,10,28,0.98)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
      }}>
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {['#ef4444', '#f59e0b', '#22c55e'].map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.75 }} />
          ))}
        </div>

        {/* URL pill */}
        <div style={{
          flex: 1, maxWidth: 420, height: 24,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6, overflow: 'hidden',
        }}>
          {iframeStatus === 'loading' ? (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0, animation: 'ap-pulse 1s ease-in-out infinite' }} />
          ) : iframeStatus === 'blocked' ? (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>
            {url}
          </span>
        </div>
      </div>

      {/* Loading progress bar */}
      {iframeStatus === 'loading' && (
        <div style={{ height: 2, flexShrink: 0, background: 'rgba(124,58,237,0.15)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '45%', background: '#7c3aed', animation: 'ap-progress 1.6s ease-in-out infinite', borderRadius: 2 }} />
        </div>
      )}

      {/* The iframe */}
      {iframeStatus !== 'blocked' && (
        <iframe
          ref={iframeRef}
          src={url}
          title="Website preview"
          onLoad={handleLoad}
          onError={handleError}
          style={{
            flex: 1, border: 'none', width: '100%',
            opacity: iframeStatus === 'loaded' ? 1 : 0.3,
            transition: 'opacity 0.4s ease',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
        />
      )}

      {/* Blocked state */}
      {iframeStatus === 'blocked' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>🚫</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#eeeeff', marginBottom: 8, letterSpacing: '-0.01em' }}>
              This site blocks previewing
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 1.65, maxWidth: 300 }}>
              <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{url}</strong> uses{' '}
              <code style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(124,58,237,0.15)', padding: '1px 5px', borderRadius: 4 }}>X-Frame-Options</code>
              {' '}to prevent embedding. Most major sites do this.
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontFamily: 'JetBrains Mono, monospace' }}>
            Showing demo website instead ↓
          </div>
        </div>
      )}

      <style>{`
        @keyframes ap-progress { 0% { margin-left:-45%; } 100% { margin-left:145%; } }
        @keyframes ap-pulse    { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
      `}</style>
    </div>
  );
}

// ─── Preview canvas (floating mode) ──────────────────────────────────────────
// Shows the website (iframe or demo) as a backdrop with the widget on top.

function FloatingPreviewCanvas({ uiConfig, chatbot, DEMO_MESSAGES, previewUrl, previewDark }) {
  const [useDemo, setUseDemo] = useState(previewUrl === 'demo');
  const primaryColor = uiConfig.chat_ui.branding.primary_color ?? '#7c3aed';
  const chatbotName  = uiConfig.chat_ui.branding.name || chatbot.title;

  useEffect(() => {
    setUseDemo(previewUrl === 'demo');
  }, [previewUrl]);

  const showIframe = previewUrl !== 'demo' && !useDemo;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Background — iframe or demo */}
      {showIframe ? (
        <IframePreview url={previewUrl} onFallback={() => setUseDemo(true)} />
      ) : (
        <DemoWebsite dark={previewDark} primaryColor={primaryColor} chatbotName={chatbotName} />
      )}

      {/* If iframe is blocked and we fell back, show blocked message + demo side by side */}
      {previewUrl !== 'demo' && useDemo && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'rgba(14,10,30,0.0)',
        }} />
      )}

      {/* Widget floats on top */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
        <WidgetRenderer
          config={uiConfig}
          chatbotTitle={chatbot.title}
          messages={DEMO_MESSAGES}
          loading={false}
          input=""
          compact={true}
          previewMode={true}
        />
      </div>
    </div>
  );
}

// ─── URL bar component ────────────────────────────────────────────────────────

function UrlBar({ previewUrl, onPreviewUrlChange }) {
  const [draft, setDraft] = useState(previewUrl === 'demo' ? '' : previewUrl);

  const commit = () => {
    const v = draft.trim();
    if (!v) { onPreviewUrlChange('demo'); return; }
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    onPreviewUrlChange(url);
  };

  const clear = () => {
    setDraft('');
    onPreviewUrlChange('demo');
  };

  const isLive = previewUrl !== 'demo';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      flex: 1, maxWidth: 420,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${isLive ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.09)'}`,
      borderRadius: 9, padding: '4px 4px 4px 10px',
      transition: 'border-color 0.2s',
    }}>
      <Globe size={11} color={isLive ? '#22c55e' : 'rgba(255,255,255,0.3)'} style={{ flexShrink: 0 }} />
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') clear(); }}
        placeholder="Enter a URL to preview your widget on (e.g. yoursite.com)"
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: '#eeeeff', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          minWidth: 0,
        }}
      />
      {draft && (
        <button onClick={clear} title="Clear URL" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 14, lineHeight: 1, padding: '0 4px' }}>×</button>
      )}
      <button
        onClick={commit}
        title="Load URL"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, border: 'none',
          background: draft.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.05)',
          color: draft.trim() ? '#fff' : 'rgba(255,255,255,0.2)',
          fontSize: 11, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'default',
          transition: 'all 0.15s', flexShrink: 0,
        }}
      >
        <ArrowRight size={11} />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AppearancePanel({ chatbot, uiConfig, onChange, onSave, saving, saved }) {
  const { C } = useAppTheme();
  const [previewDark, setPreviewDark] = useState(true);
  const [previewUrl,  setPreviewUrl]  = useState('demo'); // 'demo' | 'https://...'

  const primaryColor = uiConfig.chat_ui.branding.primary_color ?? '#7c3aed';

  const DEMO_MESSAGES = [
    { role: 'assistant', content: uiConfig.chat_ui.messages.welcome_message ?? 'Hi! How can I help you?' },
    { role: 'user',      content: 'How does this work?' },
    { role: 'assistant', content: 'This is a live preview of your chatbot. Every change you make reflects here instantly.', confidence: 0.87 },
  ];

  const setChatUiTemplate = useCallback(t => onChange({ ...uiConfig, chat_ui: { ...uiConfig.chat_ui, template: t } }), [uiConfig, onChange]);
  const setWidgetTemplate = useCallback(t => onChange({ ...uiConfig, widget: { ...uiConfig.widget, template: t } }), [uiConfig, onChange]);
  const setWidgetPosition = useCallback(p => onChange({ ...uiConfig, widget: { ...uiConfig.widget, position: p } }), [uiConfig, onChange]);
  const setBranding       = useCallback((k, v) => onChange({ ...uiConfig, chat_ui: { ...uiConfig.chat_ui, branding:  { ...uiConfig.chat_ui.branding,  [k]: v } } }), [uiConfig, onChange]);
  const setMessages       = useCallback((k, v) => onChange({ ...uiConfig, chat_ui: { ...uiConfig.chat_ui, messages:  { ...uiConfig.chat_ui.messages,  [k]: v } } }), [uiConfig, onChange]);
  const setBehavior       = useCallback((k, v) => onChange({ ...uiConfig, chat_ui: { ...uiConfig.chat_ui, behavior:  { ...uiConfig.chat_ui.behavior,  [k]: v } } }), [uiConfig, onChange]);
  const setLauncher       = useCallback((k, v) => onChange({ ...uiConfig, widget:   { ...uiConfig.widget,  launcher:  { ...uiConfig.widget.launcher,   [k]: v } } }), [uiConfig, onChange]);

  const { branding, messages: msgConfig, behavior } = uiConfig.chat_ui;
  const { template: widgetTemplate, position, launcher } = uiConfig.widget;
  const chatUiTemplate = uiConfig.chat_ui.template;

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: C.bg }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div style={{
        width: 296, flexShrink: 0, background: C.panel,
        borderRight: `1px solid ${C.panelBorder}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.panelBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Palette size={13} color={C.accentLt} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: '-0.02em' }}>Appearance</span>
          </div>
          <button
            onClick={onSave} disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 13px', borderRadius: 8, border: 'none',
              background: saved ? 'rgba(34,197,94,0.18)' : saving ? C.accentBg : 'linear-gradient(135deg,#7c3aed,#8b5cf6)',
              color: saved ? '#22c55e' : '#fff', fontSize: 11, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
              boxShadow: (!saved && !saving) ? '0 0 14px rgba(124,58,237,0.3)' : 'none', transition: 'all 0.15s',
            }}
          >
            {saved ? <Check size={11} /> : <Save size={11} />}
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 24px' }}>
          <Section title="Chat Template" icon={<MessageSquare size={10} />} C={C} defaultOpen={true}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
              {CHAT_UI_TEMPLATES.map(t => (
                <TemplateCard key={t.id} template={t} selected={chatUiTemplate === t.id} onSelect={setChatUiTemplate} primaryColor={primaryColor} />
              ))}
            </div>
          </Section>

          <Section title="Branding" icon={<Palette size={10} />} C={C} defaultOpen={false}>
            <Field label="Chatbot Name"><TextInput value={branding.name} onChange={v => setBranding('name', v || null)} placeholder={chatbot.title} maxLength={80} /></Field>
            <Field label="Logo URL (https://)"><TextInput value={branding.logo_url} onChange={v => setBranding('logo_url', v || null)} placeholder="https://..." maxLength={2048} /></Field>
            <Field label="Primary Color"><ColorInput value={branding.primary_color} onChange={v => setBranding('primary_color', v)} /></Field>
            <Field label="Accent Color"><ColorInput value={branding.accent_color} onChange={v => setBranding('accent_color', v)} /></Field>
            <Field label="Background Color"><ColorInput value={branding.background_color} onChange={v => setBranding('background_color', v)} /></Field>
            <Field label="User Bubble Color"><ColorInput value={branding.user_message_color} onChange={v => setBranding('user_message_color', v)} /></Field>
            <Field label="Bot Bubble Color"><ColorInput value={branding.bot_message_color} onChange={v => setBranding('bot_message_color', v)} /></Field>
            <Field label="Font"><Select value={branding.font_family} onChange={v => setBranding('font_family', v)} options={FONT_FAMILIES} /></Field>
          </Section>

          <Section title="Messages" icon={<MessageSquare size={10} />} C={C} defaultOpen={false}>
            <Field label="Welcome Message"><TextInput value={msgConfig.welcome_message} onChange={v => setMessages('welcome_message', v)} placeholder="Hi! How can I help you?" maxLength={300} /></Field>
            <Field label="Input Placeholder"><TextInput value={msgConfig.placeholder} onChange={v => setMessages('placeholder', v)} placeholder="Ask me anything..." maxLength={120} /></Field>
            <Field label="Empty State"><TextInput value={msgConfig.empty_state_message} onChange={v => setMessages('empty_state_message', v)} placeholder="Ask me anything about our knowledge base." maxLength={300} /></Field>
          </Section>

          <Section title="Behavior" icon={<Settings size={10} />} C={C} defaultOpen={false}>
            <Toggle value={behavior.show_sources}             onChange={v => setBehavior('show_sources', v)}             label="Show Sources" />
            <Toggle value={behavior.show_typing_indicator}    onChange={v => setBehavior('show_typing_indicator', v)}    label="Typing Indicator" />
            <Toggle value={behavior.show_suggested_questions} onChange={v => setBehavior('show_suggested_questions', v)} label="Suggested Questions" />
            {behavior.show_suggested_questions && (
              <>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace', margin: '4px 0' }}>QUESTIONS</div>
                <SuggestedQuestionsEditor questions={behavior.suggested_questions ?? []} onChange={v => setBehavior('suggested_questions', v)} />
              </>
            )}
          </Section>

          <Section title="Widget" icon={<Layout size={10} />} C={C} defaultOpen={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
              {WIDGET_TEMPLATES.map(t => (
                <WidgetTemplateCard key={t.id} template={t} selected={widgetTemplate === t.id} onSelect={setWidgetTemplate} />
              ))}
            </div>
            {widgetTemplate === 'floating' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }}>POSITION</div>
                <PositionPicker value={position} onChange={setWidgetPosition} />
                <div style={{ marginTop: 12 }}>
                  <Toggle value={launcher.enabled} onChange={v => setLauncher('enabled', v)} label="Show Launcher Button" />
                  {launcher.enabled && <Field label="Button Label"><TextInput value={launcher.label} onChange={v => setLauncher('label', v)} placeholder="Chat" maxLength={30} /></Field>}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── Right: Preview ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '7px 14px', flexShrink: 0, background: C.panel, borderBottom: `1px solid ${C.panelBorder}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Monitor size={12} color={C.accentLt} />
          <span style={{ fontSize: 10, fontWeight: 700, color: C.t3, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
            {CHAT_UI_TEMPLATES.find(t => t.id === chatUiTemplate)?.label} · {WIDGET_TEMPLATES.find(t => t.id === widgetTemplate)?.label}
          </span>

          {/* URL bar — only for floating widget (makes sense there) */}
          {widgetTemplate === 'floating' && (
            <UrlBar previewUrl={previewUrl} onPreviewUrlChange={setPreviewUrl} />
          )}

          <div style={{ flex: 1 }} />

          {/* Demo background toggle (only shown when no custom URL loaded) */}
          {(widgetTemplate === 'floating' && previewUrl === 'demo') && (
            <button
              onClick={() => setPreviewDark(d => !d)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                color: C.t2, fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.09)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              {previewDark ? <Sun size={11} /> : <Moon size={11} />}
              {previewDark ? 'Light bg' : 'Dark bg'}
            </button>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {widgetTemplate === 'floating' ? (
            <FloatingPreviewCanvas
              uiConfig={uiConfig}
              chatbot={chatbot}
              DEMO_MESSAGES={DEMO_MESSAGES}
              previewUrl={previewUrl}
              previewDark={previewDark}
            />
          ) : widgetTemplate === 'embedded' ? (
            <div style={{ position: 'absolute', inset: 0, background: '#0a0814', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', gap: 16, width: '88%', height: '82%', maxWidth: 680 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />
                  {[80,60,90,55,70].map((w,i) => <div key={i} style={{ height: 9, width:`${w}%`, borderRadius: 5, background: 'rgba(255,255,255,0.05)' }} />)}
                </div>
                <div style={{ width: 280, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,0.5)', flexShrink: 0 }}>
                  <WidgetRenderer config={uiConfig} chatbotTitle={chatbot.title} messages={DEMO_MESSAGES} loading={false} input="" compact={true} previewMode={true} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0 }}>
              <WidgetRenderer config={uiConfig} chatbotTitle={chatbot.title} messages={DEMO_MESSAGES} loading={false} input="" compact={true} previewMode={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
