// Bootstrap + a tiny in-memory router. Each route renders one screen into #app.
import { clear } from './dom.js';
import * as store from './store.js';
import { createSession } from './model.js';
import { renderFeed } from './screens/feed.js';
import { renderSession } from './screens/session.js';
import { renderExercise } from './screens/exercise.js';
import { renderDetail } from './screens/detail.js';
import { renderLibrary, renderExerciseProfile } from './screens/library.js';
import { toast } from './ui.js';

const root = document.getElementById('app');
let route = { name: 'feed' };
let draft = null; // a new session held in memory; persisted only once it has content

// Mirror every route change into browser history so the Android back
// button/gesture walks back through screens instead of exiting the PWA.
// The feed is the root: back from there leaves the app, as it should.
const router = {
  go(next) {
    const same = JSON.stringify(next) === JSON.stringify(route);
    route = next;
    if (!same) history.pushState(route, '', '');
    render();
  },
};
window.addEventListener('popstate', (e) => {
  route = e.state || { name: 'feed' };
  render();
});

const ctx = {
  router,
  store,
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
          const res = await restoreWodis(store, text);
          render();
          if (res.renames != null) {
            toast(res.renames
              ? `Renamed ${res.renames} exercise${res.renames !== 1 ? 's' : ''} · ${res.renameSessions} sessions updated${res.skipped ? ` · ${res.skipped} skipped` : ''}`
              : 'Renames already applied');
          } else {
            const parts = [];
            if (res.added) parts.push(`${res.added} session${res.added !== 1 ? 's' : ''}`);
            const plans = (res.profilesAdded || 0) + (res.profilesUpdated || 0);
            if (plans) parts.push(`${plans} exercise plan${plans !== 1 ? 's' : ''}`);
            toast(parts.length ? `Restored ${parts.join(' · ')}` : 'Already up to date');
          }
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
          for (const old of olds) await store.deleteSession(old.session.id);
          await store.saveSession(doc);
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
    else if (route.name === 'library') node = await renderLibrary(ctx);
    else if (route.name === 'exercise-profile') node = await renderExerciseProfile(ctx, route.exName);
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
  history.replaceState(route, '', '');
  await store.requestPersistence();
  await pruneEmptySessions();
  await render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
