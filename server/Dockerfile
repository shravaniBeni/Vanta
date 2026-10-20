# ─────────────────────────────────────────────────────────────────────────────
# Vanta Server — Production Dockerfile
# Target: linux/amd64 (AWS ECS Fargate, Railway, Render)
#
# Build strategy: MODEL BAKED INTO IMAGE
#   The Xenova/bge-small-en-v1.5 ONNX weights (~127 MB) are downloaded once
#   during `docker build` and written to /app/data/model-cache.
#   This means:
#     + Container starts in ~0.5s (warm cache, no download needed)
#     + No outbound HuggingFace traffic at runtime
#     + No EFS/EBS volume dependency for the model
#     - Image is ~600 MB instead of ~450 MB (127 MB model overhead)
#     - Rebuilding the image redownloads the model (acceptable: rare)
#
#   ALTERNATIVE: Runtime download (comment out the BAKE step below)
#     Pro: smaller image (~450 MB)
#     Con: 30s download on every cold container start; download fails = crash
#     Suitable only when TRANSFORMERS_CACHE points to a persistent EFS mount.
#
# sharp native binaries:
#   npm install on linux/amd64 automatically installs @img/sharp-linux-x64.
#   The Windows build on the developer machine (@img/sharp-win32-x64) is
#   excluded by .dockerignore — never copied into the image.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install production dependencies on the correct target platform.
# node:22-slim is Debian bookworm-slim (~200 MB) with Node.js 22 LTS.
# We use --platform=linux/amd64 explicitly so the image can be built on
# Apple Silicon (M1/M2) macs or Windows ARM without cross-compilation issues.

FROM --platform=linux/amd64 node:22-slim AS deps

WORKDIR /app

# Install OS packages needed for native deps:
#   python3, make, g++ — node-gyp (required by some optional deps)
#   libvips-dev         — required by @img/sharp-linux-x64 prebuilt binary
# libvips is included in the @img/sharp-libvips-linux-x64 npm package on
# Node 18+, so system libvips is usually not required. Keep as safety net.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only the package files first so the layer is cached unless deps change
COPY package.json package-lock.json* ./

# Install production deps only — devDependencies excluded.
# sharp will automatically install @img/sharp-linux-x64 (correct platform).
# SHARP_IGNORE_GLOBAL_LIBVIPS=1 forces sharp to use its bundled libvips.
RUN npm ci --omit=dev \
    && npm cache clean --force

# ── Stage 2: bake model ────────────────────────────────────────────────────────
# Download and cache Xenova/bge-small-en-v1.5 ONNX weights.
# Runs during docker build — the result is ~127 MB in /app/data/model-cache.
# Uses the same node:22-slim base so the Node.js runtime matches.

FROM --platform=linux/amd64 node:22-slim AS model-bake

WORKDIR /app

# Copy only what the bake script needs
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts/bake-model.mjs ./scripts/bake-model.mjs

# Download model weights to /app/data/model-cache
# Build arg: SKIP_MODEL_BAKE=1 disables this for faster local testing
ARG SKIP_MODEL_BAKE=0
RUN if [ "$SKIP_MODEL_BAKE" = "0" ]; then \
      node --experimental-vm-modules scripts/bake-model.mjs; \
    fi

# ── Stage 3: final image ───────────────────────────────────────────────────────

FROM --platform=linux/amd64 node:22-slim AS final

WORKDIR /app

# Runtime OS packages (minimal — no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Copy production deps (linux/amd64 binaries, including sharp)
COPY --from=deps /app/node_modules ./node_modules

# Copy baked model cache
COPY --from=model-bake /app/data/model-cache ./data/model-cache

# Copy application source
COPY src ./src
COPY package.json ./

# ── Runtime configuration ─────────────────────────────────────────────────────
# All secrets must be injected at runtime via environment variables.
# Never bake .env into the image.

ENV NODE_ENV=production
ENV PORT=3001
# Point to the baked model cache inside the container
ENV TRANSFORMERS_CACHE=/app/data/model-cache
# USE_HF_API defaults to unset (local ONNX inference)

# ── Health check ───────────────────────────────────────────────────────────────
# NOTE: Container-level HEALTHCHECK removed.
# ECS/ALB target group health check is used instead (path: /api/health, port 3001).
# The ALB health check is configured at the load balancer level, not inside the container.
# This avoids the startPeriod vs healthCheckGracePeriodSeconds conflict.

EXPOSE 3001

# dumb-init: proper PID 1 signal handling (forwards SIGTERM to Node process)
# Ensures graceful shutdown in ECS task replacement.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
