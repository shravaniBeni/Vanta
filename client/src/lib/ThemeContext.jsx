/**
 * client/src/lib/ThemeContext.jsx
 *
 * Global light/dark theme context for the entire Vanta app.
 * - Reads `vanta-theme` from localStorage on load (defaults to dark)
 * - Sets `document.documentElement.classList` with 'dark'
 * - Exposes `dark`, `toggleTheme`, `C` (color tokens) everywhere
 */

import React, { createContext, useContext, useState, useEffect } from 'react';

// ─── Shared color tokens ─────────────────────────────────────────────────────

export const DARK = {
  bg:         '#08080e',
  bgSub:      '#0d0d17',
  surface:    '#14141f',
  surfaceHi:  '#19192a',
  border:     'rgba(255,255,255,0.06)',
  borderHi:   'rgba(139,92,246,0.55)',
  t1:         '#eeeeff',
  t2:         '#8888aa',
  t3:         '#3f3f5c',
  accent:     '#7c3aed',
  accentLt:   '#a78bfa',
  accentBg:   'rgba(124,58,237,0.10)',
  amber:      '#38bdf8',
  amberBg:    'rgba(56,189,248,0.10)',
  green:      '#10b981',
  greenBg:    'rgba(16,185,129,0.10)',
  cyan:       '#22d3ee',
  shadow:     '0 2px 16px rgba(0,0,0,0.6)',
  shadowCard: '0 8px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)',
  // Panel / component backgrounds
  panel:      '#0d0d1c',
  panelBorder:'rgba(124,58,237,0.2)',
  input:      '#0c0c1a',
  inputBorder:'rgba(124,58,237,0.25)',
  nodePalette:'#0b0b18',
};

export const LIGHT = {
  bg:         '#f5f4ff',
  bgSub:      '#ebe9ff',
  surface:    '#ffffff',
  surfaceHi:  '#f9f8ff',
  border:     'rgba(0,0,0,0.09)',
  borderHi:   'rgba(124,58,237,0.4)',
  t1:         '#1a1730',
  t2:         '#5a567a',
  t3:         '#b0adc8',
  accent:     '#7c3aed',
  accentLt:   '#7c3aed',
  accentBg:   'rgba(124,58,237,0.07)',
  amber:      '#d97706',
  amberBg:    'rgba(217,119,6,0.08)',
  green:      '#059669',
  greenBg:    'rgba(5,150,105,0.08)',
  cyan:       '#0891b2',
  shadow:     '0 2px 16px rgba(0,0,0,0.08)',
  shadowCard: '0 6px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',
  // Panel / component backgrounds
  panel:      '#f0eeff',
  panelBorder:'rgba(124,58,237,0.18)',
  input:      '#ffffff',
  inputBorder:'rgba(124,58,237,0.3)',
  nodePalette:'#f7f5ff',
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext({
  dark: true,
  toggleTheme: () => {},
  C: DARK,
});

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('vanta-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('vanta-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggleTheme = () => setDark(d => !d);
  const C = dark ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ dark, toggleTheme, C }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * useAppTheme — use in any component to get { dark, toggleTheme, C }
 */
export function useAppTheme() {
  return useContext(ThemeContext);
}
