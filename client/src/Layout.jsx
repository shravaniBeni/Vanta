import React from "react";

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-[#080c14] text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');

        * { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }

        .grid-bg {
          background-image: 
            linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .glow-indigo {
          box-shadow: 0 0 30px rgba(99,102,241,0.3), 0 0 60px rgba(99,102,241,0.1);
        }

        .glow-text {
          text-shadow: 0 0 40px rgba(139,92,246,0.6);
        }

        .neon-border {
          border: 1px solid rgba(99,102,241,0.4);
          box-shadow: 0 0 10px rgba(99,102,241,0.15), inset 0 0 10px rgba(99,102,241,0.05);
        }

        .scan-line {
          background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(99,102,241,0.03) 50%,
            transparent 100%
          );
          background-size: 100% 4px;
          animation: scan 8s linear infinite;
        }

        @keyframes scan {
          0% { background-position: 0 0; }
          100% { background-position: 0 100vh; }
        }

        .pulse-dot {
          animation: pulse-dot 2s ease-in-out infinite;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .float {
          animation: float 6s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        .shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.1) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmer 3s infinite;
        }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      {children}
    </div>
  );
}
