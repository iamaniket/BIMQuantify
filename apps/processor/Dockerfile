# Build stage — TypeScript compile only.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage — bookworm-slim because we need glibc + Chromium for
# Puppeteer-driven PDF rendering. Alpine + chromium has poor font rendering
# (Dutch diacritics in WKB rule titles fall back to tofu).
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

# System deps:
#  * chromium             — headless browser for HTML→PDF
#  * fonts-liberation     — generic Helvetica/Times/Courier replacement
#  * fonts-noto + emoji   — Dutch diacritics, broad Unicode coverage
#  * ca-certificates      — TLS for outbound API/S3 calls
#  * dumb-init            — proper signal forwarding to node
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       fonts-noto \
       fonts-noto-color-emoji \
       ca-certificates \
       dumb-init \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Copy web-ifc.wasm next to the compiled JS so the resolver finds it. The
# IFC pipeline still loads on glibc.
RUN cp node_modules/web-ifc/web-ifc.wasm ./dist/web-ifc.wasm \
    && cp node_modules/web-ifc/web-ifc-mt.wasm ./dist/web-ifc-mt.wasm 2>/dev/null || true

EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
