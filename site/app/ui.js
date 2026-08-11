// Shared UI bits: bottom nav and time/date formatters.
import { h } from './dom.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';

export function sessionNoLabel(n) { return 'No. ' + String(n).padStart(4, '0'); }

export function bottomNav(active, ctx) {
  const item = (key, icon, label, onClick) =>
    h('div', { class: 'nav-item' + (active === key ? ' active' : ''), onClick: onClick || null },
      h('span', { class: 'nav-icon', html: icon }), label);
  return h('div', { class: 'bottom-nav' },
    item('feed', '&#9776;', 'Feed', () => ctx.router.go({ name: 'feed' })),
    item('stats', '&#9638;', 'Stats', () => ctx.router.go({ name: 'stats' })),
    item('library', '&#9636;', 'Exercises', () => ctx.router.go({ name: 'library' })),
    item('more', '&#9881;', 'More', () => ctx.router.go({ name: 'more' })),
  );
}

// ── Bodyweight ─────────────────────────────────────────────────────────────
// The latest value lives in localStorage as a fast synchronous cache; every
// save also appends to the dated weigh-in log in the store (one entry per
// day), which rides the carton so derived views can use the bodyweight that
// was true when a set was logged.
export function getBodyweight() {
  try {
    const b = JSON.parse(localStorage.getItem('atomic-bodyweight'));
    return b && b.v > 0 ? b : null;
  } catch (_) { return null; }
}

// ── Standards lens: sex + age ──────────────────────────────────────────────
// Device-side viewer settings (localStorage). They parameterize which
// published reference table a derived view reads; they are not part of the
// training record and never ride the carton.
export function getSex() {
  try {
    const s = localStorage.getItem('atomic-sex');
    return s === 'male' || s === 'female' ? s : null;
  } catch (_) { return null; }
}

export function getAge() {
  try {
    const a = parseInt(localStorage.getItem('atomic-age'), 10);
    return a > 0 && a < 120 ? a : null;
  } catch (_) { return null; }
}

export function standardsLensCard() {
  const chips = {};
  const select = (key) => {
    try {
      if (getSex() === key) { localStorage.removeItem('atomic-sex'); key = null; }
      else localStorage.setItem('atomic-sex', key);
    } catch (_) { /* device pref only */ }
    for (const k of Object.keys(chips)) chips[k].classList.toggle('on', k === key);
  };
  for (const s of ['male', 'female']) {
    chips[s] = h('button', { class: 'bw-unit sex-chip', onClick: () => select(s) }, s === 'male' ? 'Male' : 'Female');
  }
  const cur = getSex();
  if (cur) chips[cur].classList.add('on');
  const age = h('input', {
    class: 'bw-input', type: 'number', inputmode: 'numeric', placeholder: 'Age (optional)',
    value: getAge() ? String(getAge()) : '',
    onChange: (e) => {
      const a = parseInt(e.target.value, 10);
      try {
        if (a > 0 && a < 120) localStorage.setItem('atomic-age', String(a));
        else localStorage.removeItem('atomic-age');
      } catch (_) { /* device pref only */ }
    },
  });
  return h('div', { class: 'st-card bw-card' },
    h('div', { class: 'bw-row' }, chips.male, chips.female, age),
    h('div', { class: 'bw-sub' }, 'Only used to pick which published strength table your lifts are compared against. Age waits for age-graded tables. This device only.'));
}

export function bodyweightCard(ctx) {
  const cur = getBodyweight();
  let unit = cur ? cur.unit : 'lbs';
  const input = h('input', {
    class: 'bw-input', type: 'number', inputmode: 'decimal',
    placeholder: 'Bodyweight', value: cur ? String(cur.v) : '',
  });
  const unitBtns = {};
  const setUnit = (u) => {
    unit = u;
    unitBtns.lbs.classList.toggle('on', u === 'lbs');
    unitBtns.kg.classList.toggle('on', u === 'kg');
  };
  unitBtns.lbs = h('button', { class: 'bw-unit', onClick: () => setUnit('lbs') }, 'lbs');
  unitBtns.kg = h('button', { class: 'bw-unit', onClick: () => setUnit('kg') }, 'kg');
  const saved = h('div', { class: 'bw-sub' },
    cur ? `On record: ${cur.v} ${cur.unit} (${cur.at})` : 'Not set yet.');
  const save = h('button', {
    class: 'bw-save',
    onClick: async () => {
      const v = parseFloat(input.value);
      if (!(v > 0)) { toast('Enter a number'); return; }
      const today = new Date().toISOString().slice(0, 10);
      try {
        localStorage.setItem('atomic-bodyweight', JSON.stringify({ v, unit, at: today }));
      } catch (_) { /* cache only */ }
      if (ctx && ctx.store) await ctx.store.saveBodyweight({ date: today, v, unit });
      toast('Bodyweight saved');
      history.back();
    },
  }, 'Save');
  setUnit(unit);
  return h('div', { class: 'st-card bw-card' },
    h('div', { class: 'bw-row' }, input, unitBtns.lbs, unitBtns.kg),
    h('div', { class: 'bw-sub' }, 'Weigh in the morning, after the bathroom, before coffee. Same conditions every time.'),
    save, saved);
}

// Wall-clock date/time parsed straight from the stored local-offset ISO, so it
// shows when it was logged regardless of the viewer's current timezone.
export function formatLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const y = +m[1]; const mo = +m[2] - 1; const d = +m[3];
  return `${DAYS[new Date(y, mo, d).getDay()]} · ${MONTHS[mo]} ${d}, ${y}`;
}

export function formatTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  if (!m) return '';
  let h = +m[1]; const min = m[2];
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

// Duration in seconds → compact clock string: 30 → "0:30", 2700 → "45:00",
// 3720 → "1:02:00".
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
