/**
 * client/src/components/editor/WorkflowCodeView.jsx
 *
 * Phase 9D Correction: Standalone RAG Code tab.
 *
 * Displays a file-tree + code viewer for the standalone Node.js project
 * generated from the ACTIVE workflow via standaloneCodeGen.js.
 *
 * INVARIANTS:
 *   - Read-only — no editing
 *   - No network calls, no DB writes
 *   - Always reads from chatbot (ACTIVE) — never draftNodes
 *   - Regenerates when chatbot changes (e.g. after Architect activation)
 *   - Draft notice shown when hasDraft or draftDirty
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  Copy, Check, Download, ChevronRight, ChevronDown,
  FileCode, FileJson, FileText, Database, Lock, AlertTriangle,
  Info, Package, Folder, FolderOpen,
} from 'lucide-react';
import { generateStandaloneCode } from '@/lib/standaloneCodeGen';
import { useAppTheme } from '@/lib/ThemeContext';

// ─── File tree helpers ────────────────────────────────────────────────────────

function fileIcon(path, language) {
  if (path.endsWith('package.json'))      return <FileJson size={13} />;
  if (path.endsWith('.sql'))              return <Database size={13} />;
  if (path.endsWith('README.md'))         return <FileText size={13} />;
  if (path.endsWith('.env.example'))      return <FileText size={13} />;
  return <FileCode size={13} />;
}

function langLabel(language) {
  const map = {
    javascript: 'JS', json: 'JSON', sql: 'SQL',
    markdown: 'MD', bash: 'ENV',
  };
  return map[language] || 'TXT';
}

// ─── Syntax tokenizer (regex-based, no external dep) ─────────────────────────

const JS_KEYWORDS  = new Set(['import','export','from','const','let','var','function','async','await','return','if','else','for','of','in','while','throw','new','try','catch','default','class','extends','this','null','undefined','true','false','switch','case','break']);
const JS_BUILTINS  = new Set(['console','process','Promise','JSON','Array','Object','String','Number','Math','Date','Error','Set','Map']);

function tokenizeLine(line, language) {
  // Comments
  if (/^\s*(\/\/|#|--\s)/.test(line)) return [{ text: line, role: 'comment' }];
  if (/^\s*\/\*/.test(line))          return [{ text: line, role: 'comment' }];
  if (language === 'sql' && /^\s*--/.test(line)) return [{ text: line, role: 'comment' }];

  // For markdown — headings
  if (language === 'markdown' && /^#{1,4}\s/.test(line)) return [{ text: line, role: 'keyword' }];
  if (language === 'markdown' && /^```/.test(line))      return [{ text: line, role: 'comment' }];

  if (language === 'json') {
    // JSON key vs value
    const m = line.match(/^(\s*)(".*?")(\s*:\s*)(.*)$/);
    if (m) {
      return [
        { text: m[1], role: 'plain' },
        { text: m[2], role: 'string' },
        { text: m[3], role: 'punct' },
        { text: m[4], role: 'primitive' },
      ];
    }
    if (/^\s*"/.test(line)) return [{ text: line, role: 'string' }];
    return [{ text: line, role: 'plain' }];
  }

  const tokens = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // String " or `
    if (src[i] === '"' || src[i] === '`') {
      const q = src[i];
      let j = i + 1;
      while (j < src.length && !(src[j] === q && src[j - 1] !== '\\')) j++;
      tokens.push({ text: src.slice(i, j + 1), role: 'string' });
      i = j + 1;
      continue;
    }
    // String '
    if (src[i] === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      tokens.push({ text: src.slice(i, j + 1), role: 'string' });
      i = j + 1;
      continue;
    }
    // Word
    if (/[a-zA-Z_$]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let role = 'plain';
      if (JS_KEYWORDS.has(word))          role = 'keyword';
      else if (JS_BUILTINS.has(word))     role = 'builtin';
      else if (/^[A-Z]/.test(word))       role = 'type';
      tokens.push({ text: word, role });
      i = j;
      continue;
    }
    // Number
    if (/[0-9]/.test(src[i]) || (src[i] === '-' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      tokens.push({ text: src.slice(i, j), role: 'primitive' });
      i = j;
      continue;
    }
    // Punct / operator
    if (/[{}[\]()=><:;,+*/|&!~^%?.]/.test(src[i])) {
      tokens.push({ text: src[i], role: 'punct' });
      i++;
      continue;
    }
    tokens.push({ text: src[i], role: 'plain' });
    i++;
  }
  return tokens.length > 0 ? tokens : [{ text: line, role: 'plain' }];
}

function useTokenColors(dark) {
  return {
    comment:   dark ? '#4a5568' : '#9ca3af',
    keyword:   dark ? '#c084fc' : '#6d28d9',
    string:    dark ? '#86efac' : '#047857',
    primitive: dark ? '#38bdf8' : '#0369a1',
    type:      dark ? '#f0abfc' : '#7c3aed',
    builtin:   dark ? '#fbbf24' : '#b45309',
    punct:     dark ? '#6d6d8a' : '#7269a0',
    plain:     dark ? '#e2e8f0' : '#1a1730',
  };
}

function HighlightedCode({ content, language, dark }) {
  const colors = useTokenColors(dark);
  const lines = content.split('\n');
  const bg = dark ? '#08080e' : '#f8f7ff';

  return (
    <pre style={{
      margin: 0, padding: '20px 0 40px',
      background: bg,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12.5, lineHeight: 1.75,
      overflowX: 'auto',
      minHeight: '100%',
    }}>
      {lines.map((line, i) => {
        const tokens = tokenizeLine(line, language || 'javascript');
        return (
          <div key={i} style={{ display: 'flex', minHeight: '1.75em', paddingRight: 40 }}>
            <span style={{
              display: 'inline-block', width: 44, textAlign: 'right',
              paddingRight: 16, flexShrink: 0, userSelect: 'none',
              color: dark ? '#2d2d44' : '#c4b5fd', fontSize: 11,
            }}>
              {i + 1}
            </span>
            <span style={{ whiteSpace: 'pre' }}>
              {tokens.map((tok, j) => (
                <span key={j} style={{ color: colors[tok.role] || colors.plain }}>
                  {tok.text}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

// ─── File tree ────────────────────────────────────────────────────────────────

function buildTree(files) {
  // Returns { name, path?, children?, language?, isDir }
  const root = { name: 'project', isDir: true, children: [] };
  const dirMap = { '': root };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirKey = parts.slice(0, i + 1).join('/');
      if (!dirMap[dirKey]) {
        const node = { name: parts[i], isDir: true, children: [], key: dirKey };
        dirMap[dirKey] = node;
        current.children.push(node);
      }
      current = dirMap[dirKey];
    }
    current.children.push({
      name:     parts[parts.length - 1],
      isDir:    false,
      path:     file.path,
      language: file.language,
      key:      file.path,
    });
  }
  return root;
}

function TreeNode({ node, selectedPath, onSelect, depth, C, dark }) {
  const [open, setOpen] = useState(true);
  const indent = depth * 14;

  if (node.isDir) {
    if (node.name === 'project') {
      return (
        <div>
          {node.children.map(child => (
            <TreeNode key={child.key || child.name} node={child}
              selectedPath={selectedPath} onSelect={onSelect}
              depth={depth} C={C} dark={dark} />
          ))}
        </div>
      );
    }
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 5,
            padding: `4px 12px 4px ${12 + indent}px`,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.t2, fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
            textAlign: 'left',
          }}
        >
          {open ? <FolderOpen size={12} color={C.amber} /> : <Folder size={12} color={C.amber} />}
          {open ? <ChevronDown size={10} color={C.t3} /> : <ChevronRight size={10} color={C.t3} />}
          <span>{node.name}</span>
        </button>
        {open && node.children.map(child => (
          <TreeNode key={child.key || child.name} node={child}
            selectedPath={selectedPath} onSelect={onSelect}
            depth={depth + 1} C={C} dark={dark} />
        ))}
      </div>
    );
  }

  const isSelected = node.path === selectedPath;
  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: `4px 12px 4px ${16 + indent}px`,
        background: isSelected ? C.accentBg : 'transparent',
        border: 'none', cursor: 'pointer',
        color: isSelected ? C.t1 : C.t2,
        fontSize: 12, fontFamily: 'JetBrains Mono, monospace', textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.bgSub; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: isSelected ? C.accentLt : C.t3 }}>
        {fileIcon(node.path, node.language)}
      </span>
      <span style={{ flex: 1 }}>{node.name}</span>
      <span style={{
        fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
        color: isSelected ? C.accentLt : C.t3,
        background: isSelected ? `rgba(124,58,237,0.12)` : C.bgSub,
        padding: '1px 5px', borderRadius: 3,
      }}>
        {langLabel(node.language)}
      </span>
    </button>
  );
}

// ─── ZIP export ───────────────────────────────────────────────────────────────

/**
 * Minimal pure-JS ZIP builder (DEFLATE-free — stored only).
 * No external library needed for Phase 9D.
 * Files are stored without compression (method 0) which is universally readable.
 */
function buildZip(files) {
  const enc = new TextEncoder();
  const centralDirectory = [];
  const parts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.path);
    const dataBytes = enc.encode(file.content);

    // CRC-32
    const crc = crc32(dataBytes);

    // Local file header
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // method: stored
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true); // compressed
    lv.setUint32(22, dataBytes.length, true); // uncompressed
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra
    local.set(nameBytes, 30);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);      // local header offset
    cd.set(nameBytes, 46);

    centralDirectory.push(cd);
    parts.push(local);
    parts.push(dataBytes);
    offset += local.length + dataBytes.length;
  }

  const cdStart = offset;
  const cdBytes = concat(centralDirectory);

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);

  return concat([...parts, cdBytes, eocd]);
}

function concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) { out.set(a, pos); pos += a.length; }
  return out;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WorkflowCodeView({ chatbot, hasDraft, draftDirty }) {
  const { dark, C } = useAppTheme();
  const [selectedPath, setSelectedPath] = useState(null);
  const [copied, setCopied] = useState(false);

  // Generate from ACTIVE workflow — memoized, regenerates only when chatbot changes
  const result = useMemo(() => generateStandaloneCode(chatbot), [chatbot]);

  // Auto-select README on first render / when files change
  const files = result.ok ? result.files : [];
  const effectiveSelected = selectedPath && files.find(f => f.path === selectedPath)
    ? selectedPath
    : (files.find(f => f.path === 'README.md')?.path ?? files[0]?.path ?? null);

  const selectedFile = files.find(f => f.path === effectiveSelected) ?? null;
  const tree = useMemo(() => buildTree(files), [files]);

  const hasDraftChanges = hasDraft || draftDirty;

  // Copy selected file content
  const handleCopy = useCallback(() => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(selectedFile.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [selectedFile]);

  // Download ZIP
  const handleDownload = useCallback(() => {
    if (!result.ok || result.files.length === 0) return;
    const appName = (chatbot.title || 'rag-app').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const zipBytes = buildZip(result.files);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${appName}-standalone.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, chatbot.title]);

  const panelBg   = dark ? '#0d0d1c' : '#edeaff';
  const codeBg    = dark ? '#08080e' : '#f8f7ff';
  const sidebarBg = dark ? '#0a0a17' : '#f0eeff';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: C.bg, overflow: 'hidden',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 16px',
        background: panelBg,
        borderBottom: `1px solid ${C.panelBorder}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} color={C.accent} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>Standalone RAG Code</span>
        </div>
        <div style={{ width: 1, height: 14, background: C.border }} />
        <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
          Generated from Active Workflow · Read-only
        </span>
        {result.ok && chatbot.architect_version != null && (
          <>
            <div style={{ width: 1, height: 14, background: C.border }} />
            <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
              Architect v{chatbot.architect_version}
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />

        {result.ok && (
          <>
            <button
              onClick={handleCopy}
              disabled={!selectedFile}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 7,
                background: copied ? 'rgba(34,197,94,0.1)' : C.accentBg,
                border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : C.panelBorder}`,
                color: copied ? '#22c55e' : C.accentLt,
                fontSize: 12, fontWeight: 600, cursor: selectedFile ? 'pointer' : 'default',
                opacity: selectedFile ? 1 : 0.5, transition: 'all 0.15s',
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy file'}
            </button>
            <button
              onClick={handleDownload}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 7,
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                border: 'none', color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 0 12px rgba(124,58,237,0.3)', transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237,0.5)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 12px rgba(124,58,237,0.3)'}
            >
              <Download size={12} /> Download ZIP
            </button>
          </>
        )}
      </div>

      {/* ── Draft notice ─────────────────────────────────────────────────────── */}
      {hasDraftChanges && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 16px',
          background: dark ? 'rgba(124,58,237,0.07)' : 'rgba(109,40,217,0.05)',
          borderBottom: `1px solid ${C.panelBorder}`,
          flexShrink: 0,
        }}>
          <Info size={12} color={C.accentLt} />
          <span style={{ fontSize: 11, color: C.t2, fontFamily: 'JetBrains Mono, monospace' }}>
            Draft changes are not reflected here until activated via the Architect.
          </span>
        </div>
      )}

      {/* ── Generation error ─────────────────────────────────────────────────── */}
      {!result.ok && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 32px', gap: 16,
        }}>
          <AlertTriangle size={32} color={dark ? '#fbbf24' : '#b45309'} />
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
              Code generation blocked
            </p>
            <div style={{
              background: dark ? 'rgba(251,191,36,0.06)' : 'rgba(180,83,9,0.05)',
              border: `1px solid ${dark ? 'rgba(251,191,36,0.2)' : 'rgba(180,83,9,0.2)'}`,
              borderRadius: 10, padding: 16, textAlign: 'left',
            }}>
              {result.errors.map((e, i) => (
                <p key={i} style={{
                  fontSize: 12, color: dark ? '#fbbf24' : '#b45309',
                  fontFamily: 'JetBrains Mono, monospace',
                  margin: i < result.errors.length - 1 ? '0 0 8px' : '0',
                  lineHeight: 1.6,
                }}>
                  • {e}
                </p>
              ))}
            </div>
            <p style={{ fontSize: 12, color: C.t3, marginTop: 16, lineHeight: 1.6 }}>
              Fix the workflow issues above (either activate a complete supported workflow,
              or remove unsupported nodes), then the Code tab will generate automatically.
            </p>
          </div>
        </div>
      )}

      {/* ── Main body: file tree + code viewer ───────────────────────────────── */}
      {result.ok && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Sidebar: file tree */}
          <div style={{
            width: 220, flexShrink: 0,
            background: sidebarBg,
            borderRight: `1px solid ${C.panelBorder}`,
            overflowY: 'auto',
          }}>
            {/* Header */}
            <div style={{
              padding: '10px 12px 6px',
              display: 'flex', alignItems: 'center', gap: 6,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <Package size={12} color={C.accentLt} />
              <span style={{ fontSize: 10, fontWeight: 700, color: C.t3, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Files · {files.length}
              </span>
            </div>

            {/* Tree */}
            <div style={{ padding: '6px 0 20px' }}>
              <TreeNode
                node={tree}
                selectedPath={effectiveSelected}
                onSelect={setSelectedPath}
                depth={0}
                C={C}
                dark={dark}
              />
            </div>
          </div>

          {/* Code viewer */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedFile ? (
              <>
                {/* File tab bar */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 16px',
                  background: panelBg,
                  borderBottom: `1px solid ${C.panelBorder}`,
                  flexShrink: 0,
                }}>
                  <span style={{ color: C.accentLt }}>
                    {fileIcon(selectedFile.path, selectedFile.language)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.t1, fontFamily: 'JetBrains Mono, monospace' }}>
                    {selectedFile.path}
                  </span>
                  <div style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                    color: C.accentLt, background: C.accentBg,
                    padding: '1px 6px', borderRadius: 4, marginLeft: 4,
                  }}>
                    {langLabel(selectedFile.language)}
                  </div>
                  <div style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
                    {selectedFile.content.split('\n').length} lines
                  </div>
                </div>

                {/* Code */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: codeBg }}>
                  <HighlightedCode
                    content={selectedFile.content}
                    language={selectedFile.language}
                    dark={dark}
                  />
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: C.t3, fontSize: 13,
              }}>
                Select a file from the tree
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      {result.ok && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '5px 16px',
          background: panelBg,
          borderTop: `1px solid ${C.panelBorder}`,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            {files.length} files · {files.reduce((s, f) => s + f.content.length, 0).toLocaleString()} chars
          </span>
          <span style={{ fontSize: 10, color: dark ? '#22c55e' : '#047857', fontFamily: 'JetBrains Mono, monospace' }}>
            ✓ standalone project ready
          </span>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            Node.js {result.config?.strategy ?? ''} · {result.config?.embModel ?? ''}
          </span>
        </div>
      )}
    </div>
  );
}
