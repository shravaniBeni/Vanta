/**
 * Fix broken Tailwind CSS class fragments and inconsistent colors across all pages.
 * Run: node scripts/fix-ui-colors.js
 */

import fs from 'fs';

const FILES = [
  'client/src/pages/Architect.jsx',
  'client/src/pages/Home.jsx',
  'client/src/pages/Login.jsx',
  'client/src/pages/Chat.jsx',
  'client/src/pages/Deploy.jsx',
  'client/src/pages/Editor.jsx',
  'client/src/components/editor/ArchitectChatPanel.jsx',
  'client/src/components/editor/NodePalette.jsx',
  'client/src/components/editor/NodeProperties.jsx',
  'client/src/components/editor/NodeEditor.jsx',
  'client/src/components/editor/WorkflowPreview.jsx',
];

// All replacements as [from-string, to-string] pairs (applied with split/join)
const MAP = [
  // ── Broken class fragments (space instead of /) ───────────────────────────
  // These were created by bad regex replacements earlier
  // e.g. "bg-primary 10" should be "bg-violet-600/10"

  // ── CSS variable classes that don't resolve → explicit hex ───────────────
  ['bg-card/80',    'bg-[#13131f]/80'],
  ['bg-card/60',    'bg-[#13131f]/60'],
  ['bg-card/90',    'bg-[#13131f]/90'],
  ['bg-card/50',    'bg-[#13131f]/50'],
  [' bg-card ',     ' bg-[#13131f] '],
  ['bg-background/50', 'bg-[#09090f]/50'],
  ['bg-background/80', 'bg-[#09090f]/80'],
  [' bg-background ', ' bg-[#09090f] '],
  ['bg-surface-subtle', 'bg-slate-900/60'],
  [' text-foreground', ' text-slate-100'],
  ['"text-foreground"', '"text-slate-100"'],
  [' text-muted-foreground', ' text-slate-400'],
  ['"text-muted-foreground"', '"text-slate-400"'],
  ['border-border/50', 'border-violet-500/15'],
  [' border-border', ' border-violet-500/15'],

  // ── Pink/red color values that snuck in ───────────────────────────────────
  // text-danger, bg-danger etc. (not standard Tailwind)
  ['text-danger',  'text-red-400'],
  ['bg-danger',    'bg-red-500/10'],
  ['border-danger', 'border-red-500/30'],
  ['text-success', 'text-emerald-400'],
  ['bg-success',   'bg-emerald-500/10'],
  ['border-success', 'border-emerald-500/30'],
  ['text-warning',  'text-violet-300'],
  ['bg-warning',    'bg-violet-500/10'],
  ['border-warning', 'border-violet-500/30'],

  // ── Remaining yellow/amber → violet ──────────────────────────────────────
  ['text-yellow-500/70', 'text-violet-300/70'],
  ['bg-yellow-500/70',   'bg-slate-500/40'],
  ['#a78bfa', '#a78bfa'],  // already correct, no-op
  ['#fbbf24', '#c4b5fd'],  // leftover amber → light violet
  ['#f59e0b', '#a78bfa'],  // leftover amber → violet

  // ── Improve specific icon colors on Architect plan sections ──────────────
  // These are passed as props so they're inline styles — handled separately
];

let totalPatched = 0;

FILES.forEach(f => {
  if (!fs.existsSync(f)) return;
  let src = fs.readFileSync(f, 'utf8');
  const orig = src;

  MAP.forEach(([from, to]) => {
    src = src.split(from).join(to);
  });

  if (src !== orig) {
    fs.writeFileSync(f, src);
    totalPatched++;
    console.log('✓ Patched:', f);
  } else {
    console.log('  No change:', f);
  }
});

console.log(`\nDone. ${totalPatched} files patched.`);
