/**
 * client/src/components/widget/WidgetRenderer.jsx
 *
 * Phase 10B — Redesigned widget with animated robot launcher.
 */

import React, { useState, useEffect } from 'react';
import ChatRenderer from '../chatbot/ChatRenderer';

// ─── Animated Robot Launcher Icon ────────────────────────────────────────────
// Closed: eyes scan left ↔ right continuously (CSS keyframes)
// Open:   eyes look straight up / forward (fixed position, no scan)
// No rotation, no ✕ — always the robot face.

function RobotLauncherIcon({ open, size = 34 }) {
  // Key change forces a fresh CSS animation restart when toggling
  const animKey = open ? 'up' : 'scan';

  return (
    <>
      <style>{`
        @keyframes vbot-scan-l {
          0%,100% { transform: translateX(0px); }
          50%      { transform: translateX(3px); }
        }
        @keyframes vbot-scan-r {
          0%,100% { transform: translateX(0px); }
          50%      { transform: translateX(3px); }
        }
        @keyframes vbot-look-up {
          0%   { transform: translateY(0px); }
          100% { transform: translateY(-4px); }
        }
        @keyframes vbot-antenna {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>

      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        {/* Antenna stem */}
        <line x1="24" y1="2" x2="24" y2="10"
          stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
        {/* Antenna tip — blinks */}
        <circle cx="24" cy="2.5" r="3" fill="white"
          style={{ animation: 'vbot-antenna 2.2s ease-in-out infinite' }}/>

        {/* Ears */}
        <rect x="3"  y="17" width="6" height="12" rx="3" fill="rgba(255,255,255,0.55)"/>
        <rect x="39" y="17" width="6" height="12" rx="3" fill="rgba(255,255,255,0.55)"/>

        {/* Head */}
        <rect x="9" y="10" width="30" height="28" rx="7"
          fill="rgba(255,255,255,0.13)" stroke="white" strokeWidth="2"/>

        {/* ── LEFT EYE ── */}
        {/* socket / track */}
        <rect x="12" y="19" width="11" height="9" rx="4.5" fill="rgba(255,255,255,0.18)"/>
        {/* pupil — clipped inside socket */}
        <clipPath id="vbot-clip-l">
          <rect x="12" y="19" width="11" height="9" rx="4.5"/>
        </clipPath>
        <rect
          key={`l-${animKey}`}
          x="12" y="19" width="8" height="9" rx="4.5"
          fill="white"
          clipPath="url(#vbot-clip-l)"
          style={{
            animation: open
              ? 'vbot-look-up 0.3s ease forwards'
              : 'vbot-scan-l 2.6s ease-in-out infinite',
          }}
        />

        {/* ── RIGHT EYE ── */}
        <rect x="25" y="19" width="11" height="9" rx="4.5" fill="rgba(255,255,255,0.18)"/>
        <clipPath id="vbot-clip-r">
          <rect x="25" y="19" width="11" height="9" rx="4.5"/>
        </clipPath>
        <rect
          key={`r-${animKey}`}
          x="25" y="19" width="8" height="9" rx="4.5"
          fill="white"
          clipPath="url(#vbot-clip-r)"
          style={{
            animation: open
              ? 'vbot-look-up 0.3s ease forwards'
              : 'vbot-scan-r 2.6s ease-in-out infinite',
          }}
        />

        {/* Mouth */}
        {open
          ? /* neutral straight line when looking up */
            <line x1="17" y1="32" x2="31" y2="32"
              stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
          : /* friendly smile when idle */
            <path d="M17 31 Q24 35 31 31"
              stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.65"/>
        }
      </svg>
    </>
  );
}

// ─── Floating widget ──────────────────────────────────────────────────────────

function FloatingWidget({ config, chatbotTitle, previewMode, compact, ...chatProps }) {
  const [open, setOpen]       = useState(previewMode ?? false);
  const [visible, setVisible] = useState(previewMode ?? false); // for mount animation

  useEffect(() => {
    if (open) {
      // Small delay so the animation is visible on open
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  const { launcher, position, dimensions } = config.widget;
  const primaryColor = config.chat_ui.branding.primary_color;
  const bgColor      = config.chat_ui.branding.background_color;

  const isRight    = position !== 'bottom-left';
  const btnSize    = compact ? 52 : 68;
  const gap        = compact ? 12 : 20;
  const edgeOffset = compact ? 14 : 28;

  // Default panel is larger: 440×680 (overrides ui_config defaults for better UX)
  const rawW   = Math.max(dimensions.width,  440);
  const rawH   = Math.max(dimensions.height, 640);
  const panelW = compact ? Math.min(rawW, 320) : rawW;
  const panelH = compact ? Math.min(rawH, 440) : rawH;

  // Panel positions above the button
  const panelBottom = edgeOffset + btnSize + gap;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: panelBottom,
          [isRight ? 'right' : 'left']: edgeOffset,
          width: panelW,
          // Clamp height so it never overflows the viewport
          maxHeight: `calc(100vh - ${panelBottom + edgeOffset + 16}px)`,
          height: panelH,
          borderRadius: compact ? 16 : 20,
          overflow: 'hidden',
          background: bgColor,
          boxShadow: `0 24px 60px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)`,
          display: 'flex', flexDirection: 'column',
          zIndex: 2147483640,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'opacity 0.25s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          transformOrigin: isRight ? 'bottom right' : 'bottom left',
        }}>
          <ChatRenderer
            config={config}
            chatbotTitle={chatbotTitle}
            compact={compact}
            onClose={() => setOpen(false)}
            {...chatProps}
          />
        </div>
      )}

      {/* Launcher button */}
      {launcher.enabled && (
        <div style={{
          position: 'fixed',
          bottom: edgeOffset,
          [isRight ? 'right' : 'left']: edgeOffset,
          zIndex: 2147483641,
        }}>
          {/* Shimmer ring — outer */}
          <div style={{
            position: 'absolute',
            inset: -(compact ? 5 : 7),
            borderRadius: '50%',
            border: `2px solid ${primaryColor}`,
            opacity: open ? 0 : 0.25,
            animation: open ? 'none' : 'vw-ring 3s ease-in-out infinite',
            pointerEvents: 'none',
            transition: 'opacity 0.3s',
          }} />
          {/* Glow */}
          <div style={{
            position: 'absolute',
            inset: -(compact ? 10 : 14),
            borderRadius: '50%',
            background: `radial-gradient(circle, ${primaryColor}45 0%, transparent 68%)`,
            pointerEvents: 'none',
            animation: open ? 'none' : 'vw-glow 3s ease-in-out infinite',
          }} />

          <button
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close chat' : (launcher.label || 'Open chat')}
            style={{
              width: btnSize, height: btnSize,
              borderRadius: '50%',
              background: open
                ? `rgba(18,8,40,0.96)`
                : `linear-gradient(150deg, ${primaryColor}ff 0%, ${primaryColor}bb 100%)`,
              border: `2px solid ${open ? `${primaryColor}55` : `${primaryColor}99`}`,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: open
                ? `0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)`
                : `0 10px 40px ${primaryColor}60, 0 4px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18)`,
              transition: 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {/* Inner shine */}
            {!open && (
              <div style={{
                position: 'absolute', top: 4, left: '25%', width: '50%', height: '30%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 100%)',
                borderRadius: '50%', pointerEvents: 'none',
              }} />
            )}
            <RobotLauncherIcon
              open={open}
              size={compact ? 32 : 42}
            />
          </button>

          {/* Label badge */}
          {!open && launcher.label && !compact && (
            <div style={{
              position: 'absolute',
              bottom: btnSize + 10,
              [isRight ? 'right' : 'left']: 0,
              background: 'rgba(8,4,20,0.94)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              padding: '6px 12px',
              fontSize: 12, fontWeight: 600, color: '#fff',
              whiteSpace: 'nowrap',
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              pointerEvents: 'none',
              animation: 'vw-label-in 0.3s ease',
              letterSpacing: '-0.01em',
            }}>
              {launcher.label}
              <div style={{
                position: 'absolute', bottom: -5,
                [isRight ? 'right' : 'left']: 22,
                width: 10, height: 10,
                background: 'rgba(8,4,20,0.94)',
                border: '1px solid rgba(255,255,255,0.1)',
                transform: 'rotate(45deg)',
                borderTop: 'none', borderLeft: 'none',
              }} />
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes vw-glow      { 0%,100% { opacity:0.5; transform:scale(1); } 50% { opacity:1; transform:scale(1.2); } }
        @keyframes vw-ring      { 0%,100% { opacity:0.25; transform:scale(1); } 50% { opacity:0.55; transform:scale(1.18); } }
        @keyframes vw-label-in  { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

// ─── Embedded widget ──────────────────────────────────────────────────────────

function EmbeddedWidget({ config, chatbotTitle, compact, ...chatProps }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: config.chat_ui.branding.background_color,
      borderRadius: compact ? 16 : 20,
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      display: 'flex', flexDirection: 'column',
    }}>
      <ChatRenderer config={config} chatbotTitle={chatbotTitle} compact={compact} {...chatProps} />
    </div>
  );
}

// ─── Fullscreen widget ────────────────────────────────────────────────────────

function FullscreenWidget({ config, chatbotTitle, compact, ...chatProps }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: config.chat_ui.branding.background_color,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <ChatRenderer config={config} chatbotTitle={chatbotTitle} compact={compact} {...chatProps} />
    </div>
  );
}

// ─── Main WidgetRenderer ──────────────────────────────────────────────────────

export default function WidgetRenderer({
  config,
  previewMode = false,
  compact     = false,
  ...props
}) {
  const template = config?.widget?.template ?? 'floating';

  if (template === 'embedded')   return <EmbeddedWidget  config={config} compact={compact} {...props} />;
  if (template === 'fullscreen') return <FullscreenWidget config={config} compact={compact} {...props} />;
  return <FloatingWidget config={config} compact={compact} previewMode={previewMode} {...props} />;
}
