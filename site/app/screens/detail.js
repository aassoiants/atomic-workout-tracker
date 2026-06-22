// Per-rep detail: each rep its own row with its own load and flags.
// Failure maps to WODIS completed:false; assisted/partial are rep flags.
import { h, clear } from '../dom.js';
import { bottomNav } from '../ui.js';
import { findExercise, syncSet } from '../model.js';

const FLAGS = [
  { key: 'assisted', label: 'Assisted', cls: 'assisted', icon: '✦' },
  { key: 'partial', label: 'Partial', cls: 'partial', icon: '◑' },
  { key: 'failure', label: 'Failure', cls: 'failure', icon: '⚠' },
];

function hasFlag(rep, key) {
  return key === 'failure' ? rep.completed === false : !!rep[key];
}
function toggleFlag(rep, key) {
  if (key === 'failure') { if (rep.completed === false) delete rep.completed; else rep.completed = false; }
  else if (rep[key]) delete rep[key];
  else rep[key] = true;
}

export async function renderDetail(ctx, sessionId, exerciseId, setId) {
  const doc = await ctx.store.getSession(sessionId);
  const ex = doc && findExercise(doc, exerciseId);
  const set = ex && ex.sets.find((s) => s.id === setId);
  if (!set) { ctx.router.go({ name: 'exercise', sessionId, exerciseId }); return h('div'); }
  const unit = doc.session.load_unit;
  const setIndex = ex.sets.indexOf(set) + 1;

  // Materialize reps in-memory for editing; only persisted once something changes.
  if (!Array.isArray(set.reps)) {
    set.reps = Array.from({ length: Math.max(0, set.reps_completed | 0) }, () => ({ load: set.load }));
  }

  const scroll = h('div', { class: 'screen-scroll' });
  const rows = h('div', { class: 'rep-rows' });
  const title = h('div', { class: 'detail-title' });
  const repNext = h('span', { class: 'set-num' }, String(set.reps.length + 1));
  const renderTitle = () => { title.innerHTML = `Set ${setIndex} &middot; <span class="rep-count">${set.reps.length} Reps</span>`; };

  let popover = null;
  const closePopover = () => { if (popover) { popover.remove(); popover = null; } };
  const save = () => { syncSet(set); ctx.store.saveSession(doc); };

  function repRow(rep, i) {
    const changed = Number(rep.load) !== Number(set.load);
    const flagsCell = h('div', { class: 'rep-flags' });
    const renderFlags = () => {
      clear(flagsCell);
      FLAGS.forEach((f) => { if (hasFlag(rep, f.key)) flagsCell.append(h('span', { class: 'rep-flag ' + f.cls }, f.label)); });
    };
    renderFlags();
    const row = h('div', { class: 'rep-row' + (changed ? ' weight-changed' : '') },
      h('span', { class: 'rep-num' }, String(i + 1)),
      h('div', { class: 'rep-weight-cell' }, h('span', { class: 'rep-weight' + (changed ? ' changed' : '') }, String(rep.load))),
      flagsCell,
      h('div', { class: 'rep-more', html: '⋯', onClick: (e) => { e.stopPropagation(); togglePopover(row, rep, renderFlags); } }),
      h('div', { class: 'rep-delete', html: '&#8722;', onClick: (e) => { e.stopPropagation(); deleteRep(rep); } }));
    return row;
  }

  function togglePopover(row, rep, renderFlags) {
    if (popover && popover._row === row) { closePopover(); return; }
    closePopover();
    const pop = h('div', { class: 'flag-popover' });
    pop._row = row;
    FLAGS.forEach((f, idx) => {
      if (idx) pop.append(h('div', { class: 'popover-divider' }));
      const item = h('div', { class: 'popover-item' + (hasFlag(rep, f.key) ? ' active' : ''), onClick: (e) => {
        e.stopPropagation();
        toggleFlag(rep, f.key);
        item.classList.toggle('active');
        renderFlags();
        save();
      } }, h('span', { class: 'pi-icon', html: f.icon }), f.label);
      pop.append(item);
    });
    row.appendChild(pop);
    popover = pop;
  }

  function deleteRep(rep) {
    closePopover();
    if (set.reps.length <= 1) return;
    const idx = set.reps.indexOf(rep);
    if (idx > -1) set.reps.splice(idx, 1);
    refreshRows();
    save();
  }

  function refreshRows() {
    clear(rows);
    set.reps.forEach((rep, i) => rows.append(repRow(rep, i)));
    renderTitle();
    repNext.textContent = String(set.reps.length + 1);
  }
  refreshRows();

  const lastLoad = set.reps.length ? set.reps[set.reps.length - 1].load : set.load;
  const weightInput = h('input', { class: 'input-field', type: 'number', inputmode: 'decimal', value: lastLoad });
  const preselect = new Set();
  const tagRow = h('div', { class: 'tags' });
  FLAGS.forEach((f) => {
    const tag = h('span', { class: 'tag', onClick: () => {
      if (preselect.has(f.key)) { preselect.delete(f.key); tag.classList.remove('active'); }
      else { preselect.add(f.key); tag.classList.add('active'); }
    } }, f.label);
    tagRow.append(tag);
  });

  const addRep = () => {
    const load = parseFloat(weightInput.value);
    const rep = { load: isNaN(load) ? set.load : load };
    if (preselect.has('assisted')) rep.assisted = true;
    if (preselect.has('partial')) rep.partial = true;
    if (preselect.has('failure')) rep.completed = false;
    set.reps.push(rep);
    rows.append(repRow(rep, set.reps.length - 1));
    renderTitle();
    repNext.textContent = String(set.reps.length + 1);
    weightInput.value = rep.load;
    preselect.clear();
    tagRow.querySelectorAll('.tag').forEach((t) => t.classList.remove('active'));
    save();
    setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 30);
  };
  weightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRep(); });
  const inputRow = h('div', { class: 'input-row' },
    repNext, weightInput, h('span', { class: 'input-multiply' }, unit), h('button', { class: 'log-set-btn', onClick: addRep }, 'Log'));

  const back = () => { closePopover(); ctx.router.go({ name: 'exercise', sessionId, exerciseId }); };
  scroll.append(
    h('div', { class: 'detail-header' },
      h('span', { class: 'detail-back', html: '&#8592;', onClick: back }),
      title,
      h('button', { class: 'done-btn', onClick: back }, 'Done')),
    h('div', { class: 'rep-content' },
      h('div', { class: 'rep-table-header' },
        h('span', {}, 'Rep'), h('span', {}, unit === 'kg' ? 'Kg' : 'Lbs'), h('span', {}, 'Flags'), h('span', {}), h('span', {})),
      rows, inputRow, tagRow));

  const screen = h('div', { class: 'screen' }, scroll, bottomNav('log', ctx));
  screen.addEventListener('click', closePopover);
  return screen;
}
