// Share a session as a self-contained image. The card mirrors the "quiet dark"
// design and is generated live from the WODIS doc — never stored. The card's CSS
// lives here as a string so it can be inlined into the SVG at capture time
// (external stylesheets don't apply inside an <svg><foreignObject>).
import { h } from './dom.js';
import { sessionTonnage, sessionSetCount, sessionReps, sessionNumber, setTonnage, exerciseSetSummary } from './model.js';
import { toast } from './ui.js';

const X = '×';      // ×
const DROP = '↳';   // ↳
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SHARE_CARD_CSS = `
.share-card, .share-card * { box-sizing: border-box; margin: 0; padding: 0; }
.share-card {
  --shc-bg:#15161A; --shc-ink:#ECEDE8; --shc-mut:#A6A8A0; --shc-mut2:#9A9C94;
  --shc-faint:rgba(255,255,255,0.07); --shc-faint2:rgba(255,255,255,0.05);
  --shc-volt:#CAFF33; --shc-fail:#C9A24B;
  --shc-mono:ui-monospace,'Cascadia Code','Consolas',monospace;
  width:414px; background:var(--shc-bg); color:var(--shc-ink);
  border:1px solid var(--shc-faint); border-radius:18px; padding:24px 24px 18px;
  font-family:'Outfit','Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
}
.share-card.dense { width:556px; }
.shc-head { display:flex; align-items:center; gap:11px; }
.shc-tick { width:3px; height:19px; background:var(--shc-volt); border-radius:1.5px; flex:none; }
.shc-date { flex:1; font-size:16px; font-weight:600; }
.shc-no { font-family:var(--shc-mono); font-size:11px; letter-spacing:0.14em; color:var(--shc-mut2); }
.shc-stats { display:flex; gap:30px; margin:22px 0 24px; }
.shc-v { font-size:23px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
.shc-v.shc-accent { color:var(--shc-volt); }
.shc-l { font-family:var(--shc-mono); font-size:11px; letter-spacing:0.13em; text-transform:uppercase; color:var(--shc-mut2); margin-top:7px; }
.shc-loghead { display:flex; align-items:baseline; padding-bottom:8px; border-bottom:1px solid var(--shc-faint);
  font-family:var(--shc-mono); font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:var(--shc-mut2); }
.shc-loghead-r { margin-left:auto; letter-spacing:0.13em; }
.shc-exlist { display:grid; grid-template-columns:minmax(0,1fr); }
.share-card.dense .shc-exlist { grid-template-columns:minmax(0,1fr) minmax(0,1fr); column-gap:26px; }
.shc-ex { padding:11px 0; border-bottom:1px solid var(--shc-faint2); break-inside:avoid; }
.shc-ex-top { display:flex; align-items:baseline; gap:10px; }
.shc-ex-name { flex:1; font-size:15px; font-weight:600; }
.share-card.dense .shc-ex-name { font-size:13px; }
.shc-ex-vol { font-family:var(--shc-mono); font-size:12px; color:var(--shc-mut); font-variant-numeric:tabular-nums; white-space:nowrap; }
.shc-ex-sets { font-family:var(--shc-mono); font-size:12.5px; color:var(--shc-mut); margin-top:5px; line-height:1.5; font-variant-numeric:tabular-nums; }
.share-card.dense .shc-ex-sets { font-size:11px; }
.shc-tok { white-space:nowrap; }
.shc-drop { color:var(--shc-volt); }
.shc-flag { font-size:11px; }
.shc-failed { color:var(--shc-fail); }
.shc-empty { font-style:italic; color:var(--shc-mut2); }
.shc-foot { margin-top:16px; }
.shc-mark { font-size:12px; font-weight:400; letter-spacing:0.04em; color:var(--shc-mut2); }
.shc-mark b { color:var(--shc-ink); font-weight:600; }
`;

