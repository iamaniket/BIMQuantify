FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
# Copy web-ifc.wasm next to the compiled JS so the resolver finds it.
RUN cp node_modules/web-ifc/web-ifc.wasm ./dist/web-ifc.wasm \
    && cp node_modules/web-ifc/web-ifc-mt.wasm ./dist/web-ifc-mt.wasm 2>/dev/null || true
EXPOSE 8080
CMD ["node", "dist/index.js"]
