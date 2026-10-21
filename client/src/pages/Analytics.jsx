/**
 * client/src/pages/Analytics.jsx
 *
 * Phase 10C: Per-chatbot Analytics Dashboard.
 *
 * Accessed via: /Analytics?id=<chatbotId>
 *
 * Sections:
 *   1. Summary metrics  — questions, sessions, latency, retrieval, feedback
 *   2. Popular topics   — top 10 topics with counts + trends
 *   3. Answer quality   — retrieval health, feedback, abstentions
 *   4. Daily trend      — mini bar chart of questions per day
 *   5. AI Insights      — LLM-generated recommendations (privacy-conscious)
 *   6. Privacy settings — diagnostic logging, retention, memory config
 *
 * INVARIANTS:
 *   - Scoped to the chatbot specified in ?id= — never mixes chatbot data
 *   - Only accessible by authenticated owner
 *   - Raw transcripts are never shown
 *   - Insights clearly labeled as AI-generated
 *   - All counts derived from interaction_events, not LLM summaries
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart2, Users, MessageSquare, Zap,
  ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle,
  TrendingUp, Brain, Shield, RefreshCw, Lightbulb,
  Clock, Activity, Target, Info, Save,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { chatbotsApi, analyticsApi } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import { useAppTheme } from '@/lib/ThemeContext';

// ─── Date range presets ───────────────────────────────────────────────────────

const DATE_PRESETS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// ─── Mini bar chart ───────────────────────────────────────────────────────────

/**
 * Zero-fills a sparse trend array to cover the full date range.
 * Ensures the chart always shows a proper timeline even when most days have 0 questions.
 */
function fillDateRange(data, days) {
  const filled = {};
  // Seed all days with 0
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    filled[key] = { date: key, count: 0, answered: 0, failed: 0, abstained: 0 };
  }
  // Overlay actual data
  for (const row of (data || [])) {
    if (filled[row.date]) filled[row.date] = row;
  }
  return Object.values(filled).sort((a, b) => a.date.localeCompare(b.date));
}

