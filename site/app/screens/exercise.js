// Exercise screen: fast weight x reps logging, with drop sub-rows and a ⋯ to
// drill into a set's per-rep detail.
import { h, clear } from '../dom.js';
import { bottomNav, formatLongDate } from '../ui.js';
import { findExercise, addSet, setSummary, exerciseSetSummary } from '../model.js';

export async function renderExercise(ctx, sessionId, exerciseId) {
  const doc = await ctx.store.getSession(sessionId);
  const ex = doc && findExercise(doc, exerciseId);
  if (!ex) { ctx.router.go({ name: 'session', sessionId }); return h('div'); }
  const unit = doc.session.load_unit;

  const tbody = h('tbody');
  const table = h('table', { class: 'set-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Set'),
      h('th', {}, unit === 'kg' ? 'Kg' : 'Lbs'),
      h('th', {}, 'Reps'),
      h('th', {}),
      h('th', {}))),
    tbody);

  function renderBody() {
    clear(tbody);
    ex.sets.forEach((set, i) => {
      const sum = setSummary(set);
      const detailed = Array.isArray(set.reps) && set.reps.length > 0;
      const hasDrops = sum.drops.length > 0;
      tbody.append(h('tr', { class: hasDrops ? 'has-detail' : '' },
        h('td', { class: 'set-num-cell' }, String(i + 1)),
        h('td', {}, String(set.load)),
        h('td', {}, String(sum.reps)),
        h('td', {}, h('span', {
          class: 'more-dots' + (detailed ? ' detailed' : ''), html: '⋯',
          onClick: () => ctx.router.go({ name: 'detail', sessionId, exerciseId, setId: set.id }),
        })),
        h('td', {}, h('span', {
          class: 'set-delete', html: '&#8722;',
          onClick: async () => { ex.sets.splice(i, 1); await ctx.store.saveSession(doc); renderBody(); setNumEl.textContent = String(ex.sets.length + 1); },
        }))));
      sum.drops.forEach((d) => tbody.append(h('tr', { class: 'drop-row' },
        h('td', {}),
        h('td', {}, h('span', { class: 'drop-weight' }, String(d.load))),
        h('td', {}, h('span', { class: 'drop-reps' }, String(d.reps))),
        h('td', {}),
        h('td', {}))));
    });
  }

  const setNumEl = h('span', { class: 'set-num' }, String(ex.sets.length + 1));
  // Prefill both fields from the last set — repeats are free, only the exception needs typing.
  const lastSet = ex.sets.length ? ex.sets[ex.sets.length - 1] : null;
  const selectAll = (e) => e.target.select();
  const weightInput = h('input', { class: 'input-field', type: 'number', inputmode: 'decimal', value: lastSet ? lastSet.load : '', placeholder: unit, onFocus: selectAll });
  const repsInput = h('input', { class: 'input-field', type: 'number', inputmode: 'numeric', value: lastSet ? setSummary(lastSet).reps : '', placeholder: 'reps', onFocus: selectAll });

  const logSet = async () => {
    const reps = parseInt(repsInput.value, 10);
    if (isNaN(reps)) { repsInput.focus(); return; }
    const load = parseFloat(weightInput.value);
    addSet(ex, { load: isNaN(load) ? 0 : load, reps_completed: reps });
    await ctx.store.saveSession(doc);
    renderBody();
    setNumEl.textContent = String(ex.sets.length + 1);
    // Keep the logged values for the next set; select so one tap replaces.
    repsInput.value = String(reps);
    repsInput.select();
  };
  repsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') logSet(); });

  const inputRow = h('div', { class: 'input-row' },
    setNumEl, weightInput, h('span', { class: 'input-multiply' }, '×'), repsInput,
    h('button', { class: 'log-set-btn', onClick: logSet }, 'Log'));

  renderBody();

  const logPane = h('div', { class: 'content' }, table, inputRow);
  const { pane: histPane, count: histCount } = await buildHistoryPane(ctx, doc, ex);
  histPane.hidden = true;

  const tabLogBtn = h('button', { class: 'ex-tab active', onClick: () => switchTab(false) }, 'Log');
  const tabHistBtn = h('button', { class: 'ex-tab', onClick: () => switchTab(true) }, 'History',
    histCount ? h('span', { class: 'count' }, String(histCount)) : null);
  function switchTab(showHist) {
    tabLogBtn.classList.toggle('active', !showHist);
    tabHistBtn.classList.toggle('active', showHist);
    logPane.hidden = showHist;
    histPane.hidden = !showHist;
  }

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'ex-header' },
      h('div', { class: 'ex-header-top' },
        h('span', { class: 'ex-back', html: '&#8592;', onClick: () => ctx.router.go({ name: 'session', sessionId }) }),
        h('button', { class: 'done-btn', onClick: () => ctx.router.go({ name: 'session', sessionId }) }, 'Done')),
      h('div', { class: 'ex-name' }, ex.display_name)),
    exerciseNote(ctx, doc, ex),
    logPane, histPane);

  return h('div', { class: 'screen' }, scroll,
    h('div', { class: 'ex-tabs' }, tabLogBtn, tabHistBtn),
    bottomNav('log', ctx));
}

