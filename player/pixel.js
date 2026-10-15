// Pixel kit: the Mega Drive palette, themes, the bitmap font and the art sheet (player/art/sheet.png).
// Everything on screen is drawn 1:1 into a low-res canvas that is scaled up by a whole number, so every
// pixel of every icon, sprite, staff line and letter has the same size.

// ---------- Mega Drive colours: 3 bits per channel ----------
export const LV = [0, 36, 73, 109, 146, 182, 219, 255];
export const md = (r, g, b) => `rgb(${LV[r]},${LV[g]},${LV[b]})`;
export const lvOf = (v) => LV.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(LV[best] - v) ? i : best), 0);
export const snap = (rgb) => rgb.map((v) => LV[lvOf(v)]);
export const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
export function parseColor(s) {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export const THEMES = {
  light: {
    bg: md(5, 5, 5), face: md(7, 7, 7), hover: md(6, 6, 6), ink: md(0, 0, 0), dim: md(3, 3, 3), off: md(4, 4, 4),
    sel: md(4, 2, 1), selInk: md(7, 7, 7), soft: md(7, 6, 4),
    paper: md(7, 7, 7), staff: md(4, 4, 4), bar: md(0, 0, 0), faded: md(6, 6, 7), beat: md(6, 6, 6), keys: md(4, 4, 4),
    shade: md(4, 4, 4), lane: md(6, 6, 6),
    lcd: md(0, 0, 0), lcdInk: md(7, 6, 2), lcdDim: md(4, 3, 0),
    head: md(7, 2, 0), loop: md(1, 4, 1), rep: md(5, 1, 2), red: md(6, 1, 1), green: md(2, 5, 1), white: md(7, 7, 7),
    hiRep: md(7, 6, 4), hiLoop: md(5, 7, 5), hiDel: md(7, 5, 5), // the bars the repeat tool points at
    ghostTo: [182, 182, 182], ghostOutline: md(4, 4, 4),
  },
  dark: {
    bg: md(1, 1, 1), face: md(0, 0, 0), hover: md(2, 2, 2), ink: md(6, 6, 6), dim: md(4, 4, 4), off: md(3, 3, 3),
    sel: md(5, 3, 1), selInk: md(0, 0, 0), soft: md(2, 1, 0),
    paper: md(0, 0, 0), staff: md(3, 3, 3), bar: md(6, 6, 6), faded: md(1, 1, 2), beat: md(1, 1, 1), keys: md(3, 3, 3),
    shade: md(2, 2, 2), lane: md(1, 1, 1),
    lcd: md(0, 0, 0), lcdInk: md(7, 6, 2), lcdDim: md(3, 2, 0),
    head: md(7, 3, 0), loop: md(2, 6, 2), rep: md(7, 3, 4), red: md(6, 1, 1), green: md(2, 5, 1), white: md(7, 7, 7),
    hiRep: md(2, 1, 0), hiLoop: md(0, 2, 0), hiDel: md(2, 0, 0),
    ghostTo: [36, 36, 36], ghostOutline: md(2, 2, 2),
  },
};

// Layer colours: highlight / body / shade, like the yellow / light yellow / orange of the note sprites.
// (the art editor saves art/palette.json; loadArt puts its tones in here)
export const LAYER_TONES = [
  [[7, 7, 5], [7, 7, 1], [6, 3, 1]], // yellow (as drawn)
  [[7, 5, 5], [7, 2, 2], [4, 0, 1]], // red
  [[5, 7, 4], [2, 6, 1], [0, 3, 1]], // green
  [[5, 6, 7], [2, 4, 7], [1, 1, 4]], // blue
  [[6, 5, 7], [5, 2, 7], [2, 0, 4]], // purple
  [[7, 6, 4], [7, 4, 0], [4, 1, 0]], // orange
  [[5, 7, 7], [0, 6, 6], [0, 3, 4]], // cyan
  [[7, 5, 7], [7, 3, 6], [4, 0, 3]], // pink
  [[6, 5, 3], [5, 3, 1], [2, 1, 0]], // brown
  [[7, 7, 7], [5, 5, 5], [2, 2, 2]], // grey
  [[6, 7, 4], [5, 7, 0], [2, 4, 0]], // lime
  [[4, 7, 6], [1, 5, 4], [0, 2, 2]], // teal
].map((t) => t.map((c) => c.map((v) => LV[v])));
export const toneCss = (k) => rgbCss(LAYER_TONES[k][1]);
// Tones ordered by closeness to a colour from an older song file (hue first, then brightness).
export function toneOrder(css) {
  const c = parseColor(css);
  const hue = (x) => {
    const [r, g, b] = x.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08) return -1;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const h0 = hue(c);
  const dist = LAYER_TONES.map((t) => {
    const h1 = hue(t[1]);
    let d;
    if (h0 < 0 || h1 < 0) d = h0 === h1 ? 0 : 400;
    else { d = Math.abs(h0 - h1); d = Math.min(d, 360 - d); }
    return d + t[1].reduce((a, v, i) => a + Math.abs(v - c[i]), 0) / 40;
  });
  return dist.map((d, k) => [d, k]).sort((a, b) => a[0] - b[0]).map(([, k]) => k);
}

// ---------- canvases ----------
export function newCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

// ---------- bitmap font: 5 px tall, proportional, capitals (lower case is shown as capitals) ----------
const GLYPHS = {
  A: '.o.|o.o|ooo|o.o|o.o', B: 'oo.|o.o|oo.|o.o|oo.', C: '.oo|o..|o..|o..|.oo', D: 'oo.|o.o|o.o|o.o|oo.',
  E: 'ooo|o..|oo.|o..|ooo', F: 'ooo|o..|oo.|o..|o..', G: '.oo|o..|o.o|o.o|.oo', H: 'o.o|o.o|ooo|o.o|o.o',
  I: 'ooo|.o.|.o.|.o.|ooo', J: '..o|..o|..o|o.o|.o.', K: 'o.o|o.o|oo.|o.o|o.o', L: 'o..|o..|o..|o..|ooo',
  M: 'o...o|oo.oo|o.o.o|o...o|o...o', N: 'o..o|oo.o|o.oo|o..o|o..o', O: '.o.|o.o|o.o|o.o|.o.',
  P: 'oo.|o.o|oo.|o..|o..', Q: '.o.|o.o|o.o|oo.|.oo', R: 'oo.|o.o|oo.|o.o|o.o', S: '.oo|o..|.o.|..o|oo.',
  T: 'ooo|.o.|.o.|.o.|.o.', U: 'o.o|o.o|o.o|o.o|ooo', V: 'o.o|o.o|o.o|o.o|.o.', W: 'o...o|o...o|o.o.o|oo.oo|o...o',
  X: 'o.o|o.o|.o.|o.o|o.o', Y: 'o.o|o.o|.o.|.o.|.o.', Z: 'ooo|..o|.o.|o..|ooo',
  0: 'ooo|o.o|o.o|o.o|ooo', 1: '.o.|oo.|.o.|.o.|ooo', 2: 'oo.|..o|.o.|o..|ooo', 3: 'oo.|..o|.o.|..o|oo.',
  4: 'o.o|o.o|ooo|..o|..o', 5: 'ooo|o..|oo.|..o|oo.', 6: '.oo|o..|ooo|o.o|ooo', 7: 'ooo|..o|.o.|.o.|.o.',
  8: 'ooo|o.o|ooo|o.o|ooo', 9: 'ooo|o.o|ooo|..o|oo.',
  ' ': '..|..|..|..|..', '.': '.|.|.|.|o', ',': '.|.|.|o|o', ':': '.|o|.|o|.', ';': '.|o|.|o|o', '!': 'o|o|o|.|o',
  '?': 'oo.|..o|.o.|...|.o.', "'": 'o|o|.|.|.', '’': 'o|o|.|.|.', '"': 'o.o|o.o|...|...|...', '-': '...|...|ooo|...|...',
  '–': '...|...|ooo|...|...', '—': '....|....|oooo|....|....', '+': '...|.o.|ooo|.o.|...', '=': '...|ooo|...|ooo|...',
  '/': '..o|..o|.o.|o..|o..', '\\': 'o..|o..|.o.|..o|..o', '(': '.o|o.|o.|o.|.o', ')': 'o.|.o|.o|.o|o.',
  '[': 'oo|o.|o.|o.|oo', ']': 'oo|.o|.o|.o|oo', '#': 'o.o|ooo|o.o|ooo|o.o', '♯': 'o.o|ooo|o.o|ooo|o.o',
  '%': 'o.o|..o|.o.|o..|o.o', '&': '.o.|o.o|.o.|o.o|.oo', '*': '...|o.o|.o.|o.o|...', '<': '..o|.o.|o..|.o.|..o',
  '>': 'o..|.o.|..o|.o.|o..', '_': '...|...|...|...|ooo', '·': '.|.|o|.|.', '•': '..|oo|oo|..|..', '×': '...|o.o|.o.|o.o|...',
  '→': '....|..o.|oooo|..o.|....', '←': '....|.o..|oooo|.o..|....', '|': 'o|o|o|o|o', '…': '.....|.....|.....|.....|o.o.o',
  '~': '....|.o.o|o.o.|....|....', '@': '.oo.|o.oo|o.oo|o...|.oo.',
  '$': '.oo|oo.|.o.|.oo|oo.', '^': '.o.|o.o|...|...|...', '°': 'oo|oo|..|..|..',
  // Cyrillic capitals
  'А': '.o.|o.o|ooo|o.o|o.o', 'Б': 'ooo|o..|oo.|o.o|oo.', 'В': 'oo.|o.o|oo.|o.o|oo.', 'Г': 'ooo|o..|o..|o..|o..',
  'Д': '.oo.|.o.o|.o.o|oooo|o..o', 'Е': 'ooo|o..|oo.|o..|ooo', 'Ё': 'o.o|ooo|oo.|o..|ooo', 'Ж': 'o.o.o|o.o.o|.ooo.|o.o.o|o.o.o',
  'З': 'oo.|..o|.o.|..o|oo.', 'И': 'o..o|o..o|o.oo|oo.o|o..o', 'Й': '.oo.|o..o|o.oo|oo.o|o..o', 'К': 'o.o|o.o|oo.|o.o|o.o',
  'Л': '.oo|o.o|o.o|o.o|o.o', 'М': 'o...o|oo.oo|o.o.o|o...o|o...o', 'Н': 'o.o|o.o|ooo|o.o|o.o', 'О': '.o.|o.o|o.o|o.o|.o.',
  'П': 'ooo|o.o|o.o|o.o|o.o', 'Р': 'oo.|o.o|oo.|o..|o..', 'С': '.oo|o..|o..|o..|.oo', 'Т': 'ooo|.o.|.o.|.o.|.o.',
  'У': 'o.o|o.o|.oo|..o|oo.', 'Ф': '.ooo.|o.o.o|o.o.o|.ooo.|..o..', 'Х': 'o.o|o.o|.o.|o.o|o.o', 'Ц': 'o.o.|o.o.|o.o.|oooo|...o',
  'Ч': 'o.o|o.o|.oo|..o|..o', 'Ш': 'o.o.o|o.o.o|o.o.o|o.o.o|ooooo', 'Щ': 'o.o.o.|o.o.o.|o.o.o.|oooooo|.....o',
  'Ъ': 'oo..|.o..|.oo.|.o.o|.oo.', 'Ы': 'o...o|o...o|oo..o|o.o.o|oo..o', 'Ь': 'o..|o..|oo.|o.o|oo.', 'Э': 'oo.|..o|.oo|..o|oo.',
  'Ю': 'o..o.|o.o.o|ooo.o|o.o.o|o..o.', 'Я': '.oo|o.o|.oo|o.o|o.o',
};
const FONT = {};
for (const [ch, s] of Object.entries(GLYPHS)) if (s) FONT[ch] = s.split('|');
const UNKNOWN = ['ooo', 'o.o', 'o.o', 'o.o', 'ooo'];
export const FONT_H = 5;
const glyphOf = (ch) => FONT[ch] || FONT[ch.toUpperCase()] || UNKNOWN;
export function textWidth(text) {
  let w = 0;
  for (const ch of String(text)) w += glyphOf(ch)[0].length + 1;
  return Math.max(0, w - 1);
}
const textCache = new Map();
// Text as a canvas of its own (cached); `y` is the top of the capitals.
export function textCanvas(text, color) {
  text = String(text);
  const key = color + '\u0000' + text;
  let cv = textCache.get(key);
  if (cv) return cv;
  cv = newCanvas(Math.max(1, textWidth(text)), FONT_H);
  const c = cv.getContext('2d');
  c.fillStyle = color;
  let x = 0;
  for (const ch of text) {
    const gl = glyphOf(ch);
    gl.forEach((r, y) => { for (let i = 0; i < r.length; i++) if (r[i] === 'o') c.fillRect(x + i, y, 1, 1); });
    x += gl[0].length + 1;
  }
  if (textCache.size > 800) textCache.clear();
  textCache.set(key, cv);
  return cv;
}
export function drawText(g, text, x, y, color) {
  if (text === '' || text == null) return 0;
  const cv = textCanvas(text, color);
  g.drawImage(cv, Math.round(x), Math.round(y));
  return cv.width;
}
// Shorten text to a width, with a trailing dot run.
export function fitText(text, w) {
  text = String(text);
  if (textWidth(text) <= w) return text;
  while (text.length > 1 && textWidth(text + '..') > w) text = text.slice(0, -1);
  return text.replace(/\s+$/, '') + '..';
}

// ---------- the art: one PNG per picture in art/<kind>/<name>.png (frame 2: <name>-2.png), listed in art/art.json ----------
// Kinds: tools 16x15 (in the middle of a 20x19 button) and small 12x12 icons (black = ink), notes 8x8 (black outline +
// the three note yellows),
// cursors (drawn as they look, with a hot spot), clefs (black = ink, with their place on the staff), pictures
// (drawn as they are). Empty pixels are transparent (white counts as empty too). The art editor (art.html) edits them.
export const NOTE_NAMES = []; // filled from art.json, in its order
export const TOOL_W = 20, TOOL_H = 19, CELL = 12;
export const ICON_W = 16, ICON_H = 15, CURSOR = 16; // the drawn size of a toolbar icon; mouse pointers are at most 16x16
// the three yellows note pictures are drawn in; the player paints them in a track's light / body / shade
export const NOTE_INKS = [[255, 251, 175], [251, 242, 54], [223, 113, 38]];
const ART = { man: null, img: {} }; // img[kind/name][frame] = { w, h, data }
export const artManifest = () => ART.man;
const isBlack = (c) => c[0] < 60 && c[1] < 60 && c[2] < 60;
const isWhite = (c) => c[0] > 240 && c[1] > 240 && c[2] > 240;

// Every picture of a kind as [name, info] (notes keep their order).
export const artItems = (kind) => (kind === 'notes' ? (ART.man?.notes || []).map((x) => [x.name, x]) : Object.entries(ART.man?.[kind] || {}));
export const hasFrame = (kind, name, frame) => !!ART.img[kind + '/' + name]?.[frame];
export const frameCount = (kind, name) => ART.img[kind + '/' + name]?.length || 0;
// What art.json says about a picture besides its frames (e.g. the splash logo's frame lengths).
export const artInfo = (kind, name) => ART.man?.[kind]?.[name] || {};

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = newCanvas(img.width, img.height), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: c.getImageData(0, 0, img.width, img.height).data };
}
const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export async function loadArt(base = 'art/') {
  const v = '?v=' + Date.now(); // the art editor rewrites the files
  const [man, pal, theme] = await Promise.all([json(base + 'art.json'), json(base + 'palette.json'), json(base + 'theme.json')]);
  ART.man = man;
  // the track colours and the interface colours, as set in the art editor (3-bit levels)
  if (pal?.tones?.length) pal.tones.forEach((t, k) => { LAYER_TONES[k] = t.map((c) => c.map((x) => LV[x])); });
  if (pal?.outline) NOTE_PAL.outline = pal.outline.map((x) => LV[x]);
  if (pal?.ghostOutline) NOTE_PAL.ghostOutline = pal.ghostOutline.map((x) => LV[x]);
  NOTE_PAL.ghost = Array.isArray(pal?.ghost) ? pal.ghost.map((g) => (Array.isArray(g[0]) ? g[1] : g).map((x) => LV[x])) : null;
  if (theme) applyTheme(theme);
  NOTE_NAMES.length = 0;
  NOTE_NAMES.push(...man.notes.map((x) => x.name));
  const jobs = [];
  for (const kind of ['tools', 'small', 'notes', 'cursors', 'clefs', 'pictures']) {
    for (const [name, info] of artItems(kind)) {
      const slot = (ART.img[kind + '/' + name] = []);
      for (let f = 0; f < (info.frames || 1); f++) {
        jobs.push(loadImage(`${base}${kind}/${name}${f ? '-' + (f + 1) : ''}.png${v}`).then((d) => { slot[f] = d; }).catch(() => {}));
      }
    }
  }
  await Promise.all(jobs);
}
// theme.json: { light: { key: [r, g, b] levels }, dark: { ... } }
export function applyTheme(theme) {
  for (const [name, keys] of Object.entries(theme)) {
    const T = THEMES[name];
    if (!T) continue;
    for (const [k, c] of Object.entries(keys)) T[k] = Array.isArray(T[k]) ? c.map((x) => LV[x]) : md(...c);
  }
}
// The interface colours as 3-bit levels (for the art editor).
export function themeLevels() {
  const out = {};
  for (const [name, T] of Object.entries(THEMES)) {
    out[name] = {};
    for (const [k, v] of Object.entries(T)) out[name][k] = (Array.isArray(v) ? v : parseColor(v)).map(lvOf);
  }
  return out;
}

