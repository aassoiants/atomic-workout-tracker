// IndexedDB persistence. One WODIS document per session, keyed by session.id.
// The phone is the single writer, so no conflict handling is needed.
// v2 adds 'exercises': one profile per exercise (keyed by normalized name)
// holding its metadata — bucket, overrides, muscles, note. Profiles are app
// data, not workout record, so they live beside the sessions, not inside them.

const DB_NAME = 'atomic';
const DB_VERSION = 2;
const STORE = 'sessions';
const PROFILES = 'exercises';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'session.id' });
      }
      if (!db.objectStoreNames.contains(PROFILES)) {
        db.createObjectStore(PROFILES, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveSession(doc) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(doc);
    t.oncomplete = () => resolve(doc);
    t.onerror = () => reject(t.error);
  });
}

export async function getSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function allSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getProfile(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PROFILES, 'readonly').objectStore(PROFILES).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProfile(profile) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(PROFILES, 'readwrite');
    t.objectStore(PROFILES).put(profile);
    t.oncomplete = () => resolve(profile);
    t.onerror = () => reject(t.error);
  });
}

export async function deleteProfile(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(PROFILES, 'readwrite');
    t.objectStore(PROFILES).delete(name);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function allProfiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PROFILES, 'readonly').objectStore(PROFILES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Ask the browser not to evict our data. Auto-granted for installed daily-use
// apps; this is what protects the log from silent storage eviction.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* not supported — fine */
  }
  return false;
}
