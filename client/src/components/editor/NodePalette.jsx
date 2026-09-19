/**
 * client/src/components/editor/NodePalette.jsx
 *
 * Phase 9A: Node palette with capability status badges.
 *
 * Each node shows its runtime_status from the capability registry:
 *   supported     — fully executable, no badge needed
 *   experimental  — orange "Experimental" badge, still draggable
 *   unavailable   — slate "Coming Soon" badge, still draggable for experimentation
 *
 * Unsupported nodes can be added to the canvas for visual planning, but
 * the topology validator will flag them and they cannot be activated.
 */

import React from 'react';
import {
  FileText, Scissors, Sparkles, Database, Cpu as CpuIcon, MessageSquare,
  ScanText, Mic, Globe, Code, Filter, Languages, Image as ImageIcon,
  Workflow, Plus, FileSearch, ShieldCheck, Terminal
} from 'lucide-react';

// Static registry matching server/src/nodeCapabilityRegistry.js
// Used by the palette to render status badges without an API call.
const NODE_PALETTE_DEFS = [
  // Input
  { type: 'DocumentUpload',   label: 'Knowledge Source', icon: FileText,    color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  category: 'Input',       status: 'supported'    },
  { type: 'WebCrawler',       label: 'Web Crawler',      icon: Globe,        color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   category: 'Input',       status: 'unavailable'  },
  { type: 'VoiceRecognition', label: 'Voice to Text',    icon: Mic,          color: '#ec4899', bg: 'rgba(236,72,153,0.12)', category: 'Input',       status: 'unavailable'  },
  // Processing
  { type: 'DocumentProcessor',label: 'Doc Processor',    icon: FileSearch,   color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', category: 'Processing',  status: 'experimental' },
  { type: 'OCR',              label: 'OCR Layer',        icon: ScanText,     color: '#10b981', bg: 'rgba(16,185,129,0.12)', category: 'Processing',  status: 'unavailable'  },
  { type: 'TextSplitter',     label: 'Text Splitter',    icon: Scissors,     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  category: 'Processing',  status: 'supported'    },
  { type: 'DataFilter',       label: 'Data Filter',      icon: Filter,       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', category: 'Processing',  status: 'unavailable'  },
  { type: 'DataValidation',   label: 'Data Validation',  icon: ShieldCheck,  color: '#84cc16', bg: 'rgba(132,204,22,0.12)', category: 'Processing',  status: 'unavailable'  },
  { type: 'Translator',       label: 'Translator',       icon: Languages,    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', category: 'Processing',  status: 'unavailable'  },
  { type: 'ImageAnalysis',    label: 'Image Analysis',   icon: ImageIcon,    color: '#f43f5e', bg: 'rgba(244,63,94,0.12)',  category: 'Processing',  status: 'unavailable'  },
  { type: 'Embeddings',       label: 'Embeddings',       icon: Sparkles,     color: '#a855f7', bg: 'rgba(168,85,247,0.12)', category: 'Processing',  status: 'supported'    },
  // Storage
  { type: 'VectorStore',      label: 'Vector Store',     icon: Database,     color: '#f97316', bg: 'rgba(249,115,22,0.12)', category: 'Storage',     status: 'supported'    },
  // AI
  { type: 'LLM',              label: 'LLM',              icon: CpuIcon,      color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  category: 'AI',          status: 'supported'    },
  // Integration
  { type: 'APIIntegration',   label: 'API Integration',  icon: Workflow,     color: '#14b8a6', bg: 'rgba(20,184,166,0.12)', category: 'Integration', status: 'experimental' },
  // Advanced
  { type: 'CustomCode',       label: 'Custom Code',      icon: Code,         color: '#94a3b8', bg: 'rgba(148,163,184,0.12)',category: 'Advanced',    status: 'unavailable'  },
  { type: 'CodeExecution',    label: 'Code Execution',   icon: Terminal,     color: '#fb923c', bg: 'rgba(251,146,60,0.12)', category: 'Advanced',    status: 'unavailable'  },
  // Output
  { type: 'ChatOutput',       label: 'Chat Output',      icon: MessageSquare,color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', category: 'Output',      status: 'supported'    },
];

const STATUS_BADGE = {
  experimental: { text: 'Experimental', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  unavailable:  { text: 'Coming Soon',  color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
};

const CATEGORY_COLORS = {
  Input:       '#3b82f6',
  Processing:  '#a855f7',
  Storage:     '#f97316',
  AI:          '#ef4444',
  Integration: '#14b8a6',
  Advanced:    '#94a3b8',
  Output:      '#7c3aed',
};

const grouped = NODE_PALETTE_DEFS.reduce((acc, node) => {
  if (!acc[node.category]) acc[node.category] = [];
  acc[node.category].push(node);
  return acc;
}, {});

export default function NodePalette({ onAddNode }) {
  return (
    <div style={{
      width: 230,
      height: '100%',
      background: '#0d0d1c',
      borderRight: '1px solid rgba(124,58,237,0.2)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, sans-serif',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 14px 10px',
        borderBottom: '1px solid rgba(124,58,237,0.15)',
        position: 'sticky', top: 0,
        background: '#0d0d1c',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', boxShadow: '0 0 6px #7c3aed' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
            Node Palette
          </span>
        </div>
        <p style={{ fontSize: 9, color: '#334155', fontFamily: 'JetBrains Mono, monospace', marginTop: 4, marginBottom: 0 }}>
          Unsupported nodes are visual only.
        </p>
      </div>

      {/* Categories */}
      <div style={{ padding: '10px 10px', flex: 1 }}>
        {Object.entries(grouped).map(([category, nodes]) => (
          <div key={category} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 9, fontWeight: 700,
              color: CATEGORY_COLORS[category] || '#64748b',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 5, paddingLeft: 4,
              fontFamily: 'JetBrains Mono, monospace'
            }}>
              {category}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {nodes.map(node => {
                const Icon  = node.icon;
                const badge = STATUS_BADGE[node.status];
                const isSupported = node.status === 'supported';

                return (
                  <button
                    key={node.type}
                    onClick={() => onAddNode(node.type)}
                    title={isSupported ? node.label : `${node.label} — ${badge?.text}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 9px',
                      background: 'transparent',
                      border: '1px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      width: '100%',
                      opacity: isSupported ? 1 : 0.7,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = node.bg;
                      e.currentTarget.style.borderColor = `${node.color}44`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: node.bg, border: `1px solid ${node.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={12} color={node.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 500, display: 'block' }}>
                        {node.label}
                      </span>
                      {badge && (
                        <span style={{
                          fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
                          color: badge.color,
                          background: badge.bg,
                          padding: '1px 4px', borderRadius: 3,
                          display: 'inline-block', marginTop: 1,
                          letterSpacing: '0.05em',
                        }}>
                          {badge.text}
                        </span>
                      )}
                    </div>
                    <Plus size={10} color="#334155" style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
