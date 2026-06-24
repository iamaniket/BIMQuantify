import * as SQLite from 'expo-sqlite';

import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

const DB_NAME = 'bimstitch_offline.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initDb(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execAsync(stmt);
  }
  await db.runAsync(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    String(SCHEMA_VERSION),
  );
}

/** Lazily open (and migrate) the single offline DB. Safe to call concurrently —
 * the promise is memoized so the schema runs exactly once. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await initDb(db);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Wipe every offline table. Called on logout / org-switch (Phase 4) — mandatory
 * on a shared, multi-tenant device so one tenant's cached data never survives
 * into another session. Does not drop the schema, only the rows.
 */
export async function wipeAllOfflineData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM cache_rows; DELETE FROM outbox; DELETE FROM sync_meta; DELETE FROM pinned_models;',
  );
}
