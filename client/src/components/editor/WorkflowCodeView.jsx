/**
 * client/src/components/editor/WorkflowCodeView.jsx
 *
 * Phase 9D: Read-only Code tab for the Editor.
 *
 * Displays a deterministic text representation of the ACTIVE workflow.
 * Draft changes are NEVER reflected here — only activated workflows appear.
 *
 * INVARIANTS:
 *   - Never mutates workflow state
 *   - Never writes to DB
 *   - Never makes network calls
 *   - Always reads from chatbot.nodes / chatbot.connections (ACTIVE)
 *   - Regenerates when chatbot prop changes (e.g. after activation callback)
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Copy, Check, RefreshCw, AlertTriangle, Lock, Info } from 'lucide-react';
import { generateWorkflowCode } from '@/lib/workflowCodeGen';
import { useAppTheme } from '@/lib/ThemeContext';

// ─── Syntax token colors ──────────────────────────────────────────────────────
// Simple manual tokenizer — no external library needed.
// Avoids pulling in PrismJS/Monaco for a Phase 9D read-only view.

function tokenizeLine(line) {
  // Returns an array of { text, color } spans
  const tokens = [];

  // Comment lines
  if (/^\s*\/\//.test(line)) {
    tokens.push({ text: line, role: 'comment' });
    return tokens;
  }

  // Keywords
  const KEYWORDS = /\b(workflow|node|config|connections|receives_from|sends_to)\b/g;
  // Strings "..."
  const STRINGS = /"[^"]*"/g;
  // Booleans / numbers
  const PRIMITIVES = /\b(true|false|null|\d+\.?\d*)\b/g;
  // Status values
  const STATUS = /(supported|experimental|unavailable|unknown)/g;
  // Punctuation
  const PUNCT = /[{}[\]→]/g;

  let last = 0;
  const allMatches = [];

  // Collect all token ranges
  for (const re of [KEYWORDS, STRINGS, PRIMITIVES, STATUS, PUNCT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      allMatches.push({ start: m.index, end: m.index + m[0].length, text: m[0], re });
    }
  }

  // Sort by start position, resolve overlaps (first match wins)
  allMatches.sort((a, b) => a.start - b.start);
  const used = new Set();
  const clean = [];
  for (const m of allMatches) {
    let overlap = false;
    for (let i = m.start; i < m.end; i++) {
      if (used.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let i = m.start; i < m.end; i++) used.add(i);
    clean.push(m);
  }
  clean.sort((a, b) => a.start - b.start);

  // Build token spans
  for (const m of clean) {
    if (m.start > last) {
      tokens.push({ text: line.slice(last, m.start), role: 'plain' });
    }
    if (KEYWORDS.source && new RegExp(KEYWORDS.source).test(m.text)) {
      tokens.push({ text: m.text, role: 'keyword' });
    } else if (m.text.startsWith('"')) {
      tokens.push({ text: m.text, role: 'string' });
    } else if (/^(true|false|null|\d)/.test(m.text)) {
      tokens.push({ text: m.text, role: 'primitive' });
    } else if (/^(supported|experimental|unavailable|unknown)$/.test(m.text)) {
      tokens.push({ text: m.text, role: 'status' });
    } else {
      tokens.push({ text: m.text, role: 'punct' });
    }
    last = m.end;
  }
  if (last < line.length) {
    tokens.push({ text: line.slice(last), role: 'plain' });
  }
  return tokens.length > 0 ? tokens : [{ text: line, role: 'plain' }];
}

function useTokenColors(dark) {
  return {
    comment:   dark ? '#4a5568' : '#9ca3af',
    keyword:   dark ? '#a78bfa' : '#6d28d9',
    string:    dark ? '#86efac' : '#047857',
    primitive: dark ? '#38bdf8' : '#0369a1',
    status:    dark ? '#fbbf24' : '#b45309',
    punct:     dark ? '#6d6d8a' : '#7269a0',
    plain:     dark ? '#e2e8f0' : '#1a1730',
  };
}

function HighlightedCode({ text, dark }) {
  const colors = useTokenColors(dark);
  const lines = text.split('\n');

  return (
    <code style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.75 }}>
      {lines.map((line, i) => {
        const tokens = tokenizeLine(line);
        return (
          <div key={i} style={{ display: 'flex', minHeight: '1.75em' }}>
            {/* Line number */}
            <span style={{
              display: 'inline-block', width: 38, textAlign: 'right',
              paddingRight: 16, flexShrink: 0, userSelect: 'none',
              color: dark ? '#2d2d44' : '#c4b5fd', fontSize: 11,
            }}>
              {i + 1}
            </span>
            {/* Code */}
            <span>
              {tokens.map((tok, j) => (
                <span key={j} style={{ color: colors[tok.role] || colors.plain }}>
                  {tok.text}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </code>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WorkflowCodeView({ chatbot, hasDraft, draftDirty }) {
  const { dark, C } = useAppTheme();
  const [copied, setCopied] = useState(false);

  // Generate code from ACTIVE workflow — regenerates whenever chatbot changes
  // (e.g. after activation callback reloads the editor)
  const result = useMemo(() => generateWorkflowCode(chatbot), [chatbot]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(result.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result.text]);

  const hasDraftChanges = hasDraft || draftDirty;

  const codeBg   = dark ? '#080810' : '#f8f7ff';
  const headerBg = dark ? '#0d0d1c' : '#edeaff';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: C.bg, overflow: 'hidden',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    }}>
      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 20px',
        background: headerBg,
        borderBottom: `1px solid ${C.panelBorder}`,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Source indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} color={C.accent} />
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: C.t2, fontWeight: 600 }}>
            Showing Active Workflow
          </span>
        </div>

        <div style={{ width: 1, height: 14, background: C.border, margin: '0 4px' }} />

        <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
          Read-only
        </span>

        {chatbot.architect_version != null && (
          <>
            <div style={{ width: 1, height: 14, background: C.border, margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
              Architect v{chatbot.architect_version}
            </span>
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Copy button */}
        {result.pipeline.length > 0 && (
          <button
            onClick={handleCopy}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 7,
              background: copied ? 'rgba(34,197,94,0.1)' : C.accentBg,
              border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : C.panelBorder}`,
              color: copied ? '#22c55e' : C.accentLt,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {/* ── Draft notice ─────────────────────────────────────────────────────── */}
      {hasDraftChanges && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 20px',
          background: dark ? 'rgba(124,58,237,0.07)' : 'rgba(109,40,217,0.06)',
          borderBottom: `1px solid ${C.panelBorder}`,
          flexShrink: 0,
        }}>
          <Info size={12} color={C.accentLt} />
          <span style={{ fontSize: 11, color: C.t2, fontFamily: 'JetBrains Mono, monospace' }}>
            Draft changes exist — they are not reflected here until activated via the Architect.
          </span>
        </div>
      )}

      {/* ── Warnings ─────────────────────────────────────────────────────────── */}
      {result.warnings.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '7px 20px',
          background: dark ? 'rgba(251,191,36,0.06)' : 'rgba(180,83,9,0.05)',
          borderBottom: `1px solid ${dark ? 'rgba(251,191,36,0.15)' : 'rgba(180,83,9,0.15)'}`,
          flexShrink: 0,
        }}>
          <AlertTriangle size={12} color={dark ? '#fbbf24' : '#b45309'} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            {result.warnings.map((w, i) => (
              <p key={i} style={{ fontSize: 11, color: dark ? '#fbbf24' : '#b45309', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                {w}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── Code area ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        <div style={{
          padding: '20px 20px 40px',
          background: codeBg,
          minHeight: '100%',
        }}>
          {result.pipeline.length === 0 ? (
            /* Empty state */
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <RefreshCw size={28} color={C.t3} style={{ margin: '0 auto 16px' }} />
              <p style={{ fontSize: 14, color: C.t2, fontWeight: 600, marginBottom: 8 }}>
                No active workflow
              </p>
              <p style={{ fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
                Build a workflow in the Visual tab and activate it through the Architect
                to see its code representation here.
              </p>
            </div>
          ) : (
            <HighlightedCode text={result.text} dark={dark} />
          )}
        </div>
      </div>

      {/* ── Footer stats ─────────────────────────────────────────────────────── */}
      {result.pipeline.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '6px 20px',
          background: headerBg,
          borderTop: `1px solid ${C.panelBorder}`,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            {result.summary.node_count} nodes · {result.summary.connection_count} connections
          </span>
          <span style={{
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            color: result.summary.executable
              ? (dark ? '#22c55e' : '#047857')
              : (dark ? '#fbbf24' : '#b45309'),
          }}>
            {result.summary.executable ? '✓ executable' : '⚠ not fully executable'}
          </span>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            generated {new Date(result.generated_at).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}
