import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Cpu, Code, Zap, ArrowRight, Terminal, GitBranch, Layers,
} from "lucide-react";
import { chatbotsApi } from "@/api/apiClient";
import { createPageUrl } from "@/utils";
import { useAppTheme } from "@/lib/ThemeContext";

export default function Home() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [terminalLines, setTerminalLines] = useState(["> Initializing Vanta..."]);
  const navigate = useNavigate();
  const { C } = useAppTheme();

  useEffect(() => {
    const lines = [
      "> Initializing Vanta...",
      "> Loading neural embeddings... OK",
      "> Connecting vector store... OK",
      "> RAG pipeline ready.",
      "> System online. Awaiting input_",
    ];
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i < lines.length) {
        setTerminalLines((prev) => [...prev.slice(-4), lines[i]]);
      } else {
        clearInterval(interval);
      }
    }, 600);
    return () => clearInterval(interval);
  }, []);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    try {
      const chatbot = await chatbotsApi.generate(description);
      navigate(createPageUrl(`Editor?id=${chatbot.id}`));
    } catch (error) {
      console.error("Generation failed:", error);
      alert(
        "Failed to generate workflow. Make sure the backend is running and OPENAI_API_KEY is set.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTextChange = (e) => {
    setDescription(e.target.value);
    setCharCount(e.target.value.length);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg }} className="grid-bg relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-700/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 left-0 w-64 h-64 bg-cyan-600/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 container mx-auto px-4 py-12">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vanta" className="w-8 h-8 object-contain" style={{ filter: 'drop-shadow(0 0 8px rgba(124,58,237,0.5))' }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Vanta
            </span>
          </div>
          <div className="flex items-center gap-2 neon-border rounded-full px-3 py-1">
            <span className="pulse-dot w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.accentLt }}>
              RAG Engine · Online
            </span>
          </div>
        </div>

        {/* Hero */}
        <div className="text-center mb-16 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 neon-border rounded-full px-4 py-1.5 mb-6">
            <Terminal className="w-3.5 h-3.5" style={{ color: C.accentLt }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.accentLt }}>
              v1.0 · Powered by OpenAI + FAISS
            </span>
          </div>

          <h1 className="text-6xl md:text-7xl font-black mb-6 leading-tight">
            <span style={{ color: C.t1 }}>Build </span>
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent glow-text">
              AI Chatbots
            </span>
            <br />
            <span style={{ color: C.t1 }}>In Seconds</span>
          </h1>

          <p style={{ color: C.t2, fontSize: 18, maxWidth: 560, margin: '0 auto', lineHeight: 1.65 }}>
            Describe your chatbot in plain English. Vanta generates a complete
            <span style={{ color: C.accentLt, fontWeight: 600 }}> RAG workflow</span> — ready to deploy.
          </p>
        </div>

        {/* Main input card */}
        <div className="max-w-3xl mx-auto mb-16">
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: `1px solid ${C.border}`, background: C.bgSub }}>
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-slate-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.t3, marginLeft: 8 }}>
                chatbot_generator.rag
              </span>
            </div>

            <div style={{ padding: 24 }}>
              <div style={{ position: 'relative' }}>
                <textarea
                  placeholder={`// Describe your chatbot...\n// Example: A customer support bot for my saree business that answers\n// questions about products, delivery, returns and policies.`}
                  value={description}
                  onChange={handleTextChange}
                  style={{
                    width: '100%', minHeight: 160,
                    background: C.input, color: C.t1,
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                    border: `1px solid ${C.inputBorder}`, borderRadius: 12,
                    padding: 16, resize: 'none', outline: 'none',
                    lineHeight: 1.65, boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = C.borderHi}
                  onBlur={e => e.target.style.borderColor = C.inputBorder}
                />
                <div style={{ position: 'absolute', bottom: 12, right: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3 }}>
                  {charCount}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !description.trim()}
                style={{
                  marginTop: 16, width: '100%', padding: '16px 0',
                  borderRadius: 12, fontWeight: 700, fontSize: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                  cursor: loading || !description.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.25s',
                  background: loading || !description.trim()
                    ? C.surface
                    : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  border: `1px solid ${loading || !description.trim() ? C.border : 'transparent'}`,
                  color: loading || !description.trim() ? C.t3 : '#fff',
                  boxShadow: loading || !description.trim() ? 'none' : '0 0 30px rgba(124,58,237,0.35)',
                }}
              >
                {loading ? (
                  <>
                    <div style={{ width: 20, height: 20, border: `2px solid ${C.t3}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>Generating workflow...</span>
                  </>
                ) : (
                  <>
                    <Zap style={{ width: 20, height: 20 }} />
                    Generate RAG Workflow
                    <ArrowRight style={{ width: 16, height: 16 }} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Terminal widget */}
        <div className="max-w-3xl mx-auto mb-16">
          <div style={{ background: C.bgSub, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: `1px solid ${C.border}` }}>
              <Terminal style={{ width: 14, height: 14, color: C.accentLt }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3 }}>system.log</span>
            </div>
            <div style={{ padding: 16, minHeight: 80, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {terminalLines.map((line, i) => (
                <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.accentLt, opacity: 0.7 }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {[
            { icon: Sparkles, color: C.accentLt,  bgColor: C.accentBg,                    title: "AI Auto-Generation", desc: "Describe in plain English, get a full workflow instantly" },
            { icon: GitBranch, color: '#c084fc',  bgColor: 'rgba(192,132,252,0.1)',        title: "Visual Flow Editor",  desc: "Drag & drop nodes to customize your pipeline" },
            { icon: Code,      color: C.amber,    bgColor: C.amberBg,                      title: "Export Code",         desc: "Download production-ready Python to self-host" },
            { icon: Cpu,       color: '#f87171',  bgColor: 'rgba(248,113,113,0.1)',        title: "Real RAG",            desc: "Actual document indexing, embeddings & retrieval" },
          ].map(({ icon: Icon, color, bgColor, title, desc }) => (
            <div
              key={title}
              style={{
                background: bgColor, border: `1px solid ${color}33`,
                borderRadius: 12, padding: 20, cursor: 'default',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <Icon style={{ width: 28, height: 28, color, marginBottom: 12 }} />
              <h3 style={{ fontWeight: 600, color: C.t1, fontSize: 14, marginBottom: 4 }}>{title}</h3>
              <p style={{ color: C.t2, fontSize: 12, lineHeight: 1.55 }}>{desc}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 64 }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.t3 }}>
            © 2026 Vanta · Open Source RAG Platform
          </p>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
