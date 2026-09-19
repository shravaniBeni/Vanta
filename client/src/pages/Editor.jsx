/**
 * client/src/pages/Editor.jsx
 *
 * Phase 9A: Draft workflow editing.
 *
 * ACTIVE vs DRAFT model:
 *   - chatbot.nodes / chatbot.connections  — ACTIVE executable workflow
 *     (used by Preview, deployed chat, and runtime)
 *   - draftNodes / draftConnections        — canvas edits in progress
 *     (saved to draft_nodes/draft_connections, NOT the active workflow)
 *
 * User actions:
 *   - Add/remove/connect nodes → changes draftNodes/draftConnections
 *   - Save Draft               → PATCH /api/workflow/:id/draft
 *   - Discard Draft            → DELETE /api/workflow/:id/draft, reset canvas to active
 *   - Preview                  → always uses ACTIVE workflow (chatbot.nodes)
 *   - Deploy                   → uses ACTIVE workflow
 *
 * Phase 9B will add the "Propose to Architect" and "Activate" flows.
 *
 * Position changes (x/y drag) affect draft canvas state but are
 * not counted as semantic architectural changes by diffWorkflow().
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Rocket, Eye, EyeOff, Save, Trash2, GitBranch, AlertTriangle, CheckCircle, MessageSquare } from 'lucide-react';
import { chatbotsApi, workflowApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import NodeEditor from '../components/editor/NodeEditor';
import NodePalette from '../components/editor/NodePalette';
import NodeProperties from '../components/editor/NodeProperties';
import WorkflowPreview from '../components/editor/WorkflowPreview';
import ArchitectChatPanel from '../components/editor/ArchitectChatPanel';

export default function Editor() {
  const navigate     = useNavigate();
  const chatbotId    = new URLSearchParams(window.location.search).get('id');

  // ── Core state ─────────────────────────────────────────────────────────────
  const [chatbot,     setChatbot]     = useState(null);  // active workflow
  const [loading,     setLoading]     = useState(true);

  // ── Draft state ────────────────────────────────────────────────────────────
  // draftNodes/Connections: the canvas the user sees and edits
  // hasDraft: whether a persisted draft exists in the DB
  // draftDirty: canvas has unsaved changes relative to the persisted draft
  const [draftNodes,       setDraftNodes]       = useState([]);
  const [draftConnections, setDraftConnections] = useState([]);
  const [hasDraft,         setHasDraft]         = useState(false);
  const [draftDirty,       setDraftDirty]       = useState(false);
  const [savingDraft,      setSavingDraft]       = useState(false);
  const [discarding,       setDiscarding]        = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [selectedNode,   setSelectedNode]   = useState(null);
  const [showPreview,    setShowPreview]     = useState(false);
  const [showArchitect,  setShowArchitect]   = useState(false);
  const [deploying,      setDeploying]       = useState(false);
  const [draftError,     setDraftError]      = useState('');

  // Track the persisted draft to detect dirty state
  const persistedDraftRef = useRef({ nodes: [], connections: [] });

  // ── Load chatbot + draft ────────────────────────────────────────────────────

  useEffect(() => {
    if (chatbotId) loadEditor();
  }, [chatbotId]);

  const loadEditor = async () => {
    setLoading(true);
    try {
      // Try to load via the workflow endpoint for draft-aware data
      const [bots, workflowData] = await Promise.all([
        chatbotsApi.filter({ id: chatbotId }),
        workflowApi.get(chatbotId).catch(() => null),
      ]);

      if (!bots.length) { setLoading(false); return; }
      const bot = bots[0];
      setChatbot(bot);

      if (workflowData?.has_draft && workflowData.draft) {
        // Restore persisted draft onto canvas
        const dn = workflowData.draft.nodes       || [];
        const dc = workflowData.draft.connections || [];
        setDraftNodes(dn);
        setDraftConnections(dc);
        setHasDraft(true);
        setDraftDirty(false);
        persistedDraftRef.current = { nodes: dn, connections: dc };
      } else {
        // No draft — show active workflow on canvas
        setDraftNodes(bot.nodes       || []);
        setDraftConnections(bot.connections || []);
        setHasDraft(false);
        setDraftDirty(false);
        persistedDraftRef.current = { nodes: bot.nodes || [], connections: bot.connections || [] };
      }
    } catch (err) {
      console.error('Failed to load editor:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Detect dirty state ──────────────────────────────────────────────────────
  // Canvas is dirty if it differs from the last persisted draft (or active if no draft)

  const markDirty = useCallback(() => {
    setDraftDirty(true);
    setDraftError('');
  }, []);

  // ── Canvas change handlers ─────────────────────────────────────────────────
  // These update DRAFT only — never the active workflow

  const handleNodesChange = useCallback((newNodes) => {
    setDraftNodes(newNodes);
    markDirty();
  }, [markDirty]);

  const handleConnectionsChange = useCallback((newConnections) => {
    setDraftConnections(newConnections);
    markDirty();
  }, [markDirty]);

  const handleNodeUpdate = useCallback((nodeId, newParams) => {
    setDraftNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, params: { ...n.params, ...newParams } } : n
    ));
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, params: { ...prev.params, ...newParams } } : prev);
    markDirty();
  }, [markDirty]);

  // ── Save Draft ─────────────────────────────────────────────────────────────

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setDraftError('');
    try {
      await workflowApi.saveDraft(chatbotId, draftNodes, draftConnections);
      setHasDraft(true);
      setDraftDirty(false);
      persistedDraftRef.current = { nodes: draftNodes, connections: draftConnections };
    } catch (err) {
      setDraftError('Failed to save draft: ' + err.message);
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Discard Draft ──────────────────────────────────────────────────────────

  const handleDiscardDraft = async () => {
    setDiscarding(true);
    setDraftError('');
    try {
      await workflowApi.discardDraft(chatbotId);
      // Reset canvas to active workflow
      setDraftNodes(chatbot.nodes       || []);
      setDraftConnections(chatbot.connections || []);
      setHasDraft(false);
      setDraftDirty(false);
      persistedDraftRef.current = { nodes: chatbot.nodes || [], connections: chatbot.connections || [] };
      setSelectedNode(null);
    } catch (err) {
      setDraftError('Failed to discard draft: ' + err.message);
    } finally {
      setDiscarding(false);
    }
  };

  // ── Deploy (uses ACTIVE workflow — unchanged from Phase 8) ─────────────────

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const embedId = `bot_${chatbot.id}_${Date.now()}`;
      await chatbotsApi.update(chatbot.id, {
        status:   'deployed',
        embed_id: embedId,
        // NOTE: deploys ACTIVE nodes/connections, not the draft
        nodes:       chatbot.nodes,
        connections: chatbot.connections,
      });
      navigate(createPageUrl(`Deploy?id=${chatbot.id}`));
    } catch (err) {
      console.error('Deploy failed:', err);
      alert('Failed to deploy chatbot');
    } finally {
      setDeploying(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const isEditing = hasDraft || draftDirty;

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Loading workflow...'}
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'hsl(var(--background))', color: 'hsl(var(--danger))', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Chatbot not found.'}
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'hsl(var(--background))', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'hsl(var(--background))',
        borderBottom: '1px solid rgba(124,58,237, 0.2)',
        padding: '0 20px',
        height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        {/* Left: back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            style={{ background: 'transparent', border: '1px solid rgba(124,58,237, 0.2)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--foreground))' }}>{chatbot.title}</span>
              {/* Draft indicator */}
              {isEditing && (
                <span style={{
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                  color: draftDirty ? '#a78bfa' : '#7c3aed',
                  background: draftDirty ? 'rgba(167,139,250,0.1)' : 'rgba(124,58,237, 0.1)',
                  border: `1px solid ${draftDirty ? 'rgba(167,139,250,0.3)' : 'rgba(124,58,237, 0.3)'}`,
                  padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  <GitBranch size={8} />
                  {draftDirty ? 'UNSAVED DRAFT' : 'DRAFT'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', fontFamily: 'JetBrains Mono, monospace' }}>
              {isEditing
                ? 'Draft changes — preview and deployed chat use the active workflow'
                : chatbot.description?.slice(0, 55) + (chatbot.description?.length > 55 ? '...' : '')}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Preview — uses ACTIVE workflow */}
          <button
            onClick={() => setShowPreview(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px',
              background: showPreview ? 'rgba(34,197,94,0.15)' : 'transparent',
              border: `1px solid ${showPreview ? 'rgba(34,197,94,0.4)' : 'rgba(124,58,237, 0.3)'}`,
              borderRadius: 8, color: showPreview ? '#22c55e' : '#94a3b8',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>

          {/* Architect Chat toggle */}
          <button
            onClick={() => setShowArchitect(a => !a)}
            title="Chat with Architect (advisory only)"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px',
              background: showArchitect ? 'rgba(124,58,237, 0.2)' : 'transparent',
              border: `1px solid ${showArchitect ? 'rgba(124,58,237, 0.5)' : 'rgba(124,58,237, 0.3)'}`,
              borderRadius: 8, color: showArchitect ? '#818cf8' : '#94a3b8',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!showArchitect) e.currentTarget.style.background = 'rgba(124,58,237, 0.08)'; }}
            onMouseLeave={e => { if (!showArchitect) e.currentTarget.style.background = 'transparent'; }}
          >
            <MessageSquare size={13} />
            Architect
          </button>

          {/* Discard Draft */}
          {isEditing && (
            <button
              onClick={handleDiscardDraft}
              disabled={discarding}
              title="Discard draft and restore active workflow"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8, color: discarding ? '#475569' : '#f87171',
                fontSize: 12, fontWeight: 600, cursor: discarding ? 'wait' : 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!discarding) e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Trash2 size={13} />
              {discarding ? 'Discarding...' : 'Discard Draft'}
            </button>
          )}

          {/* Save Draft */}
          <button
            onClick={handleSaveDraft}
            disabled={savingDraft || !draftDirty}
            title={draftDirty ? 'Save draft changes' : 'No unsaved changes'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              background: draftDirty ? 'rgba(124,58,237, 0.15)' : 'transparent',
              border: `1px solid ${draftDirty ? 'rgba(124,58,237, 0.5)' : 'rgba(124,58,237, 0.2)'}`,
              borderRadius: 8, color: (savingDraft || !draftDirty) ? '#475569' : '#818cf8',
              fontSize: 12, fontWeight: 600,
              cursor: (savingDraft || !draftDirty) ? 'default' : 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (draftDirty && !savingDraft) e.currentTarget.style.background = 'rgba(124,58,237, 0.25)'; }}
            onMouseLeave={e => e.currentTarget.style.background = draftDirty ? 'rgba(124,58,237, 0.15)' : 'transparent'}
          >
            <Save size={13} />
            {savingDraft ? 'Saving...' : 'Save Draft'}
          </button>

          {/* Deploy — always uses ACTIVE workflow */}
          <button
            onClick={handleDeploy}
            disabled={deploying}
            title="Deploy active workflow (not draft)"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: deploying ? 'rgba(124,58,237, 0.3)' : 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
              border: 'none', borderRadius: 8, color: 'hsl(var(--primary-foreground))',
              fontSize: 12, fontWeight: 700, cursor: deploying ? 'wait' : 'pointer',
              boxShadow: '0 0 20px rgba(124,58,237, 0.35)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!deploying) e.currentTarget.style.boxShadow = '0 0 30px rgba(124,58,237, 0.55)'; }}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237, 0.35)'}
          >
            <Rocket size={13} />
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>

      {/* Draft error / save confirmation banner */}
      {draftError && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)',
          padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <AlertTriangle size={12} color="#ef4444" />
          <span style={{ fontSize: 11, color: 'hsl(var(--danger) / 0.8)', fontFamily: 'JetBrains Mono, monospace' }}>{draftError}</span>
          <button onClick={() => setDraftError('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--danger))', fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* Draft-saved confirmation — shown briefly when hasDraft and not dirty */}
      {hasDraft && !draftDirty && !draftError && (
        <div style={{
          background: 'rgba(124,58,237, 0.06)', borderBottom: '1px solid rgba(124,58,237, 0.12)',
          padding: '5px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <CheckCircle size={11} color="#7c3aed" />
          <span style={{ fontSize: 10, color: 'hsl(var(--primary))', fontFamily: 'JetBrains Mono, monospace' }}>
            Draft saved. Preview and deployed chat still use the active workflow until Phase 9B activates this draft.
          </span>
        </div>
      )}

      {/* ── Editor body ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Palette */}
        <NodePalette onAddNode={(nodeType) => {
          const newNode = {
            id:     `node_${Date.now()}`,
            type:   nodeType,
            label:  nodeType,
            x:      200 + Math.random() * 300,
            y:      150 + Math.random() * 200,
            params: {},
          };
          handleNodesChange([...draftNodes, newNode]);
        }} />

        {/* Canvas — shows draft */}
        <div style={{ flex: 1 }}>
          <NodeEditor
            nodes={draftNodes}
            connections={draftConnections}
            onNodesChange={handleNodesChange}
            onConnectionsChange={handleConnectionsChange}
            onNodeSelect={setSelectedNode}
          />
        </div>

        {/* Properties panel */}
        {selectedNode && (
          <NodeProperties
            node={selectedNode}
            chatbotId={chatbot.id}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        )}

        {/* Preview — always uses ACTIVE workflow */}
        {showPreview && (
          <WorkflowPreview
            chatbot={chatbot}
            onClose={() => setShowPreview(false)}
          />
        )}

        {/* Architect Chat panel — advisory only, never activates */}
        {showArchitect && (
          <ArchitectChatPanel
            chatbotId={chatbot.id}
            hasDraft={hasDraft}
            onClose={() => setShowArchitect(false)}
            onActivated={async (result) => {
              // Architect activated a proposal — reload the editor to show the new active workflow
              await loadEditor();
            }}
          />
        )}
      </div>
    </div>
  );
}
