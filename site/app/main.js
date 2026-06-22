// Bootstrap + a tiny in-memory router. Each route renders one screen into #app.
import { clear } from './dom.js';
import * as store from './store.js';
import { createSession } from './model.js';
import { renderFeed } from './screens/feed.js';
import { renderSession } from './screens/session.js';
import { renderExercise } from './screens/exercise.js';
import { renderDetail } from './screens/detail.js';
import { toast } from './ui.js';

const root = document.getElementById('app');
let route = { name: 'feed' };
let draft = null; // a new session held in memory; persisted only once it has content

const router = {
  go(next) { route = next; render(); },
};

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
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const { reconstruct } = await import('./reconstruct.js');
        const { docs, review } = reconstruct(text);
        const existing = await store.allSessions();
        const have = new Set(existing.map((d) => d.session.started_at.slice(0, 10)));
        let added = 0;
        for (const doc of docs) {
          if (have.has(doc.session.started_at.slice(0, 10))) continue;
          await store.saveSession(doc);
          added += 1;
        }
        render();
        toast(added
          ? `Imported ${added} session${added !== 1 ? 's' : ''} · ${review.dropsetsMerged} dropsets · ${review.flagged.length} to review`
          : 'Already up to date');
      } catch (err) {
        toast('Import failed: ' + (err && err.message ? err.message : err));
      }
    };
    input.click();
  },
};

async function render() {
  let node;
  try {
    if (route.name === 'session') node = await renderSession(ctx, route.sessionId);
    else if (route.name === 'exercise') node = await renderExercise(ctx, route.sessionId, route.exerciseId);
    else if (route.name === 'detail') node = await renderDetail(ctx, route.sessionId, route.exerciseId, route.setId);
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
}

boot();
