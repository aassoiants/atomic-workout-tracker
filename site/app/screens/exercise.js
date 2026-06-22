// Exercise screen: fast weight x reps logging, with drop sub-rows and a ⋯ to
// drill into a set's per-rep detail.
import { h, clear } from '../dom.js';
import { bottomNav } from '../ui.js';
import { findExercise, addSet, setSummary } from '../model.js';

export async function renderExercise(ctx, sessionId, exerciseId) {
  const doc = await ctx.store.getSession(sessionId);
  const ex = doc && findExercise(doc, exerciseId);
  if (!ex) { ctx.router.go({ name: 'session', sessionId }); return h('div'); }
  const unit = doc.session.load_unit;

  const tbody = h('tbody');
  const table = h('table', { class: 'set-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Set'),
      h('th', {}, unit === 'kg' ? 'Kg' : 'Lbs'),
      h('th', {}, 'Reps'),
      h('th', {}),
      h('th', {}))),
    tbody);

  function renderBody() {
    clear(tbody);
    ex.sets.forEach((set, i) => {
      const sum = setSummary(set);
      const detailed = Array.isArray(set.reps) && set.reps.length > 0;
      const hasDrops = sum.drops.length > 0;
      tbody.append(h('tr', { class: hasDrops ? 'has-detail' : '' },
        h('td', { class: 'set-num-cell' }, String(i + 1)),
        h('td', {}, String(set.load)),
        h('td', {}, String(sum.reps)),
        h('td', {}, h('span', {
          class: 'more-dots' + (detailed ? ' detailed' : ''), html: '⋯',
          onClick: () => ctx.router.go({ name: 'detail', sessionId, exerciseId, setId: set.id }),
        })),
        h('td', {}, h('span', {
          class: 'set-delete', html: '&#8722;',
          onClick: async () => { ex.sets.splice(i, 1); await ctx.store.saveSession(doc); renderBody(); setNumEl.textContent = String(ex.sets.length + 1); },
        }))));
      sum.drops.forEach((d) => tbody.append(h('tr', { class: 'drop-row' },
        h('td', {}),
        h('td', {}, h('span', { class: 'drop-weight' }, String(d.load))),
        h('td', {}, h('span', { class: 'drop-reps' }, String(d.reps))),
        h('td', {}),
        h('td', {}))));
    });
  }

  const setNumEl = h('span', { class: 'set-num' }, String(ex.sets.length + 1));
  const lastLoad = ex.sets.length ? ex.sets[ex.sets.length - 1].load : '';
  const weightInput = h('input', { class: 'input-field', type: 'number', inputmode: 'decimal', value: lastLoad, placeholder: unit });
  const repsInput = h('input', { class: 'input-field', type: 'number', inputmode: 'numeric', placeholder: 'reps' });

  const logSet = async () => {
    const reps = parseInt(repsInput.value, 10);
    if (isNaN(reps)) { repsInput.focus(); return; }
    const load = parseFloat(weightInput.value);
    addSet(ex, { load: isNaN(load) ? 0 : load, reps_completed: reps });
    await ctx.store.saveSession(doc);
    renderBody();
    setNumEl.textContent = String(ex.sets.length + 1);
    repsInput.value = '';
    repsInput.focus();
  };
  repsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') logSet(); });

  const inputRow = h('div', { class: 'input-row' },
    setNumEl, weightInput, h('span', { class: 'input-multiply' }, '×'), repsInput,
    h('button', { class: 'log-set-btn', onClick: logSet }, 'Log'));

  renderBody();

  const scroll = h('div', { class: 'screen-scroll' },
    h('div', { class: 'ex-header' },
      h('div', { class: 'ex-header-top' },
        h('span', { class: 'ex-back', html: '&#8592;', onClick: () => ctx.router.go({ name: 'session', sessionId }) }),
        h('button', { class: 'done-btn', onClick: () => ctx.router.go({ name: 'session', sessionId }) }, 'Done')),
      h('div', { class: 'ex-name' }, ex.display_name)),
    exerciseNote(ctx, doc, ex),
    h('div', { class: 'content' }, table, inputRow));

  return h('div', { class: 'screen' }, scroll, bottomNav('log', ctx));
}

// Per-exercise free-text note (WODIS exercise.notes), mirrors the session note.
function exerciseNote(ctx, doc, ex) {
  let t;
  const ta = h('textarea', {
    class: 'note-input', rows: '2', placeholder: 'Add a note about this exercise...',
    onInput: (e) => {
      ex.notes = e.target.value;
      clearTimeout(t);
      t = setTimeout(() => ctx.store.saveSession(doc), 400);
    },
  });
  ta.value = ex.notes || '';
  return h('div', { class: 'note-area' }, ta);
}