function fmtDate(iso) {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function exerciseTonnage(ex) {
  return ex.sets.reduce((t, s) => t + setTonnage(s), 0);
}
function pushFlags(toks, g) {
  if (g.assisted) toks.push(`<span class="shc-tok shc-flag">· ${g.assisted} assisted</span>`);
  if (g.partial) toks.push(`<span class="shc-tok shc-flag">· ${g.partial} partial</span>`);
  if (g.failed) toks.push(`<span class="shc-tok shc-flag shc-failed">· ${g.failed} failed</span>`);
}
function setTokens(set) {
  const toks = [`<span class="shc-tok">${set.load}${X}${set.reps}</span>`];
  pushFlags(toks, set);
  for (const d of set.drops) {
    toks.push(`<span class="shc-tok shc-drop">${DROP}${d.load}${X}${d.reps}</span>`);
    pushFlags(toks, d);
  }
  return toks.join(' ');
}
function exSetsHtml(ex) {
  const summary = exerciseSetSummary(ex);
  if (!summary.length) return '<span class="shc-empty">No sets logged</span>';
  return summary.map(setTokens).join(', ');
}

// Build the share-card element from a WODIS doc. `number` is the optional
// session ordinal (e.g. 324) shown as "NO. 0324".
export function buildShareCard(doc, { number } = {}) {
  const s = doc.session;
  const unit = s.load_unit;
  const dense = s.exercises.length > 6;
  const rows = s.exercises.map((ex) => `
    <div class="shc-ex">
      <div class="shc-ex-top">
        <span class="shc-ex-name">${esc(ex.display_name)}</span>
        <span class="shc-ex-vol">${exerciseTonnage(ex).toLocaleString()}</span>
      </div>
      <div class="shc-ex-sets">${exSetsHtml(ex)}</div>
    </div>`).join('');

  const card = h('div', { class: 'share-card' + (dense ? ' dense' : '') });
  card.innerHTML = `
    <div class="shc-head">
      <span class="shc-tick"></span>
      <span class="shc-date">${fmtDate(s.started_at)}</span>
      ${number ? `<span class="shc-no">NO. ${String(number).padStart(4, '0')}</span>` : ''}
    </div>
    <div class="shc-stats">
      <div class="shc-stat"><div class="shc-v shc-accent">${sessionTonnage(doc).toLocaleString()}</div><div class="shc-l">${unit} volume</div></div>
      <div class="shc-stat"><div class="shc-v">${sessionSetCount(doc)}</div><div class="shc-l">sets</div></div>
      <div class="shc-stat"><div class="shc-v">${sessionReps(doc)}</div><div class="shc-l">reps</div></div>
    </div>
    <div class="shc-loghead"><span>Session log</span><span class="shc-loghead-r">Vol · ${unit}</span></div>
    <div class="shc-exlist">${rows}</div>
    <div class="shc-foot"><span class="shc-mark"><b>Atomic</b> Workout Tracker</span></div>`;
  return card;
}

let cssInjected = false;
function ensureCss() {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.id = 'share-card-css';
  style.textContent = SHARE_CARD_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// Show the generated card in an overlay with a Share/Save action.
export async function openSharePreview(ctx, doc) {
  ensureCss();
  let number;
  try {
    number = sessionNumber(await ctx.store.allSessions(), doc);
  } catch (_) { /* ordinal is optional */ }

  const card = buildShareCard(doc, { number });
  const frame = h('div', { class: 'share-card-frame' }, card);
  const overlay = h('div', { class: 'share-overlay', onClick: (e) => { if (e.target === overlay) close(); } });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  // Phones get a native share sheet; desktop gets clipboard-copy (paste into
  // chat) as the primary, with a plain download as the fallback.
  const canNativeShare = (() => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'a.png', { type: 'image/png' })] })); }
    catch (_) { return false; }
  })();
  const primary = canNativeShare
    ? h('button', { class: 'share-save', onClick: () => shareNative(card, doc) }, 'Share')
    : h('button', { class: 'share-save', onClick: () => copyImage(card) }, 'Copy image');
  const secondary = canNativeShare
    ? h('button', { class: 'share-cancel', onClick: () => copyImage(card) }, 'Copy')
    : h('button', { class: 'share-cancel', onClick: () => downloadImage(card, doc) }, 'Download');

  overlay.append(h('div', { class: 'share-sheet' },
    frame,
    h('div', { class: 'share-actions' },
      h('button', { class: 'share-cancel', onClick: close }, 'Close'),
      secondary,
      primary)));
  document.body.appendChild(overlay);

  // Scale the full-size card down to fit the viewport for preview.
  requestAnimationFrame(() => {
    const avail = Math.min(window.innerWidth - 40, 600);
    const w = card.offsetWidth;
    if (w > avail) {
      const sc = avail / w;
      card.style.transformOrigin = 'top left';
      card.style.transform = `scale(${sc})`;
      frame.style.width = `${Math.round(w * sc)}px`;
      frame.style.height = `${Math.round(card.offsetHeight * sc)}px`;
    }
  });
}

// Rasterize the card to a PNG (zero-dependency: serialize to an SVG
// <foreignObject> with inlined CSS, draw to a canvas, export a blob) and hand
// it to the OS share sheet, falling back to a download.
// NOTE: the foreignObject→canvas path and web-font rendering must be verified
// on a real Android device before we trust it (tied to the PWA deploy, todo #10).
async function captureBlob(card) {
  const w = card.offsetWidth;
  const ht = card.offsetHeight;
  const scale = 3;
  const xml = new XMLSerializer().serializeToString(card);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${ht}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml"><style>${SHARE_CARD_CSS}</style>${xml}</div>` +
    `</foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = ht * scale;
  const cx = canvas.getContext('2d');
  cx.scale(scale, scale);
  cx.drawImage(img, 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
}

function fileName(doc) { return `atomic-${doc.session.id.slice(0, 8)}.png`; }

// Capture at full resolution (un-scale the on-screen preview first), then restore.
async function withFullRes(card, fn) {
  const prev = card.style.transform;
  card.style.transform = 'none';
  try { return await fn(); } finally { card.style.transform = prev; }
}

// Copy the image to the clipboard so it can be pasted straight into a chat.
async function copyImage(card) {
  try {
    const blob = await withFullRes(card, () => captureBlob(card));
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('clipboard unavailable');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied — paste it into your chat');
  } catch (_) {
    toast('Copy not supported here — use Download');
  }
}

// Hand the image to the OS share sheet (phones).
async function shareNative(card, doc) {
  try {
    const blob = await withFullRes(card, () => captureBlob(card));
    await navigator.share({ files: [new File([blob], fileName(doc), { type: 'image/png' })], title: 'Atomic session' });
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user dismissed the sheet
    toast('Could not share on this device');
  }
}

// Save the PNG (desktop fallback).
async function downloadImage(card, doc) {
  try {
    const blob = await withFullRes(card, () => captureBlob(card));
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: fileName(doc) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Image saved');
  } catch (_) {
    toast('Could not generate the image on this device');
  }
}
