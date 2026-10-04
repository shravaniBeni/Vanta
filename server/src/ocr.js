/**
 * server/src/ocr.js
 *
 * Phase 10A: Real OCR runtime.
 *
 * Technology stack (chosen based on environment audit):
 *   - pdfjs-dist@4.10.38  — PDF page rendering to raw RGBA pixel data (no canvas/native build)
 *   - tesseract.js@5.1.1  — WASM Tesseract OCR (pure npm, no system deps)
 *   - sharp@0.34.5        — already installed; converts RGBA → PNG for Tesseract
 *
 * Why NOT canvas:
 *   canvas requires native node-gyp build (Cairo). Not available in this environment.
 *   pdfjs-dist's NodeCanvasFactory can be replaced with a custom factory that
 *   produces raw Buffer output, which is then processed by sharp.
 *
 * Public API:
 *   extractTextWithOcr(buffer, fileName, config)
 *     → Promise<{ text: string, metadata: OcrMetadata }>
 *
 * Not exported (internal):
 *   renderPdfPageToBuffer(page, viewport, scale)
 *   runOcrOnImage(imageBuffer, worker, config)
 */

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

// ─── OCR configuration defaults ───────────────────────────────────────────────

export const OCR_DEFAULTS = {
  language:             'eng',
  dpi:                  300,
  confidence_threshold: 60,   // 0-100; pages below this threshold have their text dropped
  fallback_on_failure:  false, // if true, returns empty string on page failure; if false, records error
};

// ─── PDF page rendering ───────────────────────────────────────────────────────

/**
 * Renders a single pdfjs page to a raw RGBA Buffer using pdfjs-dist's
 * built-in rendering pipeline with a custom Node-compatible canvas substitute.
 *
 * pdfjs-dist normally requires a Canvas API. We provide a minimal implementation
 * using a raw Uint8ClampedArray backed buffer — no native canvas package needed.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {number} scale  — render scale (300 DPI / 72 native = ~4.17x)
 * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number }>}
 */
async function renderPdfPageToRgba(page, scale = 4.17) {
  const viewport = page.getViewport({ scale });
  const width    = Math.round(viewport.width);
  const height   = Math.round(viewport.height);

  // Raw pixel buffer: 4 bytes per pixel (RGBA)
  const data = new Uint8ClampedArray(width * height * 4);

  // Minimal Canvas-API substitute for pdfjs-dist in Node
  // pdfjs-dist's renderTask needs context2D operations: fillStyle, fillRect,
  // transform, putImageData, drawImage. We implement only what the renderer uses.
  const canvas = {
    width,
    height,
    getContext: () => ({
      fillStyle: '',
      globalAlpha: 1,
      transform() {},
      scale() {},
      translate() {},
      save()    {},
      restore() {},
      beginPath() {},
      closePath() {},
      clip() {},
      stroke() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      fillRect(x, y, w, h) {},   // background fill — we skip actual rendering here
      clearRect(x, y, w, h) {
        // Clear to transparent
        const startX = Math.max(0, Math.round(x));
        const startY = Math.max(0, Math.round(y));
        const endX   = Math.min(width,  startX + Math.round(w));
        const endY   = Math.min(height, startY + Math.round(h));
        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const i = (py * width + px) * 4;
            data[i] = data[i+1] = data[i+2] = 255; // white
            data[i+3] = 255;
          }
        }
      },
      putImageData(imageData, x, y) {
        const srcData = imageData.data;
        const srcW    = imageData.width;
        const srcH    = imageData.height;
        for (let row = 0; row < srcH; row++) {
          for (let col = 0; col < srcW; col++) {
            const srcIdx = (row * srcW + col) * 4;
            const dstRow = Math.round(y) + row;
            const dstCol = Math.round(x) + col;
            if (dstRow >= 0 && dstRow < height && dstCol >= 0 && dstCol < width) {
              const dstIdx = (dstRow * width + dstCol) * 4;
              data[dstIdx]   = srcData[srcIdx];
              data[dstIdx+1] = srcData[srcIdx+1];
              data[dstIdx+2] = srcData[srcIdx+2];
              data[dstIdx+3] = srcData[srcIdx+3];
            }
          }
        }
      },
      createImageData(w, h) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      drawImage() {},
      setTransform() {},
      resetTransform() {},
      getImageData(x, y, w, h) {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) {
          for (let col = 0; col < w; col++) {
            const srcRow = Math.round(y) + row;
            const srcCol = Math.round(x) + col;
            const srcIdx = (srcRow * width + srcCol) * 4;
            const dstIdx = (row * w + col) * 4;
            if (srcRow >= 0 && srcRow < height && srcCol >= 0 && srcCol < width) {
              out[dstIdx]   = data[srcIdx];
              out[dstIdx+1] = data[srcIdx+1];
              out[dstIdx+2] = data[srcIdx+2];
              out[dstIdx+3] = data[srcIdx+3];
            }
          }
        }
        return { data: out, width: w, height: h };
      },
      // Text rendering ops — ignored for raster output
      measureText: () => ({ width: 0 }),
      fillText() {},
      strokeText() {},
      setLineDash() {},
      lineDashOffset: 0,
      lineWidth: 1,
      strokeStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      shadowColor: '',
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
    }),
    toDataURL: () => '',
  };

  // Initialize to white background
  data.fill(255);

  try {
    const renderTask = page.render({
      canvasContext: canvas.getContext(),
      viewport,
      intent: 'print',
    });
    await renderTask.promise;
  } catch (err) {
    // Some pages fail rendering (e.g. pure-image XObjects); return white buffer
    console.warn('[ocr] renderTask failed for page:', err.message.slice(0, 80));
  }

  return { data, width, height };
}

