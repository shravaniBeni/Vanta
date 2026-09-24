import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Copy, ExternalLink, Check } from 'lucide-react';
import { chatbotsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import EmbedCode from '../components/deploy/EmbedCode';
import CodeExport from '../components/deploy/CodeExport';
import { useAppTheme } from '@/lib/ThemeContext';

export default function Deploy() {
  const [chatbot, setChatbot] = useState(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const { C } = useAppTheme();

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

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!chatbot) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg }}>
        <div style={{ color: C.t2, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>&gt; Loading deployment...</div>
      </div>
    );
  }

  const chatUrl = `${window.location.origin}${createPageUrl(`Chat?id=${chatbot.embed_id}`)}`;

  return (
    <div style={{ minHeight: '100vh', background: C.bg }} className="grid-bg">
      <div className="container mx-auto px-4 py-8">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.borderHi}`, color: C.t2, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = C.t1; e.currentTarget.style.borderColor = C.borderHi; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.t2; }}
          >
            <ArrowLeft style={{ width: 20, height: 20 }} />
          </button>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: C.t1 }}>🎉 Chatbot Deployed!</h1>
            <p style={{ color: C.t2, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{chatbot.title}</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Embed & Export */}
          <div className="space-y-6">
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '20px', borderBottom: `1px solid ${C.border}` }}>
                <h2 style={{ color: C.t1, fontWeight: 600 }}>Integration Options</h2>
              </div>
              <div style={{ padding: '20px' }}>
                <Tabs defaultValue="embed">
                  <TabsList style={{ display: 'grid', width: '100%', gridTemplateColumns: '1fr 1fr', background: C.bgSub, border: `1px solid ${C.border}` }}>
                    <TabsTrigger value="embed" style={{ color: C.t2 }}>Embed Code</TabsTrigger>
                    <TabsTrigger value="python" style={{ color: C.t2 }}>Export Python</TabsTrigger>
                  </TabsList>
                  <TabsContent value="embed" className="mt-4">
                    <EmbedCode chatUrl={chatUrl} onCopy={handleCopy} copied={copied} />
                  </TabsContent>
                  <TabsContent value="python" className="mt-4">
                    <CodeExport chatbot={chatbot} onCopy={handleCopy} />
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {/* Direct link */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '20px', borderBottom: `1px solid ${C.border}` }}>
                <h2 style={{ color: C.t1, fontWeight: 600 }}>Direct Link</h2>
              </div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="text"
                    value={chatUrl}
                    readOnly
                    style={{ flex: 1, padding: '8px 12px', background: C.bgSub, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.t2, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }}
                  />
                  <button
                    onClick={() => handleCopy(chatUrl)}
                    style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, color: C.t2, background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.t1; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.t2; }}
                  >
                    {copied ? <Check style={{ width: 16, height: 16, color: '#22c55e' }} /> : <Copy style={{ width: 16, height: 16 }} />}
                  </button>
                  <button
                    onClick={() => window.open(chatUrl, '_blank')}
                    style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, color: C.t2, background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.t1; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.t2; }}
                  >
                    <ExternalLink style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live preview */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '20px', borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ color: C.t1, fontWeight: 600 }}>Live Preview</h2>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, height: 560 }}>
                <iframe src={chatUrl} style={{ width: '100%', height: '100%' }} title="Chatbot Preview" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
