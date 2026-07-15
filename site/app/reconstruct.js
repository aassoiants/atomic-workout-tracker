// Reconstruct the honest record from the legacy CSV + its note shorthand.
// Auto-applies only high-confidence transforms; everything uncertain is pushed
// to `review.flagged` for the user to eyeball. Every original note is kept
// verbatim in exercise._extra.atomic.import_note. Rules: research/import-reconstruction-plan.md
import { createSession, addExercise, newId, localISO } from './model.js';

export function reconstruct(text, { load_unit = 'lbs', preview = false } = {}) {
  const sessions = groupSessions([...extractStrengthRows(text), ...extractCardioRows(text)]);
  const review = {
    sessions: sessions.length, exercises: 0,
    dropsetsMerged: 0, mgSeq: 0, partialReps: 0, assistedReps: 0, assistLoadSets: 0,
    flagged: [],
  };
  const docs = [];
  for (const s of sessions) {
    const stamps = s.instances.map((i) => i.iso).filter(Boolean).sort();
    const doc = createSession({ load_unit });
    doc.session.started_at = stamps[0] || s.instances[0].iso;
    doc.session.ended_at = stamps[stamps.length - 1] || doc.session.started_at;
    doc.meta = { source: 'imported-csv', entry_method: 'imported_csv' };
    for (const inst of s.instances) {
      review.exercises += 1;
      const ex = addExercise(doc, inst.exercise, inst.iso || doc.session.started_at);
      const { sets, extra } = buildExercise(inst, review);
      ex.sets = sets;
      const x = {};
      if (inst.note) x.import_note = inst.note;
      if (extra.mg_sequence != null) x.mg_sequence = extra.mg_sequence;
      if (extra.tempo) x.tempo = extra.tempo;
      if (preview) x._before = inst.sets.map((s) => s.load + 'x' + s.reps).join(', ');
      if (Object.keys(x).length) ex._extra = { atomic: x };
    }
    docs.push(doc);
  }
  docs.sort((a, b) => a.session.started_at.localeCompare(b.session.started_at));
  return { docs, review };
}

// ── CSV → rows → sessions ──────────────────────────────────────────────────

function extractStrengthRows(text) {
  const rows = [];
  let inStrength = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('-----')) { inStrength = /strength/i.test(line); continue; }
    if (!inStrength) continue;
    const f = parseCsvLine(line);
    if (f[0] === 'Date' && f[2] === 'Exercise') continue;
    if (f.length < 5 || !f[2]) continue;
    rows.push({ date: f[0], time: f[1] || '0:0', exercise: f[2], reps: f[3], weight: f[4], note: (f[5] || '').trim() });
  }
  return rows;
}

// The -----Cardio----- section has its own columns:
// Date,Time,Exercise,Duration,Distance,Heart Rate,Calories,Notes
function extractCardioRows(text) {
  const rows = [];
  let inCardio = false;
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('-----')) { inCardio = /cardio/i.test(line); continue; }
    if (!inCardio) continue;
    const f = parseCsvLine(line);
    if (f[0] === 'Date' && f[2] === 'Exercise') continue;
    if (f.length < 4 || !f[2]) continue;
    const extras = {};
    if (num(f[4]) != null) extras.distance = num(f[4]);
    if (num(f[5]) != null) extras.heart_rate = num(f[5]);
    if (num(f[6]) != null) extras.calories = num(f[6]);
    rows.push({ date: f[0], time: f[1] || '0:0', exercise: f[2], reps: '', weight: '', note: (f[7] || '').trim(), duration: parseDuration(f[3]), extras });
  }
  return rows;
}

