// Stats: a dashboard of rollup widgets, all computed live from the store.
// Widgets are added, removed, and reordered by the user; the layout (ids in
// order) is a device preference in localStorage. Cards state data and never
// explain themselves; outside yardsticks carry a visible tag.
import { h } from '../dom.js';
import { bottomNav, toast, getBodyweight } from '../ui.js';
import {
  MUSCLES, GROWTH_RANGES, sessionFacts, trainedDays, runHistogram, weeklyAgg,
  weekKey, weekSeq, daysAgo, muscleMap, muscleWeekly, weightedWeekSets, recordFeed,
} from '../rollups.js';

const LAYOUT_KEY = 'atomic-stats-layout';
const DEFAULT_LAYOUT = ['runs', 'gap', 'weekbars', 'wave', 'skyline', 'coverage', 'yearheat'];

const fmtK = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[+m[2] - 1]} ${+m[3]}`;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function card(label, sub, ...kids) {
  return h('div', { class: 'st-card' },
    h('div', { class: 'st-label' }, h('span', {}, label), sub ? h('span', { class: 'st-sub' }, sub) : null),
    ...kids);
}
const note = (...kids) => h('div', { class: 'st-note' }, ...kids);
function barStrip(values, { height = 56, highlightLast = true } = {}) {
  const max = Math.max(1, ...values);
  return h('div', { class: 'st-bars', style: `height:${height}px` },
    ...values.map((v, i) => h('div', {
      class: 'st-bar' + (highlightLast && i === values.length - 1 && v > 0 ? ' hi' : ''),
      style: `height:${Math.max(v / max * 100, v > 0 ? 4 : 0)}%`,
    })));
}
const axis = (l, r) => h('div', { class: 'st-axis' }, h('span', {}, l), h('span', {}, r));
function mbar(label, value, max, { amberZero = true, band = null, low = false } = {}) {
  const zero = value === 0;
  const track = h('div', { class: 'st-track' });
  if (band) {
    track.append(h('div', {
      class: 'st-band',
      style: `left:${Math.min(band[0] / max * 100, 100)}%; width:${Math.min((band[1] - band[0]) / max * 100, 100)}%`,
    }));
  }
  track.append(h('div', { class: 'st-fill' + (low || zero ? ' low' : ''), style: `width:${Math.min(value / max * 100, 100)}%` }));
  return h('div', { class: 'st-mbar' },
    h('span', { class: 'st-mn' + (zero && amberZero ? ' amber' : '') }, label),
    track,
    h('span', { class: 'st-mv' + (zero && amberZero ? ' amber' : '') }, String(value)));
}

// ── widgets ────────────────────────────────────────────────────────────────
// Each: { name, shelf, render(data) → node|null }. Render receives the shared
// derived data and may return null when the record has nothing to show.
const WIDGETS = {
  runs: {
    name: 'Days in a row', shelf: 'showing up',
    render(d) {
      const { hist, current, max } = runHistogram(d.days);
      if (!d.days.length) return null;
      const top = Math.max(...Object.values(hist));
      const rows = [];
      for (let n = 1; n <= max + 1; n++) {
        const v = hist[n] || 0;
        const label = n === 1 ? '1 day' : `${n} in a row`;
        if (n <= max) rows.push(mbar(label, v, top, { amberZero: false, low: n === 1 }));
        else rows.push(h('div', { class: 'st-mbar' },
          h('span', { class: 'st-mn cyan' }, `${n} in a row`),
          h('div', { class: 'st-track dashed' }),
          h('span', { class: 'st-mv cyan' }, '0')));
      }
      return card('Days in a row', `all ${d.days.length} training days`, ...rows,
        note(`Current run: ${current} day${current === 1 ? '' : 's'}.`));
    },
  },
  gap: {
    name: 'Gap counter', shelf: 'showing up',
    render(d) {
      if (!d.days.length) return null;
      const gap = daysAgo(d.days[d.days.length - 1]);
      const gaps = [];
      for (let i = Math.max(1, d.days.length - 30); i < d.days.length; i++) {
        gaps.push(Math.round((Date.parse(d.days[i]) - Date.parse(d.days[i - 1])) / 86400000));
      }
      gaps.sort((a, b) => a - b);
      const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
      return card('Gap', null, h('div', { class: 'st-gap' },
        h('div', { class: 'st-gap-num' },
          h('div', { class: 'st-big volt' }, String(gap)),
          h('div', { class: 'st-fl' }, gap === 1 ? 'day off' : 'days off')),
        h('div', { class: 'st-gap-txt' },
          usual != null ? `Recent gap is ${usual} day${usual === 1 ? '' : 's'}.` : '')));
    },
  },
  weekbars: {
    name: 'Week bars', shelf: 'showing up',
    render(d) {
      const weeks = weeklyAgg(d.facts, 16);
      const avg = weeks.slice(0, 13).reduce((t, w) => t + w.sessions, 0) / 13;
      return card('Consistency', 'sessions per week · 16 weeks',
        barStrip(weeks.map((w) => w.sessions), { height: 52 }),
        axis(fmtDate(weeks[0].week), 'this week'),
        note(`13-week average ${avg.toFixed(1)} per week. This week: ${weeks[15].sessions}.`));
    },
  },
  yearheat: {
    name: 'Year heat', shelf: 'showing up',
    render(d) {
      const now = new Date();
      const year = now.getFullYear();
      const trained = new Set(d.days.filter((x) => x.startsWith(String(year))));
      const jan1 = new Date(year, 0, 1);
      const start = new Date(year, 0, 1 - ((jan1.getDay() + 6) % 7));
      const weeks = Math.ceil(((now - start) / 86400000 + 1) / 7);
      const cells = []; const labels = [];
      for (let w = 0; w < weeks; w++) {
        let monthAt = '';
        for (let i = 0; i < 7; i++) {
          const dd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
          if (dd.getDate() === 1) monthAt = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][dd.getMonth()];
          const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
          const off = dd.getFullYear() !== year || dd > now;
          cells.push(h('div', { class: 'st-ghc' + (off ? ' off' : trained.has(key) ? ' on' : '') }));
        }
        labels.push(h('div', {}, monthAt));
      }
      const elapsed = Math.floor((now - jan1) / 86400000) + 1;
      return card(String(year), 'filled = a session happened',
        h('div', { class: 'st-gh' },
          h('div', { class: 'st-gh-days' }, h('span', {}, 'M'), h('span'), h('span', {}, 'W'), h('span'), h('span', {}, 'F'), h('span'), h('span')),
          h('div', { class: 'st-gh-scroll' },
            h('div', { class: 'st-gh-grid' }, ...cells),
            h('div', { class: 'st-gh-months' }, ...labels))),
        note(`${trained.size} sessions in ${elapsed} days.`));
    },
  },
  rhythm: {
    name: 'Rhythm dots', shelf: 'showing up',
    render(d) {
      const keys = weekSeq(6);
      const trained = new Set(d.days);
      const today = new Date();
      const rows = keys.map((k) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(k);
        const mon = new Date(+m[1], +m[2] - 1, +m[3]);
        const dots = [];
        for (let i = 0; i < 7; i++) {
          const dd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
          const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
          const isToday = dd.toDateString() === today.toDateString();
          dots.push(h('span', { class: 'st-dot' + (trained.has(key) ? ' on' : isToday ? ' tod' : '') }));
        }
        return h('div', { class: 'st-rhy' }, h('span', { class: 'st-rhy-wk' }, fmtDate(k).toUpperCase()), h('div', { class: 'st-dots' }, ...dots));
      });
      return card('Rhythm', 'M T W T F S S · last 6 weeks', ...rows);
    },
  },
  wave: {
    name: 'Weekly wave', shelf: 'how much',
    render(d) {
      const weeks = weeklyAgg(d.facts, 16);
      return card('Workload', 'weekly tonnage · 16 weeks',
        barStrip(weeks.map((w) => Math.round(w.tonnage)), { height: 56 }),
        axis(fmtDate(weeks[0].week), 'this week'),
        note(`This week ${fmtK(weeks[15].tonnage)} lb.`));
    },
  },
  skyline: {
    name: 'Tonnage skyline', shelf: 'how much',
    render(d) {
      const last = d.facts.slice(-20);
      if (!last.length) return null;
      const big = last.reduce((a, b) => (b.tonnage > a.tonnage ? b : a));
      return card('Volume', 'per session · last 20',
        barStrip(last.map((f) => Math.round(f.tonnage)), { height: 60, highlightLast: false }),
        axis(fmtDate(last[0].date), fmtDate(last[last.length - 1].date)),
        note(`Biggest: ${fmtK(big.tonnage)} lb on ${fmtDate(big.date)}.`));
    },
  },
  coverage: {
    name: 'Coverage heat', shelf: 'how much',
    render(d) {
      const weekly = muscleWeekly(d.facts, d.muscles, 9);
      const shade = (v) => (v === 0 ? '' : v <= 3 ? ' l1' : v <= 8 ? ' l2' : ' l3');
      const rows = MUSCLES.map((m) => {
        const s = weekly.get(m).series;
        const empty = s.every((v) => v === 0);
        return h('div', { class: 'st-cov-row' },
          h('span', { class: 'st-cov-mn' + (empty ? ' amber' : '') }, m),
          ...s.map((v) => h('div', { class: 'st-cov-c' + shade(v) })));
      });
      return card('Coverage', 'sets per muscle per week · 9 weeks', ...rows,
        axis(fmtDate(weekSeq(9)[0]), 'this week'));
    },
  },
  ladder: {
    name: 'Muscle ladder', shelf: 'how much',
    render(d) {
      const weekly = muscleWeekly(d.facts, d.muscles, 1);
      const vals = MUSCLES.map((m) => [m, weekly.get(m).series[0]]);
      vals.sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...vals.map((v) => v[1]));
      const { unmapped } = weightedWeekSets(d.facts, d.muscles);
      return card('This week', 'sets per muscle',
        ...vals.map(([m, v]) => mbar(cap(m), v, max, { low: v <= 3 })),
        unmapped.length ? note(`No muscles mapped yet: ${unmapped.join(' · ')}.`) : null);
    },
  },
  freq: {
    name: 'Times hit per week', shelf: 'how much',
    render(d) {
      const weekly = muscleWeekly(d.facts, d.muscles, 1);
      const vals = MUSCLES.map((m) => [m, weekly.get(m).daysThisWeek.size]);
      vals.sort((a, b) => b[1] - a[1]);
      return card('Times hit this week', 'tick = 2 per week',
        ...vals.map(([m, v]) => mbar(cap(m), v, 3, { band: [2, 2.08], low: v < 2 })));
    },
  },
  targets: {
    name: 'Sets vs your ranges', shelf: 'how much',
    render(d) {
      const { acc, unmapped } = weightedWeekSets(d.facts, d.muscles);
      const rows = MUSCLES.filter((m) => GROWTH_RANGES[m])
        .map((m) => ({ m, v: acc.get(m) || 0, r: GROWTH_RANGES[m] }))
        .sort((a, b) => b.v - a.v);
      return card('This week vs growth zone', 'band = your range',
        ...rows.map(({ m, v, r }) => mbar(cap(m), v, 20, { band: r, low: v < r[0] })),
        unmapped.length ? note(`Not counted, no muscles mapped: ${unmapped.join(' · ')}.`) : null);
    },
  },
  setsledger: {
    name: 'Sets ledger', shelf: 'how much',
    render(d) {
      const weeks = weeklyAgg(d.facts, 6).reverse();
      return card('Working sets', 'per week',
        ...weeks.map((w, i) => h('div', { class: 'st-lrow' },
          h('span', { class: 'st-ld' }, fmtDate(w.week)),
          h('span', { class: 'st-ln' + (w.sets ? '' : ' dim') }, i === 0 ? 'this week' : w.sets ? '' : '·'),
          h('span', { class: 'st-lv' + (w.sets ? '' : ' dim') + (i === 0 ? ' cyan' : '') }, String(w.sets)),
          h('span', { class: 'st-ld right' }, `${w.reps} reps`))));
    },
  },
  fresh: {
    name: 'Freshness board', shelf: 'bests + state',
    render(d) {
      const weekly = muscleWeekly(d.facts, d.muscles, 1);
      const rows = MUSCLES
        .map((m) => ({ m, last: weekly.get(m).last }))
        .filter((x) => x.last)
        .map((x) => ({ ...x, ago: daysAgo(x.last) }))
        .sort((a, b) => a.ago - b.ago);
      if (!rows.length) return null;
      const tone = (ago) => (ago >= 3 ? 'g' : ago >= 1 ? 'a' : 'r');
      return card('Freshness', 'time since last worked',
        h('div', { class: 'st-fresh' }, ...rows.slice(0, 8).map((x) =>
          h('div', { class: 'st-fresh-c ' + tone(x.ago) },
            h('div', { class: 'st-fresh-m' }, x.m),
            h('div', { class: 'st-fresh-d' }, x.ago === 0 ? 'today' : `${x.ago} day${x.ago === 1 ? '' : 's'}`)))));
    },
  },
  prfeed: {
    name: 'PR feed', shelf: 'bests + state',
    render(d) {
      const recs = recordFeed(d.facts).slice(0, 5);
      if (!recs.length) return null;
      return card('Records', 'latest firsts',
        ...recs.map((r) => h('div', { class: 'st-lrow' },
          h('span', { class: 'st-ld' }, fmtDate(r.date)),
          h('span', { class: 'st-ln' }, r.name),
          h('span', { class: 'st-medal' }, `${r.load} weight`))));
    },
  },
  milestones: {
    name: 'Milestones', shelf: 'bests + state',
    render(d) {
      const total = d.facts.reduce((t, f) => t + f.tonnage, 0);
      if (!total) return null;
      const next = Math.ceil(total / 500000) * 500000;
      const pct = Math.round(total / next * 100);
      return card('Milestones', `lifetime ${Math.round(total).toLocaleString()} lb`,
        h('div', { class: 'st-lrow' }, h('span', { class: 'st-ln mut' }, 'Blue whales (330,000 lb)'), h('span', { class: 'st-lv volt' }, `× ${(total / 330000).toFixed(1)}`)),
        h('div', { class: 'st-lrow' }, h('span', { class: 'st-ln mut' }, 'Statues of Liberty (450,000 lb)'), h('span', { class: 'st-lv volt' }, `× ${(total / 450000).toFixed(1)}`)),
        h('div', { class: 'st-next' },
          h('span', {}, `Next: ${next.toLocaleString()} lb`),
          h('span', { class: 'volt' }, `${pct}%`)),
        h('div', { class: 'st-prog' }, h('div', { class: 'st-prog-fill', style: `width:${pct}%` })));
    },
  },
  standards: {
    name: 'Strength standards', shelf: 'bests + state',
    render(d, ctx) {
      let e1 = 0;
      for (const f of d.facts) {
        for (const ex of f.exs) {
          if ((ex.name || '').trim().toLowerCase() !== 'bench press, barbell') continue;
          for (const s of ex.facts) if (s.clean) e1 = Math.max(e1, s.mainLoad * (1 + s.mainReps / 30));
        }
      }
      if (!e1) return null;
      const bw = getBodyweight();
      if (!bw) {
        return card('Bench standards', 'external yardstick',
          note('Standards are bodyweight multiples and no bodyweight is on record.'),
          h('button', { class: 'st-set-bw', onClick: () => ctx.router.go({ name: 'more' }) }, 'Set bodyweight'));
      }
      const lbs = bw.unit === 'kg' ? bw.v * 2.2046 : bw.v;
      const ratio = e1 / lbs;
      const TIERS = [['Untrained', 0.5], ['Novice', 0.75], ['Interm.', 1.25], ['Adv.', 1.75], ['Elite', 2.0]];
      return card('Bench standards', 'at ' + bw.v + ' ' + bw.unit + ' · external yardstick',
        h('div', { class: 'st-ruler' },
          h('div', { class: 'st-ruler-fill', style: 'width:' + Math.min(ratio / 2.25 * 100, 100) + '%' }),
          ...TIERS.map(([, r]) => h('div', { class: 'st-ruler-tick', style: 'left:' + (r / 2.25 * 100) + '%' }))),
        h('div', { class: 'st-ruler-labels' }, ...TIERS.map(([n]) => h('span', {}, n))),
        note('Best clean estimate ~' + Math.round(e1) + ', ' + ratio.toFixed(2) + ' times bodyweight. Published standards, not a verdict.'));
    },
  },
};

// ── layout persistence ─────────────────────────────────────────────────────
function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (Array.isArray(saved)) {
      const ids = saved.filter((id) => WIDGETS[id]);
      if (ids.length) return ids;
    }
  } catch (_) { /* fall through */ }
  return DEFAULT_LAYOUT.slice();
}
function saveLayout(ids) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(ids)); } catch (_) { /* device pref only */ }
}

// ── card share: clone, inline styles, rasterize, hand to the share sheet ──
async function shareCard(widgetEl, title) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed; left:-10000px; top:0; width:380px; background:#08080C; padding:16px; border-radius:18px; font-family:Outfit,sans-serif; color:#F0F0F5;';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;';
  head.innerHTML = '<span style="font-size:12px; font-weight:900; letter-spacing:3px; color:#CAFF33">ATOMIC</span>'
    + `<span style="font-size:10px; color:#4A4A52; letter-spacing:1px">${title}</span>`;
  wrap.appendChild(head);
  const clone = widgetEl.cloneNode(true);
  clone.querySelectorAll('.st-x, .st-drag, .st-share').forEach((n) => n.remove());
  clone.style.marginBottom = '0';
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  const rect = wrap.getBoundingClientRect();
  const walk = (el) => {
    if (el.nodeType !== 1) return;
    const cs = getComputedStyle(el);
    let css = '';
    for (const p of cs) {
      const v = cs.getPropertyValue(p);
      if (v.includes('url(')) continue;
      css += `${p}:${v};`;
    }
    el.setAttribute('style', css);
    [...el.children].forEach(walk);
  };
  walk(wrap);
  document.body.removeChild(wrap);
  wrap.style.position = 'static'; wrap.style.left = 'auto'; wrap.style.top = 'auto';
  const html = new XMLSerializer().serializeToString(wrap);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error('render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = rect.width * 2; canvas.height = rect.height * 2;
  const cx = canvas.getContext('2d');
  cx.scale(2, 2);
  cx.drawImage(img, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], 'atomic-card.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'atomic-card.png';
    a.click();
    toast('Image saved');
  }
}

// ── screen ─────────────────────────────────────────────────────────────────
export async function renderStats(ctx) {
  const [docs, profiles] = await Promise.all([ctx.store.allSessions(), ctx.store.allProfiles()]);
  const facts = sessionFacts(docs);
  const data = { facts, days: trainedDays(facts), muscles: muscleMap(profiles) };

  let layout = loadLayout();
  let editing = false;

  const board = h('div', { class: 'st-board' });
  const editBtn = h('button', {
    class: 'st-edit-btn',
    onClick: () => {
      if (editing) saveFromDom(); // whatever the board shows is what persists
      editing = !editing;
      sync();
    },
  }, 'Edit');
  const addBtn = h('button', { class: 'st-add-btn', onClick: () => openPicker() }, '+ Add widget');

  function widgetNode(id) {
    let inner = null;
    try { inner = WIDGETS[id].render(data, ctx); } catch (_) { inner = null; }
    if (!inner) {
      inner = card(WIDGETS[id].name, null, note('Nothing to show yet.'));
    }
    const el = h('div', { class: 'st-widget', 'data-id': id },
      h('div', { class: 'st-drag' }, '⠿'),
      h('button', { class: 'st-x', onClick: () => { layout = layout.filter((x) => x !== id); saveLayout(layout); sync(); } }, '✕'),
      h('button', { class: 'st-share', onClick: (e) => { e.stopPropagation(); shareCard(el, fmtDate(new Date().toISOString()).toUpperCase() + ' ' + new Date().getFullYear()).catch(() => toast('Share failed')); } }, '↗'),
      inner);
    return el;
  }

  function sync() {
    board.classList.toggle('editing', editing);
    editBtn.textContent = editing ? 'Done' : 'Edit';
    addBtn.style.display = editing ? '' : 'none';
    while (board.firstChild) board.removeChild(board.firstChild);
    layout.forEach((id) => board.append(widgetNode(id)));
  }

  function openPicker() {
    const shelves = [...new Set(Object.values(WIDGETS).map((w) => w.shelf))];
    const sheetBody = h('div', { class: 'st-sheet' },
      h('div', { class: 'st-sheet-title' }, 'Add widgets'));
    for (const shelf of shelves) {
      sheetBody.append(h('div', { class: 'st-shelf' }, shelf));
      for (const [id, w] of Object.entries(WIDGETS).filter(([, x]) => x.shelf === shelf)) {
        const btn = h('button', { class: 'st-pick-add' }, layout.includes(id) ? 'Added' : '+ Add');
        btn.onclick = () => {
          if (layout.includes(id)) layout = layout.filter((x) => x !== id);
          else layout.push(id);
          saveLayout(layout); sync();
          btn.textContent = layout.includes(id) ? 'Added' : '+ Add';
        };
        sheetBody.append(h('div', { class: 'st-pick' }, h('div', { class: 'st-pick-name' }, w.name), btn));
      }
    }
    const overlay = h('div', { class: 'st-sheet-wrap' }, h('div', { class: 'st-sheet-bg', onClick: () => overlay.remove() }), sheetBody);
    document.body.appendChild(overlay);
  }

  // Drag to reorder in edit mode. Listeners live on window, not the handle:
  // moving a node with insertBefore breaks pointer capture on touch, which
  // would silently eat the pointerup and the save with it.
  const saveFromDom = () => {
    layout = [...board.querySelectorAll('.st-widget')].map((w) => w.dataset.id);
    saveLayout(layout);
  };
  board.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.st-drag');
    if (!handle || !editing) return;
    e.preventDefault();
    const el = handle.closest('.st-widget');
    el.classList.add('dragging');
    const move = (ev) => {
      for (const other of board.querySelectorAll('.st-widget')) {
        if (other === el) continue;
        const r = other.getBoundingClientRect();
        if (ev.clientY > r.top && ev.clientY < r.bottom) {
          if (el.getBoundingClientRect().top < r.top) board.insertBefore(el, other.nextSibling);
          else board.insertBefore(el, other);
          break;
        }
      }
      saveFromDom();
    };
    const up = () => {
      el.classList.remove('dragging');
      saveFromDom();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  sync();

  const scroll = h('div', { class: 'screen-scroll st-screen' },
    h('div', { class: 'st-head' },
      h('div', { class: 'st-title' }, 'Stats'),
      editBtn),
    board,
    addBtn);
  return h('div', { class: 'screen' }, scroll, bottomNav('stats', ctx));
}
