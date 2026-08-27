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

// ─── Theme ────────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem("vanta-theme");
    return s ? s === "dark" : true; // default dark
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("vanta-theme", dark ? "dark" : "light");
  }, [dark]);
  return [dark, () => setDark(d => !d)];
}

// ─── CSS vars (applied via inline style on root div, override per theme) ──────

const DARK = {
  bg:        "#0e0e1a",
  bgSub:     "#13132b",
  surface:   "#181830",
  surfaceHi: "#1e1e38",
  border:    "rgba(255,255,255,0.07)",
  borderHi:  "rgba(139,92,246,0.5)",
  t1:        "#f0efff",
  t2:        "#9d9bb8",
  t3:        "#4d4b6b",
  accent:    "#7c3aed",
  accentLt:  "#a78bfa",
  accentBg:  "rgba(124,58,237,0.12)",
  amber:     "#f59e0b",
  amberBg:   "rgba(245,158,11,0.12)",
  green:     "#10b981",
  greenBg:   "rgba(16,185,129,0.12)",
  shadow:    "0 4px 24px rgba(0,0,0,0.5)",
  shadowCard:"0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)",
};

const LIGHT = {
  bg:        "#f5f4ff",
  bgSub:     "#ebe9ff",
  surface:   "#ffffff",
  surfaceHi: "#f9f8ff",
  border:    "rgba(0,0,0,0.09)",
  borderHi:  "rgba(124,58,237,0.4)",
  t1:        "#1a1730",
  t2:        "#5a567a",
  t3:        "#b0adc8",
  accent:    "#7c3aed",
  accentLt:  "#7c3aed",
  accentBg:  "rgba(124,58,237,0.07)",
  amber:     "#d97706",
  amberBg:   "rgba(217,119,6,0.08)",
  green:     "#059669",
  greenBg:   "rgba(5,150,105,0.08)",
  shadow:    "0 2px 16px rgba(0,0,0,0.08)",
  shadowCard:"0 6px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)",
};

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
        borderRadius: 16, boxShadow: C.shadowCard,
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
        width: "100%", padding: "10px 14px", borderRadius: 10,
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
        width: "100%", padding: "10px 14px", borderRadius: 10,
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
        padding: "10px 20px", borderRadius: 10,
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
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
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
        <div style={{ width: 40, height: 40, borderRadius: 12, background: C.accentBg, border: `1px solid ${C.borderHi}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bot size={17} color={C.accentLt} />
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>New RAG Application</h2>
          <p style={{ fontSize: 13, color: C.t3, marginTop: 2 }}>Describe what the assistant should do.</p>
        </div>
      </div>
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
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
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <AlertTriangle size={17} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>Delete Application?</h2>
      </div>
      <p style={{ fontSize: 14, color: C.t2, lineHeight: 1.6, marginBottom: 8 }}>
        <strong style={{ color: C.t1 }}>"{app.title}"</strong> will be permanently deleted.
      </p>
      <p style={{ fontSize: 13, color: C.t3, lineHeight: 1.6, marginBottom: 20 }}>All documents, indexed chunks, chat history, and deployment data will be removed.</p>
      {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#fca5a5", fontSize: 13 }}>{error}</div>}
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
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "20px 22px",
      boxShadow: C.shadowCard,
      display: "flex", alignItems: "center", gap: 16,
      animation: "vFadeUp 0.3s ease both",
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: 14,
        padding: "18px 18px 16px",
        boxShadow: hover ? C.shadowCard : C.shadow,
        display: "flex", flexDirection: "column",
        transition: "all 0.2s ease",
        position: "relative", cursor: "default",
      }}>
        {/* Top row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{
            background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
            color: statusColor,
            fontSize: 11, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
            letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "2px 9px", borderRadius: 6,
          }}>
            {app.status || "draft"}
          </span>
          {/* Overflow menu */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMenu(o => !o)}
              style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${menu ? C.borderHi : C.border}`, background: menu ? C.accentBg : "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menu && (
              <div style={{
                position: "absolute", right: 0, top: 32, zIndex: 20,
                background: C.surface, border: `1px solid ${C.borderHi}`,
                borderRadius: 12, boxShadow: C.shadowCard, minWidth: 152, padding: "5px 0",
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

        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.t1, marginBottom: 6, lineHeight: 1.35, fontFamily: "Plus Jakarta Sans, sans-serif", letterSpacing: "-0.01em" }}>
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
              flex: 1, padding: "9px 0", borderRadius: 9,
              background: C.accentBg, border: `1px solid ${C.borderHi}`,
              color: C.accentLt, fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: "Plus Jakarta Sans, sans-serif", transition: "all 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = `${C.accent}28`}
            onMouseLeave={e => e.currentTarget.style.background = C.accentBg}
          >
            <Cpu size={13} /> Architect
          </button>
          <button
            onClick={() => onEdit(app)}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 9,
              background: C.amberBg, border: `1px solid ${C.amber}40`,
              color: C.amber, fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: "Plus Jakarta Sans, sans-serif", transition: "all 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = `${C.amber}20`}
            onMouseLeave={e => e.currentTarget.style.background = C.amberBg}
          >
            <Edit3 size={13} /> Editor
          </button>
          {app.status === "deployed" && app.embed_id && (
            <button
              onClick={() => onDeploy(app)}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 9,
                background: C.greenBg, border: `1px solid ${C.green}40`,
                color: C.green, fontSize: 13, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontFamily: "Plus Jakarta Sans, sans-serif",
              }}
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
const MAX_W = 320;
const DEFAULT_W = 220;

function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    const s = localStorage.getItem("vanta-sidebar-w");
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
      setWidth(w => { localStorage.setItem("vanta-sidebar-w", w); return w; });
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
  const [dark, toggleTheme] = useTheme();
  const C = dark ? DARK : LIGHT;

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
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", fontFamily: "Plus Jakarta Sans, sans-serif" }}>

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
      `}</style>

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {modal === "createProject" && <ProjectModal mode="create" onClose={() => setModal(null)} onSave={handleCreateProject} C={C} />}
      {modal === "editProject"   && editTarget && <ProjectModal mode="edit" project={editTarget} onClose={() => { setModal(null); setEditTarget(null); }} onSave={handleUpdateProject} C={C} />}
      {modal === "newApp"        && <NewAppModal projectId={activeProject} onClose={() => setModal(null)} onCreated={handleAppCreated} C={C} />}
      {modal === "deleteApp"     && deleteAppTarget && <DeleteAppModal app={deleteAppTarget} onClose={() => { setModal(null); setDeleteAppTarget(null); }} onConfirm={handleDeleteAppConfirmed} C={C} />}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <div style={{ width: sidebarW, flexShrink: 0, background: C.bgSub, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "relative", transition: "width 0.05s", overflow: "hidden" }}>

        {/* Logo */}
        <div style={{ padding: collapsed ? "18px 0" : "18px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 10 }}>
          <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #6d28d9)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 20px ${C.accentBg}` }}>
            <Sparkles size={15} color="#fff" />
          </div>
          {!collapsed && (
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 15, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", background: dark ? "linear-gradient(135deg, #a78bfa, #7c3aed, #38bdf8)" : `linear-gradient(135deg, ${C.accent}, #6d28d9)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", whiteSpace: "nowrap" }}>
              Vanta
            </span>
          )}
        </div>

        {/* Projects */}
        <div style={{ flex: 1, overflowY: "auto", padding: collapsed ? "12px 0" : "12px 0" }}>
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
                <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 8, background: isActive ? C.accentBg : C.border, border: `1px solid ${isActive ? C.borderHi : C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, background: C.accentBg, border: `1px solid ${C.borderHi}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 40px" }}>

          {/* Header */}
          <div style={{ animation: "vFadeUp 0.28s ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Package size={14} color={C.accent} />
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Project</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 32 }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, color: C.t1, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {selectedProject?.name || "Dashboard"}
              </h1>
              <div style={{ display: "flex", gap: 8 }}>
                {selectedProject && (
                  <>
                    <button onClick={() => { setEditTarget(selectedProject); setModal("editProject"); }}
                      style={{ padding: "9px 11px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.t2, cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderHi; e.currentTarget.style.color = C.t1; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.t2; }}
                    >
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDeleteProject(selectedProject)}
                      style={{ padding: "9px 11px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.15s" }}
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
                    padding: "9px 20px", borderRadius: 10,
                    background: `linear-gradient(135deg, ${C.accent}, #6d28d9)`,
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
            <div style={{ marginBottom: 20, padding: "10px 16px", borderRadius: 10, background: C.amberBg, border: `1px solid ${C.amber}40`, color: C.amber, fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
              {deleteError}
              <button onClick={() => setDeleteError("")} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer" }}>✕</button>
            </div>
          )}

          {/* Stat cards */}
          {selectedProject && (
            <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
              <StatCard value={allApps.length} label="Total" desc="RAG Apps in this project" icon={<Package />} iconBg={C.accentBg} iconColor={C.accentLt} C={C} />
              <StatCard value={allApps.filter(a => a.status === "deployed").length} label="Active" desc="Currently active" icon={<CheckCircle />} iconBg={C.greenBg} iconColor={C.green} C={C} />
              <StatCard value={allApps.filter(a => a.status === "draft").length} label="Draft" desc="Work in progress" icon={<Timer />} iconBg={C.amberBg} iconColor={C.amber} C={C} />
            </div>
          )}

          {/* Search + view toggle */}
          {selectedProject && allApps.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, animation: "vFadeUp 0.32s ease both" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 14px", boxShadow: C.shadow }}>
                <Search size={14} color={C.t3} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search RAG Apps..."
                  style={{ flex: 1, background: "transparent", border: "none", color: C.t1, fontSize: 14, outline: "none", fontFamily: "Plus Jakarta Sans, sans-serif" }}
                />
              </div>
              <div style={{ display: "flex", gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
                {[["grid", <LayoutGrid size={14} />], ["list", <List size={14} />]].map(([mode, icon]) => (
                  <button key={mode} onClick={() => setViewMode(mode)}
                    style={{ width: 32, height: 32, borderRadius: 7, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: viewMode === mode ? C.accentBg : "transparent", color: viewMode === mode ? C.accentLt : C.t3, transition: "all 0.15s" }}
                  >{icon}</button>
                ))}
              </div>
            </div>
          )}

          {/* Apps */}
          {selectedProject ? (
            filteredApps.length === 0 ? (
              <div style={{ border: `1px dashed ${C.border}`, borderRadius: 16, padding: "64px 24px", textAlign: "center", background: C.accentBg }}>
                <div style={{ width: 50, height: 50, borderRadius: 14, background: C.accentBg, border: `1px solid ${C.borderHi}`, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bot size={22} color={C.accentLt} />
                </div>
                <p style={{ fontSize: 15, color: C.t2, marginBottom: 18, fontWeight: 600 }}>
                  {search ? "No apps match your search." : "No RAG apps in this project."}
                </p>
                {!search && (
                  <button onClick={() => setModal("newApp")}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 10, background: C.accentBg, border: `1px solid ${C.borderHi}`, color: C.accentLt, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Plus Jakarta Sans, sans-serif" }}
                  >
                    <Plus size={14} /> Create your first app
                  </button>
                )}
              </div>
            ) : (
              <div style={{
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
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 16, padding: "64px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 15, color: C.t3, marginBottom: 18 }}>No projects yet.</p>
              <button onClick={() => setModal("createProject")}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #6d28d9)`, border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Plus Jakarta Sans, sans-serif" }}
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
