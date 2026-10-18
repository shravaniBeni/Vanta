/**
 * client/src/pages/Chat.jsx
 *
 * Phase 10B: Public deployed chat renders using the chatbot's ui_config.
 * Phase 10C: Session persistence across turns + helpful/unhelpful feedback.
 *
 * Session lifecycle:
 *   - On first load, session_token is null.
 *   - After every response, the server returns a session_token.
 *   - The token is stored in sessionStorage (tab-scoped, not persisted across tabs).
 *   - Subsequent messages send the token back so the server can resume the session.
 *   - This gives each browser tab an independent, isolated conversation.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Zap, ZapOff, ThumbsUp, ThumbsDown } from 'lucide-react';
import { chatbotsApi, chatApi, analyticsApi } from '@/api/apiClient';
import DiagnosticPanel from '../components/diagnostic/DiagnosticPanel';
import { runDiagnostics, buildTelemetry } from '../components/diagnostic/ragDiagnostics';
import { useAppTheme } from '@/lib/ThemeContext';
import { resolveUiConfig } from '@/lib/uiConfig';
import WidgetRenderer from '../components/widget/WidgetRenderer';

// Session token persisted in sessionStorage (tab-scoped).
// Key is per-embed-id so multiple embedded chatbots on the same page don't collide.
function getStorageKey(embedId) {
  return `vanta-session-${embedId}`;
}

export default function Chat() {
  const [chatbot,      setChatbot]      = useState(null);
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [amdLocal,     setAmdLocal]     = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const { C } = useAppTheme();

  const embedId = new URLSearchParams(window.location.search).get('id');

  // Restore session token from sessionStorage on mount
  useEffect(() => {
    if (embedId) {
      const stored = sessionStorage.getItem(getStorageKey(embedId));
      if (stored) setSessionToken(stored);
    }
  }, [embedId]);

  useEffect(() => { loadChatbot(); }, [embedId]);

  const loadChatbot = async () => {
    try {
      const bots = await chatbotsApi.filter({ embed_id: embedId });
      if (bots.length > 0) {
        const bot = bots[0];
        setChatbot(bot);
        const uiCfg = resolveUiConfig(bot.ui_config ?? {});
        setMessages([{
          role:    'assistant',
          content: uiCfg.chat_ui.messages.welcome_message ?? `Hi! I'm ${bot.title}. How can I help you today?`,
        }]);
      }
    } catch (err) {
      console.error('Failed to load chatbot:', err);
    }
  };

  const handleSend = async (text) => {
    const query = (text ?? input).trim();
    if (!query || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setInput('');
    setLoading(true);

    try {
      // Pass session_token so server can resume the session
      const result = await chatApi.sendPublic(embedId, query, undefined, sessionToken);

      // Persist the returned session_token for the next turn
      if (result.session_token) {
        setSessionToken(result.session_token);
        if (embedId) {
          sessionStorage.setItem(getStorageKey(embedId), result.session_token);
        }
      }

      const telemetry = buildTelemetry({
        query,
        llmResponse:      result.answer,
        similarityScores: result.similarityScores ?? [],
        retrievedChunks:  result.retrievedChunks  ?? [],
        sourceMetadata:   [],
        configUsed:       result.telemetry?.configUsed ?? {},
      });
      const diagnostics = runDiagnostics(telemetry);

      setMessages(prev => [...prev, {
        role:                 'assistant',
        content:              result.answer,
        confidence:           result.avgSimilarity,
        sources:              result.retrievedChunks?.slice(0, 3) ?? [],
        telemetry,
        diagnostics,
        // Phase 10C: track interaction for feedback
        interactionEventId:   result.interaction_event_id ?? null,
        feedbackGiven:        null,   // null | true | false
      }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        role:        'assistant',
        content:     'Sorry, something went wrong. Please try again.',
        diagnostics: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Phase 10C: submit helpful/unhelpful feedback for a specific message
  const handleFeedback = async (messageIndex, value) => {
    const msg = messages[messageIndex];
    if (!msg?.interactionEventId || msg.feedbackGiven !== null) return;

    // Optimistic update
    setMessages(prev => prev.map((m, i) =>
      i === messageIndex ? { ...m, feedbackGiven: value } : m
    ));

    try {
      await analyticsApi.submitFeedback({
        session_token:        sessionToken,
        interaction_event_id: msg.interactionEventId,
        feedback_value:       value,
        embed_id:             embedId,
      });
    } catch (err) {
      // Roll back on failure
      console.warn('Feedback submission failed:', err.message);
      setMessages(prev => prev.map((m, i) =>
        i === messageIndex ? { ...m, feedbackGiven: null } : m
      ));
    }
  };

  if (!chatbot) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, color: C.t2, fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
        Loading chatbot...
      </div>
    );
  }

  const uiConfig    = resolveUiConfig(chatbot.ui_config ?? {});
  const widgetTempl = uiConfig.widget.template;

  return (
    <div style={{
      height: '100vh', width: '100vw', overflow: 'hidden',
      position: 'relative',
    }}>
      {/* AMD diagnostics toggle */}
      <div style={{
        position: 'fixed', top: 10, right: 10, zIndex: 999,
        display: amdLocal || widgetTempl === 'fullscreen' ? 'flex' : 'none',
        alignItems: 'center', gap: 6,
        padding: '5px 10px',
        background: amdLocal ? 'rgba(239,68,68,0.12)' : 'rgba(0,0,0,0.4)',
        border: `1px solid ${amdLocal ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', backdropFilter: 'blur(8px)',
      }}
        onClick={() => setAmdLocal(p => !p)}
      >
        {amdLocal ? <Zap size={11} color="#ef4444" /> : <ZapOff size={11} color="rgba(255,255,255,0.4)" />}
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: amdLocal ? '#ef4444' : 'rgba(255,255,255,0.4)' }}>
          {amdLocal ? 'Diagnostics ON' : 'Diagnostics'}
        </span>
      </div>

      {/* Widget */}
      <WidgetRenderer
        config={uiConfig}
        chatbotTitle={chatbot.title}
        messages={messages}
        loading={loading}
        input={input}
        onInputChange={setInput}
        onSend={() => handleSend()}
        onSuggestedQuestion={(q) => handleSend(q)}
        onFeedback={handleFeedback}
        previewMode={false}
        compact={false}
      />

      {/* Diagnostic panels */}
      {amdLocal && messages.some(m => m.diagnostics?.length) && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 500,
          maxHeight: 200, overflowY: 'auto',
          background: 'rgba(0,0,0,0.85)', borderRadius: 10, padding: 12,
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(8px)',
        }}>
          {messages
            .filter(m => m.role === 'assistant' && m.diagnostics?.length)
            .slice(-1)
            .map((m, i) => (
              <DiagnosticPanel key={i} diagnostics={m.diagnostics} amdLocal={true} telemetry={m.telemetry} />
            ))
          }
        </div>
      )}
    </div>
  );
}
