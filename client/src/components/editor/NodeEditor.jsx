import React, { useCallback, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, FileText, Scissors, Sparkles, Database, Cpu, MessageSquare, ScanText, Mic, Globe, Code, Filter, Languages, Image, Workflow, FileSearch, ShieldCheck, Terminal } from 'lucide-react';

const NODE_META = {
  DocumentUpload:    { icon: FileText,      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.5)',  status: 'supported'    },
  WebCrawler:        { icon: Globe,         color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   border: 'rgba(6,182,212,0.5)',   status: 'unavailable'  },
  OCR:               { icon: ScanText,      color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.5)',  status: 'unavailable'  },
  VoiceRecognition:  { icon: Mic,           color: '#ec4899', bg: 'rgba(236,72,153,0.12)',  border: 'rgba(236,72,153,0.5)',  status: 'unavailable'  },
  TextSplitter:      { icon: Scissors,      color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.5)',   status: 'supported'    },
  DataFilter:        { icon: Filter,        color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.5)',  status: 'unavailable'  },
  Translator:        { icon: Languages,     color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.5)',  status: 'unavailable'  },
  ImageAnalysis:     { icon: Image,         color: '#f43f5e', bg: 'rgba(244,63,94,0.12)',   border: 'rgba(244,63,94,0.5)',   status: 'unavailable'  },
  Embeddings:        { icon: Sparkles,      color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  border: 'rgba(168,85,247,0.5)',  status: 'supported'    },
  VectorStore:       { icon: Database,      color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.5)',  status: 'supported'    },
  LLM:               { icon: Cpu,           color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.5)',   status: 'supported'    },
  APIIntegration:    { icon: Workflow,      color: '#14b8a6', bg: 'rgba(20,184,166,0.12)',  border: 'rgba(20,184,166,0.5)',  status: 'experimental' },
  CustomCode:        { icon: Code,          color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.5)', status: 'unavailable'  },
  ChatOutput:        { icon: MessageSquare, color: '#6366f1', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.5)',  status: 'supported'    },
  DocumentProcessor: { icon: FileSearch,    color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)',  border: 'rgba(14,165,233,0.5)',  status: 'experimental' },
  DataValidation:    { icon: ShieldCheck,   color: '#84cc16', bg: 'rgba(132,204,22,0.12)',  border: 'rgba(132,204,22,0.5)',  status: 'unavailable'  },
  CodeExecution:     { icon: Terminal,      color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.5)',  status: 'unavailable'  },
};

const STATUS_DOT = {
  supported:    { color: '#22c55e', label: 'active' },
  experimental: { color: '#f59e0b', label: 'experimental' },
  unavailable:  { color: '#475569', label: 'unavailable' },
};

