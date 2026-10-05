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
  /**
   * Create a minimal draft rag_app (no LLM, no nodes).
   * Used by the new creation flow → navigates to Architect onboarding.
   */
  createDraft: (description, projectId) =>
    request('POST', '/api/chatbots/create-draft', {
      description,
      ...(projectId && { project_id: projectId }),
    }),

  /**
   * Legacy: AI-generate workflow nodes from a description.
   * Still used by the verification test suite and kept for backward compat.
   * The new primary creation flow uses createDraft instead.
   */
  generate: (description, projectId) =>
    request('POST', '/api/chatbots/generate', {
      description,
      ...(projectId && { project_id: projectId }),
    }),

  filter: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
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

  /**
   * Apply the approved Architect plan to create final document_chunks for one doc.
   * Requires architect_status = 'approved' on the parent RAG app.
   */
  index: (docId) => request('POST', `/api/documents/${docId}/index`),

  /** Delete a single document by ID (chunks + Storage object + row). */
  delete: (docId) => request('DELETE', `/api/documents/${docId}`),

  /** Reprocess a document using the current active workflow (OCR-aware). */
  reprocess: (docId) => request('POST', `/api/documents/${docId}/reprocess`),

  /** Delete ALL documents for a RAG app. Use with caution. */
  clear: (chatbotId) => request('DELETE', `/api/documents/app/${chatbotId}`),

  signedUrl: (docId) => request('POST', `/api/documents/${docId}/signed-url`),
};

// ─── Architect ────────────────────────────────────────────────────────────────

export const architectApi = {
  /** Profile documents + get follow-up questions */
  analyze: (ragAppId, requirement, previousAnswers = []) =>
    request('POST', '/api/architect/analyze', {
      rag_app_id: ragAppId,
      requirement,
      previous_answers: previousAnswers,
    }),

  /** Generate + persist architect plan */
  plan: (ragAppId, requirement, answers = [], knowledgeProfile = null) =>
    request('POST', '/api/architect/plan', {
      rag_app_id:        ragAppId,
      requirement,
      answers,
      knowledge_profile: knowledgeProfile,
    }),

  /** Approve the current ready plan */
  approve: (ragAppId) =>
    request('POST', '/api/architect/approve', { rag_app_id: ragAppId }),

  /**
   * Execute final indexing for all profiled documents using the approved plan.
   * Call this after approval to create the final pgvector retrieval representation.
   */
  indexAll: (ragAppId) =>
    request('POST', '/api/architect/index-all', { rag_app_id: ragAppId }),

  /**
   * Phase 8: Materialize workflow only (nodes + connections persisted, no indexing).
   * Use buildPipeline for the full approve → build → index flow.
   */
  materialize: (ragAppId) =>
    request('POST', '/api/architect/materialize', { rag_app_id: ragAppId }),

  /**
   * Phase 8: Build full pipeline — materialize workflow + index all documents.
   * This is the single user-facing action after plan approval.
   * Returns { workflow: { nodes, connections }, indexing: { indexed, errors } }
   */
  buildPipeline: (ragAppId) =>
    request('POST', '/api/architect/build-pipeline', { rag_app_id: ragAppId }),

  /** Get current architect state (for reload restoration) */
  get: (ragAppId) =>
    request('GET', `/api/architect/${ragAppId}`),
};

// ─── Workflow (Phase 9A) ──────────────────────────────────────────────────────

export const workflowApi = {
  /** Full capability registry — all node types with status */
  getRegistry: () => request('GET', '/api/workflow/registry'),

  /** Active + draft workflow for a RAG app */
  get: (ragAppId) => request('GET', `/api/workflow/${ragAppId}`),

  /** Save draft canvas changes (does NOT mutate active workflow) */
  saveDraft: (ragAppId, nodes, connections) =>
    request('PATCH', `/api/workflow/${ragAppId}/draft`, { nodes, connections }),

  /** Discard draft — clears draft_nodes/connections, visual resets to active */
  discardDraft: (ragAppId) => request('DELETE', `/api/workflow/${ragAppId}/draft`),

  /** Compute diff between active and provided (or stored) draft */
  diff: (ragAppId, nodes = undefined, connections = undefined) =>
    request('POST', `/api/workflow/${ragAppId}/diff`,
      nodes !== undefined ? { nodes, connections } : {}),

  /** Validate topology of provided (or stored draft) workflow */
  validate: (ragAppId, nodes = undefined, connections = undefined) =>
    request('POST', `/api/workflow/${ragAppId}/validate`,
      nodes !== undefined ? { nodes, connections } : {}),
};

// ─── Architect Chat (Phase 9B) ────────────────────────────────────────────────

export const architectChatApi = {
  /** Load conversation history + current proposal state */
  get: (ragAppId) =>
    request('GET', `/api/architect-chat/${ragAppId}`),

  /** Start/restart a conversation (clears previous for this version) */
  start: (ragAppId, message = '') =>
    request('POST', `/api/architect-chat/${ragAppId}/start`, { message }),

  /** Send a user message and receive the next Architect response */
  message: (ragAppId, message) =>
    request('POST', `/api/architect-chat/${ragAppId}/message`, { message }),

  /** PATH A: Review the current saved draft with the Architect */
  reviewDraft: (ragAppId) =>
    request('POST', `/api/architect-chat/${ragAppId}/review-draft`),

  /**
   * Phase 9C: Approve and activate a ready_for_review proposal.
   * Returns { approved, activated, nodes, connections, architect_version, impact, reindexed }
   * or { approved: false, activation_blocked: true, unsupported_capabilities: [...] }
   */
  approveProposal: (ragAppId) =>
    request('POST', `/api/architect-chat/${ragAppId}/approve-proposal`),

  /** Cancel the current proposal (preserves the user's draft unchanged) */
  cancel: (ragAppId) =>
    request('DELETE', `/api/architect-chat/${ragAppId}/cancel`),
};

export const chatApi = {
  // Public deployed/embed chatbot
  sendPublic: (embedId, query, sessionId) =>
    request(
      'POST',
      '/api/chat',
      {
        embed_id: embedId,
        query,
        session_id: sessionId,
      },
      false,
      true
    ),

  // Authenticated internal chat
  send: (chatbotId, query, sessionId) =>
    request('POST', '/api/chat', {
      chatbot_id: chatbotId,
      query,
      session_id: sessionId,
    }),

  // Authenticated Editor preview
  preview: (chatbotId, query) =>
    request('POST', '/api/chat/preview', {
      chatbot_id: chatbotId,
      query,
    }),
};