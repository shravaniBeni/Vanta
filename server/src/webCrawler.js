/**
 * server/src/webCrawler.js
 *
 * Real web crawler for the WebCrawler node.
 *
 * Strategy:
 *   - Uses Node native fetch (v22) — no external HTTP library needed
 *   - Uses cheerio for HTML text extraction
 *   - BFS crawl from a seed URL, respecting domain boundary
 *   - Extracts meaningful text (strips nav/header/footer/script/style)
 *   - Respects max_pages and depth_limit
 *   - Polite crawling: 300 ms delay between requests
 *   - 10-second timeout per page
 *   - Only follows HTTP/HTTPS links on the same origin
 *   - Returns structured results compatible with the ingestion pipeline
 *
 * Public API:
 *   crawlWebsite(params) → Promise<CrawlResult>
 *
 * @typedef {{ url: string, title: string, text: string, depth: number }} CrawledPage
 * @typedef {{
 *   pages: CrawledPage[],
 *   stats: { attempted: number, succeeded: number, failed: number, skipped: number },
 *   errors: string[],
 * }} CrawlResult
 */

import { load } from 'cheerio';

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000;
const POLITE_DELAY_MS    = 300;
const MAX_CONTENT_BYTES  = 2 * 1024 * 1024; // 2 MB per page — skip very large pages
const CRAWLABLE_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);

// HTML elements whose content is not useful for RAG
const STRIP_SELECTORS = [
  'script', 'style', 'noscript',
  'nav', 'header', 'footer',
  'aside', '.sidebar', '.navigation', '.menu',
  '.cookie-banner', '.ads', '.advertisement',
  '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
  'iframe', 'svg', 'canvas',
].join(', ');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    // Drop fragment — we treat same URL with different anchors as one page
    url.hash = '';
    // Only HTTP/HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function isSameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'Vanta-WebCrawler/1.0 (RAG knowledge ingestion; +https://vanta.ai)',
        'Accept':     'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    // Check content type
    const ct = res.headers.get('content-type') || '';
    const mimeType = ct.split(';')[0].trim().toLowerCase();
    if (!CRAWLABLE_MIME_TYPES.has(mimeType)) {
      return { ok: false, error: `Skipped (content-type: ${mimeType})` };
    }

    // Guard against huge pages
    const cl = parseInt(res.headers.get('content-length') || '0', 10);
    if (cl > MAX_CONTENT_BYTES) {
      return { ok: false, error: `Skipped (too large: ${cl} bytes)` };
    }

    const html = await res.text();
    return { ok: true, html, finalUrl: res.url };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout' : err.message };
  }
}

function extractContent(html, url) {
  const $ = load(html);

  // Extract title
  const title = ($('title').first().text() ||
                 $('h1').first().text() ||
                 $('meta[property="og:title"]').attr('content') || '')
    .trim().slice(0, 200);

  // Remove noisy elements
  $(STRIP_SELECTORS).remove();

  // Try to focus on main content
  const mainSelectors = ['main', 'article', '[role="main"]', '#content', '.content', '#main', '.main'];
  let contentEl = null;
  for (const sel of mainSelectors) {
    if ($(sel).length > 0) { contentEl = $(sel).first(); break; }
  }
  const target = contentEl || $('body');

  // Extract clean text
  const text = target
    .text()
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract links
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, url);
    if (normalized) links.push(normalized);
  });

  return { title, text, links: [...new Set(links)] };
}

// ─── Main crawler ─────────────────────────────────────────────────────────────

/**
 * Crawl a website and extract text from pages.
 *
 * @param {{
 *   url: string,           — seed URL to start from
 *   max_pages?: number,    — max pages to crawl (default 10, max 50)
 *   depth_limit?: number,  — max link depth from seed (default 2, max 5)
 *   same_domain?: boolean, — restrict to same origin (default true)
 *   include_patterns?: string[], — URL substrings that must be present (optional)
 *   exclude_patterns?: string[], — URL substrings to skip (optional)
 * }} params
 *
 * @returns {Promise<CrawlResult>}
 */
export async function crawlWebsite({
  url: seedUrl,
  max_pages       = 10,
  depth_limit     = 2,
  same_domain     = true,
  include_patterns = [],
  exclude_patterns = [],
} = {}) {
  // Clamp limits for safety
  const maxPages  = Math.max(1, Math.min(50, max_pages));
  const maxDepth  = Math.max(0, Math.min(5, depth_limit));

  const pages  = [];
  const errors = [];
  const stats  = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };

  const visited  = new Set();
  // Queue: { url, depth }
  const queue = [{ url: seedUrl, depth: 0 }];

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift();

    // Already visited or over depth
    if (visited.has(url)) { stats.skipped++; continue; }
    if (depth > maxDepth)  { stats.skipped++; continue; }

    // Domain check
    if (same_domain && !isSameOrigin(url, seedUrl)) { stats.skipped++; continue; }

    // Pattern filters
    if (include_patterns.length > 0 && !include_patterns.some(p => url.includes(p))) {
      stats.skipped++; continue;
    }
    if (exclude_patterns.some(p => url.includes(p))) { stats.skipped++; continue; }

    visited.add(url);
    stats.attempted++;

    console.log(`[webCrawler] fetching depth=${depth} url=${url}`);

    const result = await fetchPage(url);

    if (!result.ok) {
      stats.failed++;
      errors.push(`${url}: ${result.error}`);
      await _delay(POLITE_DELAY_MS);
      continue;
    }

    const { title, text, links } = extractContent(result.html, result.finalUrl || url);

    // Skip pages with no meaningful text
    if (text.trim().length < 50) {
      stats.skipped++;
      await _delay(POLITE_DELAY_MS);
      continue;
    }

    stats.succeeded++;
    pages.push({
      url:   result.finalUrl || url,
      title: title || url,
      text:  text.slice(0, 50_000), // cap at 50k chars per page
      depth,
    });

    // Enqueue discovered links
    if (depth < maxDepth) {
      for (const link of links) {
        if (!visited.has(link)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }

    await _delay(POLITE_DELAY_MS);
  }

  console.log(
    `[webCrawler] done — pages=${pages.length} attempted=${stats.attempted} ` +
    `failed=${stats.failed} skipped=${stats.skipped}`
  );

  return { pages, stats, errors };
}

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
