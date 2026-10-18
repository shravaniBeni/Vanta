import React, { useState } from 'react';
import { AlertTriangle, Info, XCircle, Lightbulb, ChevronDown, ChevronUp, Zap } from 'lucide-react';

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.3)',
    iconColor: '#3b82f6',
    titleColor: '#93c5fd',
    textColor: '#bfdbfe',
    label: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.3)',
    iconColor: '#a78bfa',
    titleColor: '#fcd34d',
    textColor: '#fde68a',
    label: 'Warning',
  },
  error: {
    icon: XCircle,
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.3)',
    iconColor: '#ef4444',
    titleColor: '#fca5a5',
    textColor: '#fecaca',
    label: 'Error',
  },
};

function SingleDiagnostic({ issue }) {
  const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.warning;
  const Icon = cfg.icon;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 10,
      padding: '10px 13px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon size={14} color={cfg.iconColor} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: cfg.titleColor }}>
          {issue.title}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          color: cfg.iconColor,
          background: `${cfg.bg}`,
          border: `1px solid ${cfg.border}`,
          borderRadius: 4,
          padding: '1px 5px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {cfg.label}
        </span>
      </div>
      <p style={{ fontSize: 11, color: cfg.textColor, lineHeight: 1.5, margin: 0 }}>
        {issue.explanation}
      </p>
      {issue.suggestion && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 2 }}>
          <Lightbulb size={11} color="#a3e635" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 11, color: '#a3e635', lineHeight: 1.5 }}>
            {issue.suggestion}
          </span>
        </div>
      )}
    </div>
  );
}

export default function DiagnosticPanel({ diagnostics, amdLocal, telemetry }) {
  const [expanded, setExpanded] = useState(true);

  // Support legacy single-diagnostic format
  const issues = Array.isArray(diagnostics)
    ? diagnostics
    : diagnostics
      ? [{ id: 'legacy', title: 'Diagnostic Analysis', severity: diagnostics.severity || 'warning', explanation: diagnostics.issue, suggestion: diagnostics.suggestion }]
      : [];

  if (issues.length === 0) return null;

  const worstSeverity = issues.some(i => i.severity === 'error') ? 'error'
    : issues.some(i => i.severity === 'warning') ? 'warning' : 'info';

  return (
    <div style={{
      background: '#0a0e18',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: 'Inter, sans-serif',
      marginTop: 6,
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'rgba(99,102,241,0.08)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: expanded ? '1px solid rgba(99,102,241,0.15)' : 'none',
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: worstSeverity === 'error' ? '#ef4444' : worstSeverity === 'warning' ? '#a78bfa' : '#3b82f6',
          boxShadow: `0 0 6px ${worstSeverity === 'error' ? '#ef4444' : worstSeverity === 'warning' ? '#a78bfa' : '#3b82f6'}`,
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
          RAG DIAGNOSTICS
        </span>
        <span style={{
          fontSize: 10,
          color: '#475569',
          fontFamily: 'JetBrains Mono, monospace',
          marginLeft: 2,
        }}>
          {issues.length} issue{issues.length !== 1 ? 's' : ''} detected
        </span>

        {amdLocal && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            padding: '2px 7px',
          }}>
            <Zap size={9} color="#ef4444" />
            <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }}>
              AMD Ryzen AI · NPU
            </span>
          </div>
        )}

        <div style={{ marginLeft: amdLocal ? 4 : 'auto', color: '#475569' }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
      </button>

      {/* Issues */}
      {expanded && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {issues.map((issue) => (
            <SingleDiagnostic key={issue.id} issue={issue} />
          ))}

          {/* Telemetry footer */}
          {telemetry && (
            <div style={{
              marginTop: 4,
              padding: '7px 10px',
              background: 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.12)',
              borderRadius: 8,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              <TelemetryStat label="Avg Similarity" value={`${(telemetry.avgSimilarity * 100).toFixed(0)}%`} />
              <TelemetryStat label="Chunks Retrieved" value={telemetry.retrievedChunks?.length ?? 0} />
              <TelemetryStat label="Timestamp" value={new Date(telemetry.timestamp).toLocaleTimeString()} />
            </div>
          )}

          {amdLocal && (
            <div style={{
              fontSize: 10,
              color: '#475569',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign: 'right',
              marginTop: 2,
            }}>
              ⚡ Diagnostics processed locally on AMD NPU – no data sent to cloud
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TelemetryStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  );
}