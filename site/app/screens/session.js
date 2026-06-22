// Session screen: note, exercise list with live summaries, timer, finish.
import { h, clear } from '../dom.js';
import { bottomNav, formatLongDate, formatTime, TRASH_ICON, sessionNoLabel } from '../ui.js';
import {
  addExercise, finishSession, exerciseSetSummary, exerciseCounts,
  sessionTonnage, sessionSetCount, sessionReps, sessionNumber,
} from '../model.js';
import { openSharePreview } from '../share.js';

const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5"/></svg>';

export async function renderSession(ctx, sessionId) {
  const doc = (await ctx.store.getSession(sessionId)) || (ctx.draftFor && ctx.draftFor(sessionId));
  if (!doc) { ctx.router.go({ name: 'feed' }); return h('div'); }
  const s = doc.session;
  const num = sessionNumber(await ctx.store.allSessions(), doc);

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'session-header' },
      h('div', { class: 'session-header-top' },
        h('span', { class: 'session-back', html: '&#8592;', onClick: () => ctx.router.go({ name: 'feed' }) }),
        h('div', { class: 'session-title-block' },
          h('span', { class: 'session-title' }, s.split_type || 'New Session'),
          h('span', { class: 'session-date' }, `${sessionNoLabel(num)} · ${formatLongDate(s.started_at)}`)),
        h('div', { class: 'session-header-actions' },
          h('button', { class: 'session-share', 'aria-label': 'Share session', title: 'Share session', html: SHARE_ICON, onClick: () => openSharePreview(ctx, doc) }),
          s.ended_at ? null : h('button', { class: 'done-btn', onClick: () => finishAndGo(ctx, doc) }, 'Done')))),
    sessionRollup(doc),
    noteArea(ctx, doc),
  );

  if (!s.exercises.length) {
    scroll.append(h('div', { class: 'hint' }, 'No exercises yet. Add one to start logging.'));
  } else {
    for (const ex of s.exercises) scroll.append(exerciseCard(ctx, doc, ex));
  }

  scroll.append(
    h('button', { class: 'add-exercise-btn', onClick: () => addExerciseFlow(ctx, doc) },
      h('span', {}, '+'), ' Add Exercise'));

  if (!s.ended_at) {
    scroll.append(h('button', { class: 'finish-btn', onClick: () => finishAndGo(ctx, doc) }, 'Finish Session'));
  } else {
    scroll.append(h('button', { class: 'share-session-btn', html: SHARE_ICON, onClick: () => openSharePreview(ctx, doc) }, 'Share Session'));
  }

  return h('div', { class: 'screen' }, scroll, bottomNav('log', ctx));
}

// Running totals for the session, shown at the top. Hidden until something's logged.
function sessionRollup(doc) {
  const sets = sessionSetCount(doc);
  if (!sets) return null;
  return h('div', { class: 'session-rollup' },
    rollupStat(sessionTonnage(doc).toLocaleString(), `${doc.session.load_unit} volume`, true),
    rollupStat(String(sets), sets === 1 ? 'set' : 'sets'),
    rollupStat(String(sessionReps(doc)), 'reps'));
}

function rollupStat(value, label, accent) {
  return h('div', { class: 'sr-stat' },
    h('div', { class: 'sr-val' + (accent ? ' accent' : '') }, value),
    h('div', { class: 'sr-label' }, label));
}

function noteArea(ctx, doc) {
  let t;
  const ta = h('textarea', {
    class: 'note-input', rows: '2', placeholder: "Add a note about today's session...",
    onInput: (e) => {
      doc.session.notes = e.target.value;
      clearTimeout(t);
      t = setTimeout(() => ctx.store.saveSession(doc), 400);
    },
  });
  ta.value = doc.session.notes || '';
  return h('div', { class: 'note-area' }, ta);
}

