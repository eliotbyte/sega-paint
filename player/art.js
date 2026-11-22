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
  ['tools', 'Buttons', 'Toolbar icon, 16×15 (in the middle of a 20×19 button). Theme colours: black = the outline (edge, as the buttons’ frames), white = the fill (dim, the second text), a light grey = the light edge (ink, icons and text), a dark grey = the shadow (iconShade), transparent = the button. On a disabled button all of it is off.'],
  ['small', 'Small icons', 'Small button icon, 12×12. Black is the icon.'],
  ['notes', 'Notes', 'Note, 8×8. Black outline and the three note yellows (light, body, shade): the player paints them in the track colour.'],
  ['cursors', 'Cursors', 'Mouse pointer, 16×16, drawn as it looks (any colour; empty is see-through). The pivot (red) is the point that clicks: set it with the Pivot tool.'],
  ['clefs', 'Clefs', 'Clef. Black is the clef; the player draws it in the staff colour, at its place on the staff.'],
  ['pictures', 'Pictures', 'A picture drawn as it is (Sonic on the playhead: sonicIdle, sonicWalk). button: the sprite boxes are drawn with, listItem: the rows of lists (a smaller corner); sliced in 9 by the red lines (Slices…): the corners as drawn, the edges and the middle repeat. Transparent = outside, black = the frame, white = the fill, a light grey = the light edge (theme: bevel), a dark grey = the shadow (theme: boxShade). keys: one octave of the piano keys (B at the top, C at the bottom), frame 1 = as they are, 2 = pressed, 3 = keys the pen cannot use. volIcon, volLine, volKnob: the volume control (the line’s width is how far the knob goes; knob frame 2 = held or under the mouse). noteTail: the line after a long note, drawn like the notes (black and the three yellows, painted in each track colour); the red lines (Slices…) cut it into the start, the middle (repeated along the line) and the end. While a note plays, its line turns the shade colour up to the note.'],
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
  bg: 'Window background', face: 'Buttons and panels', hover: 'Button under the mouse', ink: 'Icons and text', edge: 'Outlines of buttons, panels and list rows',
  dim: 'Second text (hints, shortcuts)', off: 'Disabled icons and text', sel: 'Pressed / chosen button, selection, title bars',
  selInk: 'Icon and text on a pressed button', soft: 'Current row in a list', paper: 'Staff paper', staff: 'Staff lines',
  bar: 'Bar lines, repeat signs', faded: 'Faint staff lines (8va)', beat: 'Beat grid', keys: 'Piano keys',
  shade: 'Shaded rows / time out of the song', lane: 'Chosen drum lane', lcd: 'Display background', lcdInk: 'Display numbers',
  lcdDim: 'Display labels', head: 'Playhead, lit key', loop: 'Green repeat (loop)', rep: 'Repeat bar on the ruler',
  red: 'Mute button', green: 'Solo button', white: 'Text on red / green', hiRep: 'Repeat tool: bars under the mouse',
  hiLoop: 'Repeat tool: loop bars', hiDel: 'Repeat tool: bars to remove', ghostTo: 'Other tracks’ notes fade to this',
  ghostOutline: 'Other tracks’ note outline',
  bevel: 'Panel bars: light edge (left and top)', panelInk: 'Text in the panels (tracks, playlist)',
  textShade: 'Shadow of the panel text',
  boxShade: 'Boxes: shadow (the box sprites’ dark pixels)',
  iconShade: 'Toolbar icons: shadow (their dark grey pixels)',
  dropShadow: 'Shadow under menus and dialogs',
  selBevel: 'Pressed / chosen boxes: light edge', selShade: 'Pressed / chosen boxes: shadow',
};

