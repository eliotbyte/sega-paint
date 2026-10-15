// Art editor: every picture of the player in its own file (art/<kind>/<name>.png, frame 2: <name>-2.png, listed in
// art/art.json), the track colours (art/palette.json) and the interface colours (art/theme.json). Save sends the
// changes to the dev server (tools/serve.py), which writes them into the project and backs up the old files.
import { makePhotos } from './photos.js';
import { makePages } from './songpages.js';
import { THEMES, LAYER_TONES, LV, lvOf, parseColor, themeLevels, applyTheme, drawText, NOTE_INKS, TOOL_W, TOOL_H, CELL, ICON_W, ICON_H, CURSOR } from './pixel.js';

const $ = (id) => document.getElementById(id);
const css = (c) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent');
const lv = (c) => c.map((v) => LV[v]); // 3-bit levels -> 0..255
const KINDS = [
  ['tools', 'Buttons', 'Toolbar icon, 16×15 (in the middle of a 20×19 button). Black is the icon: the interface colours paint it, anything else is ignored.'],
  ['small', 'Small icons', 'Small button icon, 12×12. Black is the icon.'],
  ['notes', 'Notes', 'Note, 8×8. Black outline and the three note yellows (light, body, shade): the player paints them in the track colour.'],
  ['cursors', 'Cursors', 'Mouse pointer, 16×16, drawn as it looks (any colour; empty is see-through). The pivot (red) is the point that clicks: set it with the Pivot tool.'],
  ['clefs', 'Clefs', 'Clef. Black is the clef; the player draws it in the staff colour, at its place on the staff.'],
  ['pictures', 'Pictures', 'A picture drawn as it is (Sonic on the playhead: sonicIdle, sonicWalk).'],
];
// what the frames of each kind do in the player
const FRAME_HINT = {
  tools: 'Frame 2 shows while the button is on; more are not used.', small: 'Frame 2 shows while the button is on; more are not used.',
  notes: 'Frame 1: the still note. The others play in turn while it sounds, one per eighth note.',
  cursors: 'Frame 2 shows while a mouse button is down; more are not used.', clefs: 'Only frame 1 is used.',
  pictures: 'All frames play in a loop.',
};
const NOTE_PX = 8;
const SIZES = { tools: [ICON_W, ICON_H], small: [CELL, CELL], notes: [NOTE_PX, NOTE_PX], cursors: [CURSOR, CURSOR] };
const TONE_NAMES = ['Yellow', 'Red', 'Green', 'Blue', 'Purple', 'Orange', 'Cyan', 'Pink', 'Brown', 'Grey', 'Lime', 'Teal'];
// What each interface colour paints
const THEME_INFO = {
  bg: 'Window background', face: 'Buttons and panels', hover: 'Button under the mouse', ink: 'Icons and text',
  dim: 'Second text (hints, shortcuts)', off: 'Disabled icons and text', sel: 'Pressed / chosen button, selection, title bars',
  selInk: 'Icon and text on a pressed button', soft: 'Current row in a list', paper: 'Staff paper', staff: 'Staff lines',
  bar: 'Bar lines, repeat signs', faded: 'Faint staff lines (8va)', beat: 'Beat grid', keys: 'Piano keys',
  shade: 'Shaded rows / time out of the song', lane: 'Chosen drum lane', lcd: 'Display background', lcdInk: 'Display numbers',
  lcdDim: 'Display labels', head: 'Playhead, lit key', loop: 'Green repeat (loop)', rep: 'Repeat bar on the ruler',
  red: 'Mute button', green: 'Solo button', white: 'Text on red / green', hiRep: 'Repeat tool: bars under the mouse',
  hiLoop: 'Repeat tool: loop bars', hiDel: 'Repeat tool: bars to remove', ghostTo: 'Other tracks’ notes fade to this',
  ghostOutline: 'Other tracks’ note outline',
};

const st = {
  tick: 0, toneMode: 'active',
  art: {}, // kind -> Map(name -> { info, frames: [canvas] })
  kind: 'tools', name: null, frame: 0, tool: 'pen', color: [0, 0, 0],
  zoom: 16, ox: 0, oy: 0, pan: null, painting: null,
  undo: [], redo: [], dirtyFiles: new Set(), deleted: new Set(), dirty: false,
  tones: [], theme: {}, themeName: 'light', tab: 'pictures', colourKey: null, tone: [0, 1], mockHits: [],
  bg: loadBg(),
};

