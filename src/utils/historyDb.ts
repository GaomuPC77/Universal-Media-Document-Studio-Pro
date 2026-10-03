// IndexedDB storage matching the reference architecture
const DB_NAME = 'DocStudioPro_Storage_v2';
const STORE_NAME = 'history_files';
const PENDING_STORE_NAME = 'pending_files';

export interface HistoryItem {
  id: string;
  originalName: string;
  fileName: string;
  data: ArrayBuffer;
  format: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface StoredPendingFile {
  id: string;
  name: string;
  size: number;
  type: string;
  format: string;
  targetFormat: string;
  data: ArrayBuffer;
  date: number;
}

let dbInstance: IDBDatabase | null = null;

export async function getDb(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE_NAME)) {
        db.createObjectStore(PENDING_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ----------------- History File Operations -----------------

export async function saveProcessedFile(
  id: string,
  originalName: string,
  fileName: string,
  data: ArrayBuffer | Blob,
  format: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const db = await getDb();
    let arrayBuffer: ArrayBuffer;
    if (data instanceof Blob) {
      arrayBuffer = await data.arrayBuffer();
    } else {
      arrayBuffer = data;
    }

    const item: HistoryItem = {
      id,
      originalName,
      fileName,
      data: arrayBuffer,
      format,
      timestamp: Date.now(),
      metadata,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to save to local drive db:', err);
  }
}

export async function getAllHistory(): Promise<HistoryItem[]> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as HistoryItem[];
        list.sort((a, b) => b.timestamp - a.timestamp);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
    });
  } catch (err) {
    console.warn(err);
  }
}

export async function clearAllHistory(): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
    });
  } catch (err) {
    console.warn(err);
  }
}

// ----------------- Pending Uploaded Files Operations -----------------

export async function savePendingFile(item: StoredPendingFile): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PENDING_STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to persist pending file:', err);
  }
}

export async function getPendingFiles(): Promise<StoredPendingFile[]> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(PENDING_STORE_NAME, 'readonly');
      const store = tx.objectStore(PENDING_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as StoredPendingFile[];
        list.sort((a, b) => (b.date || 0) - (a.date || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function deletePendingFile(id: string): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(PENDING_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PENDING_STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
    });
  } catch (err) {
    console.warn('Failed to delete pending file:', err);
  }
}

export async function clearAllPendingFiles(): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(PENDING_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PENDING_STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
    });
  } catch (err) {
    console.warn('Failed to clear pending files:', err);
  }
}

export async function clearEntireAppCache(): Promise<void> {
  await clearAllHistory();
  await clearAllPendingFiles();
}
