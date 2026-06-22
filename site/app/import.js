// Import legacy strength logs (CSV) into WODIS sessions, entirely on-device.
// Source: a "-----Strength-----" section, then a header row
//   Date,Time,Exercise,# of Reps,Weight,Notes
// and one row per set. Sets group into exercises by Time, exercises into
// sessions by Date. Set-grain only — that is all the source recorded.
import { createSession, addExercise, addSet, localISO } from './model.js';

export function parseStrengthCsv(text, { load_unit = 'lbs' } = {}) {
  return buildSessions(extractRows(text), load_unit);
}

function extractRows(text) {
  const rows = [];
  let inStrength = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('-----')) { inStrength = /strength/i.test(line); continue; }
    if (!inStrength) continue;
    const f = parseCsvLine(line);
    if (f[0] === 'Date' && f[2] === 'Exercise') continue; // column header
    if (f.length < 5 || !f[2]) continue;
    rows.push({ date: f[0], time: f[1] || '0:0', exercise: f[2], reps: f[3], weight: f[4], notes: f[5] || '' });
  }
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// "M/D/YY" + "HH:MM" -> ISO string (local wall time).
function toISO(dateStr, timeStr) {
  const p = (dateStr || '').split('/').map((n) => parseInt(n, 10));
  if (p.length < 3 || p.some(isNaN)) return null;
  let [m, d, y] = p;
  if (y < 100) y += 2000;
  const [hh, mm] = (timeStr || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  return isNaN(dt.getTime()) ? null : localISO(dt);
}

function buildSessions(rows, load_unit) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const docs = [];
  for (const [date, drows] of byDate) {
    const instances = new Map(); // "time|exercise" -> { time, name, sets:[] }
    const order = [];
    for (const r of drows) {
      const key = r.time + '|' + r.exercise;
      if (!instances.has(key)) { instances.set(key, { time: r.time, name: r.exercise, sets: [] }); order.push(key); }
      instances.get(key).sets.push(r);
    }

    const exes = order.map((k) => instances.get(k))
      .sort((a, b) => (toISO(date, a.time) || '').localeCompare(toISO(date, b.time) || ''));
    const stamps = exes.map((e) => toISO(date, e.time)).filter(Boolean);
    const startedAt = stamps[0] || toISO(date, '0:0');
    if (!startedAt) continue;

    const doc = createSession({ load_unit });
    doc.session.started_at = startedAt;
    doc.session.ended_at = stamps[stamps.length - 1] || startedAt;
    doc.meta = { source: 'imported-csv', entry_method: 'imported_csv' };

    for (const ex of exes) {
      const exObj = addExercise(doc, ex.name, toISO(date, ex.time) || startedAt);
      for (const s of ex.sets) {
        const set = addSet(exObj, { load: parseFloat(s.weight) || 0, reps_completed: parseInt(s.reps, 10) || 0 });
        if (s.notes) set.notes = s.notes;
      }
    }
    docs.push(doc);
  }

  docs.sort((a, b) => a.session.started_at.localeCompare(b.session.started_at));
  return docs;
}
