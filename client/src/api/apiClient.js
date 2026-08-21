/**
 * client/src/api/apiClient.js
 *
 * Phase 6: All authenticated requests now include Authorization: Bearer <token>.
 * The token is read from the active Supabase session on every request —
 * no manual token storage, no stale tokens after sign-out.
 *
 * Public routes (no token needed):
 *   GET  /api/health
 *   GET  /api/chatbots?embed_id=   (public chat widget)
 *   POST /api/chat                 (supports embed_id path without auth)
 */

import supabase from '@/lib/supabaseClient.js';

const BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Get the current access token from the Supabase session.
 * Returns null if the user is not signed in.
 * Supabase automatically refreshes the token — this always returns a fresh value.
 */
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Core request function. Automatically attaches Bearer token when available.
 * Pass skipAuth: true for genuinely public requests that must not send a token.
 */
async function request(method, path, body, isFormData = false, skipAuth = false) {
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };

  if (!skipAuth) {
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Surface 401 clearly — caller can decide to redirect to Login
    if (res.status === 401) {
      throw Object.assign(new Error(err.error || 'Authentication required'), { status: 401 });
    }
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: () =>
    request('GET', '/api/projects'),
  create: (data) =>
    request('POST', '/api/projects', data),
  update: (id, data) =>
    request('PATCH', `/api/projects/${id}`, data),
  delete: (id) =>
    request('DELETE', `/api/projects/${id}`),
};

// ─── Chatbots ─────────────────────────────────────────────────────────────────

export const chatbotsApi = {
  generate: (description, projectId) =>
    request('POST', '/api/chatbots/generate', {
      description,
      ...(projectId && { project_id: projectId }),
    }),

  filter: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    // embed_id lookup is public — skip auth so the chat widget doesn't need a session
    const isPublicEmbedLookup = params.embed_id && !params.id;
    return request('GET', `/api/chatbots${qs ? `?${qs}` : ''}`, undefined, false, isPublicEmbedLookup);
  },

  get:    (id)       => request('GET',    `/api/chatbots/${id}`),
  create: (data)     => request('POST',   '/api/chatbots', data),
  update: (id, data) => request('PATCH',  `/api/chatbots/${id}`, data),
  delete: (id)       => request('DELETE', `/api/chatbots/${id}`),
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messagesApi = {
  list:   (chatbotId) => request('GET',  `/api/messages?chatbot_id=${chatbotId}`),
  create: (data)      => request('POST', '/api/messages', data),
};

// ─── Documents ────────────────────────────────────────────────────────────────

export const documentsApi = {
  list: (ragAppId) => request('GET', `/api/documents?rag_app_id=${ragAppId}`),
  upload: (file, chatbotId, nodeId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('chatbot_id', chatbotId);
    if (nodeId) form.append('node_id', nodeId);
    return request('POST', '/api/documents/upload', form, true);
  },
  clear:     (chatbotId) => request('DELETE', `/api/documents/app/${chatbotId}`),
  signedUrl: (docId)     => request('POST',   `/api/documents/${docId}/signed-url`),
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const chatApi = {
  // Embed-based public chat — no auth required
  sendPublic: (embedId, query, sessionId) =>
    request('POST', '/api/chat', { embed_id: embedId, query, session_id: sessionId }, false, true),

  // Authenticated internal chat (chatbot_id, JWT attached automatically)
  send: (chatbotId, query, sessionId) =>
    request('POST', '/api/chat', { chatbot_id: chatbotId, query, session_id: sessionId }),

  // Editor preview — now requires auth (Phase 6 closes the temporary exception)
  preview: (chatbotId, query) =>
    request('POST', '/api/chat/preview', { chatbot_id: chatbotId, query }),
};
