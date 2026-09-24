import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Terminal } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "@/utils";
import { useAppTheme } from "@/lib/ThemeContext";

const FRIENDLY_ERRORS = {
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Please confirm your email address before signing in.",
  "User already registered": "An account with this email already exists. Sign in instead.",
  "Password should be at least 6": "Password must be at least 6 characters.",
};

function friendlyError(msg = "") {
  for (const [k, v] of Object.entries(FRIENDLY_ERRORS)) {
    if (msg.includes(k)) return v;
  }
  return msg || "Something went wrong. Please try again.";
}

export default function Login() {
  const [mode, setMode]       = useState("signin");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [info, setInfo]       = useState("");
  const [loading, setLoading] = useState(false);
  const { isAuthenticated, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { C } = useAppTheme();

  useEffect(() => {
    if (isAuthenticated) navigate(createPageUrl("Dashboard"), { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setInfo("");
    if (!email.trim() || !password.trim()) { setError("Email and password are required."); return; }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: err } = await signIn(email.trim(), password);
        if (err) { setError(friendlyError(err.message)); return; }
        navigate(createPageUrl("Dashboard"), { replace: true });
      } else {
        const { error: err } = await signUp(email.trim(), password);
        if (err) { setError(friendlyError(err.message)); return; }
        setInfo("Account created! Check your email to confirm, then sign in.");
        setMode("signin");
      }
    } finally { setLoading(false); }
  };

  const inputStyle = {
    width: "100%", padding: "12px 16px",
    background: C.input, border: `1px solid ${C.inputBorder}`,
    borderRadius: 12, color: C.t1, fontSize: 13,
    fontFamily: "JetBrains Mono, monospace",
    outline: "none", transition: "border-color 0.15s", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", position: "relative" }} className="grid-bg">
      <div style={{ position: "absolute", top: 0, left: "25%", width: 384, height: 384, background: "rgba(109,40,217,0.08)", borderRadius: "50%", filter: "blur(120px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, right: "25%", width: 384, height: 384, background: "rgba(126,34,206,0.08)", borderRadius: "50%", filter: "blur(120px)", pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 440, fontFamily: "Plus Jakarta Sans, sans-serif" }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <img src="/logo.png" alt="Vanta" style={{ width: 36, height: 36, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(124,58,237,0.55))" }} />
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color: C.t1, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Vanta
          </span>
        </div>

        {/* Card */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, overflow: "hidden", boxShadow: C.shadowCard }}>
          {/* Mac-style title bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderBottom: `1px solid ${C.border}`, background: C.bgSub }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(239,68,68,0.7)" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(100,116,139,0.5)" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(34,197,94,0.7)" }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: C.t3, marginLeft: 8 }}>
              {mode === "signin" ? "auth.sign_in()" : "auth.sign_up()"}
            </span>
          </div>

          <div style={{ padding: 32 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.t1, marginBottom: 4, letterSpacing: "-0.02em" }}>
              {mode === "signin" ? "Welcome back" : "Create account"}
            </h1>
            <p style={{ color: C.t2, fontSize: 13, marginBottom: 24 }}>
              {mode === "signin" ? "Sign in to your Vanta workspace." : "Build your first AI chatbot in minutes."}
            </p>

            {error && (
              <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: C.accentBg, border: `1px solid ${C.borderHi}`, color: C.accentLt, fontSize: 13 }}>
                {info}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: C.t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = C.borderHi}
                  onBlur={e => e.target.style.borderColor = C.inputBorder}
                />
              </div>
              <div>
                <label style={{ display: "block", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: C.t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = C.borderHi}
                  onBlur={e => e.target.style.borderColor = C.inputBorder}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  marginTop: 8, transition: "all 0.2s",
                  background: loading ? C.surface : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  border: loading ? `1px solid ${C.border}` : "none",
                  color: loading ? C.t3 : "#fff",
                  boxShadow: loading ? "none" : "0 0 24px rgba(124,58,237,0.35)",
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = "0 0 36px rgba(124,58,237,0.5)"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.boxShadow = "0 0 24px rgba(124,58,237,0.35)"; }}
              >
                {loading ? (
                  <>
                    <div style={{ width: 16, height: 16, border: `2px solid ${C.t3}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    {mode === "signin" ? "Signing in..." : "Creating account..."}
                  </>
                ) : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: C.t2 }}>
              {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
              <button
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setInfo(""); }}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: C.accentLt, fontWeight: 600, fontSize: 13 }}
                onMouseEnter={e => e.currentTarget.style.color = C.accent}
                onMouseLeave={e => e.currentTarget.style.color = C.accentLt}
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>

        {/* Terminal widget */}
        <div style={{ marginTop: 20, background: C.bgSub, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: `1px solid ${C.border}` }}>
            <Terminal style={{ width: 12, height: 12, color: C.accentLt }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: C.t3 }}>vanta.auth</span>
          </div>
          <div style={{ padding: 12 }}>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: C.accentLt, opacity: 0.6 }}>
              &gt; Secure · Supabase Auth · JWT
            </p>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