const st = {
  tick: 0, toneMode: 'active',
  art: {}, // kind -> Map(name -> { info, frames: [canvas] })
  kind: 'tools', name: null, frame: 0, tool: 'pen', color: [0, 0, 0],
  zoom: 16, ox: 0, oy: 0, pan: null, painting: null,
  undo: [], redo: [], dirtyFiles: new Set(), deleted: new Set(), dirty: false,
  tones: [], theme: {}, themeName: 'dark', tab: 'pictures', colourKey: null, tone: [0, 1], mockHits: [],
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
  st.ghostOutline = (pal?.ghostOutline || parseColor(THEMES.dark.ghostOutline).map(lvOf)).slice();
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
// with it) and one outline for all (outline and shade); 3-bit levels. Default: the body
// faded towards grey, as the player drew them before they had their own colours.
function defaultGhost() {
  const to = THEMES.dark.ghostTo;
  return st.tones.map((t) => t[1].map((v, i) => lvOf(LV[v] + (to[i] - LV[v]) * 0.62)));
}
const MODES = [['active', 'Active'], ['inactive', 'Inactive']];
// [outline, light, body, shade] of a track colour, active or inactive, 0..255
const notePal = (tone, mode) => (mode === 'active' ? [st.outline, ...st.tones[tone]]
  : mode === 'played' ? [st.outline, st.tones[tone][2], st.tones[tone][2], st.tones[tone][2]] // a played tail: the shade
  : [st.ghostOutline, st.ghost[tone], st.ghost[tone], st.ghostOutline]).map(lv);
// the paper the notes are shown on: the chosen theme's
const modeBg = () => THEMES.dark.paper;
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
  if (st.art.tools && [...st.art.tools.values()].some((a) => a.frames.includes(cv))) t.style.background = TOOL_CHECKS[0]; // white icons: on blue
  return t;
}
// toolbar icons are white, black and greys: their checks are blue
const TOOL_CHECKS = ['#3f5f8f', '#4a6c9e'];
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
    }
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
  if (!SIZES[st.kind]) bar.append(btn('Size…', () => resizePicture(a))); // pictures and clefs: any size
  if (isTail()) { // the note tail: the start and the end (the middle repeats)
    bar.append(btn('Slices…', () => {
      const v = (prompt('Start and end widths (red lines): start end', [sliceOf(a)[0], sliceOf(a)[2]].join(' ')) || '').trim().split(/[\s,]+/).map(Number);
      if (v.length !== 2 || v.some((n) => !(n >= 0))) return;
      if (v[0] + v[1] >= a.frames[0].width) { alert('The start and the end must leave at least one column in the middle.'); return; }
      a.info.slice = [v[0], 0, v[1], 0]; dirty(); buildBar(); renderPreview(); render();
    }));
    const sl = document.createElement('span'); sl.className = 'hint'; sl.textContent = `start ${sliceOf(a)[0]} · end ${sliceOf(a)[2]}`;
    bar.append(sl);
  }
  if (isBoxSprite()) {
    bar.append(btn('Slices…', () => {
      const v = (prompt('Border widths (red lines): left top right bottom', sliceOf(a).join(' ')) || '').trim().split(/[\s,]+/).map(Number);
      if (v.length !== 4 || v.some((n) => !(n >= 0))) return;
      const [w, h] = [a.frames[0].width, a.frames[0].height];
      if (v[0] + v[2] >= w || v[1] + v[3] >= h) { alert('The borders must leave at least one column and row in the middle.'); return; }
      a.info.slice = v; dirty(); buildBar(); renderPreview(); render();
    }));
    const sl = document.createElement('span'); sl.className = 'hint'; sl.textContent = 'slices ' + sliceOf(a).join(' ');
    bar.append(sl);
  }
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = st.kind === 'cursors' ? `pivot ${a.info.hot || [0, 0]}` : '';
  bar.append(hint);
}
// A new size for every frame of a picture: what is drawn stays at the top left (the rest is cut or left empty).
function resizePicture(a) {
  const w0 = a.frames[0].width, h0 = a.frames[0].height;
  const s = (prompt('New size, width×height:', `${w0}x${h0}`) || '').match(/(\d+)\s*[x×*]\s*(\d+)/);
  if (!s) return;
  const w = Math.max(1, Math.min(128, +s[1])), h = Math.max(1, Math.min(128, +s[2]));
  if (w === w0 && h === h0) return;
  pushUndo(framesUndo());
  a.frames = a.frames.map((cv) => { const n = newCv(w, h); n.getContext('2d').drawImage(cv, 0, 0); return n; });
  restructured();
  buildBar();
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
      c.fillStyle = st.kind === 'tools' ? TOOL_CHECKS[(x + y) % 2] : (x + y) % 2 ? '#e6e6e6' : '#ffffff';
      c.fillRect(x0 + x * z, y0 + y * z, z, z);
    }
  } else { c.fillStyle = css(st.bg.c.map((v) => LV[v])); c.fillRect(x0, y0, cv.width * z, cv.height * z); }
  // onion skin: the frame before, faint, under this one
  if ($('fOnion').checked && !st.playing && st.frame > 0) { c.globalAlpha = 0.25; c.drawImage(cur().frames[st.frame - 1], x0, y0, cv.width * z, cv.height * z); c.globalAlpha = 1; }
  if (st.sel && !selHere()) dropSel(true); // another picture or frame: the selection lands where it was
  c.drawImage(cv, x0, y0, cv.width * z, cv.height * z);
  if (st.sel?.float) c.drawImage(st.sel.float, x0 + st.sel.x * z, y0 + st.sel.y * z, st.sel.w * z, st.sel.h * z);
  if (z >= 6) {
    c.fillStyle = 'rgba(0,0,0,0.15)';
    for (let x = 0; x <= cv.width; x++) c.fillRect(x0 + x * z, y0, 1, cv.height * z);
    for (let y = 0; y <= cv.height; y++) c.fillRect(x0, y0 + y * z, cv.width * z, 1);
  }
  c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(x0 - 0.5, y0 - 0.5, cv.width * z + 1, cv.height * z + 1);
  if (st.sel) { // the selection: marching black and white dashes
    const s = st.sel, r = [x0 + s.x * z + 0.5, y0 + s.y * z + 0.5, s.w * z - 1, s.h * z - 1];
    c.lineWidth = 1; c.setLineDash([4, 4]);
    c.strokeStyle = '#fff'; c.lineDashOffset = 0; c.strokeRect(...r);
    c.strokeStyle = '#000'; c.lineDashOffset = 4; c.strokeRect(...r);
    c.setLineDash([]);
  }
  if (isTail()) { // the start and the end of the note tail
    const [l, , r] = sliceOf(cur());
    c.fillStyle = '#ff0000';
    for (const x of [l, cv.width - r]) c.fillRect(x0 + x * z - 1, y0 - 6, 2, cv.height * z + 12);
  }
  if (isBoxSprite()) { // the 9-slice borders, as in Unity's sprite editor
    const [l, t, r, b] = sliceOf(cur());
    c.fillStyle = '#ff0000';
    for (const x of [l, cv.width - r]) c.fillRect(x0 + x * z - 1, y0 - 6, 2, cv.height * z + 12);
    for (const y of [t, cv.height - b]) c.fillRect(x0 - 6, y0 + y * z - 1, cv.width * z + 12, 2);
  }
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
// ---------- the selection (tool Select): a box on one frame; dragged, its pixels float over the frame till dropped ----------
// st.sel = { kind, name, frame, x, y, w, h, float }: float is the lifted pixels (a canvas) or null
const selCv = (s) => st.art[s.kind]?.get(s.name)?.frames[s.frame];
const selHere = () => st.sel && st.sel.kind === st.kind && st.sel.name === st.name && st.sel.frame === st.frame;
const inSel = (s, [x, y]) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
function liftSel(copy = false) { // the pixels in the box leave the frame and float (copy: they stay there too)
  const s = st.sel, cv = selCv(s);
  if (s.float || !cv) return;
  pushUndo({ kind: s.kind, name: s.name, frame: s.frame, data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height) });
  s.float = newCv(s.w, s.h);
  s.float.getContext('2d').drawImage(cv, -s.x, -s.y);
  if (!copy) cv.getContext('2d').clearRect(s.x, s.y, s.w, s.h);
  st.dirtyFiles.add(fileOf(s.kind, s.name, s.frame)); dirty();
}
function dropSel(quiet = false) { // the floating pixels land where they are (see-through ones keep what is under), the box goes
  const s = st.sel;
  st.sel = null;
  if (!s?.float) { if (!quiet) render(); return; }
  const cv = selCv(s);
  if (cv) { cv.getContext('2d').drawImage(s.float, s.x, s.y); st.dirtyFiles.add(fileOf(s.kind, s.name, s.frame)); dirty(); }
  if (quiet) setTimeout(() => { renderPreview(); refreshThumb(); refreshCel(); }, 0); else after();
}
function clearSel() { // Delete: what is in the box goes
  const s = st.sel, cv = selCv(s);
  if (!s.float && cv) { pushUndo(pixelUndo()); cv.getContext('2d').clearRect(s.x, s.y, s.w, s.h); changed(); }
  st.sel = null; after();
}
function nudgeSel(dx, dy) { liftSel(); st.sel.x += dx; st.sel.y += dy; render(); }
function selDown(e, cv, p) {
  if (selHere() && inSel(st.sel, p)) {
    if (!st.sel.float) liftSel(e.altKey);
    else if (e.altKey) { const s = st.sel; selCv(s).getContext('2d').drawImage(s.float, s.x, s.y); changed(); } // Alt: leave a copy here
    st.selDrag = { move: true, from: p, x: st.sel.x, y: st.sel.y };
  } else {
    dropSel(true);
    const q = [Math.max(0, Math.min(cv.width - 1, p[0])), Math.max(0, Math.min(cv.height - 1, p[1]))];
    st.sel = { kind: st.kind, name: st.name, frame: st.frame, x: q[0], y: q[1], w: 1, h: 1, float: null };
    st.selDrag = { from: q, moved: false };
  }
  render();
}
function selMove(e) {
  const d = st.selDrag, s = st.sel, p = atPx(e);
  if (!s) return;
  if (d.move) { s.x = d.x + p[0] - d.from[0]; s.y = d.y + p[1] - d.from[1]; }
  else {
    const cv = selCv(s), q = [Math.max(0, Math.min(cv.width - 1, p[0])), Math.max(0, Math.min(cv.height - 1, p[1]))];
    if (q[0] !== d.from[0] || q[1] !== d.from[1]) d.moved = true;
    s.x = Math.min(d.from[0], q[0]); s.y = Math.min(d.from[1], q[1]);
    s.w = Math.abs(q[0] - d.from[0]) + 1; s.h = Math.abs(q[1] - d.from[1]) + 1;
  }
  render();
}
function selUp() {
  const d = st.selDrag;
  st.selDrag = null;
  if (d && !d.move && !d.moved) { st.sel = null; render(); } // a click without a drag: no box
  else after();
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
  if (st.tool === 'select' && e.button === 0) { e.preventDefault(); selDown(e, cv, p); return; }
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
  if (st.selDrag) { selMove(e); return; }
  if (st.tab === 'pictures' && st.tool === 'select' && e.target === view) view.style.cursor = selHere() && inSel(st.sel, atPx(e)) ? 'move' : '';
  if (!st.painting) return;
  const p = atPx(e);
  line(curCv(), st.painting.last, p, st.painting.col);
  st.painting.last = p;
  after();
}
function up() { photos?.up(); if (st.selDrag) selUp(); if (st.painting && st.kind === 'pictures') buildSwatches(); st.painting = null; st.pan = null; view.classList.remove('pan'); }
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
  // a box sprite: black the frame, white the fill, a light grey the light edge, a dark grey the shadow (pixel.js boxSprite)
  if (isBoxSprite()) list.push([[146, 146, 146], 'Light edge (theme colour bevel)'], [[73, 73, 73], 'Shadow (theme colour boxShade)']);
  // a toolbar icon: black the outline, white the fill, a light grey the light edge, a dark grey the shadow
  const toolIc = st.tab === 'pictures' && st.kind === 'tools';
  if (toolIc) { list[1][1] = 'Outline (theme colour edge)'; list[2][1] = 'Fill (theme colour dim: second text)'; list.push([[146, 146, 146], 'Light edge (theme colour ink: icons and text)'], [[73, 73, 73], 'Shadow (theme colour iconShade)']); }
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
      // (a box sprite: its five colours only)
      if (!seen.has(k) && seen.size < 30 && !isBoxSprite() && !toolIc) { seen.add(k); list.push([[d[i], d[i + 1], d[i + 2]], family ? `In ${family}` : 'In this picture']); }
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
// A black-ink picture painted in one colour (as the player does), or color = [black, white, light grey, dark grey]
// (toolbar icons: toolCols).
function inkCv(cv, color) {
  const out = newCv(cv.width, cv.height), o = out.getContext('2d'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const cols = Array.isArray(color) ? color : [color];
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i + 3] <= 127 ? 0 : d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60 ? 1 : d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 ? 2 : d[i] + d[i + 1] + d[i + 2] < 384 ? 4 : 3;
    if (k && cols[k - 1]) { o.fillStyle = cols[k - 1]; o.fillRect((i / 4) % cv.width, Math.floor(i / 4 / cv.width), 1, 1); }
  }
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
// a toolbar icon's colours, as gui.js iconColors: outline edge, fill dim, light ink, shadow iconShade
const toolCols = (t, off) => (off ? [t.off, t.off, t.off, t.off] : [t.edge, t.dim, t.ink, t.iconShade]);
function iconState(a, theme, state) { // a button with this icon, as the player draws it
  const t = T(theme), on = state === 'on', cv = (on && a.frames[1]) || a.frames[0];
  const face = on ? t.sel : state === 'hover' ? t.hover : t.face, ink = state === 'off' ? t.off : on ? t.selInk : t.ink;
  const [bw, bh] = st.kind === 'small' ? [CELL, CELL] : [TOOL_W, TOOL_H];
  const out = newCv(bw + 2, bh + 2), o = out.getContext('2d');
  o.fillStyle = t.edge || t.ink; o.fillRect(0, 0, out.width, out.height);
  o.fillStyle = face; o.fillRect(1, 1, bw, bh);
  o.drawImage(inkCv(cv, st.kind === 'tools' ? toolCols(t, state === 'off') : ink), 1 + ((bw - cv.width) >> 1), 1 + ((bh - cv.height) >> 1));
  return out;
}
// The box sprites (pictures/button, pictures/listItem): 9-slice pictures the player's boxes are drawn with (gui.js round)
const BOX_SPRITES = ['button', 'listItem']; // listItem: rows of lists and the buttons on them
const isBoxSprite = () => st.tab === 'pictures' && st.kind === 'pictures' && BOX_SPRITES.includes(st.name);
// The note tail (pictures/noteTail): sliced by two red lines into the start, the middle (repeated) and the end.
const isTail = () => st.tab === 'pictures' && st.kind === 'pictures' && st.name === 'noteTail';
// A tail w px long as the player draws it (app.js tailRun) in tone k, mode 'active' | 'played' | 'ghost'.
function tailSample(a, w, k, mode) {
  const src = noteCv(a.frames[0], k, mode === 'ghost' ? 'ghost' : mode), [l, , r] = sliceOf(a), h = src.height, mw = src.width - l - r;
  const out = newCv(w, h), o = out.getContext('2d');
  if (w < l + r) {
    const lh = Math.min(l, Math.ceil(w / 2)), rh = Math.min(r, w - lh);
    o.drawImage(src, 0, 0, lh, h, 0, 0, lh, h); o.drawImage(src, src.width - rh, 0, rh, h, w - rh, 0, rh, h);
    return out;
  }
  o.drawImage(src, 0, 0, l, h, 0, 0, l, h);
  for (let x = l; x < w - r; x += mw) { const cw = Math.min(mw, w - r - x); o.drawImage(src, l, 0, cw, h, x, 0, cw, h); }
  o.drawImage(src, src.width - r, 0, r, h, w - r, 0, r, h);
  if (mode === 'played') { // the player's checkerboard: every other pixel in the icons' outline colour
    const img = o.getImageData(0, 0, w, h), d = img.data, ol = lv(st.outline);
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] && ((i % w) + ((i / w) | 0)) & 1) for (let j = 0; j < 3; j++) d[i * 4 + j] = ol[j];
    o.putImageData(img, 0, 0);
  }
  return out;
}
const sliceOf = (a) => a.info.slice || [Math.floor(a.frames[0].width / 3), Math.floor(a.frames[0].height / 3), Math.floor(a.frames[0].width / 3), Math.floor(a.frames[0].height / 3)];
// A few boxes as the player draws them with the box sprite cv sliced at sl (gui.js nineSlice): transparent = what is
// under the box, black = the frame, white = the box's fill, another light colour = the light edge (theme colour bevel),
// another dark one = the shadow (theme colour boxShade).
// A box drawn with a 9-slice box sprite onto g in theme colours t: box(x, y, w, h, face, which) fills it now and
// returns done(), which puts the sprite's corners and edges on top once the inside is drawn.
// which: 'l' / 'r' round only that side (the other one square), as the player's list rows; under: what shows through.
function boxPainter(g, t, cv, sl, under = t.bg) {
  const fill = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const cell = (i, j) => { const k = (j * cv.width + i) * 4; return d[k + 3] <= 127 ? 0 : d[k] < 60 && d[k + 1] < 60 && d[k + 2] < 60 ? 1 : d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200 ? 2 : d[k] + d[k + 1] + d[k + 2] < 384 ? 4 : 3; };
  const [L, Tp, R, B] = sl, mw = cv.width - L - R, mh = cv.height - Tp - B;
  return (x, y, w, h, face, which = 'lr') => {
    fill(x, y, w, h, t.edge || t.ink); fill(x + 1, y + 1, w - 2, h - 2, face);
    const on = face === t.sel && t.selBevel, bev = on ? t.selBevel : t.bevel || t.face, sh = on ? t.selShade : t.boxShade || t.ink; // pressed / chosen: its own
    return () => {
      if (w < L + R + 1 || h < Tp + B + 1 || mw < 1 || mh < 1) return;
      const left = which.includes('l'), right = which.includes('r');
      const sx = (px) => (left && px - x < L ? px - x : right && px >= x + w - R ? cv.width - (x + w - px) : L + (((px - x - L) % mw) + mw) % mw);
      const sy = (py) => (py - y < Tp ? py - y : py >= y + h - B ? cv.height - (y + h - py) : Tp + (py - y - Tp) % mh);
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        const i = sx(px), j = sy(py);
        if (i >= L && i < cv.width - R && j >= Tp && j < cv.height - B) continue; // the middle: the box's own
        if (!left && px === x || !right && px === x + w - 1) continue; // a square side: the plain frame
        const v = cell(i, j);
        if (v === 0) fill(px, py, 1, 1, under); else if (v === 1) fill(px, py, 1, 1, t.edge || t.ink); else if (v === 3) fill(px, py, 1, 1, bev); else if (v === 4) fill(px, py, 1, 1, sh);
      }
    };
  };
}
function boxSample(cv, sl, th) {
  const t = T(th), W = 86, H = 44, out = newCv(W, H), g = out.getContext('2d');
  const fill = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const box = boxPainter(g, t, cv, sl);
  fill(0, 0, W, H, t.bg);
  let done = box(2, 2, W - 4, 16, t.face);
  drawText(g, 'LAYERS', 7, 8, t.textShade || t.face); drawText(g, 'LAYERS', 6, 7, t.panelInk || t.ink); done();
  done = box(4, 24, 36, 15, t.face); drawText(g, 'CANCEL', 10, 29, t.ink); done();
  done = box(44, 24, 36, 15, t.sel); drawText(g, 'DONE', 54, 29, t.selInk); done();
  return out;
}
function renderPreview() {
  const box = $('preview'), a = cur();
  box.innerHTML = '';
  if (!a) return;
  const add = (cv, title) => { cv.title = title; box.append(cv); };
  const label = (t) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = t; box.append(d); };
  if (st.kind === 'tools' || st.kind === 'small') {
    for (const th of ['dark']) {
      label('normal · hover · on · disabled');
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
    for (const th of ['dark']) {
      label('actual size, ×3');
      a.frames.forEach((cv) => { add(scaled(cv, 1, T(th).face), 'actual size'); add(scaled(cv, 3, T(th).face), '×3'); });
    }
  } else if (isTail()) {
    // the tail in every track colour: long and short, as it is and played (the shade), then on another track
    label('In every track colour: long, short, played; under it on another track (×2)');
    st.tones.forEach((_, k) => {
      const h = a.frames[0].height, row = newCv(80, h * 2 + 6), o = row.getContext('2d');
      o.drawImage(tailSample(a, 32, k, 'active'), 2, 2); o.drawImage(tailSample(a, 8, k, 'active'), 38, 2);
      o.drawImage(tailSample(a, 32, k, 'played'), 48, 2);
      o.drawImage(tailSample(a, 32, k, 'ghost'), 2, h + 4);
      add(scaled(row, 2, modeBg()), TONE_NAMES[k]);
    });
  } else if (isBoxSprite()) {
    // the box sprite: boxes of the player drawn with it, as it is being drawn
    for (const th of ['dark']) { label('a panel bar and buttons (×2)'); add(scaled(boxSample(a.frames[st.frame] || a.frames[0], sliceOf(a), th), 2), th); }
  } else if (st.kind === 'clefs') {
    for (const th of ['dark']) add(scaled(inkCv(a.frames[0], T(th).ink), 2, T(th).paper), th);
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
      : 'Notes of the other tracks: two colours. The outline (also the shade), then the body (also the light) of each track colour.'}</div>`;
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
  h.textContent = 'Interface colours';
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
    c.fillStyle = k === st.tone[0] ? '#ff2400' : '#dbdbdb';
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
  const W = 220, H = 208, cv = newCv(W, H), g = cv.getContext('2d');
  const hits = [];
  const box = (x, y, w, h, key, color = t[key]) => { g.fillStyle = color; g.fillRect(x, y, w, h); hits.push({ x, y, w, h, key }); };
  const txt = (s, x, y, key) => { const w = drawText(g, s, x, y, t[key]); hits.push({ x, y: y - 1, w: w || s.length * 4, h: 7, key }); };
  const icon = (name, x, y, face, ink, frameOn = false) => {
    const a = st.art.tools.get(name);
    box(x - 1, y - 1, TOOL_W + 2, TOOL_H + 2, 'edge');
    box(x, y, TOOL_W, TOOL_H, face);
    const icv = a && ((frameOn && a.frames[1]) || a.frames[0]);
    if (a) { g.drawImage(inkCv(icv, toolCols(t, ink === 'off')), x + ((TOOL_W - icv.width) >> 1), y + ((TOOL_H - icv.height) >> 1)); hits.push({ x: x + 4, y: y + 4, w: TOOL_W - 8, h: TOOL_H - 8, key: ink }); }
  };
  box(0, 0, W, H, 'bg');
  // toolbar buttons: normal, hover, on, disabled
  icon('pen', 4, 4, 'face', 'ink'); icon('eraser', 26, 4, 'hover', 'ink'); icon('bucket', 48, 4, 'sel', 'selInk', true); icon('pipette', 70, 4, 'face', 'off');
  txt('NORMAL HOVER  ON   OFF', 4, 26, 'dim');
  // text buttons and a field
  box(96, 4, 30, 13, 'edge'); box(97, 5, 28, 11, 'face'); txt('OK', 106, 8, 'ink');
  box(130, 4, 34, 13, 'edge'); box(131, 5, 32, 11, 'sel'); txt('SAVE', 138, 8, 'selInk');
  box(96, 20, 68, 11, 'edge'); box(97, 21, 66, 9, 'face'); txt('MY RIFF', 100, 23, 'ink');
  // a menu
  box(170, 44, 48, 2, 'dropShadow'); box(216, 6, 2, 40, 'dropShadow');
  box(168, 4, 48, 40, 'edge'); box(169, 5, 46, 38, 'face');
  txt('NEW', 172, 8, 'ink'); box(169, 15, 46, 11, 'sel'); txt('OPEN', 172, 18, 'selInk'); txt('SAVE', 172, 30, 'off'); txt('^S', 205, 30, 'dim');
  // a layer row: colour chip, name (chosen), mute, solo
  box(4, 36, 160, 13, 'edge'); box(5, 37, 12, 11, 'face', css(lv(st.tones[0][1]))); txt('1', 9, 40, 'ink');
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
  box(82, 166, 136, 2, 'dropShadow'); box(216, 126, 2, 42, 'dropShadow');
  box(80, 124, 136, 42, 'edge'); box(81, 125, 134, 40, 'face'); box(81, 125, 134, 11, 'sel'); txt('SETTINGS', 84, 128, 'selInk');
  txt('SOUND', 84, 140, 'dim'); txt('A HINT', 84, 152, 'dim');
  // rounded boxes (the box sprites button and listItem) and the panel text with its shadow
  const sprite = (name) => { const a = st.art.pictures.get(name); return a && boxPainter(g, t, a.frames[0], sliceOf(a), t.bg); };
  const sTxt = (s, x, y) => { // the panels' text: panelInk with a textShade shadow 1 px right and down
    drawText(g, s, x + 1, y + 1, t.textShade); const w = drawText(g, s, x, y, t.panelInk) || s.length * 4;
    hits.push({ x, y: y + 5, w: w + 1, h: 3, key: 'textShade' }, { x, y: y - 1, w, h: 6, key: 'panelInk' });
  };
  const rounded = (paint, x, y, w, h, key, which, under) => { // the box's colours, clickable: edge, face, light edge, shadow
    const own = t[key] ? key : 'edge'; // a track colour is not a theme colour
    const on = key === 'sel';
    hits.push({ x, y, w, h, key: 'edge' }, { x: x + 1, y: y + 1, w: w - 2, h: h - 2, key: own }, { x: x + 1, y: y + 1, w: w - 2, h: 1, key: on ? 'selBevel' : 'bevel' }, { x: x + 1, y: y + h - 2, w: w - 2, h: 1, key: on ? 'selShade' : 'boxShade' });
    return paint(x, y, w, h, typeof key === 'string' && t[key] ? t[key] : key, which, under);
  };
  const btnBox = sprite('button'), rowBox = sprite('listItem');
  if (btnBox && rowBox) {
    // a panel bar with its fold button
    let done = rounded(btnBox, 4, 172, 104, 14, 'face');
    sTxt('LAYERS', 8, 177); done();
    done = rounded(rowBox, 94, 174, 10, 10, 'face');
    const minus = st.art.small.get('minus')?.frames[0];
    if (minus) { g.drawImage(inkCv(minus, t.textShade), 94, 174); g.drawImage(inkCv(minus, t.panelInk), 93, 173); }
    done();
    // a list row on the outline colour: number | name | M | S, each its own box, rounded on the left (S on both sides)
    box(4, 188, 134, 15, 'edge');
    const row = [[4, 14, css(lv(st.tones[0][1])), 'l'], [17, 90, 'face', 'l'], [106, 14, 'face', 'l'], [119, 14, 'sel', 'lr']];
    for (const [x, w, face, which] of row) { const d = rounded(rowBox, x, 189, w, 13, face, which, t.edge); if (x === 4) txt('1', x + 5, 193, 'ink'); if (x === 17) sTxt('SYNTH BASS', x + 4, 193); if (x === 106) txt('M', x + 5, 193, 'ink'); if (x === 119) txt('S', x + 5, 193, 'selInk'); d(); }
    // a text button
    done = rounded(btnBox, 144, 186, 36, 17, 'face'); txt('CANCEL', 150, 192, 'ink'); done();
    done = rounded(btnBox, 182, 186, 34, 17, 'sel'); txt('DONE', 191, 192, 'selInk'); done();
  }
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
  if (t !== 'select' && st.sel) dropSel();
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
  if (st.sel) dropSel(true);
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
  if (st.sel) dropSel(true);
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
    else if (st.tab === 'pictures' && st.sel && selHere() && (e.code === 'Escape' || e.code === 'Enter')) { e.preventDefault(); dropSel(); }
    else if (st.tab === 'pictures' && st.sel && selHere() && !e.altKey && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); clearSel(); }
    else if (st.tab === 'pictures' && st.sel && selHere() && !e.altKey && e.code.startsWith('Arrow')) {
      e.preventDefault();
      nudgeSel(e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0, e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0);
    }
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
    else if (e.code === 'KeyM') setTool('select');
    else if (e.code === 'KeyP' && st.kind === 'cursors') setTool('pivot');
  });
  window.addEventListener('beforeunload', (e) => { if (st.dirty || photos.dirty || pages.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

init().catch((e) => { console.error(e); status('Load error: ' + e.message); });
