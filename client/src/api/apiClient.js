/**
 * API client for the Vanta backend.
 * Replaces the base44 SDK with direct REST calls.
 */

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request(method, path, body, isFormData = false) {
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ─── Chatbots ─────────────────────────────────────────────────────────────────

export const chatbotsApi = {
  /** Generate a new chatbot from a plain-English description */
  generate: (description) => request('POST', '/api/chatbots/generate', { description }),

  /** List all chatbots or filter by query params */
  filter: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/api/chatbots${qs ? `?${qs}` : ''}`);
  },

  /** Get a single chatbot */
  get: (id) => request('GET', `/api/chatbots/${id}`),

  /** Create a chatbot manually */
  create: (data) => request('POST', '/api/chatbots', data),

  /** Update a chatbot */
  update: (id, data) => request('PATCH', `/api/chatbots/${id}`, data),

  /** Delete a chatbot */
  delete: (id) => request('DELETE', `/api/chatbots/${id}`),
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messagesApi = {
  list: (chatbotId) => request('GET', `/api/messages?chatbot_id=${chatbotId}`),
  create: (data) => request('POST', '/api/messages', data),
};

// ─── Documents ────────────────────────────────────────────────────────────────

export const documentsApi = {
  /**
   * Upload a file and index it for the given chatbot.
   * @param {File} file
   * @param {string} chatbotId
   * @param {string} [nodeId]
   */
  upload: (file, chatbotId, nodeId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('chatbot_id', chatbotId);
    if (nodeId) form.append('node_id', nodeId);
    return request('POST', '/api/documents/upload', form, true);
  },

  /** Delete all indexed chunks for a chatbot */
  clear: (chatbotId) => request('DELETE', `/api/documents/app/${chatbotId}`),
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const chatApi = {
  /**
   * Send a message and get a RAG-powered answer.
   */
  send: (chatbotId, query) => request('POST', '/api/chat', { chatbot_id: chatbotId, query }),

  /**
   * Workflow preview / test mode (no real RAG, simulated).
   */
  preview: (chatbotId, query) => request('POST', '/api/chat/preview', { chatbot_id: chatbotId, query }),
};