// ---------- loading ----------
const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
function loadCanvas(url) {
  return new Promise((ok) => {
    const img = new Image();
    const give = setTimeout(() => ok(null), 8000); // a stuck request must not hang the editor
    img.onload = () => { clearTimeout(give); const cv = newCv(img.width, img.height); cv.getContext('2d').drawImage(img, 0, 0); ok(cv); };
    img.onerror = () => { clearTimeout(give); ok(null); };
    img.src = url;
  });
}
function newCv(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
async function init() {
  const [man, pal, theme] = await Promise.all([json('art/art.json'), json('art/palette.json'), json('art/theme.json')]);
  st.version = man.version || 0;
  if (theme) applyTheme(theme);
  st.theme = themeLevels();
  st.tones = (pal?.tones || LAYER_TONES.map((t) => t.map((c) => c.map(lvOf)))).map((t) => t.map((c) => c.slice()));
  st.outline = (pal?.outline || [0, 0, 0]).slice();
  st.ghostOutline = (pal?.ghostOutline || parseColor(THEMES.light.ghostOutline).map(lvOf)).slice();
  // one body colour per track colour (older files had [light, body, shade]: keep the body)
  st.ghost = Array.isArray(pal?.ghost) ? pal.ghost.map((g) => (Array.isArray(g[0]) ? g[1] : g).slice()) : defaultGhost();
  const v = '?v=' + Date.now();
  for (const [kind] of KINDS) {
    st.art[kind] = new Map();
    const items = kind === 'notes' ? man.notes.map((x) => [x.name, x]) : Object.entries(man[kind] || {});
    const loaded = await Promise.all(items.map(([name, info]) => Promise.all(
      Array.from({ length: info.frames || 1 }, (_, f) => loadCanvas(`art/${kind}/${name}${f ? '-' + (f + 1) : ''}.png${v}`)))));
    items.forEach(([name, info], k) => {
      const frames = loaded[k].filter(Boolean);
      if (frames.length) st.art[kind].set(name, { info: { ...info }, frames, saved: frames.length });
    });
  }
  bind();
  applyCursors();
  setColor([0, 0, 0]);
  setTab('pictures');
  pick('tools', st.art.tools.keys().next().value);
  status('Ready');
}

// Inactive notes (other tracks): two colours only. One body colour per track colour (light and body are painted
// with it) and one outline for all (outline and shade); 3-bit levels, the same in both themes. Default: the body
// faded towards grey, as the player drew them before they had their own colours.
function defaultGhost() {
  const to = THEMES.light.ghostTo;
  return st.tones.map((t) => t[1].map((v, i) => lvOf(LV[v] + (to[i] - LV[v]) * 0.62)));
}
const MODES = [['active', 'Active'], ['inactive', 'Inactive']];
// [outline, light, body, shade] of a track colour, active or inactive, 0..255
const notePal = (tone, mode) => (mode === 'active' ? [st.outline, ...st.tones[tone]]
  : [st.ghostOutline, st.ghost[tone], st.ghost[tone], st.ghostOutline]).map(lv);
// the paper the notes are shown on: the chosen theme's
const modeBg = () => THEMES[st.paperTheme || 'light'].paper;
// the frame an animated preview shows now
const animFrame = (a) => (a.frames.length > 1 ? st.tick % a.frames.length : 0);

// The page's mouse pointers are the art's own: the arrow, and the pointing hand over what can be clicked (×2).
function applyCursors() {
  const url = (name) => {
    const a = st.art.cursors?.get(name);
    if (!a) return null;
    const cv = scaled(a.frames[0], 2), [hx, hy] = a.info.hot || [0, 0];
    return `url(${cv.toDataURL()}) ${hx * 2} ${hy * 2}`;
  };
  const arrow = url('arrow'), hand = url('pointer');
  let el = document.getElementById('artCursors');
  if (!el) { el = document.createElement('style'); el.id = 'artCursors'; document.head.append(el); }
  el.textContent = (arrow ? `html, body, aside, header, #bar, #timeline { cursor: ${arrow}, default; }\n` : '')
    + (hand ? `button:not(:disabled), .item, .sw, .cel, a, label, input[type=range], input[type=checkbox] { cursor: ${hand}, pointer; }\n` : '');
}

// ---------- current picture ----------
const cur = () => st.art[st.kind]?.get(st.name);
const curCv = () => cur()?.frames[st.frame];
const fileOf = (kind, name, f) => `${kind}/${name}${f ? '-' + (f + 1) : ''}.png`;
function pick(kind, name) {
  st.kind = kind; st.name = name; st.frame = Math.min(st.frame, (cur()?.frames.length || 1) - 1);
  stopPlay();
  fit();
  buildList(); buildBar(); buildTimeline(); buildSwatches(); renderPreview(); render();
  $('kindNote').textContent = KINDS.find((k) => k[0] === kind)[2];
  for (const b of document.querySelectorAll('[data-tool="pivot"]')) b.disabled = kind !== 'cursors';
  if (kind !== 'cursors' && st.tool === 'pivot') setTool('pen');
}
function fit() {
  const cv = curCv();
  if (!cv) return;
  const W = $('wrap').clientWidth || 600, H = $('wrap').clientHeight || 400;
  st.zoom = Math.max(2, Math.min(48, Math.floor(Math.min(W / cv.width, H / cv.height) * 0.75)));
  st.ox = Math.round((W - cv.width * st.zoom) / 2); st.oy = Math.round((H - cv.height * st.zoom) / 2);
}

// ---------- left: the list of pictures ----------
function thumb(cv, s = 2) {
  const t = newCv(cv.width * s, cv.height * s), c = t.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, 0, t.width, t.height);
  return t;
}
function buildList() {
  const box = $('left');
  box.innerHTML = '';
  for (const [kind, title] of KINDS) {
    const h = document.createElement('h2');
    h.textContent = title;
    const add = document.createElement('button');
    add.className = 'small'; add.textContent = '+ New'; add.title = 'Add a picture of this kind';
    add.onclick = () => newPicture(kind);
    h.append(add);
    box.append(h);
    for (const [name, a] of st.art[kind]) {
      const b = document.createElement('button');
      b.className = 'item' + (kind === st.kind && name === st.name ? ' on' : '');
      const t = thumb(a.frames[0], a.frames[0].width > 24 ? 1 : 2);
      t.style.maxWidth = '48px'; t.style.maxHeight = '48px';
      b.append(t, document.createTextNode(name + (a.frames.length > 1 ? ` · ${a.frames.length} frames` : '')));
      b.onclick = () => pick(kind, name);
      box.append(b);
    }
  }
}

// ---------- the bar over the canvas: frames, size, add / delete ----------
function buildBar() {
  const bar = $('bar'), a = cur();
  bar.innerHTML = '';
  if (st.tab !== 'pictures') {
    const span = document.createElement('span');
    span.className = 'hint';
    span.textContent = st.tab === 'tones' ? 'Every note in every track colour (top: plain, bottom: while it sounds).'
      : 'The interface in this theme: click anything to set its colour.';
    if (st.tab === 'tones') span.textContent = 'Every note in every track colour, playing its frames. Notes:';
    bar.append(span);
    if (st.tab === 'tones') {
      for (const [m, title] of MODES) bar.append(btn(title, () => { st.toneMode = m; st.tone = [0, 1]; buildBar(); buildColours(); showColour(); render(); }, st.toneMode === m));
      bar.append(document.createTextNode(' on '));
      for (const th of ['light', 'dark']) bar.append(btn(th === 'light' ? 'light paper' : 'dark paper', () => { st.paperTheme = th; buildBar(); render(); renderPreview(); }, (st.paperTheme || 'light') === th));
    }
    if (st.tab === 'theme') for (const t of ['light', 'dark']) bar.append(btn(t === 'light' ? 'Light theme' : 'Dark theme', () => { st.themeName = t; buildColours(); render(); }, st.themeName === t));
    return;
  }
  if (!a) return;
  const label = document.createElement('b');
  label.textContent = `${st.kind}/${st.name}  ${a.frames[0].width}×${a.frames[0].height}`;
  bar.append(label);
  bar.append(btn('Delete picture', () => {
    if (!confirm(`Delete ${st.kind}/${st.name}? If the player uses this name, it will draw nothing there.`)) return;
    a.frames.forEach((_, f) => st.dirtyFiles.delete(fileOf(st.kind, st.name, f)));
    for (let f = 0; f < (a.saved || 0); f++) st.deleted.add(fileOf(st.kind, st.name, f));
    st.art[st.kind].delete(st.name);
    dirty();
    pick(st.kind, st.art[st.kind].keys().next().value);
  }));
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = st.kind === 'cursors' ? `pivot ${a.info.hot || [0, 0]}` : '';
  bar.append(hint);
}
function btn(text, onclick, on = false) {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = onclick;
  if (on) b.className = 'on';
  return b;
}
function newPicture(kind) {
  const name = (prompt(`Name of the new ${kind.replace(/s$/, '')} (letters, digits, _):`) || '').trim();
  if (!name) return;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) { alert('Letters, digits and _ only, starting with a letter.'); return; }
  if (st.art[kind].has(name)) { alert('There is one with this name already.'); return; }
  let [w, h] = SIZES[kind] || [16, 16];
  if (!SIZES[kind]) {
    const s = (prompt('Size, width×height:', '16x16') || '').match(/(\d+)\s*[x×*]\s*(\d+)/);
    if (!s) return;
    [w, h] = [Math.min(64, +s[1]), Math.min(128, +s[2])];
  }
  const frames = [newCv(w, h)];
  if (kind === 'notes') frames.push(newCv(w, h)); // a note has its sounding frame
  const info = kind === 'cursors' ? { hot: [0, 0] } : kind === 'clefs' ? { dx: 0, dy: 0 } : {};
  st.art[kind].set(name, { info, frames, saved: 0, restructured: true });
  dirty();
  pick(kind, name);
  status(kind === 'notes' ? 'New note picture: songs can use it once it is saved.'
    : kind === 'tools' || kind === 'small' ? 'New icon: draw it and save; a button uses it once the player asks for it by this name.'
      : 'New picture: draw it and save.');
}

