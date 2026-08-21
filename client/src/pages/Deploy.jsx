import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Copy, ExternalLink, Check } from 'lucide-react';
import { chatbotsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import EmbedCode from '../components/deploy/EmbedCode';
import CodeExport from '../components/deploy/CodeExport';

export default function Deploy() {
  const [chatbot, setChatbot] = useState(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

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
      <div className="flex items-center justify-center h-screen bg-[#080c14]">
        <div className="text-slate-400 font-mono text-sm">&gt; Loading deployment...</div>
      </div>
    );
  }

  const chatUrl = `${window.location.origin}${createPageUrl(`Chat?id=${chatbot.embed_id}`)}`;

  return (
    <div className="min-h-screen bg-[#080c14] grid-bg">
      <div className="container mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            className="p-2 rounded-lg border border-indigo-500/20 text-slate-500 hover:text-white hover:border-indigo-500/40 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">🎉 Chatbot Deployed!</h1>
            <p className="text-slate-500 font-mono text-sm">{chatbot.title}</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Embed & Export */}
          <div className="space-y-6">
            <div className="neon-border rounded-xl bg-[#0d1117]/80 overflow-hidden">
              <div className="p-5 border-b border-indigo-500/10">
                <h2 className="text-white font-semibold">Integration Options</h2>
              </div>
              <div className="p-5">
                <Tabs defaultValue="embed">
                  <TabsList className="grid w-full grid-cols-2 bg-[#060a10] border border-indigo-500/20">
                    <TabsTrigger value="embed" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-slate-400">Embed Code</TabsTrigger>
                    <TabsTrigger value="python" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-slate-400">Export Python</TabsTrigger>
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
            <div className="neon-border rounded-xl bg-[#0d1117]/80 overflow-hidden">
              <div className="p-5 border-b border-indigo-500/10">
                <h2 className="text-white font-semibold">Direct Link</h2>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-[#060a10] border border-indigo-500/20 rounded-lg text-sm text-slate-300 font-mono outline-none"
                  />
                  <button
                    onClick={() => handleCopy(chatUrl)}
                    className="p-2 rounded-lg border border-indigo-500/20 text-slate-400 hover:text-white hover:border-indigo-500/40 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => window.open(chatUrl, '_blank')}
                    className="p-2 rounded-lg border border-indigo-500/20 text-slate-400 hover:text-white hover:border-indigo-500/40 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live preview */}
          <div className="neon-border rounded-xl bg-[#0d1117]/80 overflow-hidden">
            <div className="p-5 border-b border-indigo-500/10">
              <h2 className="text-white font-semibold">Live Preview</h2>
            </div>
            <div className="p-5">
              <div className="rounded-lg overflow-hidden border border-indigo-500/20" style={{ height: 560 }}>
                <iframe src={chatUrl} className="w-full h-full" title="Chatbot Preview" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