const CustomNode = ({ data, id }) => {
  const meta = NODE_META[data.type] || NODE_META.ChatOutput;
  const Icon = meta.icon;

  return (
    <div className="relative group" style={{ minWidth: 170 }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10, height: 10,
          background: meta.color,
          border: `2px solid ${meta.border}`,
          boxShadow: `0 0 8px ${meta.color}88`,
          left: -6
        }}
      />

      <div style={{
        background: `linear-gradient(135deg, #0d1117 60%, ${meta.bg})`,
        border: `1px solid ${meta.border}`,
        boxShadow: `0 0 16px ${meta.color}22, inset 0 0 12px ${meta.bg}`,
        borderRadius: 12,
        padding: '10px 14px',
        fontFamily: 'Inter, sans-serif',
        transition: 'box-shadow 0.2s',
      }}>
        {/* Top accent bar */}
        <div style={{
          height: 2,
          background: `linear-gradient(90deg, ${meta.color}, transparent)`,
          borderRadius: 2,
          marginBottom: 8,
          opacity: 0.8
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: 7,
            background: meta.bg,
            border: `1px solid ${meta.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            <Icon size={14} color={meta.color} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.2 }}>
              {data.label}
            </div>
            <div style={{ fontSize: 10, color: meta.color, opacity: 0.85, marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>
              {data.type}
            </div>
          </div>
        </div>

        {/* Status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: STATUS_DOT[meta.status]?.color || '#22c55e',
            boxShadow: `0 0 6px ${STATUS_DOT[meta.status]?.color || '#22c55e'}`
          }} />
          <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
            {STATUS_DOT[meta.status]?.label || 'active'}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10, height: 10,
          background: meta.color,
          border: `2px solid ${meta.border}`,
          boxShadow: `0 0 8px ${meta.color}88`,
          right: -6
        }}
      />

      <button
        onClick={() => data.onDelete?.(id)}
        style={{
          position: 'absolute', top: -8, right: -8,
          width: 18, height: 18,
          background: '#ef4444',
          border: '1px solid rgba(239,68,68,0.5)',
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0,
          transition: 'opacity 0.15s',
          boxShadow: '0 0 8px rgba(239,68,68,0.4)'
        }}
        className="group-hover:!opacity-100"
      >
        <X size={10} color="white" />
      </button>
    </div>
  );
};

const nodeTypes = { default: CustomNode };

const toFlowNodes = (nodes, onDelete) =>
  nodes.map(node => ({
    id: node.id,
    type: 'default',
    position: { x: node.x ?? 100, y: node.y ?? 100 },
    data: { label: node.label, type: node.type, params: node.params, onDelete }
  }));

const toFlowEdges = (connections) =>
  connections.map((conn) => ({
    id: `e${conn.from}-${conn.to}`,
    source: conn.from,
    target: conn.to,
    animated: true,
    style: { stroke: '#6366f1', strokeWidth: 2 },
    type: 'smoothstep'
  }));

export default function NodeEditor({ nodes, connections, onNodesChange, onConnectionsChange, onNodeSelect }) {
  const prevNodeIdsRef = useRef(null);
  const prevConnectionsRef = useRef(null);

  const handleDeleteNode = useCallback((nodeId) => {
    onNodesChange(nodes.filter(n => n.id !== nodeId));
    onConnectionsChange(connections.filter(c => c.from !== nodeId && c.to !== nodeId));
  }, [nodes, connections, onNodesChange, onConnectionsChange]);

  const [flowNodes, setNodes, onNodesChangeInternal] = useNodesState(() => toFlowNodes(nodes, handleDeleteNode));
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(() => toFlowEdges(connections));

  useEffect(() => {
    const currentIds = nodes.map(n => n.id).join(',');
    if (prevNodeIdsRef.current !== currentIds) {
      prevNodeIdsRef.current = currentIds;
      setNodes(toFlowNodes(nodes, handleDeleteNode));
    }
  }, [nodes, handleDeleteNode]);

  useEffect(() => {
    const currentConns = connections.map(c => `${c.from}->${c.to}`).join(',');
    if (prevConnectionsRef.current !== currentConns) {
      prevConnectionsRef.current = currentConns;
      setEdges(toFlowEdges(connections));
    }
  }, [connections]);

  const onConnect = useCallback((params) => {
    const newEdge = { ...params, animated: true, style: { stroke: '#6366f1', strokeWidth: 2 }, type: 'smoothstep' };
    setEdges((eds) => addEdge(newEdge, eds));
    const updated = [...connections, { from: params.source, to: params.target }];
    prevConnectionsRef.current = updated.map(c => `${c.from}->${c.to}`).join(',');
    onConnectionsChange(updated);
  }, [connections, onConnectionsChange]);

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChangeInternal(changes);
    const removeChanges = changes.filter(c => c.type === 'remove');
    if (removeChanges.length > 0) {
      const removedIds = removeChanges.map(c => c.id);
      const updated = connections.filter(conn => !removedIds.includes(`e${conn.from}-${conn.to}`));
      prevConnectionsRef.current = updated.map(c => `${c.from}->${c.to}`).join(',');
      onConnectionsChange(updated);
    }
  }, [connections, onConnectionsChange, onEdgesChangeInternal]);

  const handleNodeClick = useCallback((event, node) => {
    const orig = nodes.find(n => n.id === node.id);
    if (orig) onNodeSelect(orig);
  }, [nodes, onNodeSelect]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChangeInternal(changes);
    const deleteChanges = changes.filter(c => c.type === 'remove');
    if (deleteChanges.length > 0) {
      const deletedIds = deleteChanges.map(c => c.id);
      const updated = nodes.filter(n => !deletedIds.includes(n.id));
      prevNodeIdsRef.current = updated.map(n => n.id).join(',');
      onNodesChange(updated);
    }
  }, [nodes, onNodesChange, onNodesChangeInternal]);

  return (
    <div className="w-full h-full">
      <style>{`
        .react-flow__controls { background: #0d1117 !important; border: 1px solid rgba(99,102,241,0.3) !important; border-radius: 10px !important; box-shadow: 0 0 20px rgba(99,102,241,0.15) !important; }
        .react-flow__controls-button { background: #0d1117 !important; border-bottom: 1px solid rgba(99,102,241,0.15) !important; color: #94a3b8 !important; }
        .react-flow__controls-button:hover { background: rgba(99,102,241,0.15) !important; color: #fff !important; }
        .react-flow__minimap { background: #060a10 !important; border: 1px solid rgba(99,102,241,0.3) !important; border-radius: 10px !important; }
        .react-flow__edge-path { stroke-width: 2 !important; }
      `}</style>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
        style={{ background: '#080c14' }}
      >
        <Background color="rgba(99,102,241,0.08)" gap={32} size={1} />
        <Controls />
        <MiniMap nodeColor={(node) => NODE_META[node.data?.type]?.color || '#6366f1'} maskColor="rgba(8,12,20,0.85)" />
      </ReactFlow>
    </div>
  );
}