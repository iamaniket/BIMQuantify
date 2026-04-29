# extractor

Standalone Node.js service that turns IFC uploads into ThatOpen `.frag`
bundles plus structured metadata, then calls back into `apps/api` so the
file row can transition `queued → running → succeeded|failed`.

## Architecture

```
apps/api ──HTTP POST /jobs──▶ extractor ──BullMQ──▶ worker
                                                      │
                                                      ▼
                          web-ifc + @thatopen/fragments
                                                      │
                          ┌───────────────────────────┘
                          ▼
                       MinIO
                       (.frag, .metadata.json, .properties.json)
                          │
                          ▼
              extractor ──HTTP POST callback──▶ apps/api
```

Producer (`POST /jobs`) and consumer (BullMQ Worker) run in the same Node
process for now. Split if/when scale demands.

## Local dev

```bash
# Make sure the rest of the stack is up.
docker compose up -d postgres redis minio mailhog

# Install + run.
cd apps/extractor
npm install
npm run dev   # tsx watch on src/index.ts
```

The service listens on `PORT` (default `8080`). The API talks to it via
`EXTRACTOR_URL` (defaults to `http://localhost:8088` in api/.env.example —
that's the published port from docker-compose; map accordingly when running
the extractor outside Docker).

The extractor calls back to `${API_BASE_URL}/internal/extraction/callback`
with `Authorization: Bearer ${EXTRACTOR_SHARED_SECRET}`. When running this
service inside Docker but the API on the host, set
`API_BASE_URL=http://host.docker.internal:8000`.

## Tests

```bash
npm test
```

Vitest with one fixture-driven test that runs the pipeline end-to-end against
a tiny IFC file. S3 + the API callback are stubbed so the test needs no
running services.

## Schema gate

The extractor enforces `IFC2X3 / IFC4 / IFC4X3` only. Anything else is failed
with `UNSUPPORTED_SCHEMA: <schema>`. The API's header parser already filters
at upload time, so this is defence in depth.
