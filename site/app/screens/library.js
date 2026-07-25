// Exercise library: every exercise on record as a first-class thing.
// The list (all names ever logged, searchable, planned-vs-bare at a glance)
// and the profile page — the one place an exercise's metadata lives: bucket,
// per-number overrides, muscles, note. Overriding any number mutes the bucket
// selector, so a plan that deviates from the system is visibly a deviation.
import { h } from '../dom.js';
import { bottomNav, toast, formatLongDate } from '../ui.js';
import { BUCKETS, RIR_CHOICES, normalizeName, resolvePlan, suggestBucket, fmtRest, fmtRir } from '../plan.js';
import { renameExercise } from '../export.js';
import { tokenMatch, sessionFacts, exerciseStats, daysAgo, setFacts } from '../rollups.js';

// Aggregate the record by exercise name: how often, how recently, under what
// display name (most recent spelling wins).
async function aggregate(ctx) {
  const all = await ctx.store.allSessions();
  const byName = new Map();
  for (const d of all) {
    for (const ex of d.session.exercises) {
      if (!ex.sets.length) continue;
      const key = normalizeName(ex.display_name);
      if (!key) continue;
      const when = ex.started_at || d.session.started_at;
      const cur = byName.get(key);
      if (cur) {
        cur.count += 1;
        if (when > cur.last) { cur.last = when; cur.display = ex.display_name; }
      } else {
        byName.set(key, { key, display: ex.display_name, count: 1, last: when });
      }
    }
  }
  return [...byName.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}

function agoLabel(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days < 1) return 'today';
  if (days < 365) return `${days}d ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function planSummary(profile) {
  const plan = resolvePlan(profile);
  if (!plan) return null;
  return `${plan.sets}×${plan.reps} · RIR ${fmtRir(plan.rir)}`;
}

export async function renderLibrary(ctx) {
  const [rows, profiles] = await Promise.all([aggregate(ctx), ctx.store.allProfiles()]);
  const profByName = new Map(profiles.map((p) => [p.name, p]));
  const planned = rows.filter((r) => resolvePlan(profByName.get(r.key))).length;

  // Facet state. Muscles filter on the individual muscle (major or minor);
  // groupings can come later. Buckets and muscles multi-select (OR within a
  // facet, AND across facets); plan is a three-state toggle.
  const facets = { muscles: new Set(), buckets: new Set(), plan: null };
  let query = '';

  // Muscle vocabulary straight from the profiles, most-used first.
  const muscleCounts = new Map();
  for (const p of profiles) {
    const m = p.muscles || {};
    for (const raw of [...(m.major || []), ...(m.minor || [])]) {
      const k = raw.trim().toLowerCase();
      if (!k) continue;
      const cur = muscleCounts.get(k);
      if (cur) cur.n += 1; else muscleCounts.set(k, { label: raw.trim(), n: 1 });
    }
  }
  const muscleVocab = [...muscleCounts.values()].sort((a, b) => b.n - a.n);

  const profMuscles = (p) => (p && p.muscles ? [...(p.muscles.major || []), ...(p.muscles.minor || [])] : []);

  function matches(r) {
    if (query && !tokenMatch(query, r.key)) return false;
    const p = profByName.get(r.key);
    const plan = resolvePlan(p);
    if (facets.plan === 'planned' && !plan) return false;
    if (facets.plan === 'none' && plan) return false;
    if (facets.buckets.size && !(p && facets.buckets.has(p.bucket))) return false;
    if (facets.muscles.size) {
      const mus = profMuscles(p).map((s) => s.trim().toLowerCase());
      if (![...facets.muscles].some((m) => mus.includes(m))) return false;
    }
    return true;
  }

  const list = h('div', { class: 'lib-list' });
  const tokens = h('div', { class: 'facet-tokens' });
  const dot = h('span', { class: 'facet-dot' });

  const draw = () => {
    tokens.textContent = '';
    const tok = (label, clear) => tokens.append(
      h('span', { class: 'facet-token', onClick: () => { clear(); draw(); } }, label, h('small', {}, '×')));
    for (const m of facets.muscles) tok(muscleCounts.has(m) ? muscleCounts.get(m).label : m, () => facets.muscles.delete(m));
    for (const b of facets.buckets) tok(BUCKETS[b] ? BUCKETS[b].label : b, () => facets.buckets.delete(b));
    if (facets.plan) tok(facets.plan === 'planned' ? 'Planned' : 'No plan', () => { facets.plan = null; });
    const any = facets.muscles.size || facets.buckets.size || facets.plan;
    tokens.hidden = !any;
    dot.hidden = !any;

    list.textContent = '';
    const shown = rows.filter(matches);
    if (!shown.length) {
      list.append(h('div', { class: 'lib-empty' }, 'Nothing matches.'));
      return;
    }
    for (const r of shown) {
      const p = profByName.get(r.key);
      const summary = planSummary(p);
      const mus = profMuscles(p);
      list.append(h('div', {
        class: 'lib-row',
        onClick: () => ctx.router.go({ name: 'exercise-profile', exName: r.display }),
      },
      h('div', { class: 'lib-main' },
        h('div', { class: 'lib-name' }, r.display),
        mus.length
          ? h('div', { class: 'lib-muscles' }, mus.join(' · '))
          : h('div', { class: 'lib-meta' }, `${r.count} session${r.count !== 1 ? 's' : ''} · ${agoLabel(r.last)}`)),
      h('span', { class: 'lib-plan' + (summary ? '' : ' none') }, summary || 'no plan'),
      h('span', { class: 'lib-arrow' }, '›')));
    }
  };

  // Bottom sheet with the facet grids; chips apply immediately, Done closes.
  function openSheet() {
    const overlay = h('div', { class: 'picker-overlay', onClick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const sheetChips = [];
    const chip = (label, isOn, toggle) => {
      const el = h('span', { class: 'facet-chip', onClick: () => { toggle(); refresh(); } }, label);
      sheetChips.push({ el, isOn });
      return el;
    };
    const refresh = () => { for (const c of sheetChips) c.el.classList.toggle('on', !!c.isOn()); draw(); };
    const muscleChips = muscleVocab.map((m) => {
      const k = m.label.toLowerCase();
      return chip(m.label, () => facets.muscles.has(k),
        () => { if (facets.muscles.has(k)) facets.muscles.delete(k); else facets.muscles.add(k); });
    });
    const bucketChips = Object.entries(BUCKETS).map(([id, b]) => chip(b.label, () => facets.buckets.has(id),
      () => { if (facets.buckets.has(id)) facets.buckets.delete(id); else facets.buckets.add(id); }));
    const planChips = [['planned', 'Planned'], ['none', 'No plan']].map(([id, label]) =>
      chip(label, () => facets.plan === id, () => { facets.plan = facets.plan === id ? null : id; }));
    overlay.append(h('div', { class: 'picker-sheet facet-sheet' },
      h('div', { class: 'picker-head' },
        h('div', { class: 'picker-title' }, 'Filter'),
        h('button', { class: 'picker-cancel', onClick: () => overlay.remove() }, 'Done')),
      h('div', { class: 'facet-h' }, 'Muscles'),
      h('div', { class: 'facet-grid' }, ...muscleChips),
      h('div', { class: 'facet-h' }, 'Bucket'),
      h('div', { class: 'facet-grid' }, ...bucketChips),
      h('div', { class: 'facet-h' }, 'Plan'),
      h('div', { class: 'facet-grid' }, ...planChips)));
    document.body.appendChild(overlay);
    refresh();
  }

  draw();

  const search = h('input', {
    class: 'lib-search-big', type: 'search', placeholder: 'Search exercises...',
    onInput: (e) => { query = normalizeName(e.target.value); draw(); },
  });
  const filterBtn = h('button', { class: 'facet-btn', onClick: openSheet },
    h('span', { html: '&#9881;' }), dot);

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'feed-head' }, h('div', { class: 'feed-label' }, 'Exercises')),
    h('div', { class: 'lib-sub' },
      h('strong', {}, String(rows.length)), ` on record · `, h('strong', {}, String(planned)), ' with a plan'),
    h('div', { class: 'lib-body' },
      h('div', { class: 'lib-search-row' }, search, filterBtn),
      tokens, list));
  return h('div', { class: 'screen' }, scroll, bottomNav('library', ctx));
}

// ── Profile: one exercise's metadata ────────────────────────────────────────

export async function renderExerciseProfile(ctx, exName) {
  const key = normalizeName(exName);
  const rows = await aggregate(ctx);
  const rec = rows.find((r) => r.key === key);
  const profile = (await ctx.store.getProfile(key)) || {
    name: key, display_name: exName, bucket: null, overrides: {}, muscles: { major: [], minor: [] }, notes: '',
  };

  async function save() {
    profile.updated_at = new Date().toISOString();
    await ctx.store.saveProfile(profile);
  }

  const body = h('div', { class: 'content profile-body' });
  const suggested = suggestBucket(exName);

  function drawBody() {
    body.textContent = '';
    const plan = resolvePlan(profile);
    const base = profile.bucket ? BUCKETS[profile.bucket] : null;
    const anyOverride = !!(plan && (plan.overridden.sets || plan.overridden.reps || plan.overridden.rir || plan.overridden.rest_seconds));

    // Bucket selector. Muted once any number is overridden — the plan no
    // longer derives purely from the bucket, and the UI says so.
    const seg = h('div', { class: 'bucket-seg' + (anyOverride ? ' muted' : '') });
    for (const [id, b] of Object.entries(BUCKETS)) {
      const on = profile.bucket === id;
      const hint = !profile.bucket && suggested === id;
      seg.append(h('div', {
        class: 'b-opt' + (on ? ' on' : '') + (hint ? ' hint' : ''),
        onClick: async () => {
          profile.bucket = on ? null : id;
          profile.overrides = {}; // a bucket change resets deviations from the old bucket
          await save();
          drawBody();
        },
      },
      h('div', { class: 'bo-name' }, b.label + (hint ? ' ?' : '')),
      h('div', { class: 'bo-scheme' }, `${b.sets}×${b.reps} · RIR ${fmtRir(b.rir)}`)));
    }
    body.append(seg);
    if (!profile.bucket) {
      body.append(h('div', { class: 'profile-hint' },
        suggested ? `Pick a bucket to set targets — ${BUCKETS[suggested].label} looks right for this one.`
          : 'Pick a bucket to set targets.'));
    }

    // Number rows. Tap a value to override it for this exercise; an empty
    // input clears the override and the bucket value takes back over.
    const numRow = (label, field, value, overridden) => {
      const val = h('div', { class: 'pr-val' + (plan ? '' : ' empty') }, plan ? String(value) : '—');
      const row = h('div', { class: 'plan-row' },
        h('div', { class: 'pr-label' }, label), val,
        plan ? h('span', { class: overridden ? 'override-tag' : 'derived-tag' }, overridden ? 'override' : 'bucket') : null);
      if (plan) {
        val.onclick = () => {
          const input = h('input', { class: 'pr-input', type: 'number', inputmode: 'numeric', value: String(value) });
          val.replaceWith(input);
          input.focus();
          input.select();
          const commit = async () => {
            const n = Number(input.value);
            if (!input.value.trim() || !isFinite(n) || n <= 0 || n === BUCKETS[profile.bucket][field]) {
              delete profile.overrides[field];
            } else {
              profile.overrides[field] = Math.round(n);
            }
            await save();
            drawBody();
          };
          input.onblur = commit;
          input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
        };
      }
      return row;
    };

    body.append(numRow('Sets', 'sets', plan && plan.sets, plan && plan.overridden.sets));
    body.append(numRow('Reps', 'reps', plan && plan.reps, plan && plan.overridden.reps));

    // RIR: tap cycles the three ranges; landing on the bucket's own range
    // clears the override.
    const rirRow = h('div', { class: 'plan-row' },
      h('div', { class: 'pr-label' }, 'Last-set RIR'),
      h('div', {
        class: 'pr-val' + (plan ? '' : ' empty'),
        onClick: plan ? async () => {
          const cur = plan.rir;
          const i = RIR_CHOICES.findIndex((c) => c[0] === cur[0] && c[1] === cur[1]);
          const nextRir = RIR_CHOICES[(i + 1) % RIR_CHOICES.length];
          if (nextRir[0] === base.rir[0] && nextRir[1] === base.rir[1]) delete profile.overrides.rir;
          else profile.overrides.rir = nextRir;
          await save();
          drawBody();
        } : null,
      }, plan ? fmtRir(plan.rir) : '—'),
      plan ? h('span', { class: plan.overridden.rir ? 'override-tag' : 'derived-tag' }, plan.overridden.rir ? 'override' : 'bucket') : null);
    body.append(rirRow);

    // Rest: number input in seconds (the bucket shows its range until overridden).
    const restRow = h('div', { class: 'plan-row' },
      h('div', { class: 'pr-label' }, 'Rest'),
      h('div', { class: 'pr-val' + (plan ? '' : ' empty') }, plan ? fmtRest(plan.rest_seconds) : '—'),
      plan ? h('span', { class: plan.overridden.rest_seconds ? 'override-tag' : 'derived-tag' }, plan.overridden.rest_seconds ? 'override' : 'bucket') : null);
    if (plan) {
      restRow.children[1].onclick = () => {
        const cur = Array.isArray(plan.rest_seconds) ? plan.rest_seconds[1] : plan.rest_seconds;
        const input = h('input', { class: 'pr-input', type: 'number', inputmode: 'numeric', value: String(cur), title: 'seconds' });
        restRow.children[1].replaceWith(input);
        input.focus();
        input.select();
        const commit = async () => {
          const n = Number(input.value);
          if (!input.value.trim() || !isFinite(n) || n <= 0) delete profile.overrides.rest_seconds;
          else profile.overrides.rest_seconds = Math.round(n);
          await save();
          drawBody();
        };
        input.onblur = commit;
        input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
      };
    }
    body.append(restRow);
    if (plan) body.append(h('div', { class: 'profile-hint' }, 'Rest is entered in seconds (90, 120, 180…). Numbers are a floor, not a cap: rest until the target reps are there again.'));

    // Muscles: major and minor, comma-separated. Data now, coverage views later.
    const muscleInput = (label, field) => {
      const input = h('input', {
        class: 'pr-text', type: 'text', placeholder: label === 'Major' ? 'e.g. quads' : 'e.g. glutes, hamstrings',
        value: (profile.muscles && profile.muscles[field] || []).join(', '),
        onChange: async (e) => {
          profile.muscles = profile.muscles || { major: [], minor: [] };
          profile.muscles[field] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
          await save();
        },
      });
      return h('div', { class: 'plan-row' }, h('div', { class: 'pr-label' }, `${label} muscles`), input);
    };
    body.append(muscleInput('Major', 'major'));
    body.append(muscleInput('Minor', 'minor'));

    const note = h('textarea', {
      class: 'note-input', rows: '2', placeholder: 'Exercise note — setup, seat position, cues...',
      onChange: async (e) => { profile.notes = e.target.value; await save(); },
    });
    note.value = profile.notes || '';
    body.append(h('div', { class: 'note-area profile-note' }, note));
  }
  drawBody();

  // Title row with a deliberate rename flow: the name is the exercise's
  // identity, so the form says exactly how many sessions it will rewrite and
  // warns when the new name merges into an existing exercise.
  const titleRow = h('div', { class: 'profile-title-row' });
  function drawTitle() {
    titleRow.textContent = '';
    titleRow.append(
      h('div', { class: 'profile-title' }, exName),
      h('span', { class: 'profile-rename', onClick: drawRenameForm }, 'Rename'));
  }
  function drawRenameForm() {
    titleRow.textContent = '';
    const input = h('input', { class: 'pr-text rename-input', type: 'text', value: exName });
    const hint = h('div', { class: 'rename-hint' });
    const updateHint = () => {
      const to = normalizeName(input.value);
      const other = to && to !== key ? rows.find((r) => r.key === to) : null;
      const n = rec ? rec.count : 0;
      hint.className = 'rename-hint' + (other ? ' merge' : '');
      hint.textContent = other
        ? `Merges into "${other.display}" — ${n + other.count} sessions become one history.`
        : `Rewrites the name in ${n} session${n !== 1 ? 's' : ''} and the plan.`;
    };
    updateHint();
    input.oninput = updateHint;
    const save = h('button', {
      class: 'rn-btn',
      onClick: async () => {
        const clean = input.value.trim();
        if (!clean || clean === exName) { drawTitle(); return; }
        const n = await renameExercise(ctx.store, exName, clean);
        toast(`Renamed · ${n} session${n !== 1 ? 's' : ''} updated`);
        ctx.router.go({ name: 'exercise-profile', exName: clean });
      },
    }, 'Save');
    const cancel = h('button', { class: 'rn-btn ghost', onClick: drawTitle }, 'Cancel');
    titleRow.append(h('div', { class: 'rename-form' }, input, h('div', { class: 'rename-actions' }, save, cancel), hint));
    input.focus();
    input.select();
  }
  drawTitle();

  // Three panes behind a bottom tab bar: the plan form, the record's history
  // for this lift, and the live stats. The bar sits directly above the main
  // nav, in thumb reach.
  const panes = {
    plan: body,
    history: await profileHistory(ctx, exName),
    stats: await exerciseStatsBlock(ctx, exName),
  };
  let tab = 'plan';
  const tabBtns = {};
  const labels = { plan: 'Plan', history: 'History', stats: 'Stats' };
  const syncTabs = () => {
    for (const [key, pane] of Object.entries(panes)) {
      pane.hidden = key !== tab;
      tabBtns[key].classList.toggle('on', key === tab);
    }
  };
  const bar = h('div', { class: 'pf-tabbar' },
    ...Object.keys(panes).map((key) => {
      tabBtns[key] = h('button', { class: 'pf-tab', onClick: () => { tab = key; syncTabs(); } }, labels[key]);
      return tabBtns[key];
    }));
  syncTabs();

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'content profile-head' },
      h('div', { class: 'profile-back', onClick: () => ctx.router.go({ name: 'library' }) }, '‹ Exercises'),
      titleRow,
      h('div', { class: 'profile-sub' }, rec ? `${rec.count} session${rec.count !== 1 ? 's' : ''} · last ${agoLabel(rec.last)}` : 'Not logged yet')),
    panes.plan, panes.history, panes.stats);
  return h('div', { class: 'screen' }, scroll, bar, bottomNav('library', ctx));
}

// The record's history for one lift: recent sessions, one card each, sets in
// plain tokens with flags counted.
async function profileHistory(ctx, exName) {
  const key = normalizeName(exName);
  const docs = (await ctx.store.allSessions())
    .filter((d) => d.session.exercises.some((e) => normalizeName(e.display_name) === key && e.sets.length))
    .sort((a, b) => Date.parse(b.session.started_at) - Date.parse(a.session.started_at))
    .slice(0, 20);
  const wrap = h('div', { class: 'content ex-history' });
  if (!docs.length) {
    wrap.append(h('div', { class: 'st-note' }, 'Not logged yet.'));
    return wrap;
  }
  for (const d of docs) {
    const ex = d.session.exercises.find((e) => normalizeName(e.display_name) === key);
    const toks = ex.sets.map((set) => {
      const f = setFacts(set);
      if (!f) return 'timed';
      let t = `${f.mainLoad}×${f.mainReps}`;
      const flags = [];
      if (f.assisted) flags.push(`${f.assisted} assisted`);
      if (f.partial) flags.push(`${f.partial} partial`);
      if (f.failed) flags.push(`${f.failed} failed`);
      if (flags.length) t += ` (${flags.join(', ')})`;
      return t;
    });
    wrap.append(h('div', { class: 'st-card ex-hist-card' },
      h('div', { class: 'ex-hist-date' }, formatLongDate(d.session.started_at)),
      h('div', { class: 'ex-hist-sets' }, toks.join(' · '))));
  }
  return wrap;
}

// Per-exercise stats: the record's answers for this one lift, computed live.
export async function exerciseStatsBlock(ctx, exName) {
  const facts = sessionFacts(await ctx.store.allSessions());
  const st = exerciseStats(facts, exName);
  if (!st.exposures.length) return h('div');
  const wrap = h('div', { class: 'content ex-stats' });
  const fmtD = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] } ${+m[3]} ’${m[1].slice(2)}`;
  };
  const last = st.exposures[st.exposures.length - 1];
  const ago = daysAgo(last.date);

  wrap.append(h('div', { class: 'ex-facts' },
    h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv volt' }, String(st.maxLoad)), h('div', { class: 'ex-fl' }, 'Top load')),
    h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv' }, String(st.exposures.length)), h('div', { class: 'ex-fl' }, 'Exposures')),
    h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv' }, ago === 0 ? 'today' : `${ago}d`), h('div', { class: 'ex-fl' }, 'Since last'))));

  // Top set per exposure, last 12, as bars.
  const recent = st.exposures.slice(-12);
  const max = Math.max(...recent.map((e) => e.topLoad), 1);
  wrap.append(h('div', { class: 'st-card' },
    h('div', { class: 'st-label' }, h('span', {}, 'Top set'), h('span', { class: 'st-sub' }, `last ${recent.length} exposures`)),
    h('div', { class: 'st-bars', style: 'height:56px' },
      ...recent.map((e, i) => h('div', {
        class: 'st-bar' + (i === recent.length - 1 ? ' hi' : ''),
        style: `height:${Math.max(e.topLoad / max * 100, 4)}%`,
      }))),
    h('div', { class: 'st-axis' }, h('span', {}, fmtD(recent[0].date)), h('span', {}, `${last.topLoad}×${last.topReps}`))));

  // Records, clean sets only.
  const topRec = st.repRecords.length ? st.repRecords[st.repRecords.length - 1] : null;
  wrap.append(h('div', { class: 'st-card' },
    h('div', { class: 'st-label' }, h('span', {}, 'Records'), h('span', { class: 'st-sub' }, 'clean sets only')),
    h('div', { class: 'st-lrow' }, h('span', { class: 'st-ln mut' }, 'Heaviest load'), h('span', { class: 'st-lv' }, `${st.maxLoad} lb`), h('span', { class: 'st-ld' }, fmtD(st.maxLoadDate))),
    st.bestSV.v ? h('div', { class: 'st-lrow' }, h('span', { class: 'st-ln mut' }, 'Best set volume'), h('span', { class: 'st-lv' }, st.bestSV.label), h('span', { class: 'st-ld' }, fmtD(st.bestSV.date))) : null,
    topRec ? h('div', { class: 'st-lrow' }, h('span', { class: 'st-ln mut' }, `Most reps at ${topRec.load}`), h('span', { class: 'st-lv' }, String(topRec.reps)), h('span', { class: 'st-ld' }, fmtD(topRec.date))) : null));

  // Best clean reps at each load, heaviest 8 slots.
  const slots = st.repRecords.slice(-8);
  if (slots.length > 2) {
    wrap.append(h('div', { class: 'st-card' },
      h('div', { class: 'st-label' }, h('span', {}, 'Best clean reps at each load')),
      h('div', { class: 'ex-lattice', style: `grid-template-columns: repeat(${slots.length}, 1fr)` },
        ...slots.map((s) => h('div', { class: 'ex-lat-l' }, String(s.load))),
        ...slots.map((s) => h('div', { class: 'ex-lat-v' }, String(s.reps))))));
  }

  wrap.append(h('div', { class: 'st-card' },
    h('div', { class: 'st-label' }, h('span', {}, 'All time')),
    h('div', { class: 'ex-facts' },
      h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv volt' }, st.lifeTon.toLocaleString()), h('div', { class: 'ex-fl' }, 'Honest lb')),
      h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv' }, st.lifeReps.toLocaleString()), h('div', { class: 'ex-fl' }, 'Reps')),
      h('div', { class: 'ex-fact' }, h('div', { class: 'ex-fv' }, fmtD(st.exposures[0].date)), h('div', { class: 'ex-fl' }, 'First log')))));

  return wrap;
}
