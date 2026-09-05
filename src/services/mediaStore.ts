/**
 * IndexedDB 二进制文件仓库（与 VFS 文本流分开）
 *
 * 用途：图片（Gallery）、未来音频 blob、其他二进制
 * - 异步 API、Promise 风格
 * - 单 object store + key 索引
 * - 上限：浏览器分配，常见 50MB-2GB
 */

const DB_NAME = 'arch-web-media';
const DB_VERSION = 1;
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export interface BlobRecord {
  key: string;
  blob: Blob;
  name?: string;
  addedAt?: number;
}

function tx(mode: IDBTransactionMode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function putBlob(record: BlobRecord): Promise<void> {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(record);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function putBlobs(records: BlobRecord[]): Promise<void> {
  if (records.length === 0) return;
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    records.forEach((r) => store.put(r));
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getBlob(key: string): Promise<BlobRecord | null> {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve((r.result as BlobRecord) ?? null);
    r.onerror = () => reject(r.error);
  });
}

export async function listBlobs(): Promise<BlobRecord[]> {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const out: BlobRecord[] = [];
    const r = store.openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (c) {
        out.push(c.value as BlobRecord);
        c.continue();
      } else {
        resolve(out);
      }
    };
    r.onerror = () => reject(r.error);
  });
}

export async function deleteBlob(key: string): Promise<void> {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function countBlobs(): Promise<number> {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const r = store.count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
