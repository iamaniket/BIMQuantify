# import-export

Generic Node.js worker that handles all of BIMstitch's heavy / async work
queued out of the API: IFC parsing, PDF metadata extraction, and (added in
the PDF Generation milestone) PDF report generation. Originally landed as
"extractor" — renamed when scope grew beyond IFC. The same Fastify producer
+ BullMQ worker shape is reused for every job type; the worker dispatches
on `job.data.job_type`.

## Architecture

```
apps/api ──HTTP POST /jobs──▶ import-export ──BullMQ──▶ worker
                                                          │
                                                          ▼
                            ┌─────────────────────────────┴───┐
                            │ ifc_extraction  → web-ifc + frags│
                            │ pdf_extraction  → pdfjs-dist     │
                            │ compliance_report → puppeteer    │
                            └─────────────────┬────────────────┘
                                              │
                                              ▼
                                           MinIO
                                              │
                                              ▼
                  import-export ──HTTP POST /internal/jobs/callback──▶ apps/api
```

Producer (`POST /jobs`) and consumer (BullMQ Worker) run in the same Node
process for now. Split if/when scale demands.

Queue name is plain `'jobs'` — one queue, multiple job types differentiated
by the `job_type` field on the payload. BullMQ retry/backoff config in
`src/queue/queue.ts`.

## Local dev

```bash
# Make sure the rest of the stack is up.
docker compose up -d postgres redis minio mailhog

# Install + run.
cd apps/import-export
npm install
npm run dev   # tsx watch on src/index.ts
```

The service listens on `PORT` (default `8080`). The API talks to it via
`IMPORT_EXPORT_URL` (defaults to `http://localhost:8088` in api/.env.example —
that's the published port from docker-compose; map accordingly when running
the worker outside Docker).

The worker calls back to `${API_BASE_URL}/internal/jobs/callback`
with `Authorization: Bearer ${IMPORT_EXPORT_SHARED_SECRET}`. When running
this service inside Docker but the API on the host, set
`API_BASE_URL=http://host.docker.internal:8000`.

## Tests

```bash
npm test
```

Vitest with one fixture-driven test that runs each pipeline end-to-end
against tiny inputs. S3 + the API callback are stubbed so the test needs no
running services.

## Schema gate

The IFC pipeline enforces `IFC2X3 / IFC4 / IFC4X3` only. Anything else is
failed with `UNSUPPORTED_SCHEMA: <schema>`. The API's header parser already
filters at upload time, so this is defence in depth.
