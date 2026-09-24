/**
 * Dashboard.jsx — Vanta v3
 * Reference: deep navy/purple dark, large stat cards with icons,
 * search bar, card with left accent border, two-tone action buttons,
 * resizable sidebar, light/dark toggle.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Plus, Folder, FolderOpen, Edit3, Trash2,
  LogOut, Clock, Rocket, Cpu, MoreHorizontal, Bot,
  Sun, Moon, Search, Package, CheckCircle, Timer,
  Settings, ChevronLeft, ChevronRight, GripVertical,
  LayoutGrid, List, Copy, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { projectsApi, chatbotsApi } from "@/api/apiClient";
import { createPageUrl } from "@/utils";
import { useAppTheme } from "@/lib/ThemeContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ onClose, children, C, wide }) {
  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
      }}
    >
      <div style={{
        background: C.surface, border: `1px solid ${C.borderHi}`,
        // Clip the modal top-right corner too
        clipPath: "polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)",
        boxShadow: C.shadowCard,
        width: "100%", maxWidth: wide ? 560 : 460,
        padding: 32, animation: "vFadeUp 0.22s ease both",
        fontFamily: "Plus Jakarta Sans, sans-serif",
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalInput({ label, C, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 11, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em", color: C.t3, marginBottom: 6 }}>{label}</label>}
      <input style={{
        width: "100%", padding: "10px 14px", clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
        background: C.bgSub, border: `1px solid ${C.border}`,
        color: C.t1, fontSize: 14, outline: "none",
        fontFamily: "Plus Jakarta Sans, sans-serif", boxSizing: "border-box",
      }} {...props} />
    </div>
  );
}

function ModalTextarea({ label, C, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 11, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em", color: C.t3, marginBottom: 6 }}>{label}</label>}
      <textarea style={{
        width: "100%", padding: "10px 14px", clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
        background: C.bgSub, border: `1px solid ${C.border}`,
        color: C.t1, fontSize: 14, outline: "none", resize: "none",
        fontFamily: "Plus Jakarta Sans, sans-serif", boxSizing: "border-box",
      }} {...props} />
    </div>
  );
}

function Btn({ onClick, disabled, loading, children, variant = "primary", C }) {
  const styles = {
    primary: {
      background: `linear-gradient(135deg, ${C.accent}, #6d28d9)`,
      color: "#fff", border: "none",
      boxShadow: `0 4px 16px ${C.accentBg}`,
    },
    ghost: {
      background: C.accentBg, border: `1px solid ${C.border}`, color: C.t2,
    },
    danger: {
      background: "rgba(239,68,68,0.9)", color: "#fff", border: "none",
    },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...styles[variant],
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        padding: "10px 20px",
        clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
        fontSize: 14, fontWeight: 700, cursor: disabled || loading ? "default" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        fontFamily: "Plus Jakarta Sans, sans-serif", transition: "all 0.15s",
      }}
    >
      {loading && <span style={{ width: 13, height: 13, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "vSpin 0.7s linear infinite", display: "inline-block" }} />}
      {children}
    </button>
  );
}

// ─── Project Modal ─────────────────────────────────────────────────────────────

function ProjectModal({ mode, project, onClose, onSave, C }) {
  const [name, setName] = useState(project?.name || "");
  const [desc, setDesc] = useState(project?.description || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) { setError("Name required"); return; }
    setLoading(true); setError("");
    try { await onSave({ name: name.trim(), description: desc.trim() }); onClose(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  return (
    <Modal onClose={onClose} C={C}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 20 }}>{mode === "create" ? "New Project" : "Edit Project"}</h2>
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      <ModalInput label="Name" autoFocus placeholder="e.g. Customer Support" value={name} onChange={e => setName(e.target.value)} C={C} />
      <ModalTextarea label="Description" placeholder="Optional" rows={2} value={desc} onChange={e => setDesc(e.target.value)} C={C} />
      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <Btn variant="ghost" onClick={onClose} C={C}>Cancel</Btn>
        <Btn onClick={save} loading={loading} C={C}>{mode === "create" ? "Create Project" : "Save"}</Btn>
      </div>
    </Modal>
  );
}

// ─── New App Modal ─────────────────────────────────────────────────────────────

function NewAppModal({ projectId, onClose, onCreated, C }) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!description.trim()) { setError("Description required"); return; }
    setLoading(true); setError("");
    try { const app = await chatbotsApi.createDraft(description.trim(), projectId); onCreated(app); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  return (
    <Modal onClose={onClose} C={C} wide>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, clipPath: "polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)", background: C.accentBg, border: `1px solid ${C.borderHi}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bot size={17} color={C.accentLt} />
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>New RAG Application</h2>
          <p style={{ fontSize: 13, color: C.t3, marginTop: 2 }}>Describe what the assistant should do.</p>
        </div>
      </div>
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      <ModalTextarea label="Purpose" autoFocus placeholder="e.g. A technical support assistant that answers questions from maintenance manuals..." rows={4} value={description} onChange={e => setDescription(e.target.value)} C={C} />
      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <Btn variant="ghost" onClick={onClose} C={C}>Cancel</Btn>
        <Btn onClick={create} loading={loading} disabled={!description.trim()} C={C}><Cpu size={14} /> Create & Configure</Btn>
      </div>
    </Modal>
  );
}

// ─── Delete App Modal ──────────────────────────────────────────────────────────

function DeleteAppModal({ app, onClose, onConfirm, C }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setLoading(true); setError("");
    try { await onConfirm(app); onClose(); }
    catch (e) { setError(e.message); setLoading(false); }
  };
  return (
    <Modal onClose={onClose} C={C}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, clipPath: "polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <AlertTriangle size={17} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>Delete Application?</h2>
      </div>
      <p style={{ fontSize: 14, color: C.t2, lineHeight: 1.6, marginBottom: 8 }}>
        <strong style={{ color: C.t1 }}>"{app.title}"</strong> will be permanently deleted.
      </p>
      <p style={{ fontSize: 13, color: C.t3, lineHeight: 1.6, marginBottom: 20 }}>All documents, indexed chunks, chat history, and deployment data will be removed.</p>
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.08)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} disabled={loading} C={C}>Cancel</Btn>
        <Btn variant="danger" onClick={confirm} loading={loading} C={C}>Delete Permanently</Btn>
      </div>
    </Modal>
  );
}

// ─── Stat card (large, with icon + label like reference) ──────────────────────

function StatCard({ value, label, desc, icon, iconBg, iconColor, C }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: "18px 20px",
      boxShadow: C.shadow,
      display: "flex", alignItems: "center", gap: 16,
      animation: "vFadeUp 0.3s ease both",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ width: 44, height: 44, flexShrink: 0,
        background: iconBg,
        borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {React.cloneElement(icon, { size: 20, color: iconColor })}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.t1, lineHeight: 1, fontFamily: "Plus Jakarta Sans, sans-serif" }}>{value}</div>
        <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: iconColor, marginTop: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

// ─── App Card ─────────────────────────────────────────────────────────────────

function AppCard({ app, onArchitect, onEdit, onDeploy, onDelete, index, C }) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);

  const STATUS_COLOR = {
    deployed: C.green,
    draft:    C.amber,
    archived: C.t3,
  };
  const statusColor = STATUS_COLOR[app.status] || C.amber;

  return (
    <div
      className="vCardIn"
      style={{ animationDelay: `${index * 60}ms` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenu(false); }}
    >
      <div style={{
        background: hover ? C.surfaceHi : C.surface,
        border: `1px solid ${hover ? C.borderHi : C.border}`,
        borderRadius: 0,
        padding: "16px 16px 15px",
        boxShadow: hover
          ? `${C.shadowCard}, 0 0 0 1px ${C.accent}33, 0 0 28px ${C.accent}22`
          : C.shadow,
        display: "flex", flexDirection: "column",
        minHeight: 222,
        transform: hover ? "translateY(-3px)" : "translateY(0)",
        transition: "background 0.2s ease, border-color 0.2s ease, box-shadow 0.25s ease, transform 0.25s ease",
        position: "relative", cursor: "default", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: hover ? `linear-gradient(90deg, ${C.accentLt}, ${C.cyan || C.accentLt}, transparent 82%)` : "transparent",
          opacity: hover ? 1 : 0,
          transition: "opacity 0.25s ease",
        }} />
        {/* Top row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{
            background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
            color: statusColor,
            fontSize: 11, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
            letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "3px 9px",
            borderRadius: 0,
          }}>
            {app.status || "draft"}
          </span>
          {/* Overflow menu */}
          <div style={{ position: "relative" }}>
              <button
              onClick={() => setMenu(o => !o)}
              style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${menu ? C.borderHi : C.border}`, background: menu ? C.accentBg : "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menu && (
              <div style={{
                position: "absolute", right: 0, top: 32, zIndex: 20,
                background: C.surface, border: `1px solid ${C.borderHi}`,
                borderRadius: 0,
                boxShadow: C.shadowCard, minWidth: 152, padding: "5px 0",
                animation: "vFadeUp 0.15s ease both",
              }}>
                {[
                  { icon: <Cpu size={12} />, label: "Architect", fn: () => onArchitect(app) },
                  { icon: <Edit3 size={12} />, label: "Editor", fn: () => onEdit(app) },
                  ...(app.status === "deployed" && app.embed_id ? [{ icon: <Rocket size={12} />, label: "View Deploy", fn: () => onDeploy(app) }] : []),
                ].map(item => (
                  <button key={item.label} onClick={() => { item.fn(); setMenu(false); }}
                    style={{ width: "100%", padding: "9px 16px", background: "transparent", border: "none", color: C.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 9, fontFamily: "Plus Jakarta Sans, sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = C.accentBg}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >{item.icon} {item.label}</button>
                ))}
                <div style={{ height: 1, background: C.border, margin: "4px 0" }} />
                <button onClick={() => { onDelete(app); setMenu(false); }}
                  style={{ width: "100%", padding: "9px 16px", background: "transparent", border: "none", color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 9, fontFamily: "Plus Jakarta Sans, sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.07)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Arch status */}
        {app.architect_status && app.architect_status !== "pending" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: app.architect_status === "approved" ? C.green : C.accentLt, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: app.architect_status === "approved" ? C.green : C.accentLt, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Arch · {app.architect_status}
            </span>
            {/* Animated shimmer bar on the arch line */}
            <div style={{ flex: 1, height: 2, background: `linear-gradient(90deg, ${app.architect_status === "approved" ? C.green : C.accentLt}40, transparent)`, borderRadius: 2 }} />
          </div>
        )}

        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.t1, marginBottom: 6, lineHeight: 1.35, fontFamily: "Plus Jakarta Sans, sans-serif", letterSpacing: "-0.01em", transition: "color 0.2s ease" }}>
          {app.title}
        </h3>
        {app.description && (
          <p style={{ fontSize: 13, color: C.t3, lineHeight: 1.6, marginBottom: 14, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {app.description}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.t3, fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginTop: "auto", marginBottom: 14 }}>
          <Clock size={11} />
          <span>{timeAgo(app.updated_at || app.created_at)}</span>
        </div>

        {/* Two-tone action buttons like reference */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onArchitect(app)}
            style={{
              flex: 1, padding: "9px 0",
              borderRadius: 5,
              background: C.accentBg, border: `1px solid ${C.borderHi}`,
              color: C.accentLt, fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: "Plus Jakarta Sans, sans-serif", transition: "background 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}28`; e.currentTarget.style.boxShadow = `0 0 14px ${C.accent}22`; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.accentBg; e.currentTarget.style.boxShadow = "none"; }}
          >
            <Cpu size={13} /> Architect
          </button>
          <button
            onClick={() => onEdit(app)}
            style={{
              flex: 1, padding: "9px 0",
              borderRadius: 5,
              background: C.amberBg, border: `1px solid ${C.amber}40`,
              color: C.amber, fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: "Plus Jakarta Sans, sans-serif", transition: "background 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${C.amber}20`; e.currentTarget.style.boxShadow = `0 0 14px ${C.amber}1c`; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.amberBg; e.currentTarget.style.boxShadow = "none"; }}
          >
            <Edit3 size={13} /> Editor
          </button>
          {app.status === "deployed" && app.embed_id && (
            <button
              onClick={() => onDeploy(app)}
              style={{
                flex: 1, padding: "9px 0",
                borderRadius: 5,
                background: C.greenBg, border: `1px solid ${C.green}40`,
                color: C.green, fontSize: 13, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontFamily: "Plus Jakarta Sans, sans-serif", transition: "background 0.15s ease, box-shadow 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${C.green}20`; e.currentTarget.style.boxShadow = `0 0 14px ${C.green}1c`; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.greenBg; e.currentTarget.style.boxShadow = "none"; }}
            >
              <Rocket size={13} /> View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resizable sidebar ─────────────────────────────────────────────────────────

const MIN_W = 56;
const MAX_W = 340;
const DEFAULT_W = 304;

function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    const s = localStorage.getItem("vanta-sidebar-w-v2");
    return s ? parseInt(s, 10) : DEFAULT_W;
  });
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

  const onMouseDown = useCallback(e => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [width]);

  useEffect(() => {
    const onMove = e => {
      if (!dragging.current) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, startW.current + e.clientX - startX.current));
      setWidth(w);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setWidth(w => { localStorage.setItem("vanta-sidebar-w-v2", w); return w; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const collapsed = width <= MIN_W + 20;
  return { width: collapsed ? MIN_W : width, collapsed, onMouseDown };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { dark, toggleTheme, C } = useAppTheme();

  const [projects, setProjects]         = useState([]);
  const [apps, setApps]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [activeProject, setActiveProject] = useState(null);
  const [modal, setModal]               = useState(null);
  const [editTarget, setEditTarget]     = useState(null);
  const [deleteAppTarget, setDeleteAppTarget] = useState(null);
  const [deleteError, setDeleteError]   = useState("");
  const [search, setSearch]             = useState("");
  const [viewMode, setViewMode]         = useState("grid"); // grid | list
  const { width: sidebarW, collapsed, onMouseDown } = useSidebarResize();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([projectsApi.list(), chatbotsApi.filter()]);
      setProjects(p); setApps(a);
      if (p.length > 0 && !activeProject) setActiveProject(p[0].id);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const appsFor = id => apps.filter(a => a.project_id === id);

  const handleCreateProject = async ({ name, description }) => {
    const c = await projectsApi.create({ name, description });
    setProjects(p => [c, ...p]); setActiveProject(c.id);
  };
  const handleUpdateProject = async ({ name, description }) => {
    const u = await projectsApi.update(editTarget.id, { name, description });
    setProjects(p => p.map(x => x.id === u.id ? u : x));
  };
  const handleDeleteProject = async proj => {
    setDeleteError("");
    try {
      await projectsApi.delete(proj.id);
      setProjects(p => p.filter(x => x.id !== proj.id));
      if (activeProject === proj.id) setActiveProject(projects.filter(x => x.id !== proj.id)[0]?.id || null);
    } catch (e) {
      setDeleteError(e.message.includes("RAG") ? `"${proj.name}" has apps. Delete them first.` : e.message);
    }
  };
  const handleDeleteAppConfirmed = async app => {
    await chatbotsApi.delete(app.id);
    setApps(a => a.filter(x => x.id !== app.id));
  };
  const requestDeleteApp = app => { setDeleteAppTarget(app); setModal("deleteApp"); };
  const handleAppCreated = app => { setApps(a => [app, ...a]); navigate(createPageUrl(`Architect?id=${app.id}`)); };

  const selectedProject = projects.find(p => p.id === activeProject);
  const allApps = activeProject ? appsFor(activeProject) : [];
  const filteredApps = search.trim()
    ? allApps.filter(a => a.title.toLowerCase().includes(search.toLowerCase()) || a.description?.toLowerCase().includes(search.toLowerCase()))
    : allApps;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 30, height: 30, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: "50%", animation: "vSpin 0.7s linear infinite", margin: "0 auto 14px" }} />
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: C.t3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Loading</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell" style={{ minHeight: "100vh", background: C.bg, display: "flex", fontFamily: "Plus Jakarta Sans, sans-serif" }}>

      {/* ── CSS animations ─────────────────────────────────────────── */}
      <style>{`
        @keyframes vFadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes vSpin   { to { transform:rotate(360deg); } }
        @keyframes vCardIn { from { opacity:0; transform:translateY(16px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }
        .vCardIn { animation: vCardIn 0.35s ease both; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }

        .dashboard-sidebar { width: ${sidebarW}px; }
        .dashboard-main { min-width: 0; }
        .dashboard-content { width: 100%; }
        .dashboard-stats { display: flex; }
        .dashboard-toolbar { display: flex; }
        .dashboard-app-grid { display: grid; }

        @media (max-width: 1024px) {
          .dashboard-sidebar { width: 232px !important; }
          .dashboard-content { padding: 28px 24px 40px !important; }
          .dashboard-app-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }

        @media (max-width: 700px) {
          .dashboard-shell { flex-direction: column !important; }
          .dashboard-sidebar {
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            border-right: none !important;
            border-bottom: 1px solid ${C.border};
          }
          .dashboard-sidebar > div:first-child { padding: 10px 14px !important; }
          .dashboard-projects {
            display: flex !important;
            align-items: center;
            gap: 6px;
            flex: none !important;
            padding: 8px 10px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
          }
          .dashboard-projects > div:first-child { display: none !important; }
          .dashboard-projects > button {
            width: auto !important;
            min-width: 136px;
            flex: 0 0 auto;
            padding: 8px 10px !important;
            border-left: 0 !important;
            border-bottom: 2px solid transparent !important;
          }
          .dashboard-projects > button[title="New project"] { min-width: 36px; }
          .dashboard-projects > button > div { width: 24px !important; height: 24px !important; }
          .dashboard-sidebar > div:nth-last-child(2) { display: block !important; padding: 8px 14px !important; }
          .dashboard-sidebar > div:last-child { display: none !important; }
          .dashboard-main { overflow: visible !important; }
          .dashboard-content { padding: 24px 16px 36px !important; }
          .dashboard-header-row { align-items: flex-start !important; flex-direction: column !important; gap: 18px; }
          .dashboard-header-actions { width: 100%; }
          .dashboard-header-actions > button:last-child { flex: 1; }
          .dashboard-stats { flex-direction: column; gap: 10px !important; }
          .dashboard-toolbar { flex-direction: column; align-items: stretch !important; gap: 8px !important; }
          .dashboard-view-toggle { align-self: flex-end; }
          .dashboard-app-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 12px !important; }
        }
      `}</style>

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {modal === "createProject" && <ProjectModal mode="create" onClose={() => setModal(null)} onSave={handleCreateProject} C={C} />}
      {modal === "editProject"   && editTarget && <ProjectModal mode="edit" project={editTarget} onClose={() => { setModal(null); setEditTarget(null); }} onSave={handleUpdateProject} C={C} />}
      {modal === "newApp"        && <NewAppModal projectId={activeProject} onClose={() => setModal(null)} onCreated={handleAppCreated} C={C} />}
      {modal === "deleteApp"     && deleteAppTarget && <DeleteAppModal app={deleteAppTarget} onClose={() => { setModal(null); setDeleteAppTarget(null); }} onConfirm={handleDeleteAppConfirmed} C={C} />}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <div className="dashboard-sidebar" style={{ width: sidebarW, flexShrink: 0, background: C.bgSub, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "relative", transition: "width 0.05s", overflow: "hidden" }}>

        {/* Logo */}
        <div style={{ padding: collapsed ? "40px 0" : "12px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 10 }}>
          <img
            src="/logo.png"
            alt="Vanta"
            style={{ width: 48, height: 48, flexShrink: 0, objectFit: "contain" }}
          />          {!collapsed && (
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 15, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", background: "linear-gradient(135deg, #a78bfa, #7c3aed 65%, #38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", whiteSpace: "nowrap" }}>
              Vanta
            </span>
          )}
        </div>

        {/* Projects */}
        <div className="dashboard-projects" style={{ flex: 1, overflowY: "auto", padding: collapsed ? "12px 0" : "12px 0" }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", marginBottom: 8 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.t3 }}>Projects</span>
              <button onClick={() => setModal("createProject")} title="New project"
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.t3; }}
              >
                <Plus size={11} />
              </button>
            </div>
          )}

          {collapsed && (
            <button onClick={() => setModal("createProject")} title="New project"
              style={{ width: "100%", display: "flex", justifyContent: "center", padding: "10px 0", background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Plus size={14} color={C.t3} />
            </button>
          )}

          {projects.map(proj => {
            const isActive = activeProject === proj.id;
            const count = appsFor(proj.id).length;
            return (
              <button
                key={proj.id}
                onClick={() => setActiveProject(proj.id)}
                title={collapsed ? proj.name : undefined}
                style={{
                  width: "100%", display: "flex", alignItems: "center",
                  gap: collapsed ? 0 : 9,
                  justifyContent: collapsed ? "center" : "flex-start",
                  padding: collapsed ? "10px 0" : "9px 14px",
                  border: "none", cursor: "pointer",
                  background: isActive ? C.accentBg : "transparent",
                  borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`,
                  transition: "all 0.12s",
                  fontFamily: "Plus Jakarta Sans, sans-serif",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.accentBg; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Project color dot */}
                <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 0, background: isActive ? C.accentBg : C.border, border: `1px solid ${isActive ? C.borderHi : C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isActive
                    ? <FolderOpen size={13} color={C.accentLt} />
                    : <Folder size={13} color={C.t3} />}
                </div>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: isActive ? C.t1 : C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {proj.name}
                    </span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 700, color: isActive ? C.accentLt : C.t3, minWidth: 18, textAlign: "right" }}>
                      {count}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: collapsed ? "12px 0" : "12px 14px", borderTop: `1px solid ${C.border}` }}>
          {collapsed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <button onClick={toggleTheme} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.t3, padding: 4 }}>
                {dark ? <Sun size={13} /> : <Moon size={13} />}
              </button>
              <button onClick={signOut} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.t3, padding: 4 }}>
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: C.accentBg, border: `1px solid ${C.borderHi}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: C.accentLt, fontWeight: 800 }}>{user?.email?.[0]?.toUpperCase() || "?"}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{user?.email}</p>
                <p style={{ fontSize: 10, color: C.t3, fontFamily: "JetBrains Mono, monospace" }}>Owner</p>
              </div>
              <button onClick={toggleTheme} title={dark ? "Light" : "Dark"} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.t3, padding: 4, transition: "color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.color = C.t1}
                onMouseLeave={e => e.currentTarget.style.color = C.t3}
              >
                {dark ? <Sun size={13} /> : <Moon size={13} />}
              </button>
              <button onClick={signOut} title="Sign out" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.t3, padding: 4, transition: "color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.color = C.t1}
                onMouseLeave={e => e.currentTarget.style.color = C.t3}
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          style={{
            position: "absolute", top: 0, right: -4, bottom: 0, width: 8,
            cursor: "col-resize", zIndex: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ width: 2, height: 40, borderRadius: 2, background: C.border, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = C.accent}
            onMouseLeave={e => e.currentTarget.style.background = C.border}
          />
        </div>
      </div>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <div className="dashboard-main" style={{ flex: 1, overflowY: "auto" }}>
        <div className="dashboard-content" style={{ maxWidth: 1056, margin: "0 auto", padding: "32px 32px 48px" }}>

          {/* Header */}
          <div style={{ animation: "vFadeUp 0.28s ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Package size={14} color={C.accent} />
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Project</span>
            </div>
            <div className="dashboard-header-row" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
              <h1 style={{ fontSize: 30, fontWeight: 800, color: C.t1, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                {selectedProject?.name || "Dashboard"}
              </h1>
              <div className="dashboard-header-actions" style={{ display: "flex", gap: 8 }}>
                {selectedProject && (
                  <>
                    <button onClick={() => { setEditTarget(selectedProject); setModal("editProject"); }}
                      style={{ padding: "9px 11px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.t2, cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderHi; e.currentTarget.style.color = C.t1; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.t2; }}
                    >
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDeleteProject(selectedProject)}
                      style={{ padding: "9px 11px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = C.t3; e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)"; }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => selectedProject ? setModal("newApp") : setModal("createProject")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "9px 16px",
                    borderRadius: 6,
                    background: C.accent,
                    border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                    boxShadow: `0 4px 18px ${C.accentBg}`,
                    fontFamily: "Plus Jakarta Sans, sans-serif",
                  }}
                >
                  <Plus size={14} /> {selectedProject ? "New RAG App" : "Create Project"}
                </button>
              </div>
            </div>
          </div>

          {/* Delete error */}
          {deleteError && (
            <div style={{ marginBottom: 20, padding: "10px 16px", clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)", background: C.amberBg, border: `1px solid ${C.amber}40`, color: C.amber, fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
              {deleteError}
              <button onClick={() => setDeleteError("")} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer" }}>✕</button>
            </div>
          )}

          {/* Stat cards */}
          {selectedProject && (
            <div className="dashboard-stats" style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <StatCard value={allApps.length} label="Total" desc="RAG Apps in this project" icon={<Package />} iconBg={C.accentBg} iconColor={C.accentLt} C={C} />
              <StatCard value={allApps.filter(a => a.status === "deployed").length} label="Active" desc="Currently active" icon={<CheckCircle />} iconBg={C.greenBg} iconColor={C.green} C={C} />
              <StatCard value={allApps.filter(a => a.status === "draft").length} label="Draft" desc="Work in progress" icon={<Timer />} iconBg={C.amberBg} iconColor={C.amber} C={C} />
            </div>
          )}

          {/* Search + view toggle */}
          {selectedProject && allApps.length > 0 && (
            <div className="dashboard-toolbar" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, animation: "vFadeUp 0.32s ease both" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", boxShadow: C.shadow }}>
                <Search size={14} color={C.t3} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search RAG Apps..."
                  style={{ flex: 1, background: "transparent", border: "none", color: C.t1, fontSize: 14, outline: "none", fontFamily: "Plus Jakarta Sans, sans-serif" }}
                />
              </div>
              <div className="dashboard-view-toggle" style={{ display: "flex", gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4 }}>
                {[["grid", <LayoutGrid size={14} />], ["list", <List size={14} />]].map(([mode, icon]) => (
                  <button key={mode} onClick={() => setViewMode(mode)}
                    style={{ width: 32, height: 32, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: viewMode === mode ? C.accentBg : "transparent", color: viewMode === mode ? C.accentLt : C.t3, transition: "all 0.15s" }}
                  >{icon}</button>
                ))}
              </div>
            </div>
          )}

          {/* Apps */}
          {selectedProject ? (
            filteredApps.length === 0 ? (
              <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: "56px 24px", textAlign: "center", background: C.accentBg }}>
                <div style={{ width: 50, height: 50, borderRadius: 10, background: C.accentBg, border: `1px solid ${C.borderHi}`, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bot size={22} color={C.accentLt} />
                </div>
                <p style={{ fontSize: 15, color: C.t2, marginBottom: 18, fontWeight: 600 }}>
                  {search ? "No apps match your search." : "No RAG apps in this project."}
                </p>
                {!search && (
                  <button onClick={() => setModal("newApp")}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 6, background: C.accentBg, border: `1px solid ${C.borderHi}`, color: C.accentLt, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Plus Jakarta Sans, sans-serif" }}
                  >
                    <Plus size={14} /> Create your first app
                  </button>
                )}
              </div>
            ) : (
              <div className="dashboard-app-grid" style={{
                display: viewMode === "grid" ? "grid" : "flex",
                gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(300px, 1fr))" : undefined,
                flexDirection: "column",
                gap: 14,
              }}>
                {filteredApps.map((app, i) => (
                  <AppCard
                    key={app.id} app={app} index={i} C={C}
                    onArchitect={a => navigate(createPageUrl(`Architect?id=${a.id}`))}
                    onEdit={a => navigate(createPageUrl(`Editor?id=${a.id}`))}
                    onDeploy={a => navigate(createPageUrl(`Deploy?id=${a.id}`))}
                    onDelete={requestDeleteApp}
                  />
                ))}
              </div>
            )
          ) : (
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: "56px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 15, color: C.t3, marginBottom: 18 }}>No projects yet.</p>
              <button onClick={() => setModal("createProject")}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 6, background: C.accent, border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                <Plus size={14} /> Create Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