// ---------- the frames timeline ----------
function buildTimeline() {
  const box = $('frames'), a = cur();
  box.innerHTML = '';
  $('timeline').classList.toggle('hidden', st.tab !== 'pictures' || !a);
  if (!a) return;
  $('fHint').textContent = FRAME_HINT[st.kind] || '';
  a.frames.forEach((cv, f) => {
    const b = document.createElement('button');
    b.className = 'cel' + (f === st.frame ? ' on' : '');
    b.title = 'Frame ' + (f + 1) + ' · drag to move';
    b.draggable = true;
    const num = document.createElement('span');
    num.className = 'num'; num.textContent = f + 1;
    const sc = Math.max(1, Math.min(4, Math.floor(40 / Math.max(cv.width, cv.height))));
    b.append(num, thumb(cv, sc));
    b.onclick = () => { stopPlay(); st.frame = f; buildTimeline(); renderPreview(); render(); };
    b.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(f)); };
    b.ondragover = (e) => { e.preventDefault(); b.classList.add('drop'); };
    b.ondragleave = () => b.classList.remove('drop');
    b.ondrop = (e) => { e.preventDefault(); b.classList.remove('drop'); moveFrame(+e.dataTransfer.getData('text/plain'), f); };
    box.append(b);
  });
  $('fDel').disabled = a.frames.length < 2;
  $('fLeft').disabled = st.frame === 0;
  $('fRight').disabled = st.frame >= a.frames.length - 1;
  $('fPlay').disabled = a.frames.length < 2;
  box.children[st.frame]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function refreshCel() {
  const cel = $('frames').children[st.frame]?.querySelector('canvas'), cv = curCv();
  if (!cel || !cv) return;
  const c = cel.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, cel.width, cel.height);
  c.drawImage(cv, 0, 0, cel.width, cel.height);
}
// Changing the frames renames the files after them: the whole picture is written again when saved.
function framesUndo() {
  const a = cur();
  return { kind: st.kind, name: st.name, frame: st.frame, frames: a.frames.map((cv) => { const c = newCv(cv.width, cv.height); c.getContext('2d').drawImage(cv, 0, 0); return c; }) };
}
function restructured() { cur().restructured = true; dirty(); buildList(); buildTimeline(); renderPreview(); render(); }
function addFrame(copy) {
  const a = cur(), src = a.frames[st.frame];
  pushUndo(framesUndo());
  const cv = newCv(src.width, src.height);
  if (copy) cv.getContext('2d').drawImage(src, 0, 0);
  a.frames.splice(st.frame + 1, 0, cv);
  st.frame++;
  restructured();
}
function deleteFrame() {
  const a = cur();
  if (a.frames.length < 2) return;
  pushUndo(framesUndo());
  a.frames.splice(st.frame, 1);
  st.frame = Math.min(st.frame, a.frames.length - 1);
  restructured();
}
function moveFrame(from, to) {
  const a = cur();
  if (from === to || from < 0 || to < 0 || from >= a.frames.length || to >= a.frames.length) return;
  pushUndo(framesUndo());
  const [cv] = a.frames.splice(from, 1);
  a.frames.splice(to, 0, cv);
  st.frame = to;
  restructured();
}
function play() {
  const a = cur();
  if (st.playing) { stopPlay(); return; }
  if (!a || a.frames.length < 2) return;
  st.playing = setInterval(() => {
    st.frame = (st.frame + 1) % cur().frames.length;
    for (const [k, el] of [...$('frames').children].entries()) el.classList.toggle('on', k === st.frame);
    render();
  }, 1000 / Math.max(1, Math.min(30, +$('fFps').value || 6)));
  $('fPlay').textContent = 'Stop';
}
function stopPlay() {
  if (st.playing) clearInterval(st.playing);
  st.playing = null;
  $('fPlay').textContent = 'Play';
}

