/**
 * server/src/middleware/rateLimit.js
 *
 * Zero-dependency in-process rate limiter for public API endpoints.
 *
 * Uses a sliding window counter keyed on IP address.
 * Suitable for single-instance deployments (Railway, Render, Fly.io hobby tier).
 * For multi-instance deployments, swap the in-memory store for Redis.
 *
 * Usage:
 *   import { chatRateLimit, sessionRateLimit } from './middleware/rateLimit.js';
 *   app.use('/api/chat', chatRateLimit, chatRoutes);
 */

// ─── In-memory store ──────────────────────────────────────────────────────────

/**
 * Map<ip, { count: number, windowStart: number }>
 * Entries older than 2× the window are purged periodically.
 */
const store = new Map();

// Purge stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > 600_000) {   // 10 min stale
      store.delete(key);
    }
  }
}, 300_000).unref(); // .unref() so this timer doesn't prevent process exit

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a rate-limit middleware.
 *
 * @param {{ windowMs: number, max: number, message?: string }} options
 */
function createRateLimit({ windowMs, max, message }) {
  return (req, res, next) => {
    // Respect X-Forwarded-For when behind a reverse proxy (Railway/Vercel/Render)
    const ip = (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown'
    );

    const now  = Date.now();
    const key  = ip;

    let entry = store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // Start a new window
      entry = { count: 1, windowStart: now };
      store.set(key, entry);
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      res.set('X-RateLimit-Limit',     String(max));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset',     String(Math.ceil((entry.windowStart + windowMs) / 1000)));
      return res.status(429).json({
        error: message || 'Too many requests. Please slow down.',
        retry_after_seconds: retryAfterSec,
      });
    }

    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    next();
  };
}

// ─── Pre-configured limiters ──────────────────────────────────────────────────

/**
 * Chat endpoint: 30 requests per minute per IP.
 * Protects against automated scraping and LLM abuse.
 */
export const chatRateLimit = createRateLimit({
  windowMs: 60_000,   // 1 minute
  max:      30,
  message:  'Chat rate limit exceeded. Please wait before sending more messages.',
});

/**
 * Session creation: 60 per minute per IP.
 * Each page load creates one session; this is generous.
 */
export const sessionRateLimit = createRateLimit({
  windowMs: 60_000,
  max:      60,
  message:  'Too many session requests.',
});

/**
 * Feedback: 20 per minute per IP.
 * Prevents feedback spam.
 */
export const feedbackRateLimit = createRateLimit({
  windowMs: 60_000,
  max:      20,
  message:  'Too many feedback submissions.',
});

/**
 * Document upload: 10 per minute per IP.
 * Upload + embedding is expensive; this limits abuse.
 */
export const uploadRateLimit = createRateLimit({
  windowMs: 60_000,
  max:      10,
  message:  'Upload rate limit exceeded.',
});

/**
 * General API: 200 per minute per IP.
 * Broad protection for all authenticated routes.
 */
export const generalRateLimit = createRateLimit({
  windowMs: 60_000,
  max:      200,
});
