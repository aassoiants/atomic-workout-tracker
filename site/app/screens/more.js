// More: app-level tools that don't belong on the feed. Bodyweight feeds
// derived views like strength standards; Appearance holds the theme picker.
import { h } from '../dom.js';
import { bottomNav, bodyweightCard, standardsLensCard, toast } from '../ui.js';

const THEMES = [
  { key: 'volt',  name: 'Volt',  sub: 'the original', dots: ['#0A0A0F', '#CAFF33', '#00E5FF'] },
  { key: 'berry', name: 'Pink',  sub: 'berry dusk',   dots: ['#1C0913', '#FF6FAE', '#FF9E6B'] },
];
const THEME_COLOR = { volt: '#0A0A0F', berry: '#1C0913' };

function currentTheme() {
  try { return localStorage.getItem('atomic-theme') === 'berry' ? 'berry' : 'volt'; }
  catch (_) { return 'volt'; }
}

function applyTheme(key) {
  if (key === 'volt') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', key);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[key]);
  try {
    if (key === 'volt') localStorage.removeItem('atomic-theme');
    else localStorage.setItem('atomic-theme', key);
  } catch (_) { /* device pref only */ }
}

function appearanceCard() {
  const chips = {};
  const select = (key) => {
    applyTheme(key);
    for (const k of Object.keys(chips)) chips[k].classList.toggle('sel', k === key);
    toast(key === 'volt' ? 'Volt is back' : 'Pink mode on');
  };
  for (const t of THEMES) {
    chips[t.key] = h('button', { class: 'theme-chip', onClick: () => select(t.key) },
      h('div', { class: 'chip-dots' }, ...t.dots.map((c) => h('i', { style: `background:${c}` }))),
      h('div', { class: 'chip-name' }, t.name),
      h('div', { class: 'chip-sub' }, t.sub));
  }
  chips[currentTheme()].classList.add('sel');
  return h('div', { class: 'st-card bw-card' },
    h('div', { class: 'theme-row' }, ...THEMES.map((t) => chips[t.key])),
    h('div', { class: 'bw-sub' }, 'Applies right away, this device only. Your record never changes, only the paint.'));
}

export async function renderMore(ctx) {
  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'feed-head' }, h('div', { class: 'feed-label' }, 'Appearance')),
    appearanceCard(),
    h('div', { class: 'feed-head', style: 'margin-top:22px' }, h('div', { class: 'feed-label' }, 'Bodyweight')),
    bodyweightCard(ctx),
    h('div', { class: 'feed-head', style: 'margin-top:22px' }, h('div', { class: 'feed-label' }, 'Standards lens')),
    standardsLensCard());
  return h('div', { class: 'screen' }, scroll, bottomNav('more', ctx));
}