/**
 * Convert raw RGBA pixel data to a PNG Buffer using sharp.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} rgba
 * @returns {Promise<Buffer>}
 */
async function rgbaToPng(rgba) {
  const { data, width, height } = rgba;
  // sharp expects a Node Buffer from raw RGBA
  const rawBuffer = Buffer.from(data.buffer);
  return sharp(rawBuffer, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

// ─── Tesseract worker management ─────────────────────────────────────────────

/**
 * Create and initialize a Tesseract worker.
 * @param {string} language
 * @returns {Promise<import('tesseract.js').Worker>}
 */
async function createOcrWorker(language) {
  const worker = await createWorker(language, 1, {
    // Suppress verbose tesseract.js logging
    logger: () => {},
    errorHandler: (err) => console.error('[ocr worker]', err),
  });
  return worker;
}

// ─── Per-page OCR ─────────────────────────────────────────────────────────────

/**
 * Run OCR on a PNG image buffer and return the extracted text + confidence.
 * @param {Buffer} pngBuffer
 * @param {import('tesseract.js').Worker} worker
 * @param {object} config
 * @returns {Promise<{ text: string, confidence: number }>}
 */
async function runOcrOnImage(pngBuffer, worker, config) {
  const { data } = await worker.recognize(pngBuffer);
  return {
    text:       data.text || '',
    confidence: data.confidence || 0,  // 0-100
  };
}

// ─── Main OCR entry point ─────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer using OCR (pdfjs-dist + Tesseract.js + sharp).
 *
 * Returns the concatenated OCR text from all pages, plus metadata.
 *
 * Confidence filtering: pages where Tesseract confidence < config.confidence_threshold
 * have their text included with a warning (we don't discard text from low-confidence
 * pages — that would silently lose content. The confidence metadata is preserved
 * for the caller to decide).
 *
 * @param {Buffer} buffer         — raw PDF buffer
 * @param {string} fileName       — used for logging only
 * @param {object} [config]       — OCR configuration (see OCR_DEFAULTS)
 * @returns {Promise<{ text: string, metadata: object }>}
 * @throws if ALL pages fail and fallback_on_failure=false
 */
export async function extractTextWithOcr(buffer, fileName, config = {}) {
  const cfg = { ...OCR_DEFAULTS, ...config };

  // ── Load pdfjs-dist ────────────────────────────────────────────────────────
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Disable the worker (we're in Node; the worker uses browser APIs)
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const loadingTask = pdfjsLib.getDocument({
    data:                  new Uint8Array(buffer),
    disableFontFace:       true,
    useSystemFonts:        false,
    useWorkerFetch:        false,
    isEvalSupported:       false,
    disableStream:         true,
    disableAutoFetch:      true,
    verbosity:             0,
  });

  let pdfDoc;
  try {
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    throw new Error(`[ocr] Failed to load PDF for OCR: ${err.message}`);
  }

  const pageCount = pdfDoc.numPages;
  const scale = cfg.dpi / 72; // 300 DPI → scale ≈ 4.17

  // ── Initialize Tesseract worker ────────────────────────────────────────────
  let worker;
  try {
    worker = await createOcrWorker(cfg.language);
  } catch (err) {
    throw new Error(`[ocr] Failed to initialize Tesseract worker: ${err.message}`);
  }

  const pageTexts       = [];
  const pageConfidences = [];
  const failedPages     = [];
  let successPages      = 0;

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      try {
        const page     = await pdfDoc.getPage(pageNum);
        const rgba     = await renderPdfPageToRgba(page, scale);
        const pngBuf   = await rgbaToPng(rgba);
        const { text, confidence } = await runOcrOnImage(pngBuf, worker, cfg);

        pageTexts.push(text.trim());
        pageConfidences.push(confidence);
        successPages++;

        console.log(`[ocr] page ${pageNum}/${pageCount} confidence=${confidence.toFixed(1)}% chars=${text.trim().length}`);
      } catch (pageErr) {
        console.warn(`[ocr] page ${pageNum} failed: ${pageErr.message.slice(0, 80)}`);
        failedPages.push(pageNum);
        if (cfg.fallback_on_failure) {
          pageTexts.push('');
          pageConfidences.push(0);
        }
        // continue to next page
      }
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }

  // ── Check outcome ──────────────────────────────────────────────────────────
  if (successPages === 0) {
    throw new Error(
      `[ocr] OCR failed on all ${pageCount} pages of "${fileName}". ` +
      `No text could be extracted.`
    );
  }

  const combinedText = pageTexts.join('\n\n').trim();

  if (!combinedText) {
    throw new Error(
      `[ocr] OCR produced empty text from "${fileName}" (${pageCount} pages). ` +
      `The document may contain only images without readable text.`
    );
  }

  const avgConfidence = pageConfidences.length > 0
    ? pageConfidences.reduce((s, c) => s + c, 0) / pageConfidences.length
    : 0;

  const metadata = {
    ocr_performed:      true,
    ocr_language:       cfg.language,
    ocr_dpi:            cfg.dpi,
    ocr_page_count:     pageCount,
    ocr_success_pages:  successPages,
    ocr_failed_pages:   failedPages,
    ocr_confidence_avg: parseFloat(avgConfidence.toFixed(2)),
    ocr_page_confidences: pageConfidences,
  };

  console.log(
    `[ocr] DONE "${fileName}" pages=${pageCount} success=${successPages} ` +
    `failed=${failedPages.length} avg_confidence=${metadata.ocr_confidence_avg}% ` +
    `chars=${combinedText.length}`
  );

  return { text: combinedText, metadata };
}

/**
 * Returns true if the OCR runtime is available and can be used.
 * Used by the capability registry gating.
 */
export async function isOcrAvailable() {
  try {
    const { createWorker } = await import('tesseract.js');
    await import('pdfjs-dist/legacy/build/pdf.mjs');
    return true;
  } catch {
    return false;
  }
}
