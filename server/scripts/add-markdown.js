/**
 * Adds ReactMarkdown to ArchitectChatPanel, WorkflowPreview, and Chat.jsx
 */
import fs from 'fs';

// ─── ArchitectChatPanel ───────────────────────────────────────────────────────

const af = '../client/src/components/editor/ArchitectChatPanel.jsx';
let a = fs.readFileSync(af, 'utf8');

// Add import
if (!a.includes('ReactMarkdown')) {
  a = a.replace(
    "import { architectChatApi } from '@/api/apiClient';",
    "import ReactMarkdown from 'react-markdown';\nimport { architectChatApi } from '@/api/apiClient';"
  );
}

// Shared md components string to inject (no nested template literals)
const mdCompBlock = `
// ─── Markdown components ──────────────────────────────────────────────────────

const mdComponents = {
  p:          ({ node, ...p }) => <p style={{ margin: '0 0 6px 0', lineHeight: 1.65 }} {...p} />,
  strong:     ({ node, ...p }) => <strong style={{ color: '#f0f0ff', fontWeight: 700 }} {...p} />,
  em:         ({ node, ...p }) => <em style={{ color: '#c4b5fd', fontStyle: 'italic' }} {...p} />,
  code:       ({ node, inline, children, ...p }) => inline
    ? <code style={{ background: 'rgba(124,58,237,0.18)', color: '#c4b5fd', padding: '1px 6px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code>
    : <pre style={{ background: '#0b0b18', borderRadius: 8, padding: '10px 13px', marginTop: 6, overflow: 'auto' }}><code style={{ color: '#c4b5fd', fontSize: '0.85em', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre' }}>{children}</code></pre>,
  ul:         ({ node, ...p }) => <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  ol:         ({ node, ...p }) => <ol style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  li:         ({ node, ...p }) => <li style={{ marginBottom: 3 }} {...p} />,
  a:          ({ node, ...p }) => <a style={{ color: '#a78bfa', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" {...p} />,
  hr:         () => <hr style={{ border: 'none', borderTop: '1px solid rgba(124,58,237,0.2)', margin: '8px 0' }} />,
  blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid rgba(124,58,237,0.4)', margin: '6px 0', paddingLeft: 12, color: '#9d9bb8', fontStyle: 'italic' }} {...p} />,
};

`;

// Find where to insert (before MessageBubble)
const bubbleMarker = '// ─── Message bubble ─────────────────────────────────────────────────────────────';
const bubbleIdx = a.indexOf(bubbleMarker);
if (bubbleIdx !== -1 && !a.includes('mdComponents')) {
  a = a.slice(0, bubbleIdx) + mdCompBlock + a.slice(bubbleIdx);
}

// Replace raw {msg.content} inside MessageBubble with ReactMarkdown
// Find the innermost div of MessageBubble and swap content
a = a.replace(
  /fontSize: 13, color: '#e2e8f0', lineHeight: 1\.6,\s*whiteSpace: 'pre-wrap',\s*\}\}>\s*\{msg\.content\}/,
  "fontSize: 13, color: '#e2e8f0', lineHeight: 1.65,\n      }}>\n        <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>"
);
// Also handle version without whiteSpace
a = a.replace(
  /fontSize: 13, color: '#e2e8f0', lineHeight: 1\.6[5]?,\s*\}\}>\s*\{msg\.content\}/,
  "fontSize: 13, color: '#e2e8f0', lineHeight: 1.65,\n      }}>\n        <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>"
);

fs.writeFileSync(af, a);
console.log('ArchitectChatPanel: done');

// ─── WorkflowPreview ─────────────────────────────────────────────────────────

const wf = '../client/src/components/editor/WorkflowPreview.jsx';
let w = fs.readFileSync(wf, 'utf8');

if (!w.includes('ReactMarkdown')) {
  w = w.replace(
    "import { X, Send, Bot, User, MessageSquare } from 'lucide-react';",
    "import ReactMarkdown from 'react-markdown';\nimport { X, Send, Bot, User, MessageSquare } from 'lucide-react';"
  );
}

