// Home feed: recent sessions with live derived stats, and Log New Session.
import { h } from '../dom.js';
import { bottomNav, formatLongDate, formatTime, TRASH_ICON, sessionNoLabel } from '../ui.js';
import { sessionTonnage, sessionSetCount } from '../model.js';

export async function renderFeed(ctx) {
  const sessions = (await ctx.store.allSessions())
    .sort((a, b) => Date.parse(b.session.started_at) - Date.parse(a.session.started_at));

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'home-header' },
      h('div', { class: 'home-logo', html: 'AT<span>O</span>MIC' }),
      h('div', { class: 'home-subtitle' }, 'The rep is the atomic unit')),
    h('button', { class: 'log-new-btn', onClick: () => ctx.newSession() },
      h('span', {}, '+'), ' Log New Session'),
    h('div', { class: 'feed-head' },
      h('div', { class: 'feed-label' }, 'Recent Sessions'),
      h('div', { class: 'feed-links' },
        h('button', { class: 'import-link', onClick: () => ctx.exportWodis() }, 'Export'),
        h('button', { class: 'import-link', onClick: () => ctx.importCsv() }, 'Import'))),
  );

  if (!sessions.length) {
    scroll.append(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-emoji', html: '&#9883;' }),
      h('div', {}, 'No sessions yet.'),
      h('div', { class: 'empty-sub' }, 'Tap Log New Session to start, or bring your history in.'),
      h('button', { class: 'import-btn', onClick: () => ctx.importCsv() }, 'Import History')));
  } else {
    sessions.forEach((doc, i) => scroll.append(sessionCard(ctx, doc, sessions.length - i)));
  }

  return h('div', { class: 'screen' }, scroll, bottomNav('feed', ctx));
}

function sessionCard(ctx, doc, number) {
  const s = doc.session;
  const label = s.split_type ? `${formatLongDate(s.started_at)} · ${s.split_type}` : formatLongDate(s.started_at);
  const names = s.exercises.map((e) => e.display_name).join(', ') || 'No exercises';
  const sets = sessionSetCount(doc);

  return h('div', { class: 'session-card', onClick: () => ctx.router.go({ name: 'session', sessionId: s.id }) },
    h('div', { class: 'sc-top' },
      h('span', { class: 'sc-date' }, label),
      h('div', { class: 'sc-meta' },
        h('span', { class: 'sc-no' }, sessionNoLabel(number)),
        h('span', { class: 'sc-duration' }, formatTime(s.started_at)))),
    h('div', { class: 'sc-exercises' }, names),
    h('div', { class: 'sc-bottom' },
      h('span', { class: 'sc-stat', html: `<strong>${sessionTonnage(doc).toLocaleString()}</strong> ${s.load_unit}` }),
      h('span', { class: 'sc-stat', html: `<strong>${sets}</strong> set${sets !== 1 ? 's' : ''}` }),
      s.ended_at ? null : h('span', { class: 'sc-live' }, 'In progress'),
      h('button', {
        class: 'sc-del', 'aria-label': 'Delete session', title: 'Delete session', html: TRASH_ICON,
        onClick: (e) => { e.stopPropagation(); deleteSessionCard(ctx, doc); },
      })));
}

async function deleteSessionCard(ctx, doc) {
  if (!window.confirm("Delete this session? This can't be undone.")) return;
  await ctx.store.deleteSession(doc.session.id);
  ctx.router.go({ name: 'feed' });
}
