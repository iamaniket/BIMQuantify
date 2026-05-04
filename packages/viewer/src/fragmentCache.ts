const DB_NAME = 'bimstitch-viewer';
const STORE_NAME = 'fragments';
const DB_VERSION = 1;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB

interface CacheEntry {
  key: string;
  bytes: Uint8Array;
  size: number;
  accessedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCached(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const get = store.get(key);
      get.onsuccess = () => {
        const entry = get.result as CacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        entry.accessedAt = Date.now();
        store.put(entry);
        resolve(entry.bytes);
      };
      get.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCached(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await openDB();
    await evictIfNeeded(db, bytes.byteLength);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: CacheEntry = {
        key,
        bytes,
        size: bytes.byteLength,
        accessedAt: Date.now(),
      };
      const put = store.put(entry);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    });
  } catch {
    // Cache write failure is non-critical
  }
}

async function evictIfNeeded(db: IDBDatabase, incomingSize: number): Promise<void> {
  const entries = await getAllEntries(db);
  let totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const target = MAX_TOTAL_BYTES - incomingSize;

  if (totalSize <= target) return;

  // Sort by accessedAt ascending (oldest first)
  entries.sort((a, b) => a.accessedAt - b.accessedAt);

  const keysToDelete: string[] = [];
  for (const entry of entries) {
    if (totalSize <= target) break;
    keysToDelete.push(entry.key);
    totalSize -= entry.size;
  }

  if (keysToDelete.length === 0) return;

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const k of keysToDelete) {
      store.delete(k);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function getAllEntries(db: IDBDatabase): Promise<Pick<CacheEntry, 'key' | 'size' | 'accessedAt'>[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = (request.result as CacheEntry[]).map(({ key, size, accessedAt }) => ({
        key,
        size,
        accessedAt,
      }));
      resolve(results);
    };
    request.onerror = () => resolve([]);
  });
}
