import * as FileSystem from 'expo-file-system/legacy';

/**
 * On-device draft storage for the field flows, so an app kill / crash / lost
 * signal mid-task never costs the employee their work.
 *
 * Drafts are JSON files and photos live in the app's document directory — NOT the
 * cache directory the camera writes to, which Android may purge at any time. Uses
 * expo-file-system only (already in the build), so shipping this is an OTA update.
 *
 * Everything here swallows its own errors: a draft is a safety net, and a storage
 * hiccup must never break the flow it is protecting.
 */

const BASE = FileSystem.documentDirectory; // null on web — everything becomes a no-op
const DRAFT_DIR = BASE ? `${BASE}drafts/` : null;
const PHOTO_DIR = BASE ? `${BASE}draft-photos/` : null;
const UPLOADED_FILE = DRAFT_DIR ? `${DRAFT_DIR}_uploaded.json` : null;

export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PHOTO_ORPHAN_AGE_MS = 60 * 60 * 1000;

const safe = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, '_');
const draftPath = (key: string) => `${DRAFT_DIR}${safe(key)}.json`;

async function ensureDir(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export interface StoredDraft<T> { data: T; savedAt: number }

export async function readDraft<T>(key: string): Promise<StoredDraft<T> | null> {
  if (!DRAFT_DIR) return null;
  try {
    const path = draftPath(key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      await deleteDraft(key);
      return null;
    }
    return parsed as StoredDraft<T>;
  } catch {
    return null; // corrupt / unreadable — behave as "no draft"
  }
}

// Serialised so two quick saves of the same draft can never interleave.
let writeChain: Promise<unknown> = Promise.resolve();

export function writeDraft<T>(key: string, data: T): Promise<void> {
  if (!DRAFT_DIR) return Promise.resolve();
  const job = writeChain.then(async () => {
    try {
      await ensureDir(DRAFT_DIR);
      const path = draftPath(key);
      const tmp = `${path}.tmp`;
      // Write-then-rename: a kill mid-write leaves the previous draft intact.
      await FileSystem.writeAsStringAsync(tmp, JSON.stringify({ data, savedAt: Date.now() } satisfies StoredDraft<T>));
      await FileSystem.deleteAsync(path, { idempotent: true });
      await FileSystem.moveAsync({ from: tmp, to: path });
    } catch (e) {
      console.warn('[drafts] save failed:', (e as Error)?.message);
    }
  });
  writeChain = job;
  return job;
}

/** Deletes the draft and the photos only it referenced. */
export async function deleteDraft(key: string): Promise<void> {
  if (!DRAFT_DIR) return;
  try {
    const path = draftPath(key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(path).catch(() => '');
      for (const uri of photoUrisIn(raw)) await deletePhoto(uri);
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch { /* best effort */ }
}

function photoUrisIn(raw: string): string[] {
  if (!PHOTO_DIR) return [];
  const out = new Set<string>();
  const re = /draft-photos\/[A-Za-z0-9._-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.add(`${BASE}${m[0]}`);
  return [...out];
}

// ------------------------------------------------------------------ photos

/** Copies a fresh camera capture somewhere the OS will not purge. Falls back to the original. */
export async function persistPhoto(uri: string): Promise<string> {
  if (!PHOTO_DIR) return uri;
  try {
    await ensureDir(PHOTO_DIR);
    const dest = `${PHOTO_DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

export async function fileExists(uri: string | null | undefined): Promise<boolean> {
  if (!uri) return false;
  try { return (await FileSystem.getInfoAsync(uri)).exists; } catch { return false; }
}

export async function deletePhoto(uri: string): Promise<void> {
  if (!PHOTO_DIR || !uri.startsWith(PHOTO_DIR)) return; // never touch files we did not create
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  forgetUpload(uri);
}

// ------------------------------------------------------------ uploaded-photo cache
// local photo uri -> public url. After a flaky submit, photos that already made it
// to storage are not uploaded again.

let uploaded: Record<string, string> | null = null;

async function loadUploaded(): Promise<Record<string, string>> {
  if (uploaded) return uploaded;
  uploaded = {};
  if (UPLOADED_FILE) {
    try {
      const info = await FileSystem.getInfoAsync(UPLOADED_FILE);
      if (info.exists) uploaded = JSON.parse(await FileSystem.readAsStringAsync(UPLOADED_FILE)) ?? {};
    } catch { uploaded = {}; }
  }
  return uploaded!;
}

async function saveUploaded() {
  if (!UPLOADED_FILE || !DRAFT_DIR || !uploaded) return;
  const snapshot = JSON.stringify(uploaded);
  writeChain = writeChain.then(async () => {
    try { await ensureDir(DRAFT_DIR); await FileSystem.writeAsStringAsync(UPLOADED_FILE, snapshot); } catch { /* best effort */ }
  });
}

export async function getUploadedUrl(uri: string): Promise<string | null> {
  return (await loadUploaded())[uri] ?? null;
}

export async function rememberUpload(uri: string, url: string): Promise<void> {
  // Only photos we persisted are worth remembering; cache-dir uris may vanish.
  if (!PHOTO_DIR || !uri.startsWith(PHOTO_DIR)) return;
  (await loadUploaded())[uri] = url;
  await saveUploaded();
}

function forgetUpload(uri: string) {
  if (uploaded && uri in uploaded) { delete uploaded[uri]; void saveUploaded(); }
}

// -------------------------------------------------------------------- listing / cleanup

/** Keys (file stems) of every saved draft. */
export async function listDraftKeys(): Promise<string[]> {
  if (!DRAFT_DIR) return [];
  try {
    const info = await FileSystem.getInfoAsync(DRAFT_DIR);
    if (!info.exists) return [];
    return (await FileSystem.readDirectoryAsync(DRAFT_DIR))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch { return []; }
}

/** Drops drafts past their max age and photos no draft references any more. Run once at launch. */
export async function pruneDrafts(): Promise<void> {
  if (!DRAFT_DIR || !PHOTO_DIR) return;
  try {
    const referenced = new Set<string>();
    for (const stem of await listDraftKeys()) {
      const stored = await readDraft(stem); // deletes it when expired
      if (stored) for (const u of photoUrisIn(JSON.stringify(stored.data))) referenced.add(u);
    }
    const info = await FileSystem.getInfoAsync(PHOTO_DIR);
    if (!info.exists) return;
    for (const f of await FileSystem.readDirectoryAsync(PHOTO_DIR)) {
      const uri = `${PHOTO_DIR}${f}`;
      if (referenced.has(uri)) continue;
      const fi = await FileSystem.getInfoAsync(uri);
      // modificationTime is in seconds. The grace period protects a photo taken
      // moments ago that its draft has not been written for yet.
      const age = fi.exists && fi.modificationTime ? Date.now() - fi.modificationTime * 1000 : Infinity;
      if (age > PHOTO_ORPHAN_AGE_MS) await deletePhoto(uri);
    }
  } catch { /* best effort */ }
}
