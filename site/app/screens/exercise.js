// Exercise screen: fast weight x reps logging, with drop sub-rows, a ⋯ to
// drill into a set's per-rep detail, and a History tab showing this exercise
// across earlier sessions. Timed work (bike, ropes) logs duration sets instead.
import { h, clear } from '../dom.js';
import { bottomNav, formatLongDate, fmtDuration } from '../ui.js';
import {
  findExercise, addSet, setSummary, exerciseSetSummary,
  isDurationSet, setDuration, addDurationSet,
} from '../model.js';

export async function renderExercise(ctx, sessionId, exerciseId) {
  const doc = await ctx.store.getSession(sessionId);
  const ex = doc && findExercise(doc, exerciseId);
  if (!ex) { ctx.router.go({ name: 'session', sessionId }); return h('div'); }
  const unit = doc.session.load_unit;

  const { pane: histPane, count: histCount, lastPast } = await buildHistoryPane(ctx, doc, ex);
  histPane.hidden = true;

  // Input mode defaults to however this exercise was last logged — this
  // session first, then its most recent past session.
  const lastOwn = ex.sets[ex.sets.length - 1];
  const lastPastSet = lastPast && lastPast.sets[lastPast.sets.length - 1];
  let durationMode = lastOwn ? isDurationSet(lastOwn) : (lastPastSet ? isDurationSet(lastPastSet) : false);

  const thLoad = h('th', {}, unit === 'kg' ? 'Kg' : 'Lbs');
  const thReps = h('th', {}, 'Reps');
  const tbody = h('tbody');
  const table = h('table', { class: 'set-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Set'), thLoad, thReps, h('th', {}), h('th', {}))),
    tbody);

  function renderHead() {
    if (durationMode) {
      thLoad.textContent = 'Time';
      thLoad.setAttribute('colspan', '2');
      thReps.style.display = 'none';
    } else {
      thLoad.textContent = unit === 'kg' ? 'Kg' : 'Lbs';
      thLoad.removeAttribute('colspan');
      thReps.style.display = '';
    }
  }

  function renderBody() {
    clear(tbody);
    ex.sets.forEach((set, i) => {
      const del = h('span', {
        class: 'set-delete', html: '&#8722;',
        onClick: async () => { ex.sets.splice(i, 1); await ctx.store.saveSession(doc); renderBody(); updateSetNums(); },
      });
      if (isDurationSet(set)) {
        tbody.append(h('tr', {},
          h('td', { class: 'set-num-cell' }, String(i + 1)),
          h('td', { colspan: '2', class: 'dur-cell' }, fmtDuration(setDuration(set))),
          h('td', {}),
          h('td', {}, del)));
        return;
      }
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
        h('td', {}, del)));
      sum.drops.forEach((d) => tbody.append(h('tr', { class: 'drop-row' },
        h('td', {}),
        h('td', {}, h('span', { class: 'drop-weight' }, String(d.load))),
        h('td', {}, h('span', { class: 'drop-reps' }, String(d.reps))),
        h('td', {}),
        h('td', {}))));
    });
  }

  const setNumW = h('span', { class: 'set-num' }, '');
  const setNumD = h('span', { class: 'set-num' }, '');
  function updateSetNums() {
    const n = String(ex.sets.length + 1);
    setNumW.textContent = n;
    setNumD.textContent = n;
  }

  const selectAll = (e) => e.target.select();

  // ── Weight × reps row — prefilled from the last weight set here or last time ──
  const lastWeightSet = [...ex.sets].reverse().find((s) => !isDurationSet(s))
    || (lastPast && [...lastPast.sets].reverse().find((s) => !isDurationSet(s)))
    || null;
  const weightInput = h('input', { class: 'input-field', type: 'number', inputmode: 'decimal', value: lastWeightSet ? lastWeightSet.load : '', placeholder: unit, onFocus: selectAll });
  const repsInput = h('input', { class: 'input-field', type: 'number', inputmode: 'numeric', value: lastWeightSet ? setSummary(lastWeightSet).reps : '', placeholder: 'reps', onFocus: selectAll });

  const logSet = async () => {
    const reps = parseInt(repsInput.value, 10);
    if (isNaN(reps)) { repsInput.focus(); return; }
    const load = parseFloat(weightInput.value);
    addSet(ex, { load: isNaN(load) ? 0 : load, reps_completed: reps });
    await ctx.store.saveSession(doc);
    renderBody();
    updateSetNums();
    // Keep the logged values for the next set; select so one tap replaces.
    repsInput.value = String(reps);
    repsInput.select();
  };
  repsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') logSet(); });

  const weightRow = h('div', { class: 'input-row' },
    setNumW, weightInput, h('span', { class: 'input-multiply' }, '×'), repsInput,
    h('button', { class: 'log-set-btn', onClick: logSet }, 'Log'));

  // ── Duration row (Hr:Min:Sec × sets) — prefilled the same way ──
  const lastDurSet = [...ex.sets].reverse().find(isDurationSet)
    || (lastPast && [...lastPast.sets].reverse().find(isDurationSet))
    || null;
  const d0 = lastDurSet ? setDuration(lastDurSet) : 0;
  const durField = (val, ph) => h('input', { class: 'input-field dur-field', type: 'number', inputmode: 'numeric', min: '0', value: val || '', placeholder: ph, onFocus: selectAll });
  const hrIn = durField(Math.floor(d0 / 3600), 'hr');
  const minIn = durField(Math.floor((d0 % 3600) / 60), 'min');
  const secIn = durField(d0 % 60, 'sec');
  const cntIn = h('input', { class: 'input-field dur-field', type: 'number', inputmode: 'numeric', min: '1', value: '1', placeholder: 'sets', onFocus: selectAll });

  const logDuration = async () => {
    const secs = (parseInt(hrIn.value, 10) || 0) * 3600 + (parseInt(minIn.value, 10) || 0) * 60 + (parseInt(secIn.value, 10) || 0);
    if (!secs) { minIn.focus(); return; }
    const count = Math.max(1, parseInt(cntIn.value, 10) || 1);
    for (let i = 0; i < count; i++) addDurationSet(ex, secs);
    await ctx.store.saveSession(doc);
    renderBody();
    updateSetNums();
    cntIn.value = '1';
  };
  cntIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') logDuration(); });

  const durationRow = h('div', { class: 'input-row dur-row' },
    setNumD,
    hrIn, h('span', { class: 'dur-sep' }, ':'), minIn, h('span', { class: 'dur-sep' }, ':'), secIn,
    h('span', { class: 'input-multiply' }, '×'), cntIn,
    h('button', { class: 'log-set-btn', onClick: logDuration }, 'Log'));

  const modeToggle = h('button', { class: 'mode-toggle', onClick: () => { durationMode = !durationMode; applyMode(); } });
  function applyMode() {
    weightRow.hidden = durationMode;
    durationRow.hidden = !durationMode;
    modeToggle.textContent = durationMode ? `Log ${unit} × reps instead` : 'Log time instead';
    renderHead();
  }

  renderBody();
  updateSetNums();
  applyMode();

  const logPane = h('div', { class: 'content' }, table, weightRow, durationRow, modeToggle);

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
  const lastPast = hist.length ? hist[0].past : null;
  if (!hist.length) {
    pane.append(h('div', { class: 'hist-empty' }, 'No earlier sessions of this exercise.'));
    return { pane, count: 0, lastPast };
  }
  pane.append(h('div', { class: 'hist-lead' },
    'This exercise · ', h('strong', {}, `${hist.length} session${hist.length !== 1 ? 's' : ''}`), ' on record'));
  hist.forEach((x, i) => pane.append(histCard(x.s, x.past, i === 0)));
  return { pane, count: hist.length, lastPast };
}

