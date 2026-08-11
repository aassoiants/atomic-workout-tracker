// IndexedDB persistence. One WODIS document per session, keyed by session.id.
// The phone is the single writer, so no conflict handling is needed.
// v2 adds 'exercises': one profile per exercise (keyed by normalized name)
// holding its metadata — bucket, overrides, muscles, note. Profiles are app
// data, not workout record, so they live beside the sessions, not inside them.
// v3 adds 'deleted': a tombstone per session the owner deleted. A merge can
// see records, never absences, so a deletion has to be a record of its own or
// any restore (a backup file, a sync pull) hands the session back.
// v4 adds 'bodyweights': one dated weigh-in per day, so derived views can use
// the bodyweight that was true when a set was logged, not just today's.

const DB_NAME = 'atomic';
const DB_VERSION = 4;
const STORE = 'sessions';
const PROFILES = 'exercises';
const DELETED = 'deleted';
const BODYWEIGHTS = 'bodyweights';

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
      if (!db.objectStoreNames.contains(DELETED)) {
        db.createObjectStore(DELETED, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BODYWEIGHTS)) {
        db.createObjectStore(BODYWEIGHTS, { keyPath: 'date' });
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

// The owner deleting a session. The document goes and a tombstone stays, so
// the deletion survives every later merge: a sync pull, a backup restore, a
// carton from another device. Pass deletedAt when replaying someone else's
// tombstone so the original time is kept.
export async function deleteSession(id, deletedAt) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE, DELETED], 'readwrite');
    t.objectStore(STORE).delete(id);
    t.objectStore(DELETED).put({ id, deleted_at: deletedAt || new Date().toISOString() });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Housekeeping removal: an empty leftover session, or a CSV row being replaced
// by its own re-import. Nobody decided anything, so nothing is remembered.
export async function dropSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function allDeleted() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DELETED, 'readonly').objectStore(DELETED).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
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

// One weigh-in per day, last write wins: {date: 'YYYY-MM-DD', v, unit}.
export async function saveBodyweight(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(BODYWEIGHTS, 'readwrite');
    t.objectStore(BODYWEIGHTS).put(entry);
    t.oncomplete = () => resolve(entry);
    t.onerror = () => reject(t.error);
  });
}

export async function allBodyweights() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(BODYWEIGHTS, 'readonly').objectStore(BODYWEIGHTS).getAll();
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