function groupSessions(rows) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    const insts = byDate.get(r.date);
    const key = r.time + '|' + r.exercise;
    if (!insts.has(key)) insts.set(key, { date: r.date, exercise: r.exercise, iso: toISO(r.date, r.time), note: '', sets: [] });
    const inst = insts.get(key);
    if (r.note && !inst.note) inst.note = r.note;
    inst.sets.push({
      load: parseFloat(r.weight) || 0,
      reps: parseInt(r.reps, 10) || 0,
      duration: r.duration != null ? r.duration : parseDuration(r.reps),
      extras: r.extras,
    });
  }
  const out = [];
  for (const [date, insts] of byDate) out.push({ date, instances: [...insts.values()].sort((a, b) => (a.iso || '').localeCompare(b.iso || '')) });
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toISO(dateStr, timeStr) {
  const p = (dateStr || '').split('/').map((n) => parseInt(n, 10));
  if (p.length < 3 || p.some(isNaN)) return null;
  let [m, d, y] = p;
  if (y < 100) y += 2000;
  const [hh, mm] = (timeStr || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  return isNaN(dt.getTime()) ? null : localISO(dt);
}

// ── Per-exercise reconstruction ────────────────────────────────────────────

function buildExercise(inst, review) {
  const exname = inst.exercise;
  const raw = inst.sets.map((s) => ({ load: s.load, reps: s.reps, duration: s.duration, extras: s.extras }));
  const extra = {};
  let note = inst.note || '';

  // Timed work (the old tracker stored HH:MM:SS in the reps column): duration
  // sets, no note parsing — cardio notes are things like heart rate, kept verbatim.
  if (raw.some((s) => s.duration)) return { sets: durationSets(raw), extra };

  // tempo (T44 / T4-4 / Tempo 4-4) — capture and strip so it can't be mistaken for a range
  const tempo = note.match(/\bt\s*(\d)\s*-?\s*(\d)\b/i) || note.match(/tempo\s*(\d)\s*-?\s*(\d)/i);
  if (tempo) { extra.tempo = tempo[1] + '-' + tempo[2]; note = note.replace(tempo[0], ' '); }

  // muscle-group sequence: the (remaining) note is a lone 1-3
  if (/^[1-3]$/.test(note.trim())) { extra.mg_sequence = +note.trim(); return { sets: simpleSets(raw), extra }; }

  const isAssistedEx = /assist/i.test(exname);
  const allZero = raw.length > 0 && raw.every((s) => !s.load);

  // assisted-machine pull-ups: slash numbers are per-set assist loads (negative)
  if (isAssistedEx && allZero && /\d/.test(note)) {
    const loads = parseAssistLoads(note, raw.length);
    if (loads) {
      raw.forEach((s, i) => { if (loads[i] != null) s.load = -Math.abs(loads[i]); });
      review.assistLoadSets += raw.length;
    } else {
      flag(review, inst, 'assisted pull-up loads not auto-mapped');
    }
    const segs = raw.map((s) => seg(s.load, s.reps));
    applyAssisted(note, segs, review, inst);
    if (!applyExtras(note, segs, review, inst)) {
      const t = note.match(/\+\s*(\d+)\s*$/); // trailing "+2" on a pull-up = last set assisted
      if (t && !/half/i.test(note) && segs.length) mark(segs, segs.length, +t[1], 'assisted', review);
    }
    return { sets: segsToSets(segs.map((sg) => ({ segments: [sg], drop: false }))), extra };
  }

  const items = raw.map((s) => ({ segments: [seg(s.load, s.reps)], drop: false }));
  const flat = items.map((it) => it.segments[0]);

  // flags resolved on ORIGINAL set indices, before any merge renumbers things
  applyAssisted(note, flat, review, inst);
  applyExtras(note, flat, review, inst);

  // dropset merges (validated: weight must actually drop)
  const pairs = parseDropPairs(note, raw, inst, review).sort((a, b) => b[1] - a[1]);
  for (const [n, m] of pairs) {
    const top = items[n - 1];
    const drop = items[m - 1];
    if (!top || !drop) continue;
    top.segments.push(...drop.segments);
    top.drop = true;
    items.splice(m - 1, 1);
    review.dropsetsMerged += 1;
  }

  return { sets: segsToSets(items), extra };
}

const seg = (load, reps) => ({ load, reps, flags: new Array(Math.max(0, reps)).fill(null) });
const simpleSets = (raw) => raw.map((s) => ({ id: newId(), load: s.load, reps_completed: s.reps }));

// "00:00:30" → 30; anything that isn't H:MM:SS (or HH:MM:SS) → null.
function parseDuration(str) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const secs = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  return secs > 0 ? secs : null;
}

