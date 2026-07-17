// More: app-level tools that don't belong on the feed. First tenant: sync
// setup + status. Uses real in-page inputs (never window.prompt) so switching
// to a password manager to fetch the token doesn't dismiss the form.
import { h } from '../dom.js';
import { bottomNav, toast } from '../ui.js';
import { syncStatus, setConfig, initSync, lastEndpoint } from '../sync.js';

export async function renderMore(ctx) {
  const st = syncStatus();
  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'feed-head' }, h('div', { class: 'feed-label' }, 'Sync')));

  if (st.on) {
    scroll.append(
      h('div', { class: 'sync-card' },
        h('div', { class: 'sync-state' }, 'On'),
        h('div', { class: 'sync-url' }, st.url),
        st.last ? h('div', { class: 'sync-sub' }, 'Last push ' + new Date(st.last).toLocaleString()) : null,
        h('button', { class: 'sync-off-btn', onClick: () => {
          if (window.confirm('Turn sync off on this device? Your data stays; it just stops syncing here.')) {
            setConfig(null); toast('Sync off'); ctx.router.go({ name: 'more' });
          }
        } }, 'Turn off sync')));
  } else {
    const urlInput = h('input', {
      class: 'sync-input', type: 'url', value: lastEndpoint(),
      placeholder: 'https://your-server/sync', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    });
    const tokenInput = h('input', {
      class: 'sync-input', type: 'text', placeholder: 'Paste your sync token',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    });
    scroll.append(
      h('div', { class: 'sync-card' },
        h('div', { class: 'sync-sub' }, 'Sync your history to your own server. It stays private to your devices.'),
        h('label', { class: 'sync-label' }, 'Endpoint'), urlInput,
        h('label', { class: 'sync-label' }, 'Token'), tokenInput,
        h('button', { class: 'sync-on-btn', onClick: async (e) => {
          const url = urlInput.value.trim();
          const token = tokenInput.value.trim();
          if (!url || !token) { toast('Enter both the endpoint and token'); return; }
          e.target.disabled = true; e.target.textContent = 'Connecting…';
          setConfig(url, token);
          try {
            await initSync(ctx.store);
            toast('Sync on');
          } catch {
            setConfig(null); toast('Could not reach the server — check the endpoint and token');
          }
          ctx.router.go({ name: 'more' });
        } }, 'Turn on sync')));
  }

  return h('div', { class: 'screen' }, scroll, bottomNav('more', ctx));
}
