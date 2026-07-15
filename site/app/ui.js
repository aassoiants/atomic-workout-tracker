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
    item('log', '&#9883;', 'Log', () => ctx.startLog()),
    item('stats', '&#9779;', 'Stats', () => toast('Stats — coming soon')),
    item('more', '&#9881;', 'More', () => toast('More — coming soon')),
  );
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