// ---------- the canvas ----------
const wrap = $('wrap'), view = $('view');
let photos = null; // the Song pictures tab (photos.js)
let pages = null; // the Song pages tab (songpages.js)
// The canvas background (per browser): checks, or a solid Mega Drive colour to see the picture on.
function loadBg() {
  try { const b = JSON.parse(localStorage.getItem('artBg')); if (b && Array.isArray(b.c)) return b; } catch {}
  return { checks: true, c: [0, 2, 0] };
}
function showBg() {
  $('bgChecks').checked = st.bg.checks;
  ['bgr', 'bgg', 'bgb'].forEach((id, i) => { $(id).value = st.bg.c[i]; $('bgv' + id[2]).textContent = st.bg.c[i]; });
  $('bgLevels').style.opacity = st.bg.checks ? 0.4 : 1;
}
function setBg(b) {
  st.bg = b; showBg(); render();
  try { localStorage.setItem('artBg', JSON.stringify(b)); } catch {}
}
function render() {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  view.width = W; view.height = H;
  const c = view.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#929292'; c.fillRect(0, 0, W, H);
  st.mockHits = [];
  if (st.tab === 'tones') { renderTones(c); return; }
  if (st.tab === 'theme') { renderMock(c); return; }
  if (st.tab === 'photos') { photos.render(c); return; }
  if (st.tab === 'pages') return;
  const cv = curCv();
  if (!cv) return;
  const z = st.zoom, x0 = st.ox, y0 = st.oy;
  // under the picture: see-through checks, or the solid background colour chosen on the right
  if (st.bg.checks) {
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      c.fillStyle = (x + y) % 2 ? '#e6e6e6' : '#ffffff';
      c.fillRect(x0 + x * z, y0 + y * z, z, z);
    }
  } else { c.fillStyle = css(st.bg.c.map((v) => LV[v])); c.fillRect(x0, y0, cv.width * z, cv.height * z); }
  // onion skin: the frame before, faint, under this one
  if ($('fOnion').checked && !st.playing && st.frame > 0) { c.globalAlpha = 0.25; c.drawImage(cur().frames[st.frame - 1], x0, y0, cv.width * z, cv.height * z); c.globalAlpha = 1; }
  c.drawImage(cv, x0, y0, cv.width * z, cv.height * z);
  if (z >= 6) {
    c.fillStyle = 'rgba(0,0,0,0.15)';
    for (let x = 0; x <= cv.width; x++) c.fillRect(x0 + x * z, y0, 1, cv.height * z);
    for (let y = 0; y <= cv.height; y++) c.fillRect(x0, y0 + y * z, cv.width * z, 1);
  }
  c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(x0 - 0.5, y0 - 0.5, cv.width * z + 1, cv.height * z + 1);
  if (st.kind === 'cursors') {
    const [hx, hy] = cur().info.hot || [0, 0];
    c.strokeStyle = '#ff2400'; c.lineWidth = 2;
    c.strokeRect(x0 + hx * z + 1, y0 + hy * z + 1, z - 2, z - 2);
    c.beginPath(); c.moveTo(x0 + hx * z + z / 2, y0 + hy * z - z); c.lineTo(x0 + hx * z + z / 2, y0 + hy * z + 2 * z);
    c.moveTo(x0 + hx * z - z, y0 + hy * z + z / 2); c.lineTo(x0 + hx * z + 2 * z, y0 + hy * z + z / 2); c.stroke();
  }
}
function atPx(e) {
  const r = view.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left - st.ox) / st.zoom), Math.floor((e.clientY - r.top - st.oy) / st.zoom)];
}
const inside = (cv, [x, y]) => x >= 0 && y >= 0 && x < cv.width && y < cv.height;
function getPx(cv, x, y) { const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; return d[3] < 128 ? null : [d[0], d[1], d[2]]; }
function putPx(cv, x, y, col) {
  const c = cv.getContext('2d');
  c.clearRect(x, y, 1, 1);
  if (col) { c.fillStyle = css(col); c.fillRect(x, y, 1, 1); }
}
function pushUndo(entry) { st.undo.push(entry); if (st.undo.length > 100) st.undo.shift(); st.redo = []; }
function pixelUndo() {
  const cv = curCv();
  return { kind: st.kind, name: st.name, frame: st.frame, data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height) };
}
function changed() { st.dirtyFiles.add(fileOf(st.kind, st.name, st.frame)); dirty(); }
function flood(cv, x, y, col) {
  const c = cv.getContext('2d'), img = c.getImageData(0, 0, cv.width, cv.height), d = img.data, W = cv.width, H = cv.height;
  const key = (i) => (d[i + 3] < 128 ? 'x' : d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
  const from = key((y * W + x) * 4), to = col ? col.join(',') : 'x';
  if (from === to) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const i = (py * W + px) * 4;
    if (key(i) !== from) continue;
    if (col) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; } else d[i + 3] = 0;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  c.putImageData(img, 0, 0);
}
function line(cv, a, b, col) { // every pixel between two points, so a fast stroke has no gaps
  let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (inside(cv, [x0, y0])) putPx(cv, x0, y0, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function down(e) {
  if (st.tab === 'photos') { photos.down(e); return; }
  if (e.button === 1) { // middle button: move the canvas
    e.preventDefault();
    st.pan = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
    view.classList.add('pan');
    return;
  }
  if (st.tab === 'tones') { toneClick(e); return; }
  if (st.tab === 'theme') { mockClick(e); return; }
  const cv = curCv();
  if (!cv) return;
  const p = atPx(e);
  if (!inside(cv, p)) return;
  e.preventDefault();
  if (e.button === 2 || st.tool === 'pick') { setColor(getPx(cv, ...p)); return; }
  if (st.tool === 'pivot') {
    const a = cur();
    pushUndo({ kind: st.kind, name: st.name, hot: (a.info.hot || [0, 0]).slice() });
    a.info.hot = p; dirty(); buildBar(); renderPreview(); render(); applyCursors();
    return;
  }
  pushUndo(pixelUndo());
  if (st.tool === 'fill') { flood(cv, p[0], p[1], st.color); changed(); after(); return; }
  const col = st.tool === 'erase' ? null : st.color;
  putPx(cv, ...p, col);
  st.painting = { last: p, col };
  changed(); after();
}
function move(e) {
  if (st.tab === 'photos') { photos.move(e); return; }
  if (st.pan) { st.ox = st.pan.ox + e.clientX - st.pan.x; st.oy = st.pan.oy + e.clientY - st.pan.y; render(); return; }
  if (!st.painting) return;
  const p = atPx(e);
  line(curCv(), st.painting.last, p, st.painting.col);
  st.painting.last = p;
  after();
}
function up() { photos?.up(); if (st.painting && st.kind === 'pictures') buildSwatches(); st.painting = null; st.pan = null; view.classList.remove('pan'); }
function wheel(e) {
  if (st.tab === 'photos') { e.preventDefault(); photos.wheel(e); return; }
  if (st.tab !== 'pictures') return;
  e.preventDefault();
  const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.max(1, Math.min(64, st.zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(st.zoom / 6))));
  st.ox = Math.round(mx - (mx - st.ox) * z / st.zoom); st.oy = Math.round(my - (my - st.oy) * z / st.zoom);
  st.zoom = z;
  render();
}
let afterPending = false;
function after() { // repaint now, the list and preview a moment later
  render();
  if (afterPending) return;
  afterPending = true;
  setTimeout(() => { afterPending = false; renderPreview(); refreshThumb(); refreshCel(); if (st.kind === 'cursors') applyCursors(); }, 120);
}
function refreshThumb() {
  const b = $('left').querySelector('.item.on canvas'), a = cur();
  if (!b || !a) return;
  const c = b.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, b.width, b.height);
  c.drawImage(a.frames[0], 0, 0, b.width, b.height);
}

// ---------- colours for painting ----------
function setColor(c) {
  st.color = c ? c.slice() : null;
  $('cur').style.background = c ? css(c) : '';
  $('cur').className = 'big' + (c ? '' : ' sw clear');
  const l = c ? c.map(lvOf) : [0, 0, 0];
  [$('lr').value, $('lg').value, $('lb').value] = l;
  [$('vr').textContent, $('vg').textContent, $('vb').textContent] = c ? l : ['', '', ''];
  for (const s of document.querySelectorAll('#swatches .sw')) s.classList.toggle('on', s.dataset.c === (c ? c.join(',') : ''));
}
function buildSwatches() {
  const list = [[null, 'Empty (see-through)'], [[0, 0, 0], 'Black: icon ink, note outline'], [[255, 255, 255], 'White']];
  if (st.kind === 'notes') NOTE_INKS.forEach((c, k) => list.push([c, ['Note: light', 'Note: body', 'Note: shade'][k]]));
  const seen = new Set(list.map(([c]) => (c ? c.join(',') : '')));
  // a coloured picture shares its colours with its family (sonicIdle, sonicWalk): one Mega Drive sprite
  // palette line, 15 colours + see-through
  const a = cur(), family = st.kind === 'pictures' && st.name ? st.name.match(/^[a-z0-9]+/)?.[0] : null;
  const pics = family ? [...st.art.pictures].filter(([n]) => n.match(/^[a-z0-9]+/)?.[0] === family).map(([, p]) => p) : a ? [a] : [];
  const used = new Set();
  for (const p of pics) for (const cv of p.frames) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      used.add(k);
      if (!seen.has(k) && seen.size < 30) { seen.add(k); list.push([[d[i], d[i + 1], d[i + 2]], family ? `In ${family}` : 'In this picture']); }
    }
  }
  $('palNote').textContent = family ? `${family}: ${used.size} of 15 colours (one Mega Drive sprite palette)${used.size > 15 ? ' · too many for the console' : ''}` : '';
  const box = $('swatches');
  box.innerHTML = '';
  for (const [c, title] of list) {
    const s = document.createElement('div');
    s.className = 'sw' + (c ? '' : ' clear');
    if (c) s.style.background = css(c);
    s.dataset.c = c ? c.join(',') : '';
    s.title = title;
    s.onclick = () => setColor(c);
    box.append(s);
  }
  setColor(st.color);
}

