// Live rollup derivations for the Stats screens. Everything here is computed
// from the WODIS docs on every render and never stored, per the app's core
// rule. Accounting follows decision-rep-accounting.md: failed reps excluded
// from reps and tonnage, assisted/partial counted at load but disqualifying a
// set from records, dropset reps counted but marking the set unclean.
import { setSummary, setTonnage, isDurationSet, sessionTonnage } from './model.js';

// The tracked muscle vocabulary, canonical body order. Coverage views show
// every entry, always: an empty row is data.
export const MUSCLES = ['chest', 'back', 'traps', 'front delts', 'side delts', 'rear delts',
  'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'lower back', 'abs'];

// Weekly working-set growth ranges per muscle, from
// research/intermediate-hypertrophy-integrated-report.md section 7.
export const GROWTH_RANGES = {
  chest: [12, 16], back: [14, 18], quads: [12, 16], hamstrings: [10, 14],
  glutes: [8, 14], 'front delts': [12, 20], 'side delts': [12, 20], 'rear delts': [12, 20],
  biceps: [10, 16], triceps: [10, 16], calves: [10, 16],
};

const pad2 = (n) => String(n).padStart(2, '0');
export const dayKey = (iso) => (iso || '').slice(0, 10);

// Monday-start week key from local date parts.
export function weekKey(ts) {
  const d = new Date(ts);
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-${pad2(m.getDate())}`;
}

// Last n Monday keys ending with the current week.
export function weekSeq(n, now = new Date()) {
  const m = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7 * i);
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }
  return out;
}

export function daysAgo(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const then = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86400000);
}

// Facts about one set under the accounting rules.
export function setFacts(set) {
  if (isDurationSet(set)) return null;
  const g = setSummary(set);
  const reps = g.reps + g.drops.reduce((a, d) => a + d.reps, 0);
  const assisted = g.assisted + g.drops.reduce((a, d) => a + d.assisted, 0);
  const partial = g.partial + g.drops.reduce((a, d) => a + d.partial, 0);
  const failed = g.failed + g.drops.reduce((a, d) => a + d.failed, 0);
  const clean = reps > 0 && !assisted && !partial && !failed && !g.drops.length;
  return {
    tonnage: setTonnage(set), reps, assisted, partial, failed,
    mainLoad: g.load, mainReps: g.reps, clean,
    maxLoad: Math.max(g.reps > 0 ? g.load : 0, ...g.drops.filter((d) => d.reps > 0).map((d) => d.load), 0),
  };
}

// Sessions sorted ascending with per-session derived facts.
export function sessionFacts(docs) {
  return docs
    .filter((d) => d.session.exercises.length)
    .sort((a, b) => Date.parse(a.session.started_at) - Date.parse(b.session.started_at))
    .map((d) => {
      const s = d.session;
      let sets = 0; let reps = 0;
      const exs = s.exercises.map((ex) => {
        const facts = ex.sets.map(setFacts).filter(Boolean);
        sets += facts.length;
        for (const f of facts) reps += f.reps;
        return { name: ex.display_name, facts };
      });
      return {
        id: s.id, date: dayKey(s.started_at), ts: Date.parse(s.started_at),
        week: weekKey(Date.parse(s.started_at)),
        tonnage: sessionTonnage(d), sets, reps, exs,
      };
    });
}

export function trainedDays(facts) {
  return [...new Set(facts.map((f) => f.date))].sort();
}

// Histogram of consecutive-day runs plus the current run length.
export function runHistogram(days) {
  const hist = {}; let run = 1; let current = 0;
  for (let i = 1; i <= days.length; i++) {
    const gap = i < days.length
      ? Math.round((Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000) : 0;
    if (i < days.length && gap === 1) { run += 1; continue; }
    hist[run] = (hist[run] || 0) + 1;
    if (i === days.length) current = run;
    run = 1;
  }
  return { hist, current, max: Math.max(0, ...Object.keys(hist).map(Number)) };
}

// Contiguous calendar weeks with totals, zeros included.
export function weeklyAgg(facts, nWeeks, now = new Date()) {
  const keys = weekSeq(nWeeks, now);
  const map = new Map(keys.map((k) => [k, { week: k, sessions: 0, tonnage: 0, sets: 0, reps: 0 }]));
  for (const f of facts) {
    const w = map.get(f.week);
    if (!w) continue;
    w.sessions += 1; w.tonnage += f.tonnage; w.sets += f.sets; w.reps += f.reps;
  }
  return keys.map((k) => map.get(k));
}

// name (normalized) → { major: [...], minor: [...] } lowercased.
export function muscleMap(profiles) {
  const m = new Map();
  for (const p of profiles) {
    const mus = p.muscles || {};
    m.set(p.name, {
      major: (mus.major || []).map((x) => x.toLowerCase()),
      minor: (mus.minor || []).map((x) => x.toLowerCase()),
    });
  }
  return m;
}

const exMuscles = (map, name) => map.get((name || '').trim().toLowerCase()) || { major: [], minor: [] };

// Per muscle: sets per week over the last nWeeks (major movers), plus the days
// each muscle was trained and its last-worked date.
export function muscleWeekly(facts, map, nWeeks, now = new Date()) {
  const keys = weekSeq(nWeeks, now);
  const out = new Map(MUSCLES.map((m) => [m, { series: keys.map(() => 0), daysThisWeek: new Set(), last: null }]));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const thisWk = keys[keys.length - 1];
  for (const f of facts) {
    const i = idx.get(f.week);
    for (const ex of f.exs) {
      for (const m of exMuscles(map, ex.name).major) {
        const row = out.get(m);
        if (!row) continue;
        if (i != null) row.series[i] += ex.facts.length;
        if (f.week === thisWk) row.daysThisWeek.add(f.date);
        if (!row.last || f.date > row.last) row.last = f.date;
      }
    }
  }
  return out;
}

// This week's weighted sets per muscle: major 1.0, minor 0.5, per the
// hypertrophy report's counting rule. Also reports unmapped exercise names.
export function weightedWeekSets(facts, map, now = new Date()) {
  const thisWk = weekSeq(1, now)[0];
  const acc = new Map(MUSCLES.map((m) => [m, 0]));
  const unmapped = new Set();
  for (const f of facts) {
    if (f.week !== thisWk) continue;
    for (const ex of f.exs) {
      const mus = exMuscles(map, ex.name);
      if (!mus.major.length && !mus.minor.length) { if (ex.facts.length) unmapped.add(ex.name); continue; }
      for (const m of mus.major) if (acc.has(m)) acc.set(m, acc.get(m) + ex.facts.length);
      for (const m of mus.minor) if (acc.has(m)) acc.set(m, acc.get(m) + ex.facts.length * 0.5);
    }
  }
  return { acc, unmapped: [...unmapped] };
}

// Chronological weight-record moments across all exercises (min prior exposures
// so first logs don't read as records).
export function recordFeed(facts, minPrior = 5) {
  const best = new Map(); const seen = new Map(); const out = [];
  for (const f of facts) {
    for (const ex of f.exs) {
      const key = (ex.name || '').trim().toLowerCase();
      const n = seen.get(key) || 0;
      for (const set of ex.facts) {
        if (set.maxLoad > (best.get(key) || 0)) {
          if (n >= minPrior) out.push({ date: f.date, name: ex.name, load: set.maxLoad, prev: best.get(key) || 0 });
          best.set(key, set.maxLoad);
        }
      }
      if (ex.facts.length) seen.set(key, n + 1);
    }
  }
  return out.reverse();
}

// Everything the per-exercise stats views need, from one pass over history.
export function exerciseStats(facts, name) {
  const key = (name || '').trim().toLowerCase();
  const exposures = [];
  let lifeTon = 0; let lifeReps = 0;
  let maxLoad = 0; let maxLoadDate = null;
  let bestSV = 0; let bestSVLabel = ''; let bestSVDate = null;
  const repRec = new Map();
  for (const f of facts) {
    for (const ex of f.exs) {
      if ((ex.name || '').trim().toLowerCase() !== key || !ex.facts.length) continue;
      let topLoad = 0; let topReps = 0;
      let ton = 0;
      for (const s of ex.facts) {
        ton += s.tonnage; lifeTon += s.tonnage; lifeReps += s.reps;
        if (s.maxLoad > topLoad) topLoad = s.maxLoad;
        if (s.maxLoad > maxLoad) { maxLoad = s.maxLoad; maxLoadDate = f.date; }
        const sv = s.mainLoad * s.mainReps;
        if (sv > bestSV) { bestSV = sv; bestSVLabel = `${s.mainLoad}×${s.mainReps}`; bestSVDate = f.date; }
        if (s.clean) {
          const r = repRec.get(s.mainLoad);
          if (!r || s.mainReps > r.reps) repRec.set(s.mainLoad, { reps: s.mainReps, date: f.date });
        }
      }
      for (const s of ex.facts) if (s.mainLoad === topLoad && s.mainReps > topReps) topReps = s.mainReps;
      exposures.push({ date: f.date, topLoad, topReps, tonnage: ton });
    }
  }
  return {
    exposures, lifeTon: Math.round(lifeTon), lifeReps,
    maxLoad, maxLoadDate, bestSV: { v: bestSV, label: bestSVLabel, date: bestSVDate },
    repRecords: [...repRec.entries()].sort((a, b) => a[0] - b[0])
      .map(([load, r]) => ({ load, reps: r.reps, date: r.date })),
  };
}

// Order-free token search: every whitespace token must appear somewhere in the
// candidate string. "curl hammer" matches "Curl, Dumbbell Hammer".
export function tokenMatch(query, candidate) {
  const c = (candidate || '').toLowerCase();
  return (query || '').toLowerCase().split(/\s+/).filter(Boolean).every((t) => c.includes(t));
}
