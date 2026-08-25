import 'dotenv/config';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY || '';

if (!apiKey) {
  console.warn('[warn] OPENAI_API_KEY not set — LLM calls will fail.');
}

// Auto-detect OpenRouter keys (sk-or-v1-...) and route to their base URL
const isOpenRouter = apiKey.startsWith('sk-or-');

if (isOpenRouter) {
  console.log('[openai] OpenRouter key detected → routing to openrouter.ai');
} 

export const openai = new OpenAI({
  apiKey,
  ...(isOpenRouter && { baseURL: 'https://openrouter.ai/api/v1' }),
});

// OpenRouter uses "provider/model" format; standard OpenAI uses short names
export const DEFAULT_CHAT_MODEL = isOpenRouter ? 'openai/gpt-3.5-turbo' : 'gpt-3.5-turbo';
export const DEFAULT_JSON_MODEL = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';
export const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

/**
 * Call LLM with a plain prompt.
 * max_tokens: 1024 — sufficient for RAG answers; avoids burning credits on
 * uncapped defaults when using OpenRouter with gpt-3.5-turbo.
 */
export async function invokeLLM(prompt, model, temperature = 0.7) {
  const resp = await openai.chat.completions.create({
    model:      model || DEFAULT_CHAT_MODEL,
    temperature,
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Call LLM with a full messages array (multi-turn conversation).
 * Each message: { role: 'system'|'user'|'assistant', content: string }
 * max_tokens: 1024 — sufficient for Architect clarification turns and
 * conversational responses.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} [model]
 * @param {number} [temperature]
 * @returns {Promise<string>}
 */
export async function invokeLLMChat(messages, model, temperature = 0.7) {
  const resp = await openai.chat.completions.create({
    model:      model || DEFAULT_CHAT_MODEL,
    temperature,
    max_tokens: 1024,
    messages,
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Call LLM and parse a JSON response.
 * max_tokens: 4096 — sufficient for structured Architect plan + follow-up
 * question JSON output. gpt-4o-mini default is 16384 which burns credits.
 * Throws a descriptive error if the LLM returns malformed JSON.
 */
export async function invokeLLMJson(prompt) {
  const resp = await openai.chat.completions.create({
    model:           DEFAULT_JSON_MODEL,
    temperature:     0.3,
    max_tokens:      4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a helpful assistant that always responds with valid JSON.' },
      { role: 'user',   content: prompt },
    ],
  });
  const raw = resp.choices[0]?.message?.content?.trim() ?? '';
  if (!raw) throw new Error('[invokeLLMJson] LLM returned empty response');
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    throw new Error(`[invokeLLMJson] LLM returned malformed JSON: ${parseErr.message} — raw: ${raw.slice(0, 200)}`);
  }
}

/**
 * Call LLM with a full messages array and force JSON output.
 * max_tokens: 4096 — sufficient for structured proposal JSON output.
 * gpt-4o-mini default is 16384 which was triggering 402 credit errors.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {number} [temperature]
 * @returns {Promise<object>} — parsed JSON object
 */
export async function invokeLLMJsonChat(messages, temperature = 0.3) {
  const resp = await openai.chat.completions.create({
    model:           DEFAULT_JSON_MODEL,
    temperature,
    max_tokens:      4096,
    response_format: { type: 'json_object' },
    messages,
  });
  const raw = resp.choices[0]?.message?.content?.trim() ?? '';
  if (!raw) throw new Error('[invokeLLMJsonChat] LLM returned empty response');
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    throw new Error(`[invokeLLMJsonChat] LLM returned malformed JSON: ${parseErr.message} — raw: ${raw.slice(0, 200)}`);
  }
}

/**
 * Generate embeddings for a text string.
 * Falls back to pseudo-embeddings when using OpenRouter (no embedding endpoint).
 */
export async function embedText(text, model = DEFAULT_EMBED_MODEL) {
  if (isOpenRouter) {
    return pseudoEmbed(text);
  }
  const resp = await openai.embeddings.create({
    model,
    input: text.slice(0, 8000),
  });
  return resp.data[0].embedding;
}

/**
 * Deterministic 384-dim pseudo-embedding based on character n-gram hashing.
 * Not semantically meaningful — replace with real embeddings for production.
 */
function pseudoEmbed(text, dims = 384) {
  const vec = new Array(dims).fill(0);
  const normalized = text.toLowerCase().slice(0, 2000);
  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized.charCodeAt(i);
    const b = normalized.charCodeAt(i + 1);
    const idx = Math.abs((a * 31 + b) * 1009 + i * 3) % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}
