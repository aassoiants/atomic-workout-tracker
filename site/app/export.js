// WODIS export/restore: the manual backup until sync lands. Export bundles
// every stored session into one .wodis.json handed to the OS share sheet
// (download on desktop); restore reads that file back in, skipping sessions
// already present. The file is a JSON array of WODIS documents — the spec
// defines a document as one session, the array is just the carton.
import { toWODIS, fromWODIS, localISO } from './model.js';
import { toast } from './ui.js';

// Spec conformance: an exported document MUST have >= 1 exercise, so
// note-only sessions stay local (they aren't valid WODIS on their own).
// Shared by manual export and sync push — the synced blob IS the export format.
export async function buildExportDocs(store) {
  return (await store.allSessions())
    .filter((d) => d.session.exercises.length)
    .sort((a, b) => Date.parse(a.session.started_at) - Date.parse(b.session.started_at))
    .map(toWODIS);
}

export async function exportWodis(store) {
  const docs = await buildExportDocs(store);
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
export async function restoreWodis(store, text) {
  const parsed = JSON.parse(text);
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
