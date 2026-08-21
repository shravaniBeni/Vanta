import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Rocket, Download, Eye, EyeOff } from 'lucide-react';
import { chatbotsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import NodeEditor from '../components/editor/NodeEditor';
import NodePalette from '../components/editor/NodePalette';
import NodeProperties from '../components/editor/NodeProperties';
import WorkflowPreview from '../components/editor/WorkflowPreview';

export default function Editor() {
  const [chatbot, setChatbot] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const navigate = useNavigate();

  const chatbotId = new URLSearchParams(window.location.search).get('id');

  useEffect(() => { loadChatbot(); }, [chatbotId]);

  const loadChatbot = async () => {
    try {
      const bots = await chatbotsApi.filter({ id: chatbotId });
      if (bots.length > 0) setChatbot(bots[0]);
    } catch (err) {
      console.error('Failed to load chatbot:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNodesChange = useCallback((newNodes) => {
    setChatbot(prev => ({ ...prev, nodes: newNodes }));
  }, []);

  const handleConnectionsChange = useCallback((newConnections) => {
    setChatbot(prev => ({ ...prev, connections: newConnections }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await chatbotsApi.update(chatbot.id, {
        nodes: chatbot.nodes,
        connections: chatbot.connections,
      });
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    try {
      const embedId = `bot_${chatbot.id}_${Date.now()}`;
      await chatbotsApi.update(chatbot.id, {
        status: 'deployed',
        embed_id: embedId,
        nodes: chatbot.nodes,
        connections: chatbot.connections,
      });
      navigate(createPageUrl(`Deploy?id=${chatbot.id}`));
    } catch (err) {
      console.error('Deploy failed:', err);
      alert('Failed to deploy chatbot');
    }
  };

  const handleNodeSelect = (node) => setSelectedNode(node);

  const handleNodeUpdate = (nodeId, newParams) => {
    const updatedNodes = chatbot.nodes.map(n =>
      n.id === nodeId ? { ...n, params: { ...n.params, ...newParams } } : n
    );
    setChatbot(prev => ({ ...prev, nodes: updatedNodes }));
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080c14', color: '#64748b', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Loading workflow...'}
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080c14', color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Chatbot not found.'}
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#080c14', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{
        background: '#0a0e18',
        borderBottom: '1px solid rgba(99,102,241,0.2)',
        padding: '0 20px',
        height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            style={{ background: 'transparent', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{chatbot.title}</div>
            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
              {chatbot.description?.slice(0, 60)}{chatbot.description?.length > 60 ? '...' : ''}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowPreview(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              background: showPreview ? 'rgba(34,197,94,0.15)' : 'transparent',
              border: `1px solid ${showPreview ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.3)'}`,
              borderRadius: 8, color: showPreview ? '#22c55e' : '#94a3b8',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              background: 'transparent',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 8, color: saving ? '#475569' : '#94a3b8',
              fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.color = '#e2e8f0'; }}}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
          >
            <Download size={13} />
            {saving ? 'Saving...' : 'Save'}
          </button>

          <button
            onClick={handleDeploy}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none', borderRadius: 8, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 0 20px rgba(99,102,241,0.35)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 30px rgba(99,102,241,0.55)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 20px rgba(99,102,241,0.35)'}
          >
            <Rocket size={13} />
            Deploy
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <NodePalette onAddNode={(nodeType) => {
          const newNode = {
            id: `node_${Date.now()}`,
            type: nodeType,
            label: nodeType,
            x: 200 + Math.random() * 300,
            y: 150 + Math.random() * 200,
            params: {},
          };
          handleNodesChange([...chatbot.nodes, newNode]);
        }} />

        <div style={{ flex: 1 }}>
          <NodeEditor
            nodes={chatbot.nodes}
            connections={chatbot.connections}
            onNodesChange={handleNodesChange}
            onConnectionsChange={handleConnectionsChange}
            onNodeSelect={handleNodeSelect}
          />
        </div>

        {selectedNode && (
          <NodeProperties
            node={selectedNode}
            chatbotId={chatbot.id}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        )}

        {showPreview && (
          <WorkflowPreview
            chatbot={chatbot}
            onClose={() => setShowPreview(false)}
          />
        )}
      </div>
    </div>
  );
}
