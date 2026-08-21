import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Plus, Folder, FolderOpen, Zap, Edit3, Trash2,
  ChevronRight, MoreHorizontal, LogOut, Clock, Rocket,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { projectsApi, chatbotsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS = {
  deployed: { dot: '#22c55e', label: 'deployed', glow: '#22c55e' },
  draft:    { dot: '#f59e0b', label: 'draft',    glow: '#f59e0b' },
  archived: { dot: '#64748b', label: 'archived', glow: '#64748b' },
};

// ─── Inline modal for project CRUD ────────────────────────────────────────────

function ProjectModal({ mode, project, onClose, onSave }) {
  const [name, setName]       = useState(project?.name        || '');
  const [desc, setDesc]       = useState(project?.description || '');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError('');
    try {
      await onSave({ name: name.trim(), description: desc.trim() });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="neon-border rounded-2xl bg-[#0d1117] w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-white mb-4">
          {mode === 'create' ? 'New Project' : 'Edit Project'}
        </h2>
        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <input
            autoFocus
            placeholder="Project name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-4 py-2.5 bg-[#060a10] border border-slate-700/50 rounded-xl text-slate-200 text-sm focus:border-indigo-500/60 focus:outline-none"
          />
          <textarea
            placeholder="Description (optional)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full px-4 py-2.5 bg-[#060a10] border border-slate-700/50 rounded-xl text-slate-200 text-sm focus:border-indigo-500/60 focus:outline-none resize-none"
          />
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-700/50 text-slate-400 text-sm hover:border-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline modal for new RAG app ─────────────────────────────────────────────

function NewAppModal({ projectId, onClose, onCreated }) {
  const [description, setDescription] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const handleGenerate = async () => {
    if (!description.trim()) { setError('Description is required'); return; }
    setLoading(true);
    setError('');
    try {
      const app = await chatbotsApi.generate(description.trim(), projectId);
      onCreated(app);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="neon-border rounded-2xl bg-[#0d1117] w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-white mb-1">New RAG Application</h2>
        <p className="text-slate-500 text-sm mb-4">Describe what this chatbot should do.</p>
        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
        <textarea
          autoFocus
          placeholder="e.g. A customer support bot for my SaaS product that answers questions about pricing, features, and onboarding..."
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          className="w-full px-4 py-3 bg-[#060a10] border border-slate-700/50 rounded-xl text-slate-200 text-sm font-mono focus:border-indigo-500/60 focus:outline-none resize-none placeholder:text-slate-600"
        />
        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-700/50 text-slate-400 text-sm hover:border-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <><Zap size={14} /> Generate Workflow</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, signOut }       = useAuth();
  const navigate                 = useNavigate();
  const [projects, setProjects]  = useState([]);
  const [apps, setApps]          = useState([]);
  const [loading, setLoading]    = useState(true);
  const [activeProject, setActiveProject] = useState(null);
  const [modal, setModal]        = useState(null); // null | 'createProject' | 'editProject' | 'newApp'
  const [editTarget, setEditTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, appData] = await Promise.all([
        projectsApi.list(),
        chatbotsApi.filter(),
      ]);
      setProjects(projData);
      setApps(appData);
      if (projData.length > 0 && !activeProject) {
        setActiveProject(projData[0].id);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const appsForProject = (projectId) =>
    apps.filter(a => a.project_id === projectId);

  const handleCreateProject = async ({ name, description }) => {
    const created = await projectsApi.create({ name, description });
    setProjects(prev => [created, ...prev]);
    setActiveProject(created.id);
  };

  const handleUpdateProject = async ({ name, description }) => {
    const updated = await projectsApi.update(editTarget.id, { name, description });
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const handleDeleteProject = async (project) => {
    setDeleteError('');
    try {
      await projectsApi.delete(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      if (activeProject === project.id) {
        const remaining = projects.filter(p => p.id !== project.id);
        setActiveProject(remaining[0]?.id || null);
      }
    } catch (err) {
      if (err.message.includes('RAG applications')) {
        setDeleteError(`"${project.name}" contains RAG apps. Delete or move them first.`);
      } else {
        setDeleteError(err.message);
      }
    }
  };

  const handleDeleteApp = async (app) => {
    await chatbotsApi.delete(app.id);
    setApps(prev => prev.filter(a => a.id !== app.id));
  };

  const handleAppCreated = (app) => {
    setApps(prev => [app, ...prev]);
    navigate(createPageUrl(`Editor?id=${app.id}`));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080c14] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedProject = projects.find(p => p.id === activeProject);
  const selectedApps    = activeProject ? appsForProject(activeProject) : [];

  return (
    <div className="min-h-screen bg-[#080c14] flex">
      {/* Modals */}
      {modal === 'createProject' && (
        <ProjectModal
          mode="create"
          onClose={() => setModal(null)}
          onSave={handleCreateProject}
        />
      )}
      {modal === 'editProject' && editTarget && (
        <ProjectModal
          mode="edit"
          project={editTarget}
          onClose={() => { setModal(null); setEditTarget(null); }}
          onSave={handleUpdateProject}
        />
      )}
      {modal === 'newApp' && (
        <NewAppModal
          projectId={activeProject}
          onClose={() => setModal(null)}
          onCreated={handleAppCreated}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div style={{ width: 260, flexShrink: 0 }} className="bg-[#0a0e18] border-r border-indigo-500/15 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-indigo-500/10">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center glow-indigo">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-mono text-sm font-bold text-white tracking-widest uppercase">Vanta</span>
        </div>

        {/* Projects list */}
        <div className="flex-1 overflow-y-auto py-3">
          <div className="flex items-center justify-between px-4 mb-2">
            <span className="font-mono text-xs text-slate-600 uppercase tracking-widest">Projects</span>
            <button
              onClick={() => setModal('createProject')}
              className="p-1 rounded text-slate-600 hover:text-indigo-400 transition-colors"
              title="New project"
            >
              <Plus size={13} />
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="px-4 text-xs text-slate-600 font-mono">No projects yet</p>
          ) : (
            projects.map(proj => (
              <button
                key={proj.id}
                onClick={() => setActiveProject(proj.id)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                  activeProject === proj.id
                    ? 'bg-indigo-600/10 border-r-2 border-indigo-500 text-white'
                    : 'text-slate-400 hover:bg-white/3 hover:text-slate-200'
                }`}
              >
                {activeProject === proj.id
                  ? <FolderOpen size={14} className="text-indigo-400 flex-shrink-0" />
                  : <Folder size={14} className="flex-shrink-0" />}
                <span className="text-sm truncate">{proj.name}</span>
                <span className="ml-auto text-xs text-slate-600">
                  {appsForProject(proj.id).length}
                </span>
              </button>
            ))
          )}
        </div>

        {/* User + sign out */}
        <div className="p-4 border-t border-indigo-500/10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-xs text-indigo-300 font-bold">
                {user?.email?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 truncate">{user?.email}</p>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="p-1.5 rounded text-slate-600 hover:text-slate-300 transition-colors"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {/* Project header */}
          {selectedProject ? (
            <div className="flex items-start justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold text-white">{selectedProject.name}</h1>
                {selectedProject.description && (
                  <p className="text-slate-500 text-sm mt-1">{selectedProject.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditTarget(selectedProject); setModal('editProject'); }}
                  className="p-2 rounded-lg border border-indigo-500/20 text-slate-500 hover:text-white hover:border-indigo-500/40 transition-colors"
                  title="Edit project"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => handleDeleteProject(selectedProject)}
                  className="p-2 rounded-lg border border-red-500/20 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                  title="Delete project"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setModal('newApp')}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold glow-indigo hover:opacity-90 transition-opacity"
                >
                  <Plus size={14} /> New RAG App
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-slate-500 text-sm mt-1">Create a project to get started.</p>
              <button
                onClick={() => setModal('createProject')}
                className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold"
              >
                <Plus size={14} /> Create Project
              </button>
            </div>
          )}

          {/* Delete error */}
          {deleteError && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center justify-between">
              {deleteError}
              <button onClick={() => setDeleteError('')} className="ml-4 text-amber-500 hover:text-amber-300">✕</button>
            </div>
          )}

          {/* RAG Apps grid */}
          {selectedProject && (
            <>
              {selectedApps.length === 0 ? (
                <div className="neon-border rounded-2xl p-12 text-center">
                  <Zap className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No RAG apps in this project yet.</p>
                  <button
                    onClick={() => setModal('newApp')}
                    className="mt-4 px-5 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-sm hover:bg-indigo-600/30 transition-colors"
                  >
                    Generate your first app
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {selectedApps.map(app => {
                    const sc = STATUS_COLORS[app.status] || STATUS_COLORS.draft;
                    return (
                      <div
                        key={app.id}
                        className="neon-border rounded-xl bg-[#0d1117]/60 p-5 hover:bg-[#0d1117]/90 transition-colors flex flex-col"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: sc.dot, boxShadow: `0 0 6px ${sc.glow}` }}
                            />
                            <span className="font-mono text-xs" style={{ color: sc.dot }}>
                              {sc.label}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteApp(app)}
                            className="p-1 rounded text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <h3 className="text-white font-semibold text-sm mb-1 leading-snug">{app.title}</h3>
                        {app.description && (
                          <p className="text-slate-500 text-xs leading-relaxed mb-3 line-clamp-2">
                            {app.description}
                          </p>
                        )}

                        <div className="flex items-center gap-1 text-slate-600 text-xs mt-auto mb-3">
                          <Clock size={10} />
                          <span>{timeAgo(app.updated_at || app.created_at)}</span>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate(createPageUrl(`Editor?id=${app.id}`))}
                            className="flex-1 py-2 rounded-lg border border-indigo-500/25 text-indigo-400 text-xs font-semibold hover:bg-indigo-600/10 transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Edit3 size={11} /> Edit
                          </button>
                          {app.status === 'deployed' && app.embed_id && (
                            <button
                              onClick={() => navigate(createPageUrl(`Deploy?id=${app.id}`))}
                              className="flex-1 py-2 rounded-lg border border-emerald-500/25 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/10 transition-colors flex items-center justify-center gap-1.5"
                            >
                              <Rocket size={11} /> View
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteApp(app)}
                            className="py-2 px-2.5 rounded-lg border border-red-500/20 text-red-500/60 text-xs hover:text-red-400 hover:border-red-500/40 transition-colors"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