function MiniBarChart({ data, days = 30, C, dark }) {
  const filled = fillDateRange(data, days);
  const maxCount = Math.max(...filled.map(d => d.count), 1);
  const CHART_H = 80;

  if (!data || data.length === 0) return (
    <div style={{ height: CHART_H, display: 'flex', alignItems: 'flex-end', gap: 1, padding: '4px 0', position: 'relative' }}>
      {filled.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: 0 questions`}
          style={{
            flex: 1, minWidth: 2,
            height: 3,
            background: C.border,
            borderRadius: '2px 2px 0 0',
            opacity: 0.4,
          }}
        />
      ))}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.t3, fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
        pointerEvents: 'none',
      }}>
        No data yet
      </div>
    </div>
  );

  return (
    <div style={{ height: CHART_H, display: 'flex', alignItems: 'flex-end', gap: 1, padding: '4px 0' }}>
      {filled.map((d) => {
        const barPct = d.count > 0 ? Math.max((d.count / maxCount) * 100, 8) : 0;
        const barH = d.count > 0 ? Math.max(Math.round((barPct / 100) * (CHART_H - 8)), 4) : 3;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${d.count} question${d.count !== 1 ? 's' : ''}`}
            style={{
              flex: 1, minWidth: 2,
              height: barH,
              background: d.count > 0
                ? `linear-gradient(180deg, ${C.accentLt}, ${C.accent})`
                : C.border,
              borderRadius: '2px 2px 0 0',
              opacity: d.count > 0 ? 1 : 0.25,
              transition: 'height 0.3s ease',
              cursor: d.count > 0 ? 'default' : 'default',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, icon, color, C, dark, loading }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '16px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: C.shadow,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: `${color}18`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {React.cloneElement(icon, { size: 18, color })}
      </div>
      <div style={{ minWidth: 0 }}>
        {loading ? (
          <div style={{ height: 24, width: 60, background: C.border, borderRadius: 4, marginBottom: 4 }} />
        ) : (
          <div style={{ fontSize: 24, fontWeight: 800, color: C.t1, lineHeight: 1, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            {value ?? '—'}
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Quality bar ─────────────────────────────────────────────────────────────

function QualityBar({ label, value, max, color, C }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.t2 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
          {value}{max > 0 ? ` / ${max}` : ''}
        </span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color, borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

// ─── Topic row ────────────────────────────────────────────────────────────────

function TopicRow({ topic, rank, C, dark }) {
  const abstentionRate = topic.count > 0 ? Math.round(topic.abstained / topic.count * 100) : 0;
  const failRate       = topic.count > 0 ? Math.round(topic.retrieval_fail / topic.count * 100) : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, marginBottom: 6,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
        color: C.t3, width: 20, textAlign: 'right', flexShrink: 0,
      }}>#{rank}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 2 }}>
          {topic.label}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
            {topic.category}
          </span>
          {abstentionRate > 20 && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(239,68,68,0.1)', color: '#ef4444',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            }}>
              {abstentionRate}% unanswered
            </span>
          )}
          {failRate > 20 && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(251,191,36,0.1)', color: '#f59e0b',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            }}>
              {failRate}% no source
            </span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.t1, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {topic.count}
        </div>
        <div style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
          {topic.percentage}%
        </div>
      </div>

      {/* Percentage bar */}
      <div style={{ width: 60, flexShrink: 0 }}>
        <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${topic.percentage}%`,
            background: `linear-gradient(90deg, ${C.accent}, ${C.accentLt})`,
            borderRadius: 2, transition: 'width 0.4s ease',
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function SettingsPanel({ chatbotId, C, dark }) {
  const [settings, setSettings]   = useState(null);
  const [loading,  setLoading]    = useState(true);
  const [saving,   setSaving]     = useState(false);
  const [saved,    setSaved]      = useState(false);
  const [error,    setError]      = useState('');

  useEffect(() => { loadSettings(); }, [chatbotId]);

  const loadSettings = async () => {
    try {
      const s = await analyticsApi.getSettings(chatbotId);
      setSettings(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await analyticsApi.saveSettings(chatbotId, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: C.t3, fontSize: 12, padding: 16, fontFamily: 'JetBrains Mono, monospace' }}>Loading settings…</div>;

  const s = settings || {};

  return (
    <div>
      {error && (
        <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#fca5a5', fontSize: 12, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Privacy */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.t3, marginBottom: 10 }}>
          Privacy
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 8 }}>
          <div
            onClick={() => setSettings(p => ({ ...p, diagnostic_logging: !p.diagnostic_logging }))}
            style={{
              width: 36, height: 20, borderRadius: 10, position: 'relative',
              background: s.diagnostic_logging ? C.accent : C.border,
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 2, left: s.diagnostic_logging ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
            }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>Diagnostic logging</div>
            <div style={{ fontSize: 11, color: C.t3, marginTop: 1 }}>Stores anonymized question text for debugging. Off by default.</div>
          </div>
        </label>
      </div>

      {/* Retention */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.t3, marginBottom: 10 }}>
          Data Retention
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: C.t2, display: 'block', marginBottom: 5 }}>Session expiry (days)</label>
            <input
              type="number" min="1" max="365"
              value={s.session_expiry_days ?? 30}
              onChange={e => setSettings(p => ({ ...p, session_expiry_days: parseInt(e.target.value) || 30 }))}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 7,
                background: C.input, border: `1px solid ${C.inputBorder}`,
                color: C.t1, fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: C.t2, display: 'block', marginBottom: 5 }}>Analytics retention (days)</label>
            <input
              type="number" min="7" max="365"
              value={s.data_retention_days ?? 90}
              onChange={e => setSettings(p => ({ ...p, data_retention_days: parseInt(e.target.value) || 90 }))}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 7,
                background: C.input, border: `1px solid ${C.inputBorder}`,
                color: C.t1, fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      {/* Memory */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.t3, marginBottom: 10 }}>
          Session Memory
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
          <div
            onClick={() => setSettings(p => ({ ...p, memory_enabled: !p.memory_enabled }))}
            style={{
              width: 36, height: 20, borderRadius: 10, position: 'relative',
              background: s.memory_enabled !== false ? C.accent : C.border,
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 2,
              left: s.memory_enabled !== false ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
            }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>Rolling conversation memory</div>
            <div style={{ fontSize: 11, color: C.t3, marginTop: 1 }}>Summarizes older messages for context continuity within a session.</div>
          </div>
        </label>
        {s.memory_enabled !== false && (
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: C.t2, display: 'block', marginBottom: 5 }}>Summarization threshold (tokens)</label>
              <input
                type="number" min="500" max="8000"
                value={s.memory_token_threshold ?? 2000}
                onChange={e => setSettings(p => ({ ...p, memory_token_threshold: parseInt(e.target.value) || 2000 }))}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 7,
                  background: C.input, border: `1px solid ${C.inputBorder}`,
                  color: C.t1, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: C.t2, display: 'block', marginBottom: 5 }}>Recent messages kept verbatim</label>
              <input
                type="number" min="2" max="20"
                value={s.memory_recent_messages ?? 6}
                onChange={e => setSettings(p => ({ ...p, memory_recent_messages: parseInt(e.target.value) || 6 }))}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 7,
                  background: C.input, border: `1px solid ${C.inputBorder}`,
                  color: C.t1, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '9px 20px', borderRadius: 8,
          background: saved ? 'rgba(34,197,94,0.15)' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
          border: saved ? '1px solid rgba(34,197,94,0.3)' : 'none',
          color: saved ? '#22c55e' : '#fff',
          fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {saving ? <><div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Saving…</> :
         saved  ? <><CheckCircle size={13} /> Saved</> :
                  <><Save size={13} /> Save Settings</>}
      </button>

      {/* What we collect notice */}
      <div style={{
        marginTop: 20, padding: '10px 14px',
        background: dark ? 'rgba(124,58,237,0.06)' : 'rgba(109,40,217,0.04)',
        border: `1px solid ${C.panelBorder}`, borderRadius: 8,
        fontSize: 11, color: C.t3, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.t2 }}>What we collect:</strong> event type, retrieval status, latency, similarity scores, topic category, feedback signals.
        We never store raw conversation text in analytics unless Diagnostic Logging is enabled.
        All data is scoped to this chatbot and accessible only to you.
        Records are deleted after the retention period.
      </div>
    </div>
  );
}

// ─── Main Analytics page ──────────────────────────────────────────────────────

export default function Analytics() {
  const navigate   = useNavigate();
  const chatbotId  = new URLSearchParams(window.location.search).get('id');
  const { dark, C } = useAppTheme();

  const [chatbot,    setChatbot]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [days,       setDays]       = useState(30);
  const [summary,    setSummary]    = useState(null);
  const [topics,     setTopics]     = useState([]);
  const [trend,      setTrend]      = useState([]);
  const [insights,   setInsights]   = useState([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [activeTab,  setActiveTab]  = useState('overview');
  const [error,      setError]      = useState('');

  useEffect(() => {
    if (chatbotId) loadChatbot();
  }, [chatbotId]);

  useEffect(() => {
    if (chatbot) loadAnalytics();
  }, [chatbot, days]);

  const loadChatbot = async () => {
    try {
      const bots = await chatbotsApi.filter({ id: chatbotId });
      if (bots.length) setChatbot(bots[0]);
    } catch (err) {
      setError('Failed to load chatbot');
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setDataLoading(true);
    setError('');
    try {
      const [summaryRes, topicsRes, trendRes] = await Promise.all([
        analyticsApi.getSummary(chatbotId, { days }),
        analyticsApi.getTopics(chatbotId, { days }),
        analyticsApi.getTrend(chatbotId, { days }),
      ]);
      setSummary(summaryRes.summary);
      setTopics(topicsRes.topics || []);
      setTrend(trendRes.trend || []);
    } catch (err) {
      setError('Failed to load analytics: ' + err.message);
    } finally {
      setDataLoading(false);
    }
  };

  const handleGenerateInsights = async () => {
    setInsightLoading(true);
    try {
      const res = await analyticsApi.getInsights(chatbotId, { days });
      setInsights(res.insights || []);
    } catch (err) {
      setInsights(['Failed to generate insights: ' + err.message]);
    } finally {
      setInsightLoading(false);
    }
  };

  // ── Derived metrics ────────────────────────────────────────────────────────

  const s = summary || {};
  const abstentionRate  = s.total_questions > 0 ? Math.round(s.abstained_count / s.total_questions * 100) : 0;
  const retrievalOkRate = s.total_questions > 0 ? Math.round(s.retrieval_ok_count / s.total_questions * 100) : 0;
  const feedbackTotal   = (s.helpful_count || 0) + (s.unhelpful_count || 0);
  const helpfulRate     = feedbackTotal > 0 ? Math.round(s.helpful_count / feedbackTotal * 100) : null;

  const tabs = [
    { id: 'overview',  label: 'Overview',  icon: <BarChart2 size={13} /> },
    { id: 'topics',    label: 'Topics',    icon: <Target size={13} /> },
    { id: 'quality',   label: 'Quality',   icon: <Activity size={13} /> },
    { id: 'insights',  label: 'Insights',  icon: <Lightbulb size={13} /> },
    { id: 'settings',  label: 'Settings',  icon: <Shield size={13} /> },
  ];

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.t3, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        Loading analytics…
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        Chatbot not found
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .anim-fadeUp { animation: fadeUp 0.3s ease both; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        background: C.panel, borderBottom: `1px solid ${C.panelBorder}`,
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: C.t2 }}
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart2 size={15} color={C.accent} />
              <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>Analytics</span>
              <span style={{ fontSize: 12, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>·</span>
              <span style={{ fontSize: 13, color: C.t2 }}>{chatbot.title}</span>
            </div>
            <div style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
              Per-chatbot dashboard — isolated from other chatbots
            </div>
          </div>
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {DATE_PRESETS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: days === p.days ? C.accentBg : 'transparent',
                border: `1px solid ${days === p.days ? C.borderHi : C.border}`,
                color: days === p.days ? C.accentLt : C.t3,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={loadAnalytics}
            disabled={dataLoading}
            style={{
              padding: '6px 8px', borderRadius: 7, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.t3, cursor: 'pointer',
            }}
            title="Refresh"
          >
            <RefreshCw size={13} style={{ animation: dataLoading ? 'spin 0.7s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 2, padding: '0 24px',
        borderBottom: `1px solid ${C.panelBorder}`,
        background: C.panel,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 16px', border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? C.accent : 'transparent'}`,
              background: 'transparent', cursor: 'pointer',
              color: activeTab === tab.id ? C.t1 : C.t3,
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
              transition: 'all 0.15s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {error && (
        <div style={{ margin: '16px 24px 0', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#fca5a5', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={13} color="#ef4444" /> {error}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────── */}
      <div style={{ padding: '24px 24px 48px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ── OVERVIEW TAB ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="anim-fadeUp">
            {/* Metric cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
              <MetricCard
                label="Questions" value={s.total_questions ?? 0}
                sub={`last ${days} days`}
                icon={<MessageSquare />} color={C.accent} C={C} loading={dataLoading}
              />
              <MetricCard
                label="Sessions" value={s.total_sessions ?? 0}
                sub="unique visitor sessions"
                icon={<Users />} color={C.cyan} C={C} loading={dataLoading}
              />
              <MetricCard
                label="Avg Latency"
                value={s.avg_latency_ms ? `${s.avg_latency_ms}ms` : '—'}
                sub="wall-clock response time"
                icon={<Clock />} color={C.green} C={C} loading={dataLoading}
              />
              <MetricCard
                label="Retrieval OK"
                value={s.total_questions > 0 ? `${retrievalOkRate}%` : '—'}
                sub={`${s.retrieval_ok_count ?? 0} of ${s.total_questions ?? 0}`}
                icon={<CheckCircle />} color="#22c55e" C={C} loading={dataLoading}
              />
              <MetricCard
                label="Abstentions"
                value={s.total_questions > 0 ? `${abstentionRate}%` : '—'}
                sub={`${s.abstained_count ?? 0} unanswered`}
                icon={<AlertTriangle />} color={abstentionRate > 20 ? '#ef4444' : C.amber} C={C} loading={dataLoading}
              />
              <MetricCard
                label="Helpful"
                value={helpfulRate !== null ? `${helpfulRate}%` : '—'}
                sub={feedbackTotal > 0 ? `${feedbackTotal} rated` : 'no ratings yet'}
                icon={<ThumbsUp />} color={helpfulRate !== null && helpfulRate < 60 ? '#ef4444' : '#22c55e'} C={C} loading={dataLoading}
              />
            </div>

            {/* Daily trend */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '18px 20px', marginBottom: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <TrendingUp size={14} color={C.accentLt} />
                <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Daily Questions</span>
                <span style={{ fontSize: 11, color: C.t3, fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
                  {trend.length} day{trend.length !== 1 ? 's' : ''} with activity
                </span>
              </div>
              <MiniBarChart data={trend} days={days} C={C} dark={dark} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
                  {(() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })()}
                </span>
                <span style={{ fontSize: 10, color: C.t3, fontFamily: 'JetBrains Mono, monospace' }}>
                  {new Date().toISOString().slice(0, 10)}
                </span>
              </div>
            </div>

            {/* Top 3 topics preview */}
            {topics.length > 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Target size={14} color={C.accentLt} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Top Topics</span>
                  <button
                    onClick={() => setActiveTab('topics')}
                    style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: C.t3, fontSize: 11 }}
                  >
                    View all →
                  </button>
                </div>
                {topics.slice(0, 3).map((t, i) => (
                  <TopicRow key={t.category} topic={t} rank={i + 1} C={C} dark={dark} />
                ))}
              </div>
            ) : s.total_questions > 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Target size={14} color={C.accentLt} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Top Topics</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: C.accentBg, border: `1px solid ${C.borderHi}`, borderRadius: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accentLt, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.t2 }}>
                    Topic classification will appear here after deploying the latest update.
                    Your {s.total_questions} existing question{s.total_questions !== 1 ? 's' : ''} will be classified going forward.
                  </span>
                </div>
              </div>
            ) : null}

            {/* Empty state */}
            {!dataLoading && s.total_questions === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: C.t3 }}>
                <BarChart2 size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p style={{ fontSize: 15, fontWeight: 600, color: C.t2, marginBottom: 6 }}>No data yet</p>
                <p style={{ fontSize: 13, color: C.t3 }}>Analytics will appear once visitors start chatting with this bot.</p>
              </div>
            )}
          </div>
        )}

        {/* ── TOPICS TAB ────────────────────────────────────────────── */}
        {activeTab === 'topics' && (
          <div className="anim-fadeUp">
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={15} color={C.accentLt} />
              <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>Popular Topics</span>
              <span style={{ fontSize: 12, color: C.t3, marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace' }}>
                {topics.length} topics · {s.total_questions ?? 0} total questions
              </span>
            </div>

            {/* Privacy note */}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '8px 12px', marginBottom: 16,
              background: dark ? 'rgba(124,58,237,0.06)' : 'rgba(109,40,217,0.04)',
              border: `1px solid ${C.panelBorder}`, borderRadius: 8,
              fontSize: 11, color: C.t3,
            }}>
              <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} color={C.t3} />
              Topics are AI-classified from question patterns. No raw question text is shown here.
              Counts are based on recorded interaction events, not LLM estimates.
            </div>

            {topics.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: C.t3 }}>
                <Target size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: C.t2, marginBottom: 6 }}>No topics classified yet</p>
                <p style={{ fontSize: 12, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
                  Topics are AI-classified after each question. They appear here once the latest server update is deployed.
                  {s.total_questions > 0 && (
                    <span> You have <strong style={{ color: C.accentLt }}>{s.total_questions} recorded questions</strong> — topics will be classified on new conversations after deployment.</span>
                  )}
                </p>
              </div>
            ) : (
              topics.map((t, i) => (
                <TopicRow key={t.category} topic={t} rank={i + 1} C={C} dark={dark} />
              ))
            )}
          </div>
        )}

        {/* ── QUALITY TAB ───────────────────────────────────────────── */}
        {activeTab === 'quality' && (
          <div className="anim-fadeUp">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

              {/* Retrieval health */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <CheckCircle size={14} color="#22c55e" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Retrieval Health</span>
                </div>
                <QualityBar label="Successful retrievals" value={s.retrieval_ok_count ?? 0} max={s.total_questions ?? 0} color="#22c55e" C={C} />
                <QualityBar label="No results found" value={s.retrieval_fail_count ?? 0} max={s.total_questions ?? 0} color="#f59e0b" C={C} />
                <div style={{ fontSize: 11, color: C.t3, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>
                  Avg similarity: {s.avg_similarity ? (s.avg_similarity * 100).toFixed(1) + '%' : '—'}
                </div>
                {(s.retrieval_fail_count ?? 0) > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, fontSize: 11, color: '#f59e0b' }}>
                    {s.retrieval_fail_count} questions found no relevant content. Consider expanding the knowledge base.
                  </div>
                )}
              </div>

              {/* User feedback */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <ThumbsUp size={14} color={C.accentLt} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>User Feedback</span>
                </div>
                {feedbackTotal === 0 ? (
                  <div style={{ color: C.t3, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                    No feedback yet. Visitors can rate responses helpful or unhelpful.
                  </div>
                ) : (
                  <>
                    <QualityBar label="Helpful" value={s.helpful_count ?? 0} max={feedbackTotal} color="#22c55e" C={C} />
                    <QualityBar label="Unhelpful" value={s.unhelpful_count ?? 0} max={feedbackTotal} color="#ef4444" C={C} />
                    <div style={{ fontSize: 11, color: C.t3, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>
                      {feedbackTotal} rated · {(feedbackTotal / (s.total_questions || 1) * 100).toFixed(0)}% feedback rate
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: C.t3 }}>
                      <strong style={{ color: C.t2 }}>Note:</strong> Feedback reflects explicit user ratings only.
                      Absence of feedback is not treated as negative.
                    </div>
                  </>
                )}
              </div>

              {/* Response status */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <Activity size={14} color={C.cyan} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Response Status</span>
                </div>
                <QualityBar label="Answered" value={s.answered_count ?? 0} max={s.total_questions ?? 0} color="#22c55e" C={C} />
                <QualityBar label="Abstained (no info)" value={s.abstained_count ?? 0} max={s.total_questions ?? 0} color="#f59e0b" C={C} />
                <QualityBar label="Failed (error)" value={s.failed_count ?? 0} max={s.total_questions ?? 0} color="#ef4444" C={C} />
                <div style={{ marginTop: 10, fontSize: 11, color: C.t3 }}>
                  <strong style={{ color: C.t2 }}>Abstained</strong> means the bot stated it couldn't answer from available knowledge.
                  This is the correct grounded behavior, not an error.
                </div>
              </div>

              {/* Disclaimer */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Info size={14} color={C.t3} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>Quality Signals</span>
                </div>
                <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.7 }}>
                  <p><strong>Retrieval success</strong> — found relevant chunks in the knowledge base.</p>
                  <p style={{ marginTop: 8 }}><strong>User feedback</strong> — visitor clicked 👍 or 👎.</p>
                  <p style={{ marginTop: 8 }}><strong>Abstention rate</strong> — bot correctly said "I don't know."</p>
                  <p style={{ marginTop: 8 }}><strong>No accuracy %</strong> is shown because we cannot determine correctness without ground truth.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── INSIGHTS TAB ──────────────────────────────────────────── */}
        {activeTab === 'insights' && (
          <div className="anim-fadeUp">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Lightbulb size={16} color={C.accentLt} />
              <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>AI-Generated Insights</span>
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 4,
                background: C.accentBg, border: `1px solid ${C.borderHi}`,
                color: C.accentLt, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>AI</span>
              <button
                onClick={handleGenerateInsights}
                disabled={insightLoading}
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 8,
                  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: insightLoading ? 'wait' : 'pointer',
                }}
              >
                {insightLoading
                  ? <><div style={{ width: 11, height: 11, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating…</>
                  : <><Brain size={12} /> Generate Insights</>}
              </button>
            </div>

            {/* Privacy notice */}
            <div style={{
              display: 'flex', gap: 8, padding: '9px 13px', marginBottom: 20,
              background: dark ? 'rgba(124,58,237,0.06)' : 'rgba(109,40,217,0.04)',
              border: `1px solid ${C.panelBorder}`, borderRadius: 8,
              fontSize: 11, color: C.t3, lineHeight: 1.6,
            }}>
              <Shield size={12} style={{ flexShrink: 0, marginTop: 1 }} color={C.t3} />
              <div>
                Insights are derived from aggregated analytics counts — no raw question text is sent to the AI.
                They are interpretations, not exact measurements. Always cross-reference with the numbers in the Overview and Quality tabs.
              </div>
            </div>

            {insights.length === 0 && !insightLoading ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: C.t3 }}>
                <Brain size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p style={{ fontSize: 13 }}>Click "Generate Insights" to get AI-powered recommendations based on your analytics.</p>
                <p style={{ fontSize: 12, marginTop: 6, color: C.t3 }}>Requires at least 5 recorded interactions.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {insights.map((insight, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, padding: '14px 16px',
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 10,
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                      background: C.accentBg, border: `1px solid ${C.borderHi}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: C.accentLt, fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {i + 1}
                    </div>
                    <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.65, margin: 0 }}>{insight}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ──────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="anim-fadeUp" style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <Shield size={15} color={C.accentLt} />
              <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>Privacy & Analytics Settings</span>
            </div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
              <SettingsPanel chatbotId={chatbotId} C={C} dark={dark} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
