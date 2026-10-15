// Song pages: the art editor's tab for a song's Description panel (meta.json "info": {"pages": [...]}). A page is a
// picture ({picture: "../_games/<game>/<name>.png", caption}) or text ({title, text}). Pick a song, add, delete and
// reorder its pages, write their text or choose their picture. Save sends the changed songs to the dev server
// (tools/serve.py, POST /api/song-info), which writes only "info" and backs up the old meta.json. Saved pages are
// marked "edited", so tools/song_info.py leaves them alone.
import { THEMES, drawText, textWidth, fitText } from './pixel.js';

const PIC_W = 124, PIC_H = 86, CAP_H = 13, Z = 2; // the panel's picture box and its caption line, drawn ×2
const pictureUrl = (p) => 'songs/_games/' + p.slice('../_games/'.length);
const imgs = new Map();
function img(url, then) {
  let im = imgs.get(url);
  if (!im) { im = new Image(); im.src = url + '?v=' + Date.now(); imgs.set(url, im); }
  if (!im.complete) im.addEventListener('load', then, { once: true });
  return im.complete && im.naturalWidth ? im : null;
}
function wrapText(t, w) { // as the player wraps it
  const lines = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (textWidth(next) > w && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function makePages({ $, btn, status }) {
  const sp = {
    songs: [], songsByDir: new Map(), dir: null, page: 0,
    edits: new Map(), // dir -> { pages, saved (JSON of the pages on disk), undo: [], redo: [], extra }
    games: {}, typing: false,
  };
  const cur = () => sp.edits.get(sp.dir);
  const pages = () => cur()?.pages || [];
  const isDirty = (e) => JSON.stringify(e.pages) !== e.saved;
  const dirtyCount = () => [...sp.edits.values()].filter(isDirty).length;

  // ---------- loading ----------
  const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  async function loadSongs() {
    if (!sp.songs.length) {
      const index = (await json('songs/index.json')) || [];
      sp.songs = index.filter((e) => e.dir && !e.dir.startsWith('_'));
      sp.songsByDir = new Map(sp.songs.map((e) => [e.dir, e]));
    }
    // the pictures every time: the Song pictures tab may have made new ones
    const r = await json('api/game-pictures');
    sp.games = r?.games || {};
    if (!r) status('The pictures list needs the dev server (python tools/serve.py)');
  }
  let opening = 0; // only the last song asked for opens (a click while another one loads)
  async function openSong(dir) {
    const me = ++opening;
    if (!sp.edits.has(dir)) {
      const meta = await json(`songs/${dir}/meta.json`);
      if (me !== opening) return;
      if (!meta) { status(`songs/${dir}/meta.json did not load`); return; }
      const { pages: ps = [], ...extra } = meta.info || {};
      const clean = ps.map((p) => (p.picture ? { picture: p.picture, caption: p.caption || '' } : { title: p.title || '', text: p.text || '' }));
      sp.edits.set(dir, { pages: clean, saved: JSON.stringify(clean), undo: [], redo: [], extra });
    }
    sp.dir = dir; sp.page = 0;
    buildList(); buildBar(); buildCards(); buildSide();
  }

  // ---------- changes (each one undoable) ----------
  function snapshot() { const e = cur(); e.undo.push(JSON.stringify(e.pages)); if (e.undo.length > 100) e.undo.shift(); e.redo = []; }
  function change(fn) { snapshot(); fn(cur().pages); after(); }
  function after() { buildList(); buildBar(); buildCards(); buildSide(); }
  function undoRedo(redo) {
    const e = cur();
    if (!e) return;
    const [from, to] = redo ? [e.redo, e.undo] : [e.undo, e.redo];
    if (!from.length) return;
    to.push(JSON.stringify(e.pages));
    e.pages = JSON.parse(from.pop());
    sp.page = Math.min(sp.page, Math.max(0, e.pages.length - 1));
    after();
  }
  function add(kind) {
    if (!cur()) return;
    const ps = pages(), at = ps.length ? sp.page + 1 : 0;
    const p = kind === 'picture' ? { picture: firstPicture(), caption: '' } : { title: 'New page', text: '' };
    if (kind === 'picture' && !p.picture) { status('No pictures yet: make some in the Song pictures tab'); return; }
    change((list) => list.splice(at, 0, p));
    sp.page = at; after();
    if (kind === 'text') { $('pgTitle').focus(); $('pgTitle').select(); }
  }
  function firstPicture() {
    const game = gameOf(sp.dir), list = sp.games[game] || Object.values(sp.games)[0] || [];
    const g = sp.games[game] ? game : Object.keys(sp.games)[0];
    return list.length ? `../_games/${g}/${list[0].name}.png` : null;
  }
  // the pictures folder of a song's game: Skitchin' -> skitchin
  const gameOf = (dir) => (sp.songsByDir.get(dir)?.game || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function remove() {
    if (!pages().length) return;
    change((list) => list.splice(sp.page, 1));
    sp.page = Math.max(0, Math.min(sp.page, pages().length - 1)); after();
  }
  function duplicate() {
    if (!pages().length) return;
    change((list) => list.splice(sp.page + 1, 0, { ...list[sp.page] }));
    sp.page++; after();
  }
  function move(from, to) {
    const ps = pages();
    if (from === to || from < 0 || to < 0 || from >= ps.length || to >= ps.length) return;
    change((list) => list.splice(to, 0, ...list.splice(from, 1)));
    sp.page = to; after();
  }

  // ---------- saving ----------
  async function save() {
    const todo = [...sp.edits].filter(([, e]) => isDirty(e));
    if (!todo.length) { status('Nothing to save'); return; }
    status('Saving…');
    try {
      let backup = '';
      for (const [dir, e] of todo) {
        const r = await fetch('api/song-info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir, info: { ...e.extra, edited: true, pages: e.pages } }),
        });
        const res = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
        if (!res.ok) throw new Error(`${dir}: ${res.error}`);
        e.saved = JSON.stringify(e.pages); e.extra.edited = true; backup = res.backup;
      }
      after();
      status(`Saved ${todo.map(([d]) => sp.songsByDir.get(d)?.title || d).join(', ')} · old meta.json in art/backup/${backup} · reload the player to see it`);
    } catch (err) { after(); status('Not saved: ' + err.message + ' (is the dev server running?)'); }
  }
  function revert() {
    const e = cur();
    if (!e || !isDirty(e) || !confirm('Throw away the changes to this song’s pages?')) return;
    snapshot();
    e.pages = JSON.parse(e.saved); sp.page = 0; after();
  }

  // ---------- left: the songs ----------
  function buildList() {
    const box = $('left');
    box.innerHTML = '';
    let game = null;
    for (const s of sp.songs) {
      if (s.game !== game) { game = s.game; const h = document.createElement('h2'); h.textContent = game || 'Other'; box.append(h); }
      const e = sp.edits.get(s.dir), b = document.createElement('button');
      b.className = 'item' + (s.dir === sp.dir ? ' on' : '');
      b.textContent = (e && isDirty(e) ? '● ' : '') + s.title + (e ? ` · ${e.pages.length}` : '');
      b.title = e && isDirty(e) ? 'Changed, not saved' : '';
      b.onclick = () => openSong(s.dir);
      box.append(b);
    }
  }

  // ---------- the bar ----------
  function buildBar() {
    const bar = $('bar');
    bar.innerHTML = '';
    const e = cur();
    if (!e) { const s = document.createElement('span'); s.className = 'hint'; s.textContent = 'Choose a song on the left.'; bar.append(s); return; }
    const t = document.createElement('b');
    t.textContent = sp.songsByDir.get(sp.dir)?.title || sp.dir;
    const n = pages().length, none = !n;
    const x = (text, fn, title, off = false) => { const b = btn(text, fn); b.title = title; b.disabled = off; return b; };
    bar.append(t,
      x('+ Picture', () => add('picture'), 'New picture page after this one'),
      x('+ Text', () => add('text'), 'New text page after this one'),
      x('Duplicate', duplicate, 'Copy of this page after it', none),
      x('Delete', remove, 'Delete this page · Delete', none),
      x('◀', () => move(sp.page, sp.page - 1), 'Move this page left · Alt+←', none || sp.page === 0),
      x('▶', () => move(sp.page, sp.page + 1), 'Move this page right · Alt+→', none || sp.page >= n - 1));
    const sv = x(dirtyCount() > 1 ? `Save ${dirtyCount()} songs` : 'Save pages', save, 'Save the changed songs · Ctrl+S', !dirtyCount());
    sv.className = 'primary';
    bar.append(sv, x('Revert', revert, 'Back to the saved pages of this song', !isDirty(e)));
  }

  // ---------- the middle: every page as the player draws it, in order ----------
  function drawPage(p, k, n) {
    const T = THEMES.light, cv = document.createElement('canvas');
    const W = PIC_W + 6, H = PIC_H + CAP_H + 2;
    cv.width = W * Z; cv.height = H * Z;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.scale(Z, Z);
    g.fillStyle = T.face; g.fillRect(0, 0, W, H);
    const px = 3, py = 1;
    let overflow = false;
    if (p.picture) {
      const im = img(pictureUrl(p.picture), () => buildCards());
      if (im) g.drawImage(im, px, py, PIC_W, PIC_H);
      else { g.fillStyle = T.dim; g.fillRect(px, py, PIC_W, PIC_H); drawText(g, 'NO PICTURE', px + 40, py + 40, T.face); }
    } else {
      let ty = py + 3;
      if (p.title) { drawText(g, fitText(p.title, PIC_W - 4), px + 2, ty, T.head); ty += 10; }
      for (const para of String(p.text || '').split('\n')) {
        for (const line of wrapText(para, PIC_W - 4)) { if (ty + 5 <= py + PIC_H) drawText(g, line, px + 2, ty, T.ink); else overflow = true; ty += 7; }
        ty += 3;
      }
    }
    // the caption line under it: 2/5 · caption
    const ny = py + PIC_H + 1;
    g.fillStyle = T.ink; g.fillRect(0, ny, W, 1);
    const num = `${k + 1}/${n}`, cap = p.caption || p.title || '';
    const label = cap ? `${num} · ${fitText(cap, W - 36 - textWidth(num) - 8)}` : num;
    drawText(g, label, (W - textWidth(label)) >> 1, ny + 4, T.dim);
    if (overflow) { g.strokeStyle = '#ff2400'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, PIC_W - 1, PIC_H - 1); }
    return [cv, overflow];
  }
  function buildCards() {
    const box = $('pagesView');
    box.innerHTML = '';
    const ps = pages(), n = ps.length;
    if (!cur()) return;
    if (!n) { const d = document.createElement('div'); d.className = 'note'; d.textContent = 'No pages: the player hides the Description panel for this song. Add a picture or a text page above.'; box.append(d); }
    ps.forEach((p, k) => {
      const b = document.createElement('button');
      b.className = 'cel page' + (k === sp.page ? ' on' : '');
      b.draggable = true;
      const [cv, overflow] = drawPage(p, k, n);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${k + 1} · ${p.picture ? 'picture' : 'text'}${overflow ? ' · text does not fit' : ''}`;
      if (overflow) num.style.color = '#ff2400';
      b.append(num, cv);
      b.title = 'Click to edit · drag to move';
      b.onclick = () => { sp.page = k; buildCards(); buildSide(); buildBar(); };
      b.ondragstart = (e) => e.dataTransfer.setData('text/x-page', String(k));
      b.ondragover = (e) => { if (e.dataTransfer.types.includes('text/x-page')) { e.preventDefault(); b.classList.add('drop'); } };
      b.ondragleave = () => b.classList.remove('drop');
      b.ondrop = (e) => { e.preventDefault(); b.classList.remove('drop'); move(+e.dataTransfer.getData('text/x-page'), k); };
      box.append(b);
    });
    box.children[sp.page]?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- right: the chosen page ----------
  function buildSide() {
    const p = pages()[sp.page];
    $('pgNone').classList.toggle('hidden', !!p);
    $('pgPicture').classList.toggle('hidden', !p?.picture);
    $('pgText').classList.toggle('hidden', !p || !!p.picture);
    if (!p) { $('pgNone').textContent = cur() ? 'No page chosen.' : 'Choose a song on the left.'; return; }
    $('pgKind').textContent = `Page ${sp.page + 1} of ${pages().length}`;
    if (p.picture) {
      if (document.activeElement !== $('pgCaption')) $('pgCaption').value = p.caption || '';
      const box = $('pgPics');
      box.innerHTML = '';
      const games = Object.keys(sp.games), mine = gameOf(sp.dir);
      games.sort((a, b) => (b === mine) - (a === mine)); // the song's own game first
      for (const game of games) {
        const h = document.createElement('div');
        h.className = 'note'; h.textContent = game;
        box.append(h);
        const grid = document.createElement('div');
        grid.className = 'picgrid';
        for (const it of sp.games[game]) {
          const path = `../_games/${game}/${it.name}.png`, b = document.createElement('button');
          b.className = 'pic' + (p.picture === path ? ' on' : '');
          b.title = it.name;
          const im = new Image();
          im.src = pictureUrl(path) + '?v=' + Date.now();
          b.append(im);
          b.onclick = () => {
            const cap = p.caption;
            change((list) => { list[sp.page].picture = path; });
            // a caption still empty gets the picture's name (los-angeles -> Los Angeles)
            if (!cap) { pages()[sp.page].caption = it.name.replace(/-\d+$/, '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); after(); }
          };
          grid.append(b);
        }
        box.append(grid);
      }
    } else {
      if (document.activeElement !== $('pgTitle')) $('pgTitle').value = p.title || '';
      if (document.activeElement !== $('pgBody')) $('pgBody').value = p.text || '';
    }
  }
  // typing: one undo step per field visit, the cards follow as you type
  function field(id, key) {
    const el = $(id);
    el.addEventListener('focus', () => { sp.typing = false; });
    el.addEventListener('input', () => {
      const p = pages()[sp.page];
      if (!p) return;
      if (!sp.typing) { snapshot(); sp.typing = true; }
      p[key] = el.value;
      buildCards(); buildList(); buildBar();
    });
    el.addEventListener('blur', () => { sp.typing = false; });
  }
  field('pgCaption', 'caption'); field('pgTitle', 'title'); field('pgBody', 'text');

  function key(e) {
    const mod = e.ctrlKey || e.metaKey, typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (mod && e.code === 'KeyS') { e.preventDefault(); save(); return; }
    if (typing) return;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); undoRedo(e.shiftKey); }
    else if (mod && e.code === 'KeyY') { e.preventDefault(); undoRedo(true); }
    else if (e.altKey && e.code === 'ArrowLeft') { e.preventDefault(); move(sp.page, sp.page - 1); }
    else if (e.altKey && e.code === 'ArrowRight') { e.preventDefault(); move(sp.page, sp.page + 1); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const n = pages().length;
      if (n) { sp.page = (sp.page + (e.code === 'ArrowLeft' ? n - 1 : 1)) % n; buildCards(); buildSide(); buildBar(); }
    } else if (e.code === 'Delete') { e.preventDefault(); remove(); }
  }

  return {
    async enter() {
      await loadSongs();
      if (!sp.dir && !opening && sp.songs.length) await openSong(sp.songs[0].dir);
      else after();
    },
    key, save, undo: () => undoRedo(false), redo: () => undoRedo(true),
    get dirty() { return dirtyCount() > 0; },
  };
}