if (!w.includes('mdComponentsWP')) {
  const wpMd = `
const mdComponentsWP = {
  p:      ({ node, ...p }) => <p style={{ margin: '0 0 6px 0', lineHeight: 1.65 }} {...p} />,
  strong: ({ node, ...p }) => <strong style={{ color: '#f0f0ff', fontWeight: 700 }} {...p} />,
  em:     ({ node, ...p }) => <em style={{ color: '#c4b5fd' }} {...p} />,
  code:   ({ node, inline, children, ...p }) => inline
    ? <code style={{ background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code>
    : <pre style={{ background: '#0b0b18', borderRadius: 8, padding: '10px 13px', marginTop: 6 }}><code style={{ color: '#c4b5fd', fontSize: '0.85em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code></pre>,
  ul:     ({ node, ...p }) => <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  ol:     ({ node, ...p }) => <ol style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  li:     ({ node, ...p }) => <li style={{ marginBottom: 3 }} {...p} />,
};

`;
  w = w.replace('export default function WorkflowPreview', wpMd + 'export default function WorkflowPreview');
}

// Replace raw {msg.content} in the message bubble div
w = w.replace(
  /lineHeight: 1\.[56],\s*whiteSpace: 'pre-wrap',\s*\}\}>\s*\{msg\.content\}/g,
  "lineHeight: 1.65,\n            }}>\n              <ReactMarkdown components={mdComponentsWP}>{msg.content}</ReactMarkdown>"
);
w = w.replace(
  /lineHeight: 1\.[56]5?,\s*\}\}>\s*\{msg\.content\}/g,
  "lineHeight: 1.65,\n            }}>\n              <ReactMarkdown components={mdComponentsWP}>{msg.content}</ReactMarkdown>"
);

fs.writeFileSync(wf, w);
console.log('WorkflowPreview: done');

// ─── Chat.jsx ─────────────────────────────────────────────────────────────────

const cf = '../client/src/pages/Chat.jsx';
let c = fs.readFileSync(cf, 'utf8');

if (!c.includes('ReactMarkdown')) {
  c = c.replace(
    "import { Send, Loader2, Zap, ZapOff } from 'lucide-react';",
    "import ReactMarkdown from 'react-markdown';\nimport { Send, Loader2, Zap, ZapOff } from 'lucide-react';"
  );

  // Add shared md components before the component
  const chatMd = `
const mdComponentsChat = {
  p:      ({ node, ...p }) => <p style={{ margin: '0 0 5px 0', lineHeight: 1.65 }} {...p} />,
  strong: ({ node, ...p }) => <strong style={{ fontWeight: 700 }} {...p} />,
  em:     ({ node, ...p }) => <em style={{ fontStyle: 'italic' }} {...p} />,
  code:   ({ node, inline, children, ...p }) => inline
    ? <code style={{ background: 'rgba(99,102,241,0.18)', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code>
    : <pre style={{ background: '#060a10', borderRadius: 8, padding: '10px', marginTop: 6, overflow: 'auto' }}><code style={{ fontSize: '0.85em', fontFamily: 'JetBrains Mono, monospace' }}>{children}</code></pre>,
  ul:     ({ node, ...p }) => <ul style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  ol:     ({ node, ...p }) => <ol style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.65 }} {...p} />,
  li:     ({ node, ...p }) => <li style={{ marginBottom: 3 }} {...p} />,
};

`;
  c = c.replace('export default function Chat()', chatMd + 'export default function Chat()');

  // Replace {msg.content} with conditional ReactMarkdown for assistant
  c = c.replace(
    '{msg.content}',
    "{msg.role === 'assistant'\n                  ? <ReactMarkdown components={mdComponentsChat}>{msg.content}</ReactMarkdown>\n                  : msg.content}"
  );

  fs.writeFileSync(cf, c);
  console.log('Chat.jsx: done');
} else {
  console.log('Chat.jsx: already has ReactMarkdown, skipping');
}

console.log('\nAll done.');
