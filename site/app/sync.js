// Optional sync to a self-hosted endpoint. Dormant unless the user configures
// an endpoint URL + token (Sync on the feed); the public app never talks to
// any network without that opt-in. The synced blob is exactly the export
// carton (an array of WODIS documents), pushed whole — small data, simple
// truth. Pull merges by session.id (same dedupe as restore), so pulling is
// always safe. Only a device that made local edits pushes (dirty flag), which
// keeps secondary devices from resurrecting states they merely read.
import { buildExportDocs, restoreWodis } from './export.js';
import { toast } from './ui.js';

const KEY = 'atomic.sync.v1';
const DIRTY = 'atomic.sync.dirty';
const APP_PATH = '/v1/atomic/current';

// Prefill for the setup form: the last endpoint used on this device, so
// re-enabling sync doesn't retype the URL. Empty on a fresh install (no server
// address is hardcoded in the public app).
export function lastEndpoint() {
  return localStorage.getItem('atomic.sync.lasturl') || '';
}

export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && c.url && c.token ? c : null;
  } catch { return null; }
}

export function syncStatus() {
  const cfg = getConfig();
  return { on: !!cfg, url: cfg ? cfg.url : '', last: localStorage.getItem('atomic.sync.last') };
}

export function setConfig(url, token) {
  if (!url || !token) { localStorage.removeItem(KEY); return; }
  const clean = String(url).trim().replace(/\/+$/, '');
  localStorage.setItem(KEY, JSON.stringify({ url: clean, token: String(token).trim() }));
  localStorage.setItem('atomic.sync.lasturl', clean); // remembered for re-setup
}

function call(cfg, method, body) {
  return fetch(cfg.url + APP_PATH, {
    method,
    headers: { 'X-Sync-Token': cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body || undefined,
  });
}

// Explicit reachability probe for setup. Hits the cheap /meta route with the
// given (not-yet-saved) endpoint + token. Resolves { status } when the server
// answers at all (200 has data, 404 empty, 401 bad token); rejects only on a
// real network / CORS / TLS failure, so the UI can tell those cases apart.
export async function testEndpoint(url, token) {
  const base = String(url).trim().replace(/\/+$/, '');
  const res = await fetch(base + '/v1/atomic/meta', { headers: { 'X-Sync-Token': String(token).trim() } });
  return { status: res.status };
}

export async function pushAll(store) {
  const cfg = getConfig();
  if (!cfg) return false;
  const docs = await buildExportDocs(store);
  if (!docs.length) return false;
  const res = await call(cfg, 'PUT', JSON.stringify(docs));
  if (!res.ok) throw new Error('push HTTP ' + res.status);
  localStorage.removeItem(DIRTY);
  localStorage.setItem('atomic.sync.last', new Date().toISOString());
  return true;
}

let pushTimer = null;
// Called after every local save/delete: mark dirty, push soon. Capture never
// waits on this — failures leave the dirty flag for the next boot/online.
export function schedulePush(store) {
  if (!getConfig()) return;
  localStorage.setItem(DIRTY, '1');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushAll(store).catch(() => {}); }, 3000);
}

// Boot (and post-setup) sync: pull + merge, then push only if this device has
// unsynced local edits, or the server is empty and we hold history (first
// seed). Returns how many sessions the pull added, so the caller can rerender.
export async function initSync(store) {
  const cfg = getConfig();
  if (!cfg) return 0;
  let added = 0;
  let serverEmpty = false;
  try {
    const res = await call(cfg, 'GET');
    if (res.ok) {
      const r = await restoreWodis(store, await res.text());
      added = r.added;
    } else if (res.status === 404) {
      serverEmpty = true;
    } else {
      throw new Error('pull HTTP ' + res.status);
    }
    const haveLocal = (await store.allSessions()).length > 0;
    if (localStorage.getItem(DIRTY) || (serverEmpty && haveLocal)) await pushAll(store);
    if (added) toast(`Synced ${added} session${added !== 1 ? 's' : ''}`);
  } catch {
    // Offline or endpoint unreachable: leave state as-is; dirty edits push later.
  }
  return added;
}

// Retry pending pushes when the network returns.
export function watchOnline(store) {
  window.addEventListener('online', () => {
    if (localStorage.getItem(DIRTY)) pushAll(store).catch(() => {});
  });
}
