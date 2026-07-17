// More: app-level tools that don't belong on the feed. First tenant: sync
// setup + status. Reuses the card styles so no new CSS is needed.
import { h } from '../dom.js';
import { bottomNav } from '../ui.js';
import { syncStatus } from '../sync.js';

export async function renderMore(ctx) {
  const st = syncStatus();
  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'feed-head' },
      h('div', { class: 'feed-label' }, 'Sync')),
    h('div', { class: 'session-card', onClick: () => ctx.syncSetup() },
      h('div', { class: 'sc-top' },
        h('span', { class: 'sc-date' }, st.on ? 'On' : 'Off')),
      h('div', { class: 'sc-exercises' }, st.on ? st.url : 'Sync to your own server'),
      st.on && st.last
        ? h('div', { class: 'sc-bottom' },
            h('span', { class: 'sc-stat' }, 'Last push ' + new Date(st.last).toLocaleString()))
        : null),
  );
  return h('div', { class: 'screen' }, scroll, bottomNav('more', ctx));
}
