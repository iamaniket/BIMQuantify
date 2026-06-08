import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { CachedInspection, QueueEntry } from './types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

interface OfflineDB extends DBSchema {
  inspectionCache: {
    key: [string, string]; // [projectId, momentId]
    value: CachedInspection;
  };
  offlineQueue: {
    key: number; // autoIncrement
    value: QueueEntry;
    indexes: {
      'by-status': string;
      'by-moment': string;
    };
  };
}

const DB_NAME = 'bimstitch-offline';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbPromise === null) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('inspectionCache')) {
          db.createObjectStore('inspectionCache');
        }

        if (!db.objectStoreNames.contains('offlineQueue')) {
          const queue = db.createObjectStore('offlineQueue', {
            keyPath: 'id',
            autoIncrement: true,
          });
          queue.createIndex('by-status', 'status');
          queue.createIndex('by-moment', 'momentId');
        }
      },
    });
  }
  return dbPromise;
}

export type { OfflineDB };
