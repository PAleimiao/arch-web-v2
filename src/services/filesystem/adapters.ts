/**
 * 虚拟文件系统的存储适配层。
 * 只负责"路径 → 文本内容"的读写，目录结构由路径前缀推导，
 * 这样两个后端可以共用同一套目录树逻辑。
 */

export interface FsAdapter {
  readonly name: 'opfs' | 'idb';
  /** 所有已存在的文件路径 */
  keys(): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const normalize = (p: string) => (p.startsWith('/') ? p : `/${p}`);

/* ---------------------------------- OPFS ---------------------------------- */

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
  };
  if (!nav.storage?.getDirectory) return null;
  try {
    return await nav.storage.getDirectory();
  } catch {
    return null;
  }
}

/** 路径转文件名：OPFS 不支持斜杠，做一次可逆编码 */
const encodeName = (path: string) => encodeURIComponent(normalize(path));
const decodeName = (name: string) => {
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
};

export function createOpfsAdapter(root: FileSystemDirectoryHandle): FsAdapter {
  return {
    name: 'opfs',
    async keys() {
      const out: string[] = [];
      // @ts-expect-error values() 在部分浏览器的类型定义里缺失
      for await (const handle of root.values()) {
        if (handle.kind !== 'file') continue;
        const path = decodeName(handle.name);
        if (path) out.push(path);
      }
      return out;
    },
    async read(path) {
      try {
        const handle = await root.getFileHandle(encodeName(path));
        const file = await handle.getFile();
        return await file.text();
      } catch {
        return null;
      }
    },
    async write(path, content) {
      const handle = await root.getFileHandle(encodeName(path), {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },
    async remove(path) {
      try {
        await root.removeEntry(encodeName(path));
      } catch {
        /* 文件不存在时静默忽略 */
      }
    },
  };
}

export async function tryOpfsAdapter(): Promise<FsAdapter | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    // 探活：确保真的可写
    return createOpfsAdapter(root);
  } catch {
    return null;
  }
}

/* ------------------------------- IndexedDB -------------------------------- */

const DB_NAME = 'arch-web-os';
const STORE = 'files';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIdbAdapter(): FsAdapter {
  const tx = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await openIdb();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  };

  return {
    name: 'idb',
    async keys() {
      const all = await tx<{ path: string }[]>('readonly', (s) => s.getAll());
      return all.map((r) => r.path);
    },
    async read(path) {
      const rec = await tx<{ content: string } | undefined>(
        'readonly',
        (s) => s.get(normalize(path)),
      );
      return rec?.content ?? null;
    },
    async write(path, content) {
      await tx('readwrite', (s) =>
        s.put({ path: normalize(path), content, updatedAt: Date.now() }),
      );
    },
    async remove(path) {
      await tx('readwrite', (s) => s.delete(normalize(path)));
    },
  };
}