const durationSets = (raw) => raw.map((s) => (s.duration
  ? { id: newId(), load: 0, reps_completed: 0, _extra: { atomic: { duration_seconds: s.duration, ...(s.extras || {}) } } }
  : { id: newId(), load: s.load, reps_completed: s.reps }));
const setsStr = (sets) => sets.map((s) => s.load + 'x' + s.reps).join(', ');

function segsToSets(items) {
  return items.map((it) => {
    const segs = it.segments;
    const isDrop = it.drop || segs.length > 1;
    const hasFlags = segs.some((s) => s.flags.some(Boolean));
    const set = { id: newId(), load: segs[0].load, reps_completed: segs.reduce((n, s) => n + s.reps, 0) };
    if (isDrop) set.set_type = 'dropset';
    if (isDrop || hasFlags) {
      set.reps = [];
      for (const s of segs) {
        for (let i = 0; i < s.reps; i++) {
          const rep = { load: s.load };
          if (s.flags[i] === 'assisted') rep.assisted = true;
          if (s.flags[i] === 'partial') rep.partial = true;
          set.reps.push(rep);
        }
      }
    }
    return set;
  });
}

// ── Note parsers (confident-only; flag the rest) ───────────────────────────

function parseDropPairs(note, raw, inst, review) {
  const found = [];
  const res = [
    /s\s*(\d+)\s*d\s*s?\s*(\d+)/ig, // S2D3, S3d4, S4 D S5
    /s\s*(\d+)\s*\/\s*(\d+)/ig,     // S2/3
    /s\s*(\d+)\s*drop\s*(\d+)/ig,   // S5 drop 6
  ];
  let m;
  for (const r of res) while ((m = r.exec(note))) found.push([+m[1], +m[2]]);
  const dr = note.trim().match(/^(\d)\s*-\s*(\d)$/); // whole-note range "2-3"
  if (dr) found.push([+dr[1], +dr[2]]);

  const valid = [];
  const seen = new Set();
  for (const [n, mm] of found) {
    const key = n + '-' + mm;
    if (seen.has(key)) continue;
    seen.add(key);
    const top = raw[n - 1];
    const drop = raw[mm - 1];
    if (!top || !drop) { flag(review, inst, `S${n}D${mm} references a missing set`); continue; }
    if (mm <= n) { flag(review, inst, `S${n}D${mm} order looks off`); continue; }
    if (drop.load >= top.load) { flag(review, inst, `S${n}D${mm} drop not lighter (${top.load}->${drop.load})`); continue; }
    valid.push([n, mm]);
  }
  return valid;
}

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function applyAssisted(note, segs, review, inst) {
  let any = false;
  let m;
  // compact canonical forms
  const compact = [
    /s\s*(\d+)\s*incl?\w*\s*(\d+)/ig,                                  // S2 incl 1, S3 includes 1
    /s\s*(\d+)\s*(?:inc\w*|i)\s*(\d+)\s*(?:ass\w*|a\b|sup\w*|help)/ig,  // S4inc2ass, S4i3a
    /s\s*(\d+)\s*ass\w*\s*(\d+)/ig,                                    // S4Ass1
  ];
  for (const r of compact) while ((m = r.exec(note))) { mark(segs, +m[1], +m[2], 'assisted', review); any = true; }
  if (any) return;
  // verbose: "S2&3 incl 2 assists", "S2-4 incl 1 ass", "S3 incl one assist", "S2 2 assists", "S2 7 plus 2 assisted"
  if (/ass|help|supp/i.test(note)) {
    const setM = note.match(/s(?:et)?\s*(\d+)\s*([-&]\s*(\d+))?/i);
    const cntM = note.match(/(\d+|one|two|three|four|five)\s*[a-z]*\s*(?:ass|help|supp)/i);
    if (setM && cntM) {
      const s1 = +setM[1];
      const s2 = setM[3] ? +setM[3] : null;
      const cnt = WORDNUM[String(cntM[1]).toLowerCase()] || +cntM[1];
      let sets = [s1];
      if (s2) sets = /-/.test(setM[2]) ? Array.from({ length: s2 - s1 + 1 }, (_, i) => s1 + i) : [s1, s2];
      for (const s of sets) { mark(segs, s, cnt, 'assisted', review); any = true; }
    }
  }
  if (!any && /assist|\bhelp\b|supp|\bincl\b|\binc\b/i.test(note)) flag(review, inst, 'assisted note not auto-parsed');
}

