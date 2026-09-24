import React, { useState } from 'react';
import {
  FileText, Scissors, Sparkles, Database, Cpu as CpuIcon, MessageSquare,
  ScanText, Mic, Globe, Code, Filter, Languages, Image as ImageIcon,
  Workflow, Plus, FileSearch, ShieldCheck, Terminal,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAppTheme } from '@/lib/ThemeContext';

const NODE_PALETTE_DEFS = [
  { type: 'DocumentUpload',    label: 'Knowledge Source', icon: FileText,     color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  category: 'Input',       status: 'supported'    },
  { type: 'WebCrawler',        label: 'Web Crawler',      icon: Globe,         color: '#22d3ee', bg: 'rgba(34,211,238,0.10)',  category: 'Input',       status: 'unavailable'  },
  { type: 'VoiceRecognition',  label: 'Voice to Text',    icon: Mic,           color: '#c084fc', bg: 'rgba(192,132,252,0.10)', category: 'Input',       status: 'unavailable'  },
  { type: 'DocumentProcessor', label: 'Doc Processor',    icon: FileSearch,    color: '#38bdf8', bg: 'rgba(56,189,248,0.10)',  category: 'Processing',  status: 'experimental' },
  { type: 'OCR',               label: 'OCR Layer',        icon: ScanText,      color: '#34d399', bg: 'rgba(52,211,153,0.10)',  category: 'Processing',  status: 'unavailable'  },
  { type: 'TextSplitter',      label: 'Text Splitter',    icon: Scissors,      color: '#4ade80', bg: 'rgba(74,222,128,0.10)',  category: 'Processing',  status: 'supported'    },
  { type: 'DataFilter',        label: 'Data Filter',      icon: Filter,        color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', category: 'Processing',  status: 'unavailable'  },
  { type: 'DataValidation',    label: 'Data Validation',  icon: ShieldCheck,   color: '#86efac', bg: 'rgba(134,239,172,0.10)', category: 'Processing',  status: 'unavailable'  },
  { type: 'Translator',        label: 'Translator',       icon: Languages,     color: '#c4b5fd', bg: 'rgba(196,181,253,0.10)', category: 'Processing',  status: 'unavailable'  },
  { type: 'ImageAnalysis',     label: 'Image Analysis',   icon: ImageIcon,     color: '#fb7185', bg: 'rgba(251,113,133,0.10)', category: 'Processing',  status: 'unavailable'  },
  { type: 'Embeddings',        label: 'Embeddings',       icon: Sparkles,      color: '#e879f9', bg: 'rgba(232,121,249,0.10)', category: 'Processing',  status: 'supported'    },
  { type: 'VectorStore',       label: 'Vector Store',     icon: Database,      color: '#fb923c', bg: 'rgba(251,146,60,0.10)',  category: 'Storage',     status: 'supported'    },
  { type: 'LLM',               label: 'LLM',              icon: CpuIcon,       color: '#f87171', bg: 'rgba(248,113,113,0.10)', category: 'AI',          status: 'supported'    },
  { type: 'APIIntegration',    label: 'API Integration',  icon: Workflow,      color: '#2dd4bf', bg: 'rgba(45,212,191,0.10)',  category: 'Integration', status: 'experimental' },
  { type: 'CustomCode',        label: 'Custom Code',      icon: Code,          color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', category: 'Advanced',    status: 'unavailable'  },
  { type: 'CodeExecution',     label: 'Code Execution',   icon: Terminal,      color: '#fdba74', bg: 'rgba(253,186,116,0.10)', category: 'Advanced',    status: 'unavailable'  },
  { type: 'ChatOutput',        label: 'Chat Output',      icon: MessageSquare, color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', category: 'Output',      status: 'supported'    },
];

const STATUS_BADGE = {
  experimental: { text: 'Beta',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  unavailable:  { text: 'Soon',        color: '#475569', bg: 'rgba(71,85,105,0.12)'   },
};

const CATEGORIES = ['Input', 'Processing', 'Storage', 'AI', 'Integration', 'Advanced', 'Output'];

const CATEGORY_COLOR = {
  Input:       '#60a5fa',
  Processing:  '#c084fc',
  Storage:     '#fb923c',
  AI:          '#f87171',
  Integration: '#2dd4bf',
  Advanced:    '#94a3b8',
  Output:      '#a78bfa',
};

const grouped = NODE_PALETTE_DEFS.reduce((acc, n) => {
  if (!acc[n.category]) acc[n.category] = [];
  acc[n.category].push(n);
  return acc;
}, {});

export default function NodePalette({ onAddNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [openCats, setOpenCats]   = useState(() =>
    Object.fromEntries(CATEGORIES.map(c => [c, true]))
  );
  const { C } = useAppTheme();

  const toggleCat = cat =>
    setOpenCats(prev => ({ ...prev, [cat]: !prev[cat] }));

  const W = collapsed ? 52 : 280;

  return (
    <div style={{
      width: W, flexShrink: 0, height: '100%',
      background: C.nodePalette,
      borderRight: `1px solid ${C.panelBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      transition: 'width 0.2s ease',
      overflow: 'hidden',
      position: 'relative',
    }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? 0 : '0 12px 0 14px',
        borderBottom: `1px solid ${C.panelBorder}`,
        background: C.panel,
      }}>
        {!collapsed && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: C.t3,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: 'JetBrains Mono, monospace',
            whiteSpace: 'nowrap',
          }}>
            Nodes
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand palette' : 'Collapse palette'}
          style={{
            width: 30, height: 30, borderRadius: 8,
            border: `1px solid ${C.panelBorder}`,
            background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.t3, transition: 'all 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.accentBg; e.currentTarget.style.color = C.accentLt; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.t3; }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* ── Node list ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '8px 0' : '8px 0 16px' }}>

        {collapsed ? (
          /* ── Icon-only mode ─────────────────────────────────────────── */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 6px' }}>
            {NODE_PALETTE_DEFS.map(node => {
              const Icon = node.icon;
              return (
                <button
                  key={node.type}
                  onClick={() => onAddNode(node.type)}
                  title={node.label + (node.status !== 'supported' ? ` (${STATUS_BADGE[node.status]?.text})` : '')}
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: node.bg,
                    border: `1px solid ${node.color}33`,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: node.status === 'supported' ? 1 : 0.55,
                    transition: 'all 0.15s', flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.borderColor = node.color + '88'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = node.status === 'supported' ? '1' : '0.55'; e.currentTarget.style.borderColor = node.color + '33'; }}
                >
                  <Icon size={16} color={node.color} />
                </button>
              );
            })}
          </div>
        ) : (
          /* ── Expanded mode ──────────────────────────────────────────── */
          CATEGORIES.map(cat => {
            const nodes = grouped[cat];
            if (!nodes?.length) return null;
            const open = openCats[cat];
            const catColor = CATEGORY_COLOR[cat];

            return (
              <div key={cat}>
                {/* Category header */}
                <button
                  onClick={() => toggleCat(cat)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: 7, padding: '7px 12px 6px 16px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ width: 3, height: 12, borderRadius: 2, background: catColor, flexShrink: 0 }} />
                  <span style={{
                    flex: 1, fontSize: 10, fontWeight: 700,
                    color: catColor, letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {cat}
                  </span>
                  {open
                    ? <ChevronUp size={10} color={C.t3} />
                    : <ChevronDown size={10} color={C.t3} />}
                </button>

                {/* Nodes in this category */}
                {open && (
                  <div style={{ paddingBottom: 6 }}>
                    {nodes.map(node => {
                      const Icon  = node.icon;
                      const badge = STATUS_BADGE[node.status];
                      return (
                        <button
                          key={node.type}
                          onClick={() => onAddNode(node.type)}
                          title={node.label}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center',
                            gap: 10, padding: '9px 12px 9px 18px',
                            background: 'transparent', border: 'none',
                            cursor: 'pointer', textAlign: 'left',
                            opacity: node.status === 'supported' ? 1 : 0.65,
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = node.bg;
                            e.currentTarget.style.opacity = '1';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.opacity = node.status === 'supported' ? '1' : '0.65';
                          }}
                        >
                          {/* Icon box */}
                          <div style={{
                            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                            background: node.bg,
                            border: `1px solid ${node.color}33`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Icon size={15} color={node.color} />
                          </div>

                          {/* Label + badge */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 600, color: C.t1,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              lineHeight: 1.3,
                            }}>
                              {node.label}
                            </div>
                            {badge && (
                              <span style={{
                                fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                                fontWeight: 700, color: badge.color,
                                background: badge.bg, letterSpacing: '0.05em',
                                padding: '1px 6px', borderRadius: 4,
                                display: 'inline-block', marginTop: 2,
                              }}>
                                {badge.text}
                              </span>
                            )}
                          </div>

                          {/* Add indicator */}
                          <Plus size={12} color={C.t3} style={{ flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <style>{`
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.panelBorder}; border-radius: 3px; }
      `}</style>
    </div>
  );
}
