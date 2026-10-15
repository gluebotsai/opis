const DB_NAME = 'worktual_analytics';
const STORE = 'events';
const LS_KEY = 'wa_offline_queue';

import { uuidV4 } from '../utils/id.js';
import { log } from '../core/logger.js';
import { OFFLINE_QUEUE_MAX, OFFLINE_STORE_MAX } from '../core/constants.js';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function lsLoad() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function lsSave(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items.slice(-OFFLINE_QUEUE_MAX)));
  } catch {
    /* quota */
  }
}

/** @param {{ id: string; payload: unknown; retries: number }} item */
export async function enqueue(item) {
  const record = { id: item.id || uuidV4(), payload: item.payload, retries: item.retries || 0, createdAt: Date.now() };
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    });
    return record.id;
  }
  const items = lsLoad();
  items.push(record);
  lsSave(items);
  return record.id;
}

export async function drain(max = OFFLINE_STORE_MAX) {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const batch = all.slice(0, max);
        for (const item of batch) store.delete(item.id);
        resolve(batch);
      };
      req.onerror = () => resolve([]);
    });
  }
  const items = lsLoad();
  const batch = items.slice(0, max);
  lsSave(items.slice(max));
  return batch;
}

/** @param {string} id @param {number} retries */
export async function requeue(id, payload, retries) {
  log('requeue', id, retries);
  await enqueue({ id, payload, retries });
}

export async function clear() {
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(undefined);
    });
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
