// WODIS export/restore: the manual backup until sync lands. Export bundles
// every stored session into one .wodis.json handed to the OS share sheet
// (download on desktop); restore reads that file back in, skipping sessions
// already present. The file is a JSON array of WODIS documents — the spec
// defines a document as one session, the array is just the carton.
import { toWODIS, fromWODIS, localISO } from './model.js';
import { toast } from './ui.js';
import { normalizeName } from './plan.js';

export async function exportWodis(store) {
  // Spec conformance: an exported document MUST have >= 1 exercise, so
  // note-only sessions stay local (they aren't valid WODIS on their own).
  const docs = (await store.allSessions())
    .filter((d) => d.session.exercises.length)
    .sort((a, b) => Date.parse(a.session.started_at) - Date.parse(b.session.started_at))
    .map(toWODIS);
  if (!docs.length) { toast('Nothing to export yet'); return; }

  const name = `atomic-${localISO(new Date()).slice(0, 10)}.wodis.json`;
  const json = JSON.stringify(docs);
  const file = new File([json], name, { type: 'application/json' });

  const canNativeShare = (() => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); }
    catch (_) { return false; }
  })();
  if (canNativeShare) {
    try {
      await navigator.share({ files: [file], title: 'Atomic training history' });
      toast(`Exported ${docs.length} sessions`);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the sheet
      // fall through to download
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Exported ${docs.length} sessions`);
}

// Read a .wodis.json (array or single document) back into the store.
// Dedupes by session.id — restoring on top of existing data is safe.
// Also accepts an exercise-profiles file ({ atomic_exercise_profiles: [...] })
// so library metadata (bucket, muscles) can be seeded through the same button.
export async function restoreWodis(store, text) {
  const parsed = JSON.parse(text);
  if (parsed && Array.isArray(parsed.atomic_exercise_profiles)) {
    return restoreProfiles(store, parsed.atomic_exercise_profiles);
  }
  if (parsed && Array.isArray(parsed.atomic_renames)) {
    return applyRenames(store, parsed.atomic_renames);
  }
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  const have = new Set((await store.allSessions()).map((d) => d.session.id));
  let added = 0;
  let skipped = 0;
  for (const raw of docs) {
    if (!raw || !raw.session || !Array.isArray(raw.session.exercises)) { skipped += 1; continue; }
    const doc = fromWODIS(raw);
    if (have.has(doc.session.id)) continue;
    await store.saveSession(doc);
    have.add(doc.session.id);
    added += 1;
  }
  return { added, skipped };
}

// Rename an exercise everywhere: every session document (the file is the
// source of truth, so history itself is corrected), then the profile key.
// Renaming onto an existing exercise merges the two histories; the newer
// profile wins. Returns the number of sessions rewritten.
export async function renameExercise(store, oldName, newName) {
  const from = normalizeName(oldName);
  const to = normalizeName(newName);
  const clean = newName.trim();
  let touched = 0;
  for (const d of await store.allSessions()) {
    let hit = false;
    for (const ex of d.session.exercises) {
      if (normalizeName(ex.display_name) === from) { ex.display_name = clean; hit = true; }
    }
    if (hit) { await store.saveSession(d); touched += 1; }
  }
  const src = await store.getProfile(from);
  const now = new Date().toISOString();
  if (to === from) {
    if (src) await store.saveProfile({ ...src, display_name: clean, updated_at: now });
  } else {
    const dst = await store.getProfile(to);
    const winner = src && dst
      ? ((src.updated_at || '') > (dst.updated_at || '') ? src : dst)
      : (src || dst);
    if (winner) await store.saveProfile({ ...winner, name: to, display_name: clean, updated_at: now });
    if (src) await store.deleteProfile(from);
  }
  return touched;
}

// Batch renames from an imported map ({ atomic_renames: [{from, to}] }).
// Re-importing is a no-op: applied entries no longer match anything.
async function applyRenames(store, list) {
  let renames = 0;
  let renameSessions = 0;
  let skipped = 0;
  for (const r of list) {
    if (!r || !r.from || !r.to || normalizeName(r.from) === normalizeName(r.to)) { skipped += 1; continue; }
    const touched = await renameExercise(store, r.from, r.to);
    if (touched) { renames += 1; renameSessions += touched; } else skipped += 1;
  }
  return { renames, renameSessions, skipped };
}

// Newer updated_at wins; a hand-edited profile on the device never loses to a
// stale seed file.
async function restoreProfiles(store, list) {
  let profilesAdded = 0;
  let profilesUpdated = 0;
  let skipped = 0;
  for (const p of list) {
    if (!p || !p.name || typeof p.name !== 'string') { skipped += 1; continue; }
    const existing = await store.getProfile(p.name);
    if (!existing) { await store.saveProfile(p); profilesAdded += 1; continue; }
    if ((p.updated_at || '') > (existing.updated_at || '')) { await store.saveProfile(p); profilesUpdated += 1; }
    else skipped += 1;
  }
  return { profilesAdded, profilesUpdated, skipped };
}