const pic = (kind, name, frame = 0) => { const s = ART.img[kind + '/' + name]; return s?.[frame] || s?.[0] || null; };
const pxOf = (d, i) => [d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2], d.data[i * 4 + 3]];

// Monochrome masks (1 = ink).
const maskCache = new Map();
function inkMask(kind, name, frame = 0) {
  const key = kind + '/' + name + '/' + frame;
  if (maskCache.has(key)) return maskCache.get(key);
  const d = pic(kind, name, frame);
  // button icons sit in the middle of their button (a 16x15 drawing in a 20x19 tool button)
  const w = kind === 'tools' ? TOOL_W : kind === 'small' ? CELL : d?.w || 1, h = kind === 'tools' ? TOOL_H : kind === 'small' ? CELL : d?.h || 1;
  const ox = d ? Math.max(0, (w - d.w) >> 1) : 0, oy = d ? Math.max(0, (h - d.h) >> 1) : 0;
  const m = new Uint8Array(w * h);
  if (d) for (let y = 0; y < Math.min(d.h, h); y++) for (let x = 0; x < Math.min(d.w, w); x++) {
    const c = pxOf(d, y * d.w + x);
    m[(y + oy) * w + x + ox] = c[3] > 127 && isBlack(c) ? 1 : 0;
  }
  const out = { w, h, m };
  maskCache.set(key, out);
  return out;
}
const toolMask = (name, frame) => inkMask('tools', name, frame);
function paintMask(mk, color) {
  const cv = newCanvas(mk.w, mk.h);
  const c = cv.getContext('2d');
  c.fillStyle = color;
  for (let y = 0; y < mk.h; y++) for (let x = 0; x < mk.w; x++) if (mk.m[y * mk.w + x]) c.fillRect(x, y, 1, 1);
  return cv;
}
const iconCache = new Map();
// frame 1 (the second) is used when a button is on, if the icon has one
export function toolIcon(name, color, frame = 0) {
  const key = 't' + name + color + frame;
  if (!iconCache.has(key)) iconCache.set(key, paintMask(toolMask(name, frame), color));
  return iconCache.get(key);
}
export function smallIcon(name, color, frame = 0) {
  const key = 's' + name + color + frame;
  if (!iconCache.has(key)) iconCache.set(key, paintMask(inkMask('small', name, frame), color));
  return iconCache.get(key);
}
// A mouse pointer, drawn as it is in art/cursors, with its hot spot (frame 1: while a mouse button is down, if drawn).
export function pointerIcon(name, frame = 0) {
  const key = 'p' + name + frame;
  if (iconCache.has(key)) return iconCache.get(key);
  const d = pic('cursors', name, frame) || pic('cursors', 'arrow');
  const cv = newCanvas(d?.w || 1, d?.h || 1);
  if (d) cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data), d.w, d.h), 0, 0);
  const res = { cv, hot: ART.man?.cursors?.[name]?.hot || [0, 0] };
  iconCache.set(key, res);
  return res;
}
// A coloured picture as it is drawn (art/pictures), e.g. Sonic on the playhead.
export function picture(name, frame = 0) {
  const key = 'q' + name + frame;
  if (iconCache.has(key)) return iconCache.get(key);
  const d = pic('pictures', name, frame);
  const cv = newCanvas(d?.w || 1, d?.h || 1);
  if (d) cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data), d.w, d.h), 0, 0);
  iconCache.set(key, cv);
  return cv;
}
// ---------- note sprites: the 8x8 picture in the middle of a 12x12 cell; frame 0 = still, the others = while it plays ----------
export const NOTE_PX = 8;
const NOTE_OFF = (CELL - NOTE_PX) >> 1;
// Pixel codes: 1 outline (black), 2 highlight (light yellow), 3 body (yellow), 4 shade (orange).
const noteData = new Map();
function noteIdx(name, frame) {
  const key = name + frame;
  if (noteData.has(key)) return noteData.get(key);
  const src = pic('notes', NOTE_NAMES.includes(name) ? name : NOTE_NAMES[0], frame);
  const d = new Uint8Array(CELL * CELL);
  const off = src && src.w < CELL ? NOTE_OFF : 0; // 8x8 pictures sit in the middle of the cell
  if (src) for (let y = 0; y < Math.min(CELL, src.h); y++) for (let x = 0; x < Math.min(CELL, src.w); x++) {
    const c = pxOf(src, y * src.w + x), at = (y + off) * CELL + x + off;
    if (c[3] < 128 || isWhite(c)) continue;
    if (isBlack(c)) { d[at] = 1; continue; }
    let best = 0, bd = 1e9; // closest of the three drawn tones
    NOTE_INKS.forEach((t, i) => { const dd = t.reduce((a, v, j) => a + Math.abs(v - c[j]), 0); if (dd < bd) { bd = dd; best = i; } });
    d[at] = 2 + best;
  }
  noteData.set(key, d);
  return d;
}
const noteCache = new Map();
// The outline of notes, and other tracks' notes in two colours: one outline (also the shade) and one body colour
// (also the light) per track colour, the same in both themes (null: faded from the track colours towards the theme),
// as set in the art editor.
export const NOTE_PAL = { outline: [0, 0, 0], ghostOutline: null, ghost: null };
// variant: 'normal' | 'ghost' (other layers, or notes that do not play)
export function noteSprite(name, tone, frame = 0, variant = 'normal', theme = THEMES.light) {
  const key = `${name}|${tone}|${frame}|${variant}|${theme.paper}`;
  if (noteCache.has(key)) return noteCache.get(key);
  const t = LAYER_TONES[tone] || LAYER_TONES[0];
  let pal = ['', rgbCss(NOTE_PAL.outline), rgbCss(t[0]), rgbCss(t[1]), rgbCss(t[2])];
  if (variant === 'ghost') {
    const own = NOTE_PAL.ghost?.[tone], to = theme.ghostTo;
    const ol = NOTE_PAL.ghostOutline ? rgbCss(NOTE_PAL.ghostOutline) : theme.ghostOutline;
    const body = own ? rgbCss(own) : rgbCss(snap(mixRgb(t[1], to, 0.62)));
    pal = ['', ol, body, body, ol];
  }
  const d = noteIdx(name, frame);
  const cv = newCanvas(CELL, CELL);
  const c = cv.getContext('2d');
  for (let i = 0; i < d.length; i++) if (d[i]) { c.fillStyle = pal[d[i]]; c.fillRect(i % CELL, (i / CELL) | 0, 1, 1); }
  noteCache.set(key, cv);
  return cv;
}

