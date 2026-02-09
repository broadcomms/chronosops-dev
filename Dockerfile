# Stage 1: Build the application
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Install build dependencies for native modules (better-sqlite3, @napi-rs/canvas)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./

# Copy all package.json files for workspace resolution
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/gemini/package.json ./packages/gemini/
COPY packages/video/package.json ./packages/video/
COPY packages/vision/package.json ./packages/vision/
COPY packages/database/package.json ./packages/database/
COPY packages/kubernetes/package.json ./packages/kubernetes/
COPY packages/git/package.json ./packages/git/
COPY packages/grafana/package.json ./packages/grafana/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY apps ./apps

# Build all packages
RUN pnpm build

# Build the web frontend
RUN pnpm --filter @chronosops/web build

# Stage 2: Production image
FROM node:20-slim AS runner

# Install pnpm (needed for proper symlink resolution)
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Install runtime dependencies for native modules and FFmpeg
RUN apt-get update && apt-get install -y \
    # Canvas runtime dependencies
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    # Build tools for native module rebuilding
    python3 \
    make \
    g++ \
    # FFmpeg for frame extraction
    ffmpeg \
    # SQLite runtime
    libsqlite3-0 \
    # Curl for health checks
    curl \
    # CA certificates for HTTPS
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl for Kubernetes operations
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/kubectl

WORKDIR /app

# Copy package files and rebuilt dist files
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/gemini/package.json ./packages/gemini/
COPY --from=builder /app/packages/video/package.json ./packages/video/
COPY --from=builder /app/packages/vision/package.json ./packages/vision/
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/kubernetes/package.json ./packages/kubernetes/
COPY --from=builder /app/packages/git/package.json ./packages/git/
COPY --from=builder /app/packages/grafana/package.json ./packages/grafana/
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/web/package.json ./apps/web/

# Copy built packages (dist directories)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/gemini/dist ./packages/gemini/dist
COPY --from=builder /app/packages/video/dist ./packages/video/dist
COPY --from=builder /app/packages/vision/dist ./packages/vision/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/kubernetes/dist ./packages/kubernetes/dist
COPY --from=builder /app/packages/git/dist ./packages/git/dist
COPY --from=builder /app/packages/grafana/dist ./packages/grafana/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Install production dependencies fresh (creates proper symlinks)
RUN pnpm install --prod --frozen-lockfile

# Create data directory for SQLite and other storage
RUN mkdir -p /app/data /app/data/videos /app/data/evidence /app/data/postmortems \
    && chown -R node:node /app

# Switch to non-root user (node user has UID 1000)
USER node

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/chronosops.db
ENV EXECUTION_MODE=KUBERNETES
ENV K8S_DRY_RUN=false

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "apps/api/dist/index.js"]
