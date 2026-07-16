// The WODIS document is the stored fact. Sets, summaries, tonnage are all
// derived views computed over reps — never stored. The rep is the atomic unit.
// Field semantics follow the WODIS spec (Z:\Projects\wodis\SPECIFICATION.md).

export const WODIS_VERSION = '1.0.0';
export const APP_SOURCE = 'atomic';
export const DEFAULT_LOAD_UNIT = 'lbs';
export const SET_TYPES = ['working', 'warmup', 'dropset', 'failure', 'backoff', 'amrap'];

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Local wall-clock ISO 8601 with timezone offset, e.g. 2026-06-18T18:44:00-07:00.
// Keeps the calendar date matching when the workout happened, so slicing the date
// out of a WODIS file gives the real local day (matters when analyzing the files).
export function localISO(dt) {
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad2(Math.floor(Math.abs(off) / 60));
  const om = pad2(Math.abs(off) % 60);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T`
    + `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}${sign}${oh}:${om}`;
}

function nowISO() {
  return localISO(new Date());
}

// ── Factory ──────────────────────────────────────────────────────────────

// A session is one WODIS document. `id` is an extra property (spec-preserved)
// that we use as the storage key. exercises[] starts empty; WODIS only
// requires >= 1 exercise for a conformant *exported* file, checked at export.
export function createSession({ load_unit = DEFAULT_LOAD_UNIT, split_type = null } = {}) {
  return {
    wodis_version: WODIS_VERSION,
    meta: { source: APP_SOURCE, entry_method: 'manual' },
    session: {
      id: newId(),
      started_at: nowISO(),
      load_unit,
      ...(split_type ? { split_type } : {}),
      exercises: [],
    },
  };
}

export function addExercise(doc, display_name, started_at = nowISO()) {
  const ex = { id: newId(), display_name, started_at, sets: [] };
  doc.session.exercises.push(ex);
  return ex;
}

// load: starting/primary weight. reps_completed: count of completed reps.
export function addSet(exercise, { load = 0, reps_completed = 0, set_type = null } = {}) {
  const set = { id: newId(), load: Number(load) || 0, reps_completed: Number(reps_completed) || 0 };
  if (set_type && SET_TYPES.includes(set_type)) set.set_type = set_type;
  exercise.sets.push(set);
  return set;
}

// ── Timed work (bike, run, battle ropes) ───────────────────────────────────
// The spec has no first-class field for work duration (its duration fields are
// rest/transition), so it rides in _extra — the spec's extension channel,
// round-trip protected. A duration set carries no load and no reps.

export function isDurationSet(set) {
  return !!(set._extra && set._extra.atomic && set._extra.atomic.duration_seconds != null);
}

export function setDuration(set) {
  return isDurationSet(set) ? Number(set._extra.atomic.duration_seconds) || 0 : 0;
}

export function addDurationSet(exercise, seconds) {
  const set = { id: newId(), load: 0, reps_completed: 0, _extra: { atomic: { duration_seconds: Math.max(0, Math.round(seconds)) } } };
  exercise.sets.push(set);
  return set;
}

// Materialize per-rep data (dropsets, assisted/partial/failed reps).
// reps: array of { load, assisted, partial, completed }.
export function setReps(set, reps) {
  set.reps = reps.map((r) => normalizeRep(r, set.load));
  set.reps_completed = set.reps.filter((r) => r.completed !== false).length;
  return set;
}

function normalizeRep(r, fallbackLoad) {
  const rep = { load: Number(r.load != null ? r.load : fallbackLoad) || 0 };
  if (r.assisted) rep.assisted = true;
  if (r.partial) rep.partial = true;
  if (r.completed === false) rep.completed = false; // failed rep attempt
  return rep;
}

export function finishSession(doc) {
  if (!doc.session.ended_at) doc.session.ended_at = nowISO();
  // Planned rows are scaffolding, never facts; they don't outlive the session.
  for (const ex of doc.session.exercises) {
    if (ex._extra && ex._extra.atomic && ex._extra.atomic.plan) delete ex._extra.atomic.plan;
  }
  return doc;
}

export function findExercise(doc, exId) {
  return doc.session.exercises.find((e) => e.id === exId) || null;
}

// ── Derivations (never stored) ─────────────────────────────────────────────

export function setTonnage(set) {
  if (Array.isArray(set.reps) && set.reps.length) {
    return set.reps.reduce((t, r) => t + (r.completed === false ? 0 : Number(r.load) || 0), 0);
  }
  return (Number(set.load) || 0) * (Number(set.reps_completed) || 0);
}

export function sessionTonnage(doc) {
  return doc.session.exercises.reduce(
    (t, ex) => t + ex.sets.reduce((s, set) => s + setTonnage(set), 0),
    0
  );
}

export function sessionSetCount(doc) {
  return doc.session.exercises.reduce((n, ex) => n + ex.sets.length, 0);
}

// 1-based chronological position of this session among all sessions (its "number").
// Works for an unsaved draft too: it counts as the next one after the saved set.
export function sessionNumber(allSessions, doc) {
  const t = Date.parse(doc.session.started_at);
  const id = doc.session.id;
  let before = 0;
  for (const d of allSessions) {
    if (d.session.id !== id && Date.parse(d.session.started_at) <= t) before += 1;
  }
  return before + 1;
}

// Completed reps across the session: dropset reps counted, failed reps excluded.
export function sessionReps(doc) {
  return doc.session.exercises.reduce(
    (n, ex) => n + ex.sets.reduce((m, set) => {
      const s = setSummary(set);
      return m + s.reps + s.drops.reduce((a, d) => a + d.reps, 0);
    }, 0),
    0,
  );
}

// Compact view of one set, grouped by load. Each group reports completed reps
// plus how many were assisted / partial / failed. Flags are independent of load
// (a rep can be a dropset rep that was also assisted). Failed reps are excluded
// from `reps` and tonnage but surfaced as `failed`.
// { load, reps, assisted, partial, failed, drops:[{load, reps, assisted, partial, failed}] }
export function setSummary(set) {
  if (isDurationSet(set)) {
    return { load: 0, reps: 0, duration: setDuration(set), assisted: 0, partial: 0, failed: 0, drops: [] };
  }
  const mainLoad = Number(set.load);
  if (!Array.isArray(set.reps) || !set.reps.length) {
    return { load: mainLoad, reps: Number(set.reps_completed) || 0, assisted: 0, partial: 0, failed: 0, drops: [] };
  }
  const main = { load: mainLoad, reps: 0, assisted: 0, partial: 0, failed: 0 };
  const dropMap = new Map();
  const dropOrder = [];
  // Pass 1: completed reps define the load groups, in order of first appearance.
  for (const r of set.reps) {
    if (r.completed === false) continue;
    const load = Number(r.load != null ? r.load : mainLoad);
    let g;
    if (load === mainLoad) {
      g = main;
    } else {
      if (!dropMap.has(load)) { dropMap.set(load, { load, reps: 0, assisted: 0, partial: 0, failed: 0 }); dropOrder.push(load); }
      g = dropMap.get(load);
    }
    g.reps += 1;
    if (r.assisted) g.assisted += 1;
    if (r.partial) g.partial += 1;
  }
  // Pass 2: failed attempts attach to their load's group if it exists, else the main load.
  for (const r of set.reps) {
    if (r.completed !== false) continue;
    const load = Number(r.load != null ? r.load : mainLoad);
    const g = load === mainLoad ? main : (dropMap.get(load) || main);
    g.failed += 1;
  }
  return {
    load: main.load, reps: main.reps, assisted: main.assisted, partial: main.partial, failed: main.failed,
    drops: dropOrder.map((k) => dropMap.get(k)),
  };
}

export function exerciseSetSummary(ex) {
  return ex.sets.map(setSummary);
}

// Recompute reps_completed and set_type after editing a set's reps[].
export function syncSet(set) {
  if (!Array.isArray(set.reps)) return set;
  set.reps_completed = set.reps.filter((r) => r.completed !== false).length;
  const loads = new Set(set.reps.map((r) => Number(r.load)));
  if (loads.size > 1) set.set_type = 'dropset';
  else if (set.set_type === 'dropset') delete set.set_type;
  return set;
}

export function exerciseCounts(ex) {
  const sets = ex.sets.length;
  const drops = ex.sets.reduce((d, set) => d + setSummary(set).drops.length, 0);
  return { sets, drops };
}

// ── WODIS round-trip ───────────────────────────────────────────────────────

// The stored document is already WODIS-shaped; export is a deep clone.
export function toWODIS(doc) {
  return JSON.parse(JSON.stringify(doc));
}

export function fromWODIS(parsed) {
  if (!parsed.session.id) parsed.session.id = uid();
  return parsed;
}