// ---------- the preview of the current picture ----------
const T = (name) => THEMES[name];
function inkCv(cv, color) { // a black-ink picture painted in one colour (as the player does)
  const out = newCv(cv.width, cv.height), o = out.getContext('2d'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  o.fillStyle = color;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127 && d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) o.fillRect((i / 4) % cv.width, Math.floor(i / 4 / cv.width), 1, 1);
  return out;
}
function noteCv(cv, tone, mode = 'active') { // a note picture in a track colour (active or inactive)
  const pal = notePal(tone, mode), out = newCv(cv.width, cv.height), o = out.getContext('2d');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 0; i < d.length / 4; i++) {
    const p = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    if (d[i * 4 + 3] < 128 || p.every((v) => v > 240)) continue;
    let col = pal[0];
    if (!p.every((v) => v < 60)) {
      let best = 0, bd = 1e9;
      NOTE_INKS.forEach((n, k) => { const dd = n.reduce((a, v, j) => a + Math.abs(v - p[j]), 0); if (dd < bd) { bd = dd; best = k; } });
      col = pal[best + 1];
    }
    o.fillStyle = css(col); o.fillRect(i % cv.width, Math.floor(i / cv.width), 1, 1);
  }
  return out;
}
function scaled(cv, s, bg) {
  const out = newCv(cv.width * s, cv.height * s), o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  if (bg) { o.fillStyle = bg; o.fillRect(0, 0, out.width, out.height); }
  o.drawImage(cv, 0, 0, out.width, out.height);
  return out;
}
function iconState(a, theme, state) { // a button with this icon, as the player draws it
  const t = T(theme), on = state === 'on', cv = (on && a.frames[1]) || a.frames[0];
  const face = on ? t.sel : state === 'hover' ? t.hover : t.face, ink = state === 'off' ? t.off : on ? t.selInk : t.ink;
  const [bw, bh] = st.kind === 'small' ? [CELL, CELL] : [TOOL_W, TOOL_H];
  const out = newCv(bw + 2, bh + 2), o = out.getContext('2d');
  o.fillStyle = t.ink; o.fillRect(0, 0, out.width, out.height);
  o.fillStyle = face; o.fillRect(1, 1, bw, bh);
  o.drawImage(inkCv(cv, ink), 1 + ((bw - cv.width) >> 1), 1 + ((bh - cv.height) >> 1));
  return out;
}
function renderPreview() {
  const box = $('preview'), a = cur();
  box.innerHTML = '';
  if (!a) return;
  const add = (cv, title) => { cv.title = title; box.append(cv); };
  const label = (t) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = t; box.append(d); };
  if (st.kind === 'tools' || st.kind === 'small') {
    for (const th of ['light', 'dark']) {
      label(th + ': normal · hover · on · disabled');
      for (const s of ['normal', 'hover', 'on', 'off']) add(scaled(iconState(a, th, s), 2), s);
    }
  } else if (st.kind === 'notes') {
    const modes = document.createElement('div');
    modes.className = 'tools';
    for (const [m, title] of MODES) modes.append(btn(title, () => { st.toneMode = m; renderPreview(); }, st.toneMode === m));
    box.append(modes);
    label(a.frames.length > 1 ? 'In every track colour, playing its frames' : 'In every track colour');
    const cv = a.frames[animFrame(a)];
    st.tones.forEach((_, k) => add(scaled(noteCv(cv, k, st.toneMode), 3, modeBg()), TONE_NAMES[k]));
  } else if (st.kind === 'cursors') {
    for (const th of ['light', 'dark']) {
      label(th + ' (actual size, ×3)');
      a.frames.forEach((cv) => { add(scaled(cv, 1, T(th).face), 'actual size'); add(scaled(cv, 3, T(th).face), '×3'); });
    }
  } else if (st.kind === 'clefs') {
    for (const th of ['light', 'dark']) add(scaled(inkCv(a.frames[0], T(th).ink), 2, T(th).paper), th);
  } else add(scaled(a.frames[animFrame(a)], 3, '#fff'), a.frames.length > 1 ? 'playing its frames' : '');
}

