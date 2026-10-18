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
import { ArrowLeft, Rocket, Eye, EyeOff, Save, Trash2, GitBranch, AlertTriangle, CheckCircle, MessageSquare, Workflow, Code, Palette, BarChart2 } from 'lucide-react';
import { chatbotsApi, workflowApi, uiConfigApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import NodeEditor from '../components/editor/NodeEditor';
import NodePalette from '../components/editor/NodePalette';
import NodeProperties from '../components/editor/NodeProperties';
import WorkflowPreview from '../components/editor/WorkflowPreview';
import ArchitectChatPanel from '../components/editor/ArchitectChatPanel';
import WorkflowCodeView from '../components/editor/WorkflowCodeView';
import AppearancePanel from '../components/editor/AppearancePanel';
import { useAppTheme } from '@/lib/ThemeContext';
import { resolveUiConfig } from '@/lib/uiConfig';

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
  // Phase 9D: tab switcher — 'visual' | 'code'
  // Default: 'visual'. Switching to 'code' never mutates workflow.
  const [activeTab,      setActiveTab]       = useState('visual');

  // Phase 10B: UI configuration state (completely separate from workflow)
  const [uiConfig,       setUiConfig]        = useState(null);   // null = loading
  const [uiDirty,        setUiDirty]         = useState(false);
  const [savingUi,       setSavingUi]        = useState(false);
  const [savedUi,        setSavedUi]         = useState(false);

  // Track the persisted draft to detect dirty state
  const persistedDraftRef = useRef({ nodes: [], connections: [] });

  // ── Load chatbot + draft ────────────────────────────────────────────────────

  useEffect(() => {
    if (chatbotId) loadEditor();
  }, [chatbotId]);

  // `silent = true` skips the full-screen loading indicator — used after
  // architect activation so the ArchitectChatPanel stays mounted and the
  // user sees the "Activated" confirmation while chatbot refreshes in-place.
  const loadEditor = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Try to load via the workflow endpoint for draft-aware data
      const [bots, workflowData] = await Promise.all([
        chatbotsApi.filter({ id: chatbotId }),
        workflowApi.get(chatbotId).catch(() => null),
      ]);

      if (!bots.length) { if (!silent) setLoading(false); return; }
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

      // Phase 10B: Load UI config (separate from workflow)
      try {
        const cfg = await uiConfigApi.get(chatbotId);
        setUiConfig(resolveUiConfig(cfg));
      } catch {
        setUiConfig(resolveUiConfig(bot.ui_config ?? {}));
      }
    } catch (err) {
      console.error('Failed to load editor:', err);
    } finally {
      if (!silent) setLoading(false);
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

  // ── UI Config Save (Phase 10B) ─────────────────────────────────────────────
  // INVARIANT: Never touches nodes/connections/architect_plan

  const handleSaveUiConfig = useCallback(async () => {
    if (!uiConfig) return;
    setSavingUi(true);
    try {
      const saved = await uiConfigApi.save(chatbotId, uiConfig);
      setUiConfig(resolveUiConfig(saved));
      setUiDirty(false);
      setSavedUi(true);
      setTimeout(() => setSavedUi(false), 2000);
    } catch (err) {
      console.error('[ui-config save]', err.message);
    } finally {
      setSavingUi(false);
    }
  }, [chatbotId, uiConfig]);

  const handleUiConfigChange = useCallback((newConfig) => {
    setUiConfig(newConfig);
    setUiDirty(true);
  }, []);

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
  const { C } = useAppTheme();

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.t2, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Loading workflow...'}
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        {'> Chatbot not found.'}
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: C.panel,
        borderBottom: `1px solid ${C.panelBorder}`,
        padding: '0 24px',
        height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 1px 0 rgba(124,58,237,0.08)',
      }}>
        {/* Left: back + title + tab switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            style={{ background: 'transparent', border: `1px solid ${C.borderHi}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: C.t2, display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = C.t1}
            onMouseLeave={e => e.currentTarget.style.color = C.t2}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.t1, letterSpacing: '-0.01em' }}>{chatbot.title}</span>
              {/* Draft indicator */}
              {isEditing && (
                <span style={{
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                  color: draftDirty ? C.accentLt : C.accent,
                  background: draftDirty ? 'rgba(167,139,250,0.1)' : C.accentBg,
                  border: `1px solid ${draftDirty ? 'rgba(167,139,250,0.3)' : C.borderHi}`,
                  padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  <GitBranch size={9} />
                  {draftDirty ? 'UNSAVED DRAFT' : 'DRAFT'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.t2, fontFamily: 'JetBrains Mono, monospace' }}>
              {isEditing
                ? 'Draft changes — preview and deployed chat use the active workflow'
                : chatbot.description?.slice(0, 55) + (chatbot.description?.length > 55 ? '...' : '')}
            </div>
          </div>

          {/* ── Phase 9D: Tab switcher ─────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: C.bgSub, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: 3, marginLeft: 8,
          }}>
            {[
              { id: 'visual',     icon: <Workflow size={13} />, label: 'Visual Workflow' },
              { id: 'code',       icon: <Code size={13} />,     label: 'Code' },
              { id: 'appearance', icon: <Palette size={13} />,  label: 'Appearance' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 7, border: 'none',
                  background: activeTab === tab.id ? C.surface : 'transparent',
                  color: activeTab === tab.id ? C.t1 : C.t3,
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                  boxShadow: activeTab === tab.id ? C.shadow : 'none',
                  position: 'relative',
                }}
              >
                {tab.icon}
                {tab.label}
                {/* Dirty indicator for appearance tab */}
                {tab.id === 'appearance' && uiDirty && (
                  <div style={{ position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Preview — uses ACTIVE workflow */}
          <button
            onClick={() => setShowPreview(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 16px',
              background: showPreview ? 'rgba(34,197,94,0.15)' : 'transparent',
              border: `1px solid ${showPreview ? 'rgba(34,197,94,0.4)' : C.panelBorder}`,
              borderRadius: 8, color: showPreview ? '#22c55e' : C.t2,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>

          {/* Architect Chat toggle */}
          <button
            onClick={() => setShowArchitect(a => !a)}
            title="Chat with Architect (advisory only)"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 16px',
              background: showArchitect ? C.accentBg : 'transparent',
              border: `1px solid ${showArchitect ? C.borderHi : C.panelBorder}`,
              borderRadius: 8, color: showArchitect ? C.accentLt : C.t2,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!showArchitect) e.currentTarget.style.background = C.accentBg; }}
            onMouseLeave={e => { if (!showArchitect) e.currentTarget.style.background = 'transparent'; }}
          >
            <MessageSquare size={14} />
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
                padding: '9px 16px',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8, color: discarding ? C.t3 : '#f87171',
                fontSize: 13, fontWeight: 600, cursor: discarding ? 'wait' : 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!discarding) e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Trash2 size={14} />
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
              padding: '9px 18px',
              background: draftDirty ? C.accentBg : 'transparent',
              border: `1px solid ${draftDirty ? C.borderHi : C.panelBorder}`,
              borderRadius: 8, color: (savingDraft || !draftDirty) ? C.t3 : C.accentLt,
              fontSize: 13, fontWeight: 600,
              cursor: (savingDraft || !draftDirty) ? 'default' : 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (draftDirty && !savingDraft) e.currentTarget.style.background = `rgba(124,58,237,0.25)`; }}
            onMouseLeave={e => e.currentTarget.style.background = draftDirty ? C.accentBg : 'transparent'}
          >
            <Save size={14} />
            {savingDraft ? 'Saving...' : 'Save Draft'}
          </button>

          {/* Deploy — always uses ACTIVE workflow */}
          <button
            onClick={handleDeploy}
            disabled={deploying}
            title="Deploy active workflow (not draft)"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 20px',
              background: deploying ? C.accentBg : 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
              border: 'none', borderRadius: 8, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: deploying ? 'wait' : 'pointer',
              boxShadow: '0 0 20px rgba(124,58,237,0.35)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!deploying) e.currentTarget.style.boxShadow = '0 0 30px rgba(124,58,237,0.55)'; }}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237,0.35)'}
          >
            <Rocket size={14} />
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>

          {/* Analytics */}
          <button
            onClick={() => navigate(createPageUrl(`Analytics?id=${chatbot.id}`))}
            title="View analytics dashboard"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 14px',
              background: 'transparent',
              border: `1px solid ${C.panelBorder}`,
              borderRadius: 8, color: C.t2,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.accentLt; e.currentTarget.style.background = C.accentBg; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.t2; e.currentTarget.style.background = 'transparent'; }}
          >
            <BarChart2 size={14} />
            Analytics
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
          <span style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace' }}>{draftError}</span>
          <button onClick={() => setDraftError('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* Draft-saved confirmation — shown briefly when hasDraft and not dirty */}
      {hasDraft && !draftDirty && !draftError && (
        <div style={{
          background: C.accentBg, borderBottom: `1px solid ${C.panelBorder}`,
          padding: '5px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <CheckCircle size={11} color={C.accent} />
          <span style={{ fontSize: 10, color: C.accentLt, fontFamily: 'JetBrains Mono, monospace' }}>
            Draft saved. Preview and deployed chat still use the active workflow until Phase 9B activates this draft.
          </span>
        </div>
      )}

      {/* ── Editor body ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Code tab (Phase 9D) — shown instead of canvas when activeTab === 'code' */}
        {/* key forces remount when architect activates a new version, resetting file selection */}
        {activeTab === 'code' ? (
          <WorkflowCodeView
            key={`code-${chatbot.architect_version ?? 0}-${(chatbot.nodes || []).length}`}
            chatbot={chatbot}
            hasDraft={hasDraft}
            draftDirty={draftDirty}
          />
        ) : activeTab === 'appearance' ? (
          /* ── Appearance tab (Phase 10B) ─────────────────────────────────── */
          /* INVARIANT: never touches nodes/connections */
          uiConfig ? (
            <AppearancePanel
              chatbot={chatbot}
              uiConfig={uiConfig}
              onChange={handleUiConfigChange}
              onSave={handleSaveUiConfig}
              saving={savingUi}
              saved={savedUi}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.t3, fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>
              Loading appearance settings…
            </div>
          )
        ) : (
          <>
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
                  // Silent reload — keeps ArchitectChatPanel mounted so user
                  // sees the "Activated" confirmation while chatbot refreshes.
                  await loadEditor(true);
                  // Auto-switch to code tab so user immediately sees the
                  // updated standalone code reflecting the new active workflow.
                  if (result?.activated) {
                    setActiveTab('code');
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
