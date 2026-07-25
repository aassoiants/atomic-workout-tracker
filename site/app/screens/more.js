// More: app-level tools that don't belong on the feed. The public build's
// first tenant: bodyweight, which feeds derived views like strength standards.
import { h } from '../dom.js';
import { bottomNav, bodyweightCard } from '../ui.js';

export async function renderMore(ctx) {
  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'feed-head' }, h('div', { class: 'feed-label' }, 'Bodyweight')),
    bodyweightCard());
  return h('div', { class: 'screen' }, scroll, bottomNav('more', ctx));
}