// A picture dithered: every other pixel of it in one flat colour (`gap`, e.g. the shade of the areas out of play), so
// its shape stays but it greys out. Pass (x + y) & 1 of where it is drawn: the kept pixels then fall on the same screen
// checkerboard as gui.js dither(), so neighbours line up.
const checkerCache = new WeakMap();
export function checkered(cv, phase, gap) {
  let byKey = checkerCache.get(cv);
  if (!byKey) { byKey = new Map(); checkerCache.set(cv, byKey); }
  const key = phase + gap;
  if (byKey.has(key)) return byKey.get(key);
  const out = newCanvas(cv.width, cv.height), o = out.getContext('2d');
  o.drawImage(cv, 0, 0);
  const img = o.getImageData(0, 0, cv.width, cv.height), d = img.data;
  const g = parseColor(gap);
  for (let i = 0; i < d.length / 4; i++) {
    if (d[i * 4 + 3] && (((i % cv.width) + ((i / cv.width) | 0) + phase) & 1)) for (let j = 0; j < 3; j++) d[i * 4 + j] = g[j];
  }
  o.putImageData(img, 0, 0);
  byKey.set(key, out);
  return out;
}

// ---------- clefs ----------
const clefCache = new Map();
export function clef(name, color) {
  const key = name + color;
  if (clefCache.has(key)) return clefCache.get(key);
  const info = ART.man?.clefs?.[name] || {};
  const out = { cv: paintMask(inkMask('clefs', name), color), dx: info.dx || 0, dy: info.dy || 0 }; // offset from (clef area left, top staff line)
  clefCache.set(key, out);
  return out;
}
