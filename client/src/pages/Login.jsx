import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Terminal } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "@/utils";

const FRIENDLY_ERRORS = {
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Please confirm your email address before signing in.",
  "User already registered":
    "An account with this email already exists. Sign in instead.",
  "Password should be at least 6": "Password must be at least 6 characters.",
};

function friendlyError(msg = "") {
  for (const [k, v] of Object.entries(FRIENDLY_ERRORS)) {
    if (msg.includes(k)) return v;
  }
  return msg || "Something went wrong. Please try again.";
}

export default function Login() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const { isAuthenticated, signIn, signUp } = useAuth();
  const navigate = useNavigate();

  // Redirect authenticated users away from Login
  useEffect(() => {
    if (isAuthenticated) {
      navigate(createPageUrl("Dashboard"), { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: err } = await signIn(email.trim(), password);
        if (err) {
          setError(friendlyError(err.message));
          return;
        }
        navigate(createPageUrl("Dashboard"), { replace: true });
      } else {
        const { error: err } = await signUp(email.trim(), password);
        if (err) {
          setError(friendlyError(err.message));
          return;
        }
        setInfo("Account created! Check your email to confirm, then sign in.");
        setMode("signin");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090f] grid-bg flex items-center justify-center px-4">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-700/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-10">
          <img src="/logo.png" alt="Vanta" className="w-9 h-9 object-contain" style={{ filter: 'drop-shadow(0 0 10px rgba(124,58,237,0.55))' }} />
          <span className="font-mono text-base font-bold text-white tracking-widest uppercase">
            Vanta
          </span>
        </div>

        {/* Card */}
        <div className="neon-border rounded-2xl bg-[#13131f]/80 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-violet-600/10 bg-indigo-950/20">
            <div className="w-3 h-3 rounded-full bg-red-500/70" />
            <div className="w-3 h-3 rounded-full bg-slate-500/50" />
            <div className="w-3 h-3 rounded-full bg-green-500/70" />
            <span className="font-mono text-xs text-slate-500 ml-2">
              {mode === "signin" ? "auth.sign_in()" : "auth.sign_up()"}
            </span>
          </div>

          <div className="p-8">
            <h1 className="text-2xl font-bold text-white mb-1">
              {mode === "signin" ? "Welcome back" : "Create account"}
            </h1>
            <p className="text-slate-500 text-sm mb-6">
              {mode === "signin"
                ? "Sign in to your Vanta workspace."
                : "Build your first AI chatbot in minutes."}
            </p>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}
            {info && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-violet-300 text-sm">
                {info}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-mono text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-[#0c0c1a] border border-slate-700/50 rounded-xl text-slate-200 text-sm font-mono focus:border-violet-600/60 focus:outline-none transition-colors placeholder:text-slate-600"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-[#0c0c1a] border border-slate-700/50 rounded-xl text-slate-200 text-sm font-mono focus:border-violet-600/60 focus:outline-none transition-colors placeholder:text-slate-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 mt-2 ${
                  loading
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-violet-700 to-purple-600 hover:from-violet-600 hover:to-purple-500 text-white glow-indigo"
                }`}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    {mode === "signin"
                      ? "Signing in..."
                      : "Creating account..."}
                  </>
                ) : mode === "signin" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              {mode === "signin"
                ? "Don't have an account? "
                : "Already have an account? "}
              <button
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError("");
                  setInfo("");
                }}
                className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>

        {/* Terminal widget */}
        <div className="mt-6 neon-border rounded-xl bg-[#0c0c1a]/90 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 bg-black/30">
            <Terminal className="w-3 h-3 text-violet-400" />
            <span className="font-mono text-xs text-slate-600">vanta.auth</span>
          </div>
          <div className="p-3">
            <p className="font-mono text-xs text-violet-300/60">
              &gt; Secure · Supabase Auth · JWT
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
