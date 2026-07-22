// The three-bucket prescription ruleset (docs/exercise-buckets-ruleset.md).
// The ruleset is the app's opinion, not workout data — it never enters WODIS
// core. A per-exercise profile (store: 'exercises') picks a bucket and may
// override individual numbers; the resolved prescription feeds the "next"
// suggestion and is stamped into the session file (_extra.atomic.prescription)
// when logging starts, so target and actual live side by side.

export const BUCKETS = {
  heavy_compound: { label: 'Heavy', sets: 3, reps: 6, rir: [2, 3], rest_seconds: [120, 180] },
  mid_compound: { label: 'Mid', sets: 3, reps: 10, rir: [1, 2], rest_seconds: [120, 120] },
  isolation: { label: 'Isolation', sets: 3, reps: 10, rir: [0, 1], rest_seconds: [90, 90] },
};

export const RIR_CHOICES = [[0, 1], [1, 2], [2, 3]];

export function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

// Bucket values with this exercise's overrides applied. Null when no bucket is
// set — history-guessing stays in charge, exactly as before profiles existed.
export function resolvePlan(profile) {
  const base = profile && BUCKETS[profile.bucket];
  if (!base) return null;
  const o = profile.overrides || {};
  return {
    bucket: profile.bucket,
    sets: o.sets != null ? o.sets : base.sets,
    reps: o.reps != null ? o.reps : base.reps,
    rir: o.rir != null ? o.rir : base.rir,
    rest_seconds: o.rest_seconds != null ? o.rest_seconds : base.rest_seconds,
    overridden: {
      sets: o.sets != null, reps: o.reps != null,
      rir: o.rir != null, rest_seconds: o.rest_seconds != null,
    },
  };
}

// Bucket suggestion by name-match against the ruleset's example lists.
// Isolation keywords are checked before mid so "incline dumbell curls" reads
// as a curl, not an incline press. Always user-overridable — never auto-saved.
const HEAVY_WORDS = ['leg press', 'hack squat', 'bench', 'deadlift', 'squat'];
const ISO_WORDS = ['curl', 'lateral', 'pushdown', 'extension', 'calf', 'face pull', 'fly', 'flye', 'shrug', 'crunch', 'raise'];
const MID_WORDS = ['incline', 'shoulder press', 'pulldown', 'pullup', 'pull-up', 'pull up', 'row', 'hip thrust', 'dip', 'press'];

export function suggestBucket(name) {
  const n = normalizeName(name);
  if (HEAVY_WORDS.some((w) => n.includes(w))) return 'heavy_compound';
  if (ISO_WORDS.some((w) => n.includes(w))) return 'isolation';
  if (MID_WORDS.some((w) => n.includes(w))) return 'mid_compound';
  return null;
}

// "90s" / "2 min" / "2–3 min" from a single number of seconds or a [min, max].
export function fmtRest(rest) {
  const one = (s) => (s < 120 ? `${s}s` : `${Math.round(s / 60)}`);
  const unit = (s) => (s < 120 ? '' : ' min');
  if (Array.isArray(rest)) {
    const [a, b] = rest;
    if (a === b) return one(a) + unit(a);
    return `${one(a)}–${one(b)}${unit(b)}`;
  }
  return one(rest) + unit(rest);
}

export function fmtRir(rir) {
  return Array.isArray(rir) ? `${rir[0]}–${rir[1]}` : String(rir);
}
