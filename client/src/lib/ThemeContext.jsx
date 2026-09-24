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
  border:     'rgba(0,0,0,0.10)',
  borderHi:   'rgba(109,40,217,0.45)',
  t1:         '#1a1730',   // near-black — headings, primary text
  t2:         '#3d3960',   // dark purple-grey — body text (was #5a567a, too light)
  t3:         '#7269a0',   // mid-purple — secondary labels (was #b0adc8, invisible)
  accent:     '#6d28d9',   // slightly darker violet for light bg contrast
  accentLt:   '#6d28d9',
  accentBg:   'rgba(109,40,217,0.08)',
  amber:      '#b45309',   // darker amber for light bg
  amberBg:    'rgba(180,83,9,0.08)',
  green:      '#047857',   // darker green for light bg
  greenBg:    'rgba(4,120,87,0.08)',
  cyan:       '#0369a1',   // darker cyan for light bg
  shadow:     '0 2px 16px rgba(0,0,0,0.08)',
  shadowCard: '0 6px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
  // Panel / component backgrounds
  panel:      '#edeaff',   // slightly deeper than bg for visible panels
  panelBorder:'rgba(109,40,217,0.20)',
  input:      '#faf9ff',   // near-white input, slightly tinted
  inputBorder:'rgba(109,40,217,0.28)',
  nodePalette:'#f0eeff',
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
