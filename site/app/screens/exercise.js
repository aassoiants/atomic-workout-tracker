// Exercise screen: fast weight x reps logging, with drop sub-rows, a ⋯ to
// drill into a set's per-rep detail, and a History tab showing this exercise
// across earlier sessions. Timed work (bike, ropes) logs duration sets instead.
import { h, clear } from '../dom.js';
import { bottomNav, formatLongDate, fmtDuration } from '../ui.js';
import {
  findExercise, addSet, setSummary, exerciseSetSummary,
  isDurationSet, setDuration, addDurationSet, localISO,
} from '../model.js';

export async function renderExercise(ctx, sessionId, exerciseId) {
  const doc = await ctx.store.getSession(sessionId);
  const ex = doc && findExercise(doc, exerciseId);
  if (!ex) { ctx.router.go({ name: 'session', sessionId }); return h('div'); }
  const unit = doc.session.load_unit;

  const { pane: histPane, count: histCount, lastPast, next } = await buildHistoryPane(ctx, doc, ex, (n) => applySuggestion(n));
  histPane.hidden = true;

  // Apply: load the suggestion into the input row and jump to the Log tab.
  // The record is untouched until a set is actually logged.
  function applySuggestion(n) {
    if (durationMode) { durationMode = false; applyMode(); }
    if (n.load != null) weightInput.value = String(n.load);
    if (n.reps != null) repsInput.value = String(n.reps);
    switchTab(false);
    repsInput.select();
  }

  // Prediction ledger: the first time a set is logged, stamp the suggestion
  // that was live. Stored as a fact (with its rule version) so later analysis
  // can compare what the app said against what actually happened — even
  // after the rule itself evolves.
  const stampSuggestion = () => {
    if (!next || next.load == null) return;
    if (ex._extra && ex._extra.atomic && ex._extra.atomic.suggestion) return;
    ex._extra = ex._extra || {};
    ex._extra.atomic = ex._extra.atomic || {};
    ex._extra.atomic.suggestion = {
      label: next.label, load: next.load,
      ...(next.reps != null ? { reps: next.reps } : {}),
      rule: 'flag-gated-dp-v1', at: localISO(new Date()),
    };
  };

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
    stampSuggestion();
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
    stampSuggestion();
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

async function buildHistoryPane(ctx, doc, ex, onApply) {
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
  const next = computeNext(hist);
  if (next) pane.append(nextCard(next, onApply));
  pane.append(h('div', { class: 'hist-lead' },
    'This exercise · ', h('strong', {}, `${hist.length} session${hist.length !== 1 ? 's' : ''}`), ' on record'));
  hist.forEach((x, i) => pane.append(histCard(x.s, x.past, i === 0)));
  return { pane, count: hist.length, lastPast, next };
}

// ── "Next" suggestion: flag-gated double progression over the record ────────
// A derived view with a visible rule, never advice: advance only off a clean
// exposure that hit the rep target, repeat after grinders, hold after gaps,
// step back after two sliding exposures. Display-only; shows its work.

// One past exposure reduced to its top-load working sets.
function summarizeExposure(past) {
  const groups = exerciseSetSummary(past).filter((g) => !g.duration && g.load > 0);
  if (!groups.length) return null;
  const top = Math.max(...groups.map((g) => g.load));
  const at = groups.filter((g) => g.load === top);
  const flags = { assisted: 0, partial: 0, failed: 0 };
  at.forEach((g) => { flags.assisted += g.assisted; flags.partial += g.partial; flags.failed += g.failed; });
  return {
    top,
    reps: at.map((g) => g.reps),
    totalReps: at.reduce((n, g) => n + g.reps, 0),
    dirty: !!(flags.assisted || flags.partial || flags.failed),
    flags,
    hadLighter: groups.length > at.length,
    all: groups.map((g) => ({ load: g.load, reps: g.reps })),
  };
}

// All of an exposure's sets the way a person would say them:
// "100×12, 120×12 and 120×10" or "3 sets of 185×8".
function humanSets(all) {
  const grouped = [];
  for (const s of all) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.load === s.load && prev.reps === s.reps) { prev.count += 1; continue; }
    grouped.push({ load: s.load, reps: s.reps, count: 1 });
  }
  const words = grouped.map((g) => (g.count > 1 ? `${g.count} sets of ${g.load}×${g.reps}` : `${g.load}×${g.reps}`));
  if (words.length <= 1) return words[0] || '';
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

// Smallest load step ever actually made on this exercise (fallback 5).
function learnIncrement(exposures) {
  const diffs = [];
  for (let i = 0; i < exposures.length - 1; i++) {
    const d = Math.abs(exposures[i].e.top - exposures[i + 1].e.top);
    if (d > 0) diffs.push(d);
  }
  return diffs.length ? Math.min(...diffs) : 5;
}

