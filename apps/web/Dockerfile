# syntax=docker/dockerfile:1
#
# BimDossier marketing site (apps/web) — Next.js 16, standalone output.
#
# IMPORTANT: build from the REPO ROOT, not apps/web — the app depends on pnpm
# workspace packages (@bimdossier/*) that must be installed and built too:
#     docker build -f apps/web/Dockerfile -t bimdossier-web .
# (docker compose sets `context: .` for this reason.)
#
# NEXT_PUBLIC_* values are inlined into the CLIENT bundle at BUILD time, so the
# deploy-specific ones are ARGs below. The server-evaluated ones (next.config
# headers/redirects) are ALSO read at runtime — compose passes them as both
# build args and `environment`. Override per environment.

# ---- base: Node + pnpm (version pinned via corepack from package.json) ------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ---- builder: install the whole workspace, build web + its deps -------------
FROM base AS builder
# .dockerignore prunes node_modules/.next/.git from the context.
COPY . .
# Cache mount keeps the pnpm content-addressable store warm across builds.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build-time public config (baked into the client bundle). Defaults suit the
# local docker-compose stack; production overrides via --build-arg / compose.
ARG NEXT_PUBLIC_STANDALONE=false
ARG NEXT_PUBLIC_PORTAL_URL=http://localhost:3001
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_STORAGE_URL=http://localhost:9000
ARG NEXT_PUBLIC_ENABLE_LOGIN=false
ARG NEXT_PUBLIC_ENABLE_SIGNUP=false
ARG NEXT_PUBLIC_ENABLE_REQUEST_ACCESS=false
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
ENV NEXT_PUBLIC_STANDALONE=$NEXT_PUBLIC_STANDALONE \
    NEXT_PUBLIC_PORTAL_URL=$NEXT_PUBLIC_PORTAL_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL \
    NEXT_PUBLIC_ENABLE_LOGIN=$NEXT_PUBLIC_ENABLE_LOGIN \
    NEXT_PUBLIC_ENABLE_SIGNUP=$NEXT_PUBLIC_ENABLE_SIGNUP \
    NEXT_PUBLIC_ENABLE_REQUEST_ACCESS=$NEXT_PUBLIC_ENABLE_REQUEST_ACCESS \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

# turbo builds the @bimdossier/* deps first (^build), then `next build`.
# The prebuild hook stages the fragments worker + brand assets into public/.
RUN pnpm exec turbo run build --filter=web

# ---- runtime: minimal standalone server -------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# dumb-init: correct PID-1 signal forwarding. curl: container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output is rooted at the monorepo root (outputFileTracingRoot), so
# it lays down /repo/apps/web/server.js + a pruned /repo/node_modules. The
# static assets and public/ dir are copied alongside it (Next does not bundle
# those into standalone).
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
