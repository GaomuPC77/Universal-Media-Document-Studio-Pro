// IndexedDB storage matching the reference architecture
const DB_NAME = 'DocStudioPro_Storage_v1';
const STORE_NAME = 'history_files';

export interface HistoryItem {
  id: string;
  originalName: string;
  fileName: string;
  data: ArrayBuffer;
  format: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

let dbInstance: IDBDatabase | null = null;

export async function getDb(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
