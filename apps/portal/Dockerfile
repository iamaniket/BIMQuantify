# syntax=docker/dockerfile:1
#
# BimDossier portal (apps/portal) — Next.js 16, standalone output.
#
# IMPORTANT: build from the REPO ROOT, not apps/portal — the app depends on pnpm
# workspace packages (@bimdossier/*) that must be installed and built too:
#     docker build -f apps/portal/Dockerfile -t bimdossier-portal .
# (docker compose sets `context: .` for this reason.)
#
# NEXT_PUBLIC_* values are inlined into the CLIENT bundle at BUILD time, so they
# are ARGs below. These are BROWSER-facing origins (the user's browser calls the
# API/storage directly), so they must be the public/host URLs — NOT the internal
# docker service names. NEXT_PUBLIC_API_URL is REQUIRED in production (lib/env.ts
# fails the build if unset outside dev). The CSP in next.config also reads
# NEXT_PUBLIC_API_URL / NEXT_PUBLIC_STORAGE_URL at runtime — compose passes them
# as both build args and `environment`.

# ---- base: Node + pnpm (version pinned via corepack from package.json) ------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ---- builder: install the whole workspace, build portal + its deps ----------
FROM base AS builder
# .dockerignore prunes node_modules/.next/.git from the context.
COPY . .
# Cache mount keeps the pnpm content-addressable store warm across builds.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build-time public config (baked into the client bundle). Defaults suit the
# local docker-compose stack; production overrides via --build-arg / compose.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_STORAGE_URL=http://localhost:9000
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

# turbo builds the @bimdossier/* deps first (^build), then `next build`. The
# prebuild hook stages web-ifc.wasm + fragments worker + brand assets into
# public/. Sentry source-map upload is skipped unless SENTRY_DSN is set.
RUN pnpm exec turbo run build --filter=portal

# ---- runtime: minimal standalone server -------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# dumb-init: correct PID-1 signal forwarding. curl: container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output is rooted at the monorepo root (outputFileTracingRoot), so
# it lays down /repo/apps/portal/server.js + a pruned /repo/node_modules. The
# static assets and public/ dir (incl. the copied web-ifc.wasm + fragments
# worker) are copied alongside it.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/public ./apps/portal/public

USER nextjs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/ || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/portal/server.js"]
