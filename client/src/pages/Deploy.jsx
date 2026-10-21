/**
 * client/src/pages/Deploy.jsx
 *
 * Post-deployment page showing all three access modes:
 *   1. Shareable Chatbot Link  — standalone fullscreen URL
 *   2. Website Embed           — floating widget script tag
 *   3. API Access              — REST endpoint for developers
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Check, ExternalLink, Link, Code2, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { chatbotsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import { useAppTheme } from '@/lib/ThemeContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function Deploy() {
  const [chatbot,   setChatbot]   = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [openSection, setOpenSection] = useState('link'); // which accordion is open
  const navigate = useNavigate();
  const { C, dark } = useAppTheme();

  const chatbotId = new URLSearchParams(window.location.search).get('id');

  useEffect(() => { loadChatbot(); }, [chatbotId]);

  const loadChatbot = async () => {
    try {
      const bots = await chatbotsApi.filter({ id: chatbotId });
      if (bots.length > 0) setChatbot(bots[0]);
    } catch (err) {
      console.error('Failed to load chatbot:', err);
    }
  };

  const copy = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!chatbot) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background: C.bg }}>
        <span style={{ color: C.t3, fontFamily:'JetBrains Mono, monospace', fontSize:13 }}>Loading deployment…</span>
      </div>
    );
  }

  // ── Derived URLs ────────────────────────────────────────────────────────────
  const origin   = window.location.origin;
  // Shareable link: no ?mode → Chat.jsx forces fullscreen
  const chatUrl  = `${origin}${createPageUrl(`Chat?id=${chatbot.embed_id}`)}`;
  // Widget URL: ?mode=widget → Chat.jsx forces floating widget
  const widgetUrl = `${origin}${createPageUrl(`Chat?id=${chatbot.embed_id}&mode=widget`)}`;
  const apiUrl   = `${API_BASE}/api/chat`;
  const embedId  = chatbot.embed_id;

  // The floating widget script — injects a hidden iframe loading the widget URL.
  // Chat.jsx detects ?mode=widget and renders the floating template.
  const widgetScript = `<!-- VANTA Chatbot Widget — ${chatbot.title} -->
<script>
(function(){
  var iframe = document.createElement('iframe');
  iframe.src = "${widgetUrl}";
  iframe.style.cssText = [
    'position:fixed',
    'bottom:0',
    'right:0',
    'width:420px',
    'height:640px',
    'border:none',
    'z-index:2147483647',
    'background:transparent'
  ].join(';');
  iframe.allow = 'microphone';
  iframe.title = "${chatbot.title} — Powered by VANTA";
  document.body.appendChild(iframe);
})();
</script>
<!-- End VANTA Widget -->`;

  // API curl example
  const curlExample = `curl -X POST ${apiUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "embed_id": "${embedId}",
    "query": "Your question here"
  }'`;

  const apiResponse = `{
  "answer": "The chatbot's response...",
  "session_token": "uuid-for-conversation-continuity",
  "retrievedChunks": ["source snippet 1", "source snippet 2"],
  "avgSimilarity": 0.82
}`;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  };

  const cardHeader = (active) => ({
    padding: '16px 20px',
    display: 'flex', alignItems: 'center', gap: 12,
    cursor: 'pointer',
    background: active ? C.accentBg : 'transparent',
    borderBottom: active ? `1px solid ${C.panelBorder}` : 'none',
    transition: 'background 0.15s',
  });

  const badge = (color) => ({
    fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
    padding: '2px 8px', borderRadius: 20,
    background: `${color}18`, border: `1px solid ${color}40`, color,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  });

  const codeBlock = {
    background: dark ? '#08080e' : '#1a1730',
    borderRadius: 8, padding: '14px 16px',
    fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
    color: '#e2e8f0', lineHeight: 1.7, overflowX: 'auto',
    whiteSpace: 'pre', margin: '12px 0 0',
  };

  const copyBtn = (key) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 7,
    background: copiedKey === key ? 'rgba(34,197,94,0.12)' : C.accentBg,
    border: `1px solid ${copiedKey === key ? 'rgba(34,197,94,0.3)' : C.borderHi}`,
    color: copiedKey === key ? '#22c55e' : C.accentLt,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
  });

  const toggle = (id) => setOpenSection(s => s === id ? null : id);

  return (
    <div style={{ minHeight:'100vh', background: C.bg, fontFamily:'Plus Jakarta Sans, sans-serif' }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Header */}
      <div style={{ background: C.panel, borderBottom:`1px solid ${C.panelBorder}`, padding:'0 28px', height:60, display:'flex', alignItems:'center', gap:14 }}>
        <button onClick={() => navigate(createPageUrl('Dashboard'))}
          style={{ background:'transparent', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 10px', cursor:'pointer', color: C.t2, display:'flex', alignItems:'center' }}
        >
          <ArrowLeft size={15} />
        </button>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color: C.t1 }}>🎉 {chatbot.title} — Deployed</div>
          <div style={{ fontSize:11, color: C.t3, fontFamily:'JetBrains Mono, monospace' }}>embed_id: {embedId}</div>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 24px', animation:'fadeUp 0.3s ease both' }}>

        {/* Intro */}
        <p style={{ fontSize:14, color: C.t2, marginBottom:28, lineHeight:1.7 }}>
          Your chatbot is live. Choose how you want people to access it — share the link, embed the widget on your site, or call the API directly.
        </p>

        {/* ── Mode 1: Shareable Link ─────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHeader(openSection === 'link')} onClick={() => toggle('link')}>
            <div style={{ width:36, height:36, borderRadius:9, background:'rgba(99,102,241,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Link size={16} color="#818cf8" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:14, fontWeight:700, color: C.t1 }}>Shareable Chatbot Link</span>
                <span style={badge('#818cf8')}>Mode 1</span>
              </div>
              <div style={{ fontSize:12, color: C.t3, marginTop:2 }}>A standalone URL — open in any browser for the full chatbot experience</div>
            </div>
            {openSection === 'link' ? <ChevronUp size={16} color={C.t3} /> : <ChevronDown size={16} color={C.t3} />}
          </div>
          {openSection === 'link' && (
            <div style={{ padding:'20px' }}>
              <p style={{ fontSize:13, color: C.t2, marginBottom:14, lineHeight:1.6 }}>
                Share this URL with anyone. They open it in their browser and chat with your AI assistant — no login required, no setup.
              </p>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <div style={{ flex:1, padding:'9px 14px', background: C.bgSub, border:`1px solid ${C.border}`, borderRadius:8, fontFamily:'JetBrains Mono, monospace', fontSize:12, color: C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {chatUrl}
                </div>
                <button style={copyBtn('link')} onClick={() => copy('link', chatUrl)}>
                  {copiedKey === 'link' ? <Check size={12}/> : <Copy size={12}/>}
                  {copiedKey === 'link' ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => window.open(chatUrl, '_blank')}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, background: C.greenBg, border:`1px solid ${C.green}40`, color: C.green, fontSize:12, fontWeight:600, cursor:'pointer' }}
                >
                  <ExternalLink size={12} /> Open
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Mode 2: Website Embed ──────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHeader(openSection === 'embed')} onClick={() => toggle('embed')}>
            <div style={{ width:36, height:36, borderRadius:9, background:'rgba(16,185,129,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Globe size={16} color="#10b981" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:14, fontWeight:700, color: C.t1 }}>Website Embed</span>
                <span style={badge('#10b981')}>Mode 2</span>
              </div>
              <div style={{ fontSize:12, color: C.t3, marginTop:2 }}>Paste one script tag — a floating AI assistant appears on your website</div>
            </div>
            {openSection === 'embed' ? <ChevronUp size={16} color={C.t3} /> : <ChevronDown size={16} color={C.t3} />}
          </div>
          {openSection === 'embed' && (
            <div style={{ padding:'20px' }}>
              <p style={{ fontSize:13, color: C.t2, marginBottom:14, lineHeight:1.6 }}>
                Copy the snippet below and paste it just before the <code style={{ background: C.bgSub, padding:'1px 5px', borderRadius:4, fontSize:11 }}>&lt;/body&gt;</code> tag of any HTML page. A floating chat button will appear in the bottom-right corner of your site. Visitors click it to open the chatbot — no additional infrastructure needed.
              </p>

              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:4 }}>
                <button style={copyBtn('embed')} onClick={() => copy('embed', widgetScript)}>
                  {copiedKey === 'embed' ? <Check size={12}/> : <Copy size={12}/>}
                  {copiedKey === 'embed' ? 'Copied!' : 'Copy snippet'}
                </button>
              </div>
              <div style={codeBlock}>{widgetScript}</div>

              <div style={{ marginTop:16, padding:'12px 14px', background: dark ? 'rgba(16,185,129,0.06)' : 'rgba(4,120,87,0.05)', border:`1px solid ${C.green}30`, borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color: C.green, marginBottom:6 }}>How it works</div>
                <ul style={{ fontSize:12, color: C.t2, lineHeight:1.8, paddingLeft:16, margin:0 }}>
                  <li>The script injects a fixed-position iframe into your page.</li>
                  <li>The iframe loads your deployed chatbot in widget mode.</li>
                  <li>Visitors see a floating bot icon — clicking it opens the chat panel.</li>
                  <li>All AI processing runs on VANTA's servers — nothing to host yourself.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* ── Mode 3: API Access ─────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHeader(openSection === 'api')} onClick={() => toggle('api')}>
            <div style={{ width:36, height:36, borderRadius:9, background:'rgba(249,115,22,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Code2 size={16} color="#f97316" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:14, fontWeight:700, color: C.t1 }}>API Access</span>
                <span style={badge('#f97316')}>Mode 3</span>
              </div>
              <div style={{ fontSize:12, color: C.t3, marginTop:2 }}>REST endpoint — integrate the chatbot into any application or workflow</div>
            </div>
            {openSection === 'api' ? <ChevronUp size={16} color={C.t3} /> : <ChevronDown size={16} color={C.t3} />}
          </div>
          {openSection === 'api' && (
            <div style={{ padding:'20px' }}>
              <p style={{ fontSize:13, color: C.t2, marginBottom:14, lineHeight:1.6 }}>
                Call the chatbot backend directly from your own application, script, or automation. No authentication required for deployed chatbots — just POST your question with the embed ID.
              </p>

              <div style={{ marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:700, color: C.t2, fontFamily:'JetBrains Mono, monospace' }}>POST {apiUrl}</span>
                  <button style={copyBtn('curl')} onClick={() => copy('curl', curlExample)}>
                    {copiedKey === 'curl' ? <Check size={12}/> : <Copy size={12}/>}
                    {copiedKey === 'curl' ? 'Copied' : 'Copy curl'}
                  </button>
                </div>
                <div style={codeBlock}>{curlExample}</div>
              </div>

              <div>
                <div style={{ fontSize:12, fontWeight:700, color: C.t2, fontFamily:'JetBrains Mono, monospace', marginBottom:4 }}>Example response</div>
                <div style={codeBlock}>{apiResponse}</div>
              </div>

              <div style={{ marginTop:16, padding:'12px 14px', background: dark ? 'rgba(249,115,22,0.06)' : 'rgba(234,88,12,0.05)', border:`1px solid ${C.amber}30`, borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color: C.amber, marginBottom:6 }}>Session continuity</div>
                <p style={{ fontSize:12, color: C.t2, lineHeight:1.7, margin:0 }}>
                  Pass the returned <code style={{ background: C.bgSub, padding:'1px 5px', borderRadius:4, fontSize:11 }}>session_token</code> in subsequent requests to maintain conversation context. Omit it to start a fresh conversation.
                </p>
              </div>

              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color: C.t2, marginBottom:8 }}>Your embed ID</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <div style={{ flex:1, padding:'9px 14px', background: C.bgSub, border:`1px solid ${C.border}`, borderRadius:8, fontFamily:'JetBrains Mono, monospace', fontSize:12, color: C.t2 }}>
                    {embedId}
                  </div>
                  <button style={copyBtn('embedid')} onClick={() => copy('embedid', embedId)}>
                    {copiedKey === 'embedid' ? <Check size={12}/> : <Copy size={12}/>}
                    Copy ID
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