function mode(nums) {
  if (!nums.length) return null;
  const counts = new Map();
  nums.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))[0][0];
}

function flagsPhrase(f) {
  const parts = [];
  if (f.assisted) parts.push(`${f.assisted} assisted rep${f.assisted !== 1 ? 's' : ''}`);
  if (f.partial) parts.push(`${f.partial} partial${f.partial !== 1 ? 's' : ''}`);
  if (f.failed) parts.push(`${f.failed} failed rep${f.failed !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

function computeNext(hist) {
  const exposures = hist
    .map((x) => ({ when: x.s.started_at, e: summarizeExposure(x.past) }))
    .filter((x) => x.e);
  if (!exposures.length) return null; // duration-only history: the cards speak for themselves

  const last = exposures[0];
  // Narrate every set the way a person would say it; the rule still judges
  // only the top weight, and the sentence says so when lighter sets exist.
  const did = `You did ${humanSets(last.e.all)}`;
  const ago = agoLabel(last.when);

  if (exposures.length < 3) {
    return { label: 'Low confidence', value: null, reason: `Only ${exposures.length} session${exposures.length !== 1 ? 's' : ''} on record, too little history to suggest. Log what's real.` };
  }

  const inc = learnIncrement(exposures);
  const cleanMaxes = exposures.slice(0, 6).filter((x) => !x.e.dirty).map((x) => Math.max(...x.e.reps));
  const target = mode(cleanMaxes) || Math.max(...last.e.reps);
  const gapDays = Math.floor((Date.now() - Date.parse(last.when)) / 86400000);

  if (gapDays > 84) {
    const load = Math.max(inc, Math.round((last.e.top * 0.85) / inc) * inc);
    return { label: 'Restart light', value: `~${load}`, load, reason: `${Math.round(gapDays / 7)} weeks since you last did this. Old numbers go stale, so start easy. You'll be back fast. (Layoff sizing is a heuristic, not tested evidence.)` };
  }
  if (gapDays > 28) {
    return { label: 'Hold', value: `${last.e.top} × ${target}`, load: last.e.top, reps: target, wild: last.e.top + inc, reason: `${Math.round(gapDays / 7)} weeks since you last did this. Strength holds about 4 weeks, so repeat it once before advancing.` };
  }
  if (last.e.dirty) {
    return { label: 'Repeat', value: `${last.e.top} × ${target}`, load: last.e.top, reps: target, reason: `${did}, but the ${last.e.top} sets included ${flagsPhrase(last.e.flags)}. Earn it clean first.` };
  }
  if (last.e.reps.every((r) => r >= target)) {
    return { label: 'Progress', value: `${last.e.top + inc} × ${target}`, load: last.e.top + inc, reps: target, reason: `${did}, all clean, ${ago}. Every set at ${last.e.top} hit ${target} reps, so move up.` };
  }
  const p1 = exposures[1];
  const p2 = exposures[2];
  if (p1 && p2 && p1.e.top === last.e.top && p2.e.top === last.e.top
      && last.e.totalReps < p1.e.totalReps && p1.e.totalReps < p2.e.totalReps) {
    return { label: 'Step back', value: `${last.e.top - inc} × ${target}`, load: last.e.top - inc, reps: target, reason: `Your total reps at ${last.e.top} have dropped three sessions in a row: ${p2.e.totalReps}, then ${p1.e.totalReps}, then ${last.e.totalReps}. Step back and rebuild.` };
  }
  return { label: 'Repeat', value: `${last.e.top} × ${target}`, load: last.e.top, reps: target, wild: last.e.top + inc, reason: `${did}. The target at ${last.e.top}${last.e.hadLighter ? ', your top weight,' : ''} is ${target} reps on every set. Not quite there, so run it back.` };
}

// Design D: scoreboard verdict + wildcard permission line + Apply.
function nextCard(n, onApply) {
  const verdict = {
    'Progress': 'Go up', 'Repeat': 'Again', 'Hold': 'Hold',
    'Restart light': 'Ease in', 'Step back': 'Step back', 'Low confidence': 'Low confidence',
  }[n.label] || n.label;
  return h('div', { class: 'next-card' },
    h('span', { class: 'nc-verdict' }, verdict),
    n.value ? h('div', { class: 'nc-val' }, n.value) : null,
    h('div', { class: 'nc-reason' }, n.reason),
    n.load != null && onApply
      ? h('button', { class: 'nc-apply', onClick: () => onApply(n) }, `Apply ${n.value}`)
      : null,
    n.wild != null
      ? h('div', { class: 'nc-wild' }, `Bored of ${n.load}? Take ${n.wild} for a ride. `,
          h('span', {}, 'A heavy day you wanted beats a target you skipped.'))
      : null);
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
