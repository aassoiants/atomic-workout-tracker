// Bootstrap + a tiny in-memory router. Each route renders one screen into #app.
import { clear } from './dom.js';
import * as store from './store.js';
import { createSession } from './model.js';
import { renderFeed } from './screens/feed.js';
import { renderSession } from './screens/session.js';
import { renderExercise } from './screens/exercise.js';
import { renderDetail } from './screens/detail.js';
import { renderMore } from './screens/more.js';
import { toast } from './ui.js';
import { initSync, schedulePush, watchOnline } from './sync.js';

const root = document.getElementById('app');
let route = { name: 'feed' };
let draft = null; // a new session held in memory; persisted only once it has content

const router = {
  go(next) { route = next; render(); },
};

// Store facade: every local write also schedules a sync push (a no-op unless
// sync is configured). Screens and importers write through this; reads are
// untouched.
const syncedStore = {
  ...store,
  saveSession: async (doc) => { const r = await store.saveSession(doc); schedulePush(store); return r; },
  deleteSession: async (id) => { const r = await store.deleteSession(id); schedulePush(store); return r; },
};

const ctx = {
  router,
  store: syncedStore,
  // Hold the new session in memory; it isn't written until something is logged,
  // so backing out doesn't litter the feed with empty in-progress sessions.
  async newSession() {
    draft = createSession();
    router.go({ name: 'session', sessionId: draft.session.id });
  },
  // Resume the most recent in-progress session (only content-ful ones are
  // persisted), or start a fresh in-memory one.
  async startLog() {
    const live = (await store.allSessions())
      .filter((d) => !d.session.ended_at)
      .sort((a, b) => Date.parse(b.session.started_at) - Date.parse(a.session.started_at))[0];
    if (live) { router.go({ name: 'session', sessionId: live.session.id }); return; }
    draft = createSession();
    router.go({ name: 'session', sessionId: draft.session.id });
  },
  // The unsaved draft, looked up by id when the store doesn't have it yet.
  draftFor(id) { return draft && draft.session.id === id ? draft : null; },
  importCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    // No accept filter: Android reports CSVs under assorted MIME types and greys them out.
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        // A .wodis.json backup restores directly; anything else is the legacy CSV.
        const head = text.trimStart();
        if (head.startsWith('[') || head.startsWith('{')) {
          const { restoreWodis } = await import('./export.js');
          const { added, skipped } = await restoreWodis(syncedStore, text);
          render();
          toast(added
            ? `Restored ${added} session${added !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`
            : 'Already up to date');
          return;
        }
        const { reconstruct } = await import('./reconstruct.js');
        const { docs, review } = reconstruct(text);
        // Re-importing refreshes sessions that came from the CSV (they're
        // deterministic from the file); manually logged sessions are never touched.
        const byDate = new Map();
        for (const d of await store.allSessions()) {
          const k = d.session.started_at.slice(0, 10);
          if (!byDate.has(k)) byDate.set(k, []);
          byDate.get(k).push(d);
        }
        let added = 0;
        let refreshed = 0;
        for (const doc of docs) {
          const same = byDate.get(doc.session.started_at.slice(0, 10)) || [];
          const olds = same.filter((d) => d.meta && d.meta.source === 'imported-csv');
          if (same.length && !olds.length) continue;
          for (const old of olds) await syncedStore.deleteSession(old.session.id);
          await syncedStore.saveSession(doc);
          if (olds.length) refreshed += 1; else added += 1;
        }
        render();
        toast(added + refreshed
          ? `Import: ${added} new · ${refreshed} refreshed · ${review.flagged.length} to review`
          : 'Already up to date');
      } catch (err) {
        toast('Import failed: ' + (err && err.message ? err.message : err));
      }
    };
    input.click();
  },
  async exportWodis() {
    const { exportWodis } = await import('./export.js');
    await exportWodis(store);
  },
};

async function render() {
  let node;
  try {
    if (route.name === 'session') node = await renderSession(ctx, route.sessionId);
    else if (route.name === 'exercise') node = await renderExercise(ctx, route.sessionId, route.exerciseId);
    else if (route.name === 'detail') node = await renderDetail(ctx, route.sessionId, route.exerciseId, route.setId);
    else if (route.name === 'more') node = await renderMore(ctx);
    else node = await renderFeed(ctx);
  } catch (err) {
    node = errorScreen(err);
  }
  clear(root);
  if (node) root.append(node);
}

function errorScreen(err) {
  const div = document.createElement('div');
  div.style.padding = '40px';
  div.style.color = '#FF5252';
  div.textContent = 'Something went wrong: ' + (err && err.message ? err.message : err);
  return div;
}

// Clear empty in-progress sessions (started, nothing logged) left over from
// before lazy persistence, so the feed only ever shows real training.
async function pruneEmptySessions() {
  try {
    const all = await store.allSessions();
    await Promise.all(all
      .filter((d) => {
        const s = d.session;
        return !s.ended_at && s.exercises.length === 0 && !(s.notes && s.notes.trim());
      })
      .map((d) => store.deleteSession(d.session.id)));
  } catch (_) { /* best-effort cleanup */ }
}

async function boot() {
  await store.requestPersistence();
  await pruneEmptySessions();
  await render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Sync last so first paint never waits on the network; rerender if the pull
  // brought sessions this device hadn't seen.
  watchOnline(store);
  initSync(store).then((added) => { if (added) render(); });
}

boot();