// +N = assisted reps by default; +N with "halfs" = partial reps (user's ruling).
function applyExtras(note, segs, review, inst) {
  const prose = /\b(and then|then\b|couldn'?t|cuz|because|drop \d|stay\b|go up|next time)\b/i.test(note);
  const kind = /half/i.test(note) ? 'partial' : 'assisted';
  const got = new Map();
  const add = (s, c) => { if (s >= 1 && c >= 1 && s <= segs.length) got.set(s, c); };
  let m;
  if (!prose) {
    const fs = note.match(/\+\s*(\d+)[^]*?for set\s*(\d+)/i);          // "9+3 for set 1"
    if (fs) add(+fs[2], +fs[1]);
    const reS = /\b(?:s|set)\s*(\d+)\b[^/;+]*?\(?\+\s*(\d+)\)?/ig;       // "S3 8+2", "Set 2 (+1)"
    while ((m = reS.exec(note))) add(+m[1], +m[2]);
    const reN = /(?:^|[\s/;(])([1-9])[s/( ]*\+\s*(\d+)/ig;              // "2+1/3+1", "2/+1 3/+1", "2(+1)", "3s+2"
    while ((m = reN.exec(note))) {
      const pos = m.index + m[0].lastIndexOf(m[1]);
      if (/[dsDS]/.test(note[pos - 1] || '')) continue;                 // skip D2.. / S2.. (S handled above)
      add(+m[1], +m[2]);
    }
  }
  let any = false;
  for (const [s, c] of got) { mark(segs, s, c, kind, review); any = true; }
  if (!any && /\+\s*\d|half/i.test(note)) flag(review, inst, 'extra-rep note not auto-parsed');
  return any;
}

function mark(segs, setIdx, count, type, review) {
  const s = segs[setIdx - 1];
  if (!s) return;
  let n = 0;
  for (let i = Math.max(0, s.flags.length - count); i < s.flags.length; i++) { s.flags[i] = type; n += 1; }
  if (type === 'assisted') review.assistedReps += n; else review.partialReps += n;
}

function parseAssistLoads(note, count) {
  if (/s\s*\d/i.test(note)) { // labeled: S1 90, S2&3 100
    const loads = new Array(count).fill(null);
    const re = /s\s*(\d+)(?:\s*&\s*(\d+))?\D*?(\d+(?:\.\d+)?)/ig;
    let m;
    let any = false;
    while ((m = re.exec(note))) {
      const v = parseFloat(m[3]);
      const a = +m[1];
      const b = m[2] ? +m[2] : null;
      if (a >= 1 && a <= count) { loads[a - 1] = v; any = true; }
      if (b && b >= 1 && b <= count) loads[b - 1] = v;
    }
    return any ? loads : null;
  }
  const slashes = (note.match(/\//g) || []).length;
  if (slashes === 0) { // single value used for every set ("95", "110 - keep")
    const one = note.match(/(\d+(?:\.\d+)?)/);
    return one ? new Array(count).fill(parseFloat(one[1])) : null;
  }
  const tokens = note.split('/').map((t) => t.trim()).filter(Boolean); // positional: N/N/N
  if (tokens.length === count) {
    const loads = tokens.map((t) => { const mm = t.match(/(\d+(?:\.\d+)?)/); return mm ? parseFloat(mm[1]) : null; });
    if (loads.every((x) => x != null)) return loads;
  }
  return null;
}

function flag(review, inst, reason) {
  review.flagged.push({ date: inst.date, exercise: inst.exercise, note: inst.note, sets: setsStr(inst.sets), reason });
}
