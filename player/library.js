// Song library: reference tracks (read-only, served from songs/), the user's songs and sounds (IndexedDB).
const DB_NAME = 'segapaint', STORE = 'songs', SOUNDS = 'sounds';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!names.contains(SOUNDS)) req.result.createObjectStore(SOUNDS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn, store = STORE) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const listRefs = () => fetch('songs/index.json').then((r) => r.json());
export async function listMine() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.map(({ id, name, base, updated }) => ({ id, name, base, updated })).sort((a, b) => b.updated - a.updated);
}
export const getMine = (id) => tx('readonly', (s) => s.get(id));
export const putMine = (rec) => tx('readwrite', (s) => s.put({ ...rec, updated: Date.now() }));
export const deleteMine = (id) => tx('readwrite', (s) => s.delete(id));

// My sounds: records in the format of the library's (sounds.json) plus type (fm / drums / psg / noise / samples)
// and key 'my:<id>'; a sample carries its bytes (pcm, Uint8Array) and its loop point from its start (loopAt, -1 none).
export async function listMySounds() {
  const all = await tx('readonly', (s) => s.getAll(), SOUNDS);
  return all.sort((a, b) => a.created - b.created);
}
export function putMySound(rec) {
  const now = Date.now();
  return tx('readwrite', (s) => s.put({ created: now, ...rec, key: 'my:' + rec.id, updated: now }), SOUNDS);
}
export const deleteMySound = (id) => tx('readwrite', (s) => s.delete(id), SOUNDS);
export const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Reference song with its display metadata merged in.
export async function fetchRef(dir) {
  const base = `songs/${dir}/`;
  const [song, meta] = await Promise.all([
    fetch(base + 'song.json').then((r) => r.json()),
    fetch(base + 'meta.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  for (const L of song.layers) Object.assign(L, meta.layers?.[L.id] || {});
  (song.samples || []).forEach((smp, i) => Object.assign(smp, meta.samples?.[i] || {}));
  song.game = meta.game || song.game || '';
  // the Description panel's pages (pictures go by the song's folder); not enumerable, so a saved copy leaves them out
  if (meta.info?.pages?.length) Object.defineProperty(song, 'info', { value: { ...meta.info, base }, configurable: true });
  return song;
}

const banks = new Map();
export async function fetchBank(dir, file) {
  const key = dir + '/' + file;
  if (!banks.has(key)) banks.set(key, fetch(`songs/${key}`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)));
  return banks.get(key);
}

// The shared sound library (tools/build_sound_library.py): every sound the example songs play, for every channel,
// grouped by game; the samples in one bank.
export async function fetchCatalog() {
  try {
    const [cat, bank] = await Promise.all([
      fetch('library/sounds.json').then((r) => r.json()),
      fetch('library/samples.bin').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    ]);
    for (const g of cat.games) for (const sec of ['samples', 'fm', 'drums', 'psg', 'noise']) for (const x of g[sec] || []) x.game = g.game;
    return { games: cat.games, bank };
  } catch (e) {
    return { games: [], bank: new Uint8Array(0) };
  }
}
