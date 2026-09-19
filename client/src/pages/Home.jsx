import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Cpu,
  Code,
  Zap,
  ArrowRight,
  Terminal,
  GitBranch,
  Layers,
} from "lucide-react";
import { chatbotsApi } from "@/api/apiClient";
import { createPageUrl } from "@/utils";

export default function Home() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [terminalLines, setTerminalLines] = useState([
    "> Initializing Vanta...",
  ]);
  const navigate = useNavigate();

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
    <div className="min-h-screen bg-[#09090f] grid-bg relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-700/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 left-0 w-64 h-64 bg-cyan-600/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 container mx-auto px-4 py-12">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Vanta" className="w-8 h-8 object-contain" style={{ filter: 'drop-shadow(0 0 8px rgba(124,58,237,0.5))' }} />
            <span className="font-mono text-sm font-bold text-white tracking-widest uppercase">
              Vanta
            </span>
          </div>
          <div className="flex items-center gap-2 neon-border rounded-full px-3 py-1">
            <span className="pulse-dot w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span className="font-mono text-xs text-violet-300">
              RAG Engine · Online
            </span>
          </div>
        </div>

        {/* Hero */}
        <div className="text-center mb-16 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 neon-border rounded-full px-4 py-1.5 mb-6">
            <Terminal className="w-3.5 h-3.5 text-violet-400" />
            <span className="font-mono text-xs text-violet-300">
              v1.0 · Powered by OpenAI + FAISS
            </span>
          </div>

          <h1 className="text-6xl md:text-7xl font-black mb-6 leading-tight">
            <span className="text-white">Build </span>
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent glow-text">
              AI Chatbots
            </span>
            <br />
            <span className="text-white">In Seconds</span>
          </h1>

          <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
            Describe your chatbot in plain English. Vanta generates a complete
            <span className="text-violet-300 font-semibold">
              {" "}
              RAG workflow
            </span>{" "}
            — ready to deploy.
          </p>
        </div>

        {/* Main input card */}
        <div className="max-w-3xl mx-auto mb-16">
          <div className="neon-border rounded-2xl bg-[#13131f]/80 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-violet-600/10 bg-indigo-950/20">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-slate-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="font-mono text-xs text-slate-500 ml-2">
                chatbot_generator.rag
              </span>
            </div>

            <div className="p-6">
              <div className="relative">
                <textarea
                  placeholder={`// Describe your chatbot...\n// Example: A customer support bot for my saree business that answers\n// questions about products, delivery, returns and policies.`}
                  value={description}
                  onChange={handleTextChange}
                  className="w-full min-h-[160px] bg-[#0c0c1a] text-slate-200 placeholder:text-slate-600 font-mono text-sm rounded-xl border border-slate-700/50 focus:border-violet-600/60 focus:outline-none focus:ring-0 p-4 resize-none transition-colors leading-relaxed"
                />
                <div className="absolute bottom-3 right-3 font-mono text-xs text-slate-600">
                  {charCount}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !description.trim()}
                className={`mt-4 w-full py-4 rounded-xl font-bold text-base transition-all duration-300 flex items-center justify-center gap-3 ${
                  loading || !description.trim()
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
                    : "bg-gradient-to-r from-violet-700 to-purple-600 hover:from-violet-600 hover:to-purple-500 text-white glow-indigo hover:scale-[1.01]"
                }`}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono">Generating workflow...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    Generate RAG Workflow
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Terminal widget */}
        <div className="max-w-3xl mx-auto mb-16">
          <div className="neon-border rounded-xl bg-[#0c0c1a]/90 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 bg-black/30">
              <Terminal className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-mono text-xs text-slate-500">
                system.log
              </span>
            </div>
            <div className="p-4 space-y-1 min-h-[80px]">
              {terminalLines.map((line, i) => (
                <div key={i} className="font-mono text-xs text-violet-300/70">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {[
            {
              icon: Sparkles,
              color: "text-violet-400",
              bg: "bg-violet-600/10 border-violet-600/20",
              title: "AI Auto-Generation",
              desc: "Describe in plain English, get a full workflow instantly",
            },
            {
              icon: GitBranch,
              color: "text-purple-400",
              bg: "bg-purple-500/10 border-purple-500/20",
              title: "Visual Flow Editor",
              desc: "Drag & drop nodes to customize your pipeline",
            },
            {
              icon: Code,
              color: "text-cyan-400",
              bg: "bg-cyan-500/10 border-cyan-500/20",
              title: "Export Code",
              desc: "Download production-ready Python to self-host",
            },
            {
              icon: Cpu,
              color: "text-red-400",
              bg: "bg-red-500/10 border-red-500/20",
              title: "Real RAG",
              desc: "Actual document indexing, embeddings & retrieval",
            },
          ].map(({ icon: Icon, color, bg, title, desc }) => (
            <div
              key={title}
              className={`rounded-xl border p-5 ${bg} hover:scale-[1.02] transition-transform cursor-default`}
            >
              <Icon className={`w-7 h-7 ${color} mb-3`} />
              <h3 className="font-semibold text-white text-sm mb-1">{title}</h3>
              <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-16">
          <p className="font-mono text-xs text-slate-700">
            © 2026 Vanta · Open Source RAG Platform
          </p>
        </div>
      </div>
    </div>
  );
}
