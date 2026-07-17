// More: app-level tools that don't belong on the feed. First tenant: sync
// setup + status. Uses real in-page inputs (never window.prompt) so switching
// to a password manager to fetch the token doesn't dismiss the form. Setup runs
// an explicit connection test and shows the real result — no silent failures.
import { h } from '../dom.js';
import { bottomNav, toast } from '../ui.js';
import { syncStatus, setConfig, testEndpoint, pushAll, lastEndpoint } from '../sync.js';

const BUILD = 'v32';

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
    const status = h('div', { class: 'sync-sub', style: 'min-height:18px' }, '');
    const btn = h('button', { class: 'sync-on-btn' }, 'Turn on sync');
    btn.onclick = async () => {
      const url = urlInput.value.trim();
      const token = tokenInput.value.trim();
      if (!url || !token) { status.textContent = 'Enter both the endpoint and token.'; return; }
      btn.disabled = true;
      status.textContent = 'Testing connection…';
      let probe;
      try {
        probe = await testEndpoint(url, token); // { status } or throws a network/CORS error
      } catch (e) {
        btn.disabled = false;
        status.textContent = 'Can’t reach the server: ' + (e && e.message ? e.message : e) +
          '  (endpoint typo, or the phone isn’t routing to the box)';
        return;
      }
      if (probe.status === 401) {
        btn.disabled = false;
        status.textContent = 'Server reached, but the token was rejected (401). Re-copy the token.';
        return;
      }
      if (probe.status !== 200 && probe.status !== 404) {
        btn.disabled = false;
        status.textContent = 'Server reached but returned HTTP ' + probe.status + '. Check the endpoint path.';
        return;
      }
      // Reachable and authed (200 = has data, 404 = empty). Save + push.
      setConfig(url, token);
      status.textContent = 'Connected. Uploading your history…';
      try {
        await pushAll(ctx.store);
        toast('Sync on');
        ctx.router.go({ name: 'more' });
      } catch (e) {
        status.textContent = 'Connected, but the upload failed: ' + (e && e.message ? e.message : e);
      }
    };
    scroll.append(
      h('div', { class: 'sync-card' },
        h('div', { class: 'sync-sub' }, 'Sync your history to your own server. It stays private to your devices.'),
        h('label', { class: 'sync-label' }, 'Endpoint'), urlInput,
        h('label', { class: 'sync-label' }, 'Token'), tokenInput,
        btn, status));
  }

  scroll.append(h('div', { class: 'sync-build' }, 'Atomic ' + BUILD));
  return h('div', { class: 'screen' }, scroll, bottomNav('more', ctx));
}