function exerciseCard(ctx, doc, ex) {
  const { sets, drops } = exerciseCounts(ex);
  const summary = exerciseSetSummary(ex);
  const summaryEl = h('div', { class: 'ec-sets-summary' });
  if (!summary.length) {
    summaryEl.append(h('span', { class: 'ec-empty' }, 'No sets logged'));
  } else {
    summary.forEach((set, i) => {
      if (i) summaryEl.append(', ');
      summaryEl.append(`${set.load}×${set.reps}`);
      set.drops.forEach((d) => summaryEl.append(h('span', { class: 'ec-drop' }, ` ↳${d.load}×${d.reps}`)));
    });
  }
  let countLabel = `${sets} set${sets !== 1 ? 's' : ''}`;
  if (drops) countLabel += ` · ${drops} drop${drops !== 1 ? 's' : ''}`;

  return h('div', {
    class: 'exercise-card',
    onClick: () => ctx.router.go({ name: 'exercise', sessionId: doc.session.id, exerciseId: ex.id }),
  },
    h('div', { class: 'ec-body' },
      h('span', { class: 'ec-name' }, ex.display_name),
      summaryEl),
    h('div', { class: 'ec-meta' },
      ex.started_at ? h('span', { class: 'ec-time' }, formatTime(ex.started_at)) : null,
      h('span', { class: 'ec-sets-count' }, countLabel)),
    h('button', {
      class: 'ec-del', 'aria-label': 'Delete exercise', title: 'Delete exercise', html: TRASH_ICON,
      onClick: (e) => { e.stopPropagation(); deleteExercise(ctx, doc, ex); },
    }));
}

async function addExerciseFlow(ctx, doc) {
  // Build a searchable list of every exercise already logged, most-used first.
  const all = await ctx.store.allSessions();
  const counts = new Map();
  for (const d of all) {
    for (const ex of d.session.exercises) {
      const n = (ex.display_name || '').trim();
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  const names = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));

  openExercisePicker(names, (name) => {
    addExercise(doc, name);
    ctx.store.saveSession(doc);
    ctx.router.go({ name: 'session', sessionId: doc.session.id });
  });
}

// Searchable pick-or-create list of exercise names. Tap an existing one, or type
// a new name and add it.
function openExercisePicker(names, onPick) {
  const overlay = h('div', { class: 'picker-overlay', onClick: (e) => { if (e.target === overlay) close(); } });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const list = h('div', { class: 'picker-list' });
  const input = h('input', { class: 'input-field picker-search', type: 'text', placeholder: 'Search or add an exercise…', autocomplete: 'off' });
  const pick = (name) => { const n = (name || '').trim(); if (!n) return; close(); onPick(n); };

  const renderList = () => {
    clear(list);
    const q = input.value.trim().toLowerCase();
    const matches = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
    const exact = q && names.some((n) => n.toLowerCase() === q);
    if (q && !exact) {
      list.append(h('div', { class: 'picker-item picker-new', onClick: () => pick(input.value) }, `+ Add “${input.value.trim()}”`));
    }
    matches.forEach((n) => list.append(h('div', { class: 'picker-item', onClick: () => pick(n) }, n)));
    if (!matches.length && !q) list.append(h('div', { class: 'picker-empty' }, 'No exercises logged yet — type one to add it.'));
  };

  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = list.querySelector('.picker-item'); if (first) first.click(); }
  });

  overlay.append(h('div', { class: 'picker-sheet' },
    h('div', { class: 'picker-head' },
      h('span', { class: 'picker-title' }, 'Add exercise'),
      h('button', { class: 'picker-cancel', onClick: close }, 'Cancel')),
    input, list));
  document.body.appendChild(overlay);
  renderList();
  setTimeout(() => input.focus(), 30);
}

async function deleteExercise(ctx, doc, ex) {
  if (!window.confirm(`Delete ${ex.display_name} and its sets?`)) return;
  const i = doc.session.exercises.indexOf(ex);
  if (i > -1) doc.session.exercises.splice(i, 1);
  await ctx.store.saveSession(doc);
  ctx.router.go({ name: 'session', sessionId: doc.session.id });
}

async function finishAndGo(ctx, doc) {
  const s = doc.session;
  // Nothing logged → don't persist an empty session.
  if (!s.exercises.length && !(s.notes && s.notes.trim())) {
    ctx.router.go({ name: 'feed' });
    return;
  }
  finishSession(doc);
  await ctx.store.saveSession(doc);
  ctx.router.go({ name: 'feed' });
}

// (session duration / live timer removed — total time isn't a reliable number,
// and per-exercise start times below carry the real timeline instead.)
