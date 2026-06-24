// Full offline schema, defined up-front so later phases (outbox, pinned models)
// add no migration. Phase 3 only reads/writes `cache_rows`; `outbox`,
// `sync_meta`, and `pinned_models` are populated by Phases 4/5/7.

export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  // Read mirror for browse-offline. One row per cached entity instance, keyed by
  // (entity, scope, id); `seq` preserves the server's list order, `data` is the
  // full JSON payload, `server_updated_at` is the conflict baseline (Phase 6).
  `CREATE TABLE IF NOT EXISTS cache_rows (
     entity TEXT NOT NULL,
     scope TEXT NOT NULL,
     id TEXT NOT NULL,
     seq INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL,
     server_updated_at TEXT,
     cached_at INTEGER NOT NULL,
     PRIMARY KEY (entity, scope, id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_cache_rows_scope ON cache_rows (entity, scope, seq)`,

  // Write outbox (Phase 4+). temp_id is the client-minted finding/photo id used
  // for optimistic UI + later server-id remap; idempotency_key is sent to the
  // server so a replay is deduped; depends_on links a finding create to its
  // photo uploads.
  `CREATE TABLE IF NOT EXISTS outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     temp_id TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     scope TEXT NOT NULL,
     payload TEXT NOT NULL,
     base_updated_at TEXT,
     depends_on TEXT,
     conflict_json TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_outbox_status ON outbox (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_outbox_scope ON outbox (scope)`,

  // Misc per-key sync bookkeeping (Phase 4+).
  `CREATE TABLE IF NOT EXISTS sync_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  // Pinned models for the offline viewer (Phase 7). `manifest` is the JSON of
  // local artifact file:// paths; `cache_key` matches the embed's IndexedDB key.
  `CREATE TABLE IF NOT EXISTS pinned_models (
     file_id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     model_id TEXT NOT NULL,
     cache_key TEXT,
     manifest TEXT NOT NULL,
     size_bytes INTEGER NOT NULL DEFAULT 0,
     pinned_at INTEGER NOT NULL
   )`,
];