// ---------- track colours ----------
function buildColours() {
  const box = $('left');
  box.innerHTML = '';
  if (st.tab === 'tones') {
    const active = st.toneMode === 'active';
    box.innerHTML = `<h2>${MODES.find((m) => m[0] === st.toneMode)[1]}</h2><div class="note">${active
      ? 'Notes of the chosen track: the outline, then light · body · shade of each track colour.'
      : 'Notes of the other tracks (the same in both themes): two colours. The outline (also the shade), then the body (also the light) of each track colour.'}</div>`;
    const sw = (c, on, title, click) => {
      const s = document.createElement('div');
      s.className = 'sw' + (on ? ' on' : ''); s.style.background = css(lv(c)); s.title = title; s.onclick = click;
      return s;
    };
    const pickTone = (t) => () => { st.tone = t; buildColours(); showColour(); render(); };
    const t = document.createElement('table');
    t.className = 'tones';
    {
      const tr = document.createElement('tr'), td = document.createElement('td');
      tr.innerHTML = '<td>Outline</td>';
      td.append(sw(active ? st.outline : st.ghostOutline, st.tone[0] === 'outline', 'outline of every note', pickTone(['outline'])));
      tr.append(td); t.append(tr);
    }
    st.tones.forEach((tone, k) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${TONE_NAMES[k] || k + 1}</td>`;
      if (active) tone.forEach((c, j) => { const td = document.createElement('td'); td.append(sw(c, st.tone[0] === k && st.tone[1] === j, ['light', 'body', 'shade'][j], pickTone([k, j]))); tr.append(td); });
      else { const td = document.createElement('td'); td.append(sw(st.ghost[k], st.tone[0] === k, 'body and light', pickTone([k, 1]))); tr.append(td); }
      t.append(tr);
    });
    box.append(t);
    if (!active) box.append(btn('Reset to faded', () => { st.ghost = defaultGhost(); dirty(); buildColours(); showColour(); render(); }));
    return;
  }
  const h = document.createElement('h2');
  h.textContent = (st.themeName === 'light' ? 'Light' : 'Dark') + ' theme';
  box.append(h);
  for (const [k, c] of Object.entries(st.theme[st.themeName])) {
    const b = document.createElement('button');
    b.className = 'item' + (st.colourKey === k ? ' on' : '');
    const s = document.createElement('span');
    s.className = 'sw'; s.style.background = css(lv(c));
    b.append(s, document.createTextNode(THEME_INFO[k] || k));
    b.title = k;
    b.onclick = () => { st.colourKey = k; buildColours(); showColour(); render(); };
    box.append(b);
  }
}
function colourRef() {
  if (st.tab === 'tones') {
    const [k, j] = st.tone, mode = st.toneMode;
    if (k === 'outline') return mode === 'active' ? { get: () => st.outline, set: (c) => { st.outline = c; }, title: 'Outline of every note' }
      : { get: () => st.ghostOutline, set: (c) => { st.ghostOutline = c; }, title: 'Outline of other tracks\u2019 notes' };
    if (mode === 'active') return { get: () => st.tones[k][j], set: (c) => { st.tones[k][j] = c; }, title: `${TONE_NAMES[k]}: ${['light', 'body', 'shade'][j]}` };
    return { get: () => st.ghost[k], set: (c) => { st.ghost[k] = c; }, title: `${TONE_NAMES[k]} inactive` };
  }
  const k = st.colourKey;
  if (!k) return null;
  return { get: () => st.theme[st.themeName][k], set: (c) => { st.theme[st.themeName][k] = c; }, title: THEME_INFO[k] || k, note: `${st.themeName} · ${k}` };
}
function showColour() {
  const r = colourRef();
  $('colourTitle').textContent = r ? r.title : 'Click a colour';
  $('colourNote').textContent = r?.note || '';
  if (!r) return;
  const c = r.get();
  $('colourCur').style.background = css(lv(c));
  [$('cr').value, $('cg').value, $('cb').value] = c;
  [$('vcr').textContent, $('vcg').textContent, $('vcb').textContent] = c;
}
function renderTones(c) {
  // every note picture in every track colour, playing its frames, in the chosen mode
  const z = 3, cw = (NOTE_PX + 4) * z, rh = (NOTE_PX + 4) * z, notes = [...st.art.notes.values()];
  const W = notes.length * cw + 80, H = st.tones.length * rh + 10;
  view.width = Math.max(W, wrap.clientWidth); view.height = Math.max(H, wrap.clientHeight);
  c = view.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = modeBg(); c.fillRect(0, 0, view.width, view.height);
  st.tones.forEach((_, k) => {
    const y = 5 + k * rh;
    c.fillStyle = k === st.tone[0] ? '#ff2400' : st.paperTheme === 'dark' ? '#dbdbdb' : '#000';
    c.font = '11px ui-monospace, monospace';
    c.fillText(TONE_NAMES[k] || String(k + 1), 4, y + 16);
    notes.forEach((a, n) => c.drawImage(scaled(noteCv(a.frames[animFrame(a)], k, st.toneMode), z), 80 + n * cw, y));
    st.mockHits.push({ x: 0, y, w: view.width, h: rh, key: k });
  });
}
function toneClick(e) {
  const r = view.getBoundingClientRect(), y = e.clientY - r.top;
  const hit = st.mockHits.find((m) => y >= m.y && y < m.y + m.h);
  if (hit) { st.tone = [hit.key, typeof st.tone[1] === 'number' ? st.tone[1] : 1]; buildColours(); showColour(); render(); }
}

// ---------- the interface mock-up: the player's widgets in their states, in the chosen theme ----------
function renderMock(c) {
  const S = Math.max(2, Math.min(4, Math.floor((wrap.clientWidth - 16) / 220))), t = Object.fromEntries(Object.entries(st.theme[st.themeName]).map(([k, v]) => [k, css(lv(v))]));
  const W = 220, H = 170, cv = newCv(W, H), g = cv.getContext('2d');
  const hits = [];
  const box = (x, y, w, h, key, color = t[key]) => { g.fillStyle = color; g.fillRect(x, y, w, h); hits.push({ x, y, w, h, key }); };
  const txt = (s, x, y, key) => { const w = drawText(g, s, x, y, t[key]); hits.push({ x, y: y - 1, w: w || s.length * 4, h: 7, key }); };
  const icon = (name, x, y, face, ink, frameOn = false) => {
    const a = st.art.tools.get(name);
    box(x - 1, y - 1, TOOL_W + 2, TOOL_H + 2, 'ink');
    box(x, y, TOOL_W, TOOL_H, face);
    const icv = a && ((frameOn && a.frames[1]) || a.frames[0]);
    if (a) { g.drawImage(inkCv(icv, t[ink]), x + ((TOOL_W - icv.width) >> 1), y + ((TOOL_H - icv.height) >> 1)); hits.push({ x: x + 4, y: y + 4, w: TOOL_W - 8, h: TOOL_H - 8, key: ink }); }
  };
  box(0, 0, W, H, 'bg');
  // toolbar buttons: normal, hover, on, disabled
  icon('pen', 4, 4, 'face', 'ink'); icon('eraser', 26, 4, 'hover', 'ink'); icon('bucket', 48, 4, 'sel', 'selInk', true); icon('pipette', 70, 4, 'face', 'off');
  txt('NORMAL HOVER  ON   OFF', 4, 26, 'dim');
  // text buttons and a field
  box(96, 4, 30, 13, 'ink'); box(97, 5, 28, 11, 'face'); txt('OK', 106, 8, 'ink');
  box(130, 4, 34, 13, 'ink'); box(131, 5, 32, 11, 'sel'); txt('SAVE', 138, 8, 'selInk');
  box(96, 20, 68, 11, 'ink'); box(97, 21, 66, 9, 'face'); txt('MY RIFF', 100, 23, 'ink');
  // a menu
  box(168, 4, 48, 40, 'ink'); box(169, 5, 46, 38, 'face');
  txt('NEW', 172, 8, 'ink'); box(169, 15, 46, 11, 'sel'); txt('OPEN', 172, 18, 'selInk'); txt('SAVE', 172, 30, 'off'); txt('^S', 205, 30, 'dim');
  // a layer row: colour chip, name (chosen), mute, solo
  box(4, 36, 160, 13, 'ink'); box(5, 37, 12, 11, 'face', css(lv(st.tones[0][1]))); txt('1', 9, 40, 'ink');
  box(18, 37, 90, 11, 'sel'); txt('CHEESE RIFF', 21, 40, 'selInk');
  box(109, 37, 26, 11, 'soft'); txt('ROW', 112, 40, 'ink');
  box(136, 37, 13, 11, 'red'); txt('M', 140, 40, 'white'); box(150, 37, 13, 11, 'green'); txt('S', 154, 40, 'ink');
  // the staff
  const sx = 4, sy = 54, sw = 212, sh = 64;
  box(sx, sy, sw, sh, 'paper');
  box(sx, sy, 18, sh, 'paper'); for (let k = 0; k < 8; k++) box(sx, sy + 4 + k * 8, 12, 3, 'keys');
  box(sx + 150, sy, 30, sh, 'hiRep'); box(sx + 182, sy, 14, sh, 'hiLoop'); box(sx + 198, sy, 14, sh, 'hiDel');
  for (let k = 0; k < 5; k++) box(sx + 20, sy + 12 + k * 6, sw - 20, 1, 'staff');
  for (let k = 0; k < 2; k++) box(sx + 20, sy + 4 + k * 3, sw - 20, 1, 'faded');
  for (let x = sx + 40; x < sx + sw; x += 16) for (let y = sy + 2; y < sy + sh; y += 2) box(x, y, 1, 1, 'beat');
  box(sx + 64, sy + 12, 1, 25, 'bar'); box(sx + 128, sy + 12, 2, 25, 'loop'); box(sx + 132, sy + 12, 1, 25, 'loop');
  box(sx + 20, sy + 46, 30, sh - 46, 'shade');
  box(sx + 22, sy + sh - 12, sw - 22, 10, 'lane');
  box(sx + 60, sy + 1, 60, 2, 'rep');
  const n = st.art.notes.values().next().value;
  if (n) {
    g.drawImage(noteCv(n.frames[0], 0), sx + 80, sy + 18); hits.push({ x: sx + 80, y: sy + 18, w: 12, h: 12, key: 'paper' });
    // another track's note: faded towards ghostTo, outline ghostOutline
    const ghost = noteCv(n.frames[0], 1), gd = ghost.getContext('2d'), d = gd.getImageData(0, 0, CELL, CELL);
    const to = lv(st.theme[st.themeName].ghostTo), ol = lv(st.theme[st.themeName].ghostOutline);
    for (let i = 0; i < d.data.length; i += 4) {
      if (!d.data[i + 3]) continue;
      const black = d.data[i] + d.data[i + 1] + d.data[i + 2] === 0;
      for (let j = 0; j < 3; j++) d.data[i + j] = black ? ol[j] : d.data[i + j] + (to[j] - d.data[i + j]) * 0.62;
    }
    gd.putImageData(d, 0, 0);
    g.drawImage(ghost, sx + 100, sy + 24); hits.push({ x: sx + 100, y: sy + 24, w: 12, h: 12, key: 'ghostTo' });
  }
  box(sx + 96, sy, 1, sh, 'head');
  // the display
  box(4, 124, 70, 18, 'lcd'); txt('BAR', 7, 126, 'lcdDim'); txt('1.1', 7, 134, 'lcdInk'); txt('BPM', 40, 126, 'lcdDim'); txt('177', 40, 134, 'lcdInk');
  // a dialog
  box(80, 124, 136, 42, 'ink'); box(81, 125, 134, 40, 'face'); box(81, 125, 134, 11, 'sel'); txt('SETTINGS', 84, 128, 'selInk');
  txt('THEME', 84, 140, 'dim'); txt('A HINT', 84, 152, 'dim');
  // scale it up and keep the hit boxes
  const ox = st.ox, oy = st.oy; // moved with the middle button
  c.drawImage(cv, ox, oy, W * S, H * S);
  st.mockHits = hits.reverse().map((h) => ({ x: ox + h.x * S, y: oy + h.y * S, w: h.w * S, h: h.h * S, key: h.key }));
  if (st.colourKey) for (const h of st.mockHits) if (h.key === st.colourKey) { c.strokeStyle = '#ff2400'; c.lineWidth = 2; c.strokeRect(h.x - 1, h.y - 1, h.w + 2, h.h + 2); }
}
function mockClick(e) {
  const r = view.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = st.mockHits.find((h) => x >= h.x && y >= h.y && x < h.x + h.w && y < h.y + h.h);
  if (!hit) return;
  st.colourKey = hit.key; buildColours(); showColour(); render();
  $('left').querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
}

// ---------- tabs, saving, keys ----------
function setTab(t) {
  st.tab = t;
  for (const [id, k] of [['tabPictures', 'pictures'], ['tabTones', 'tones'], ['tabTheme', 'theme'], ['tabPhotos', 'photos'], ['tabPages', 'pages']]) $(id).classList.toggle('on', t === k);
  $('paintTools').classList.toggle('hidden', t !== 'pictures');
  $('colourTools').classList.toggle('hidden', t === 'pictures' || t === 'photos' || t === 'pages');
  $('photoTools').classList.toggle('hidden', t !== 'photos');
  $('pageTools').classList.toggle('hidden', t !== 'pages');
  $('pagesView').classList.toggle('hidden', t !== 'pages');
  for (const id of ['undo', 'redo']) $(id).disabled = t === 'photos';
  $('anim').disabled = t === 'photos' || t === 'pages';
  $('save').textContent = t === 'photos' || t === 'pages' ? 'Save art' : 'Save';
  view.style.cursor = '';
  if (t === 'pages') { $('timeline').classList.add('hidden'); pages.enter(); return; }
  if (t === 'photos') { $('timeline').classList.add('hidden'); render(); photos.enter(() => st.tab === 'photos'); return; }
  if (t === 'pictures') { buildList(); fit(); } else { if (t === 'theme' && !st.colourKey) st.colourKey = 'face'; st.ox = 8; st.oy = 8; buildColours(); showColour(); }
  buildBar();
  buildTimeline();
  render();
}
function setTool(t) {
  st.tool = t;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
}
function dirty() { st.dirty = true; status('Not saved'); }
function status(s) { $('status').textContent = s; }
function manifest() {
  const m = { version: st.version + 1 };
  for (const [kind] of KINDS) {
    if (kind === 'notes') m.notes = [...st.art.notes].map(([name, a]) => ({ ...a.info, name, frames: a.frames.length }));
    else m[kind] = Object.fromEntries([...st.art[kind]].map(([name, a]) => [name, { ...a.info, frames: a.frames.length }]));
  }
  return m;
}
async function save() {
  status('Saving…');
  for (const [kind] of KINDS) for (const [name, a] of st.art[kind]) {
    if (!a.restructured) continue;
    a.frames.forEach((_, f) => { st.dirtyFiles.add(fileOf(kind, name, f)); st.deleted.delete(fileOf(kind, name, f)); });
    for (let f = a.frames.length; f < (a.saved || 0); f++) st.deleted.add(fileOf(kind, name, f));
  }
  const files = {};
  for (const rel of st.dirtyFiles) {
    const [kind, file] = rel.split('/'), m = file.match(/^(.*?)(?:-(\d+))?\.png$/);
    const cv = st.art[kind].get(m[1])?.frames[m[2] ? +m[2] - 1 : 0];
    if (cv) files[rel] = cv.toDataURL('image/png');
  }
  try {
    const r = await fetch('api/art', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: st.version, files, delete: [...st.deleted], manifest: manifest(), palette: { tones: st.tones, outline: st.outline, ghostOutline: st.ghostOutline, ghost: st.ghost }, theme: st.theme }),
    });
    const res = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
    if (!res.ok) throw new Error(res.error || 'HTTP ' + r.status);
    st.dirty = false; st.dirtyFiles.clear(); st.deleted.clear(); st.version++;
    for (const [kind] of KINDS) for (const a of st.art[kind].values()) { a.saved = a.frames.length; a.restructured = false; }
    status(`Saved (${res.written} pictures) · old files in art/backup/${res.backup} · reload the player to see it`);
  } catch (e) {
    status('Not saved: ' + e.message + ' (is the dev server running? python tools/serve.py)');
  }
}
function undoRedo(from, to) {
  const u = from.pop();
  if (!u) return;
  const a = st.art[u.kind]?.get(u.name);
  if (!a) return;
  if (u.hot) { to.push({ kind: u.kind, name: u.name, hot: (a.info.hot || [0, 0]).slice() }); a.info.hot = u.hot; }
  else if (u.frames) {
    if (u.kind !== st.kind || u.name !== st.name) pick(u.kind, u.name);
    to.push(framesUndo());
    a.frames = u.frames; st.frame = Math.min(u.frame, a.frames.length - 1); a.restructured = true;
  }
  else {
    const cv = a.frames[u.frame];
    if (!cv) return;
    to.push({ kind: u.kind, name: u.name, frame: u.frame, data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height) });
    cv.getContext('2d').putImageData(u.data, 0, 0);
    st.dirtyFiles.add(fileOf(u.kind, u.name, u.frame));
  }
  dirty();
  if (u.kind !== st.kind || u.name !== st.name) pick(u.kind, u.name); else { buildBar(); buildTimeline(); after(); }
}
function startClock() { // animated previews: the frames play at the timeline's speed
  if (st.clock) clearInterval(st.clock);
  st.clock = setInterval(() => {
    if (st.animPaused) return;
    st.tick++;
    if (st.tab === 'tones') render();
    else if (st.tab === 'pictures' && (st.kind === 'notes' || st.kind === 'pictures') && cur()?.frames.length > 1) renderPreview();
  }, 1000 / Math.max(1, Math.min(30, +$('fFps').value || 6)));
}
function toggleAnim() { // pause the previews on the frame they show, to look at it
  st.animPaused = !st.animPaused;
  $('anim').textContent = st.animPaused ? 'Play animation' : 'Pause animation';
  $('anim').classList.toggle('on', st.animPaused);
}
function bind() {
  startClock();
  view.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  view.addEventListener('wheel', wheel, { passive: false });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('auxclick', (e) => e.preventDefault());
  window.addEventListener('resize', render);
  for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  showBg();
  $('bgChecks').onchange = () => setBg({ ...st.bg, checks: $('bgChecks').checked });
  for (const id of ['bgr', 'bgg', 'bgb']) $(id).oninput = () => setBg({ checks: false, c: ['bgr', 'bgg', 'bgb'].map((k) => +$(k).value) });
  for (const id of ['lr', 'lg', 'lb']) $(id).oninput = () => setColor([$('lr'), $('lg'), $('lb')].map((s) => LV[+s.value]));
  for (const id of ['cr', 'cg', 'cb']) $(id).oninput = () => {
    const r = colourRef();
    if (!r) return;
    r.set([$('cr'), $('cg'), $('cb')].map((s) => +s.value));
    dirty(); buildColours(); showColour(); render();
  };
  $('tabPictures').onclick = () => setTab('pictures');
  $('tabTones').onclick = () => setTab('tones');
  $('tabTheme').onclick = () => setTab('theme');
  $('tabPhotos').onclick = () => setTab('photos');
  $('tabPages').onclick = () => setTab('pages');
  pages = makePages({ $, btn, status });
  photos = makePhotos({ $, btn, status, view, wrap });
  $('undo').onclick = () => (st.tab === 'pages' ? pages.undo() : undoRedo(st.undo, st.redo));
  $('redo').onclick = () => (st.tab === 'pages' ? pages.redo() : undoRedo(st.redo, st.undo));
  $('save').onclick = save;
  $('anim').onclick = toggleAnim;
  $('fNew').onclick = () => addFrame(false);
  $('fDup').onclick = () => addFrame(true);
  $('fDel').onclick = deleteFrame;
  $('fLeft').onclick = () => moveFrame(st.frame, st.frame - 1);
  $('fRight').onclick = () => moveFrame(st.frame, st.frame + 1);
  $('fPlay').onclick = play;
  $('fOnion').onchange = render;
  $('fFps').onchange = () => { startClock(); if (st.playing) { stopPlay(); play(); } };
  window.addEventListener('keydown', (e) => {
    if (st.tab === 'pages') { pages.key(e); return; }
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    if (st.tab === 'photos') { photos.key(e); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyS') { e.preventDefault(); save(); }
    else if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? undoRedo(st.redo, st.undo) : undoRedo(st.undo, st.redo); }
    else if (mod && e.code === 'KeyY') { e.preventDefault(); undoRedo(st.redo, st.undo); }
    else if (mod) return;
    else if (st.tab === 'pictures' && e.altKey && e.code === 'KeyN') { e.preventDefault(); addFrame(false); }
    else if (st.tab === 'pictures' && e.altKey && e.code === 'KeyD') { e.preventDefault(); addFrame(true); }
    else if (st.tab === 'pictures' && e.altKey && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); deleteFrame(); }
    else if (st.tab === 'pictures' && e.altKey && e.code === 'ArrowLeft') { e.preventDefault(); moveFrame(st.frame, st.frame - 1); }
    else if (st.tab === 'pictures' && e.altKey && e.code === 'ArrowRight') { e.preventDefault(); moveFrame(st.frame, st.frame + 1); }
    else if (st.tab === 'pictures' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && cur()) {
      e.preventDefault(); stopPlay();
      const n = cur().frames.length;
      st.frame = (st.frame + (e.code === 'ArrowLeft' ? n - 1 : 1)) % n;
      buildTimeline(); renderPreview(); render();
    }
    else if (st.tab === 'pictures' && e.code === 'Enter') { e.preventDefault(); play(); }
    else if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggleAnim(); }
    else if (e.code === 'KeyB') setTool('pen');
    else if (e.code === 'KeyE') setTool('erase');
    else if (e.code === 'KeyG') setTool('fill');
    else if (e.code === 'KeyI') setTool('pick');
    else if (e.code === 'KeyP' && st.kind === 'cursors') setTool('pivot');
  });
  window.addEventListener('beforeunload', (e) => { if (st.dirty || photos.dirty || pages.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

init().catch((e) => { console.error(e); status('Load error: ' + e.message); });