// ── History tab: this exercise across earlier sessions, newest first ────────

async function buildHistoryPane(ctx, doc, ex) {
  const all = await ctx.store.allSessions();
  const name = (ex.display_name || '').trim().toLowerCase();
  const t0 = Date.parse(doc.session.started_at);
  const hist = all
    .filter((d) => d.session.id !== doc.session.id && Date.parse(d.session.started_at) < t0)
    .map((d) => ({ s: d.session, past: d.session.exercises.find((e) => (e.display_name || '').trim().toLowerCase() === name) }))
    .filter((x) => x.past && x.past.sets.length)
    .sort((a, b) => Date.parse(b.s.started_at) - Date.parse(a.s.started_at));

  const pane = h('div', { class: 'hist' });
  if (!hist.length) {
    pane.append(h('div', { class: 'hist-empty' }, 'No earlier sessions of this exercise.'));
    return { pane, count: 0 };
  }
  pane.append(h('div', { class: 'hist-lead' },
    'This exercise · ', h('strong', {}, `${hist.length} session${hist.length !== 1 ? 's' : ''}`), ' on record'));
  hist.forEach((x, i) => pane.append(histCard(x.s, x.past, i === 0)));
  return { pane, count: hist.length };
}

function histCard(s, ex, latest) {
  const summary = exerciseSetSummary(ex);
  const top = Math.max(...summary.map((g) => g.load));
  const sets = h('div', { class: 'hc-sets' });
  summary.forEach((g) => sets.append(setGroup(g, g.load === top)));
  return h('div', { class: 'hist-card' + (latest ? ' latest' : '') },
    h('div', { class: 'hc-top' },
      h('span', { class: 'hc-when' }, formatLongDate(s.started_at),
        h('span', { class: 'hc-ago' }, agoLabel(s.started_at))),
      latest ? h('span', { class: 'hc-latest-tag' }, 'Last time') : null),
    sets,
    ex.notes && ex.notes.trim() ? h('div', { class: 'hc-note' }, ex.notes.trim()) : null);
}

// One set with its qualifiers and drops — same bracket notation as the share card.
function setGroup(g, isTop) {
  const el = h('span', { class: 'hc-group' },
    h('span', { class: 'hc-set' + (isTop ? ' top' : '') },
      String(g.load), h('span', { class: 'x' }, '×'), h('span', { class: 'reps' }, String(g.reps))));
  const f = flagsEl(g);
  if (f) el.append(' ', f);
  g.drops.forEach((d) => {
    el.append(' ', h('span', { class: 'hc-drop' }, `↳${d.load}×${d.reps}`));
    const df = flagsEl(d);
    if (df) el.append(' ', df);
  });
  return el;
}

function flagsEl(g) {
  const parts = [];
  if (g.assisted) parts.push(`${g.assisted} assisted`);
  if (g.partial) parts.push(`${g.partial} partial`);
  if (g.failed) parts.push(h('span', { class: 'hc-failed' }, `${g.failed} failed`));
  if (!parts.length) return null;
  const el = h('span', { class: 'hc-flag' }, '(');
  parts.forEach((p, i) => { if (i) el.append(', '); el.append(p.nodeType ? p : document.createTextNode(p)); });
  el.append(')');
  return el;
}

function agoLabel(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Per-exercise free-text note (WODIS exercise.notes), mirrors the session note.
function exerciseNote(ctx, doc, ex) {
  let t;
  const ta = h('textarea', {
    class: 'note-input', rows: '2', placeholder: 'Add a note about this exercise...',
    onInput: (e) => {
      ex.notes = e.target.value;
      clearTimeout(t);
      t = setTimeout(() => ctx.store.saveSession(doc), 400);
    },
  });
  ta.value = ex.notes || '';
  return h('div', { class: 'note-area' }, ta);
}