function histCard(s, ex, latest) {
  const summary = exerciseSetSummary(ex);
  const weights = summary.filter((g) => !g.duration);
  const top = weights.length ? Math.max(...weights.map((g) => g.load)) : null;
  const sets = h('div', { class: 'hc-sets' });
  compressDurations(summary).forEach((t) => sets.append(
    t.dur != null
      ? h('span', { class: 'hc-group' },
          h('span', { class: 'hc-set' }, (t.n > 1 ? `${t.n} × ` : '') + fmtDuration(t.dur)))
      : setGroup(t.g, top != null && t.g.load === top)));
  return h('div', { class: 'hist-card' + (latest ? ' latest' : '') },
    h('div', { class: 'hc-top' },
      h('span', { class: 'hc-when' }, formatLongDate(s.started_at),
        h('span', { class: 'hc-ago' }, agoLabel(s.started_at))),
      latest ? h('span', { class: 'hc-latest-tag' }, 'Last time') : null),
    sets,
    ex.notes && ex.notes.trim() ? h('div', { class: 'hc-note' }, ex.notes.trim()) : null);
}

// Runs of equal durations collapse to one token ("8 × 0:20"); weight sets pass through.
function compressDurations(summary) {
  const out = [];
  for (const g of summary) {
    if (g.duration) {
      const last = out[out.length - 1];
      if (last && last.dur === g.duration) { last.n += 1; continue; }
      out.push({ dur: g.duration, n: 1 });
    } else {
      out.push({ g });
    }
  }
  return out;
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
