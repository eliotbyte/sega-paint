// A tiny immediate-mode GUI on one low-res canvas. Every frame the app draws the whole screen and
// registers the clickable rectangles (regions); mouse events go to the topmost region of the last frame.
import { THEMES, toolIcon, smallIcon, drawText, textWidth, fitText, TOOL_W, TOOL_H, CELL, newCanvas } from './pixel.js';

export const ui = {
  cv: null, g: null, W: 0, H: 0, SC: 1, dpr: 1, T: THEMES.light,
  regions: [], hover: null, capture: null, mouse: { x: -1, y: -1, inside: false, buttons: 0 },
  scale: 4, fit: 1, // chosen scale; the biggest one the window allows
  focus: null, // { id, opts } of the text field being edited
  input: null, frame: 0, onResize: null, pressedId: null,
};

// The screen is scaled by a whole number (ui.scale, chosen in the settings), but never so much that
// fewer than this many art pixels are left.
const MIN_W = 440, MIN_H = 240;

export function initScreen(canvas, input) {
  ui.cv = canvas; ui.g = canvas.getContext('2d'); ui.input = input;
  resizeScreen();
  window.addEventListener('resize', resizeScreen);
  const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { resizeScreen(); watchDpr(); }, { once: true });
  watchDpr();
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const r = regionAt(pos(e)); r?.dbl?.(pos(e), e); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mouseleave', () => { ui.mouse.inside = false; });
  input.addEventListener('input', () => ui.focus?.opts.onInput?.(input.value));
  input.addEventListener('keydown', (e) => {
    const o = ui.focus?.opts;
    if (!o) return;
    if (e.key === 'Enter') { e.preventDefault(); o.onEnter?.(input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); o.onEscape?.(); blurField(); }
    else if (e.key === 'Tab') e.preventDefault();
    else if (o.onKey?.(e)) e.preventDefault();
    e.stopPropagation();
  });
  input.addEventListener('blur', () => { const f = ui.focus; ui.focus = null; f?.opts.onBlur?.(input.value); });
}

export function resizeScreen() {
  const dpr = window.devicePixelRatio || 1;
  const dw = Math.floor(window.innerWidth * dpr), dh = Math.floor(window.innerHeight * dpr);
  ui.fit = Math.max(1, Math.min(Math.floor(dw / MIN_W), Math.floor(dh / MIN_H)));
  const SC = Math.min(ui.scale, ui.fit);
  const W = Math.floor(dw / SC), H = Math.floor(dh / SC);
  Object.assign(ui, { dpr, SC, W, H });
  ui.cv.width = W; ui.cv.height = H;
  ui.cv.style.width = `${(W * SC) / dpr}px`;
  ui.cv.style.height = `${(H * SC) / dpr}px`;
  ui.g.imageSmoothingEnabled = false;
  ui.onResize?.();
}

const pos = (e) => {
  const r = ui.cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * ui.W, y: (e.clientY - r.top) / r.height * ui.H };
};
const inside = (r, m) => m.x >= r.x && m.y >= r.y && m.x < r.x + r.w && m.y < r.y + r.h;
function regionAt(m, need) {
  for (let i = ui.regions.length - 1; i >= 0; i--) {
    const r = ui.regions[i];
    if (!inside(r, m)) continue;
    if (!need || r[need]) return r;
    if (r.block) return null;
  }
  return null;
}

function onDown(e) {
  const m = pos(e);
  const r = regionAt(m);
  if (ui.focus && r?.id !== ui.focus.id) blurField();
  if (!r) return;
  e.preventDefault();
  if (r.disabled) return;
  ui.capture = r; ui.pressedId = r.id;
  r.down?.(m, e);
}
function onMove(e) {
  const m = pos(e);
  Object.assign(ui.mouse, m, { inside: e.target === ui.cv || inside({ x: 0, y: 0, w: ui.W, h: ui.H }, m), buttons: e.buttons });
  if (ui.capture) { ui.capture.move?.(m, e); return; }
  regionAt(m)?.hoverMove?.(m, e);
}
function onUp(e) {
  const r = ui.capture;
  ui.capture = null; ui.pressedId = null;
  if (!r) return;
  const m = pos(e);
  r.up?.(m, e);
  if (inside(r, m) && !r.disabled) r.click?.(m, e);
}
function onWheel(e) {
  const r = regionAt(pos(e), 'wheel');
  if (!r) return;
  e.preventDefault();
  r.wheel(e, pos(e));
}

// ---------- frame ----------
export function beginFrame() {
  ui.frame++;
  ui.regions = [];
}
export function endFrame() {
  const m = ui.mouse;
  // while dragging, the hovered region is the pressed one, as drawn this frame (its tip shows the live value)
  const cap = ui.capture && (ui.capture.id != null && ui.regions.find((r) => r.id === ui.capture.id) || ui.capture);
  ui.hover = cap || (m.inside ? regionAt(m) : null);
  // the app draws its own pixel pointers (arrow, pointing hand, tools); only text fields keep the system I-beam
  const cur = ui.hover?.cursor === 'text' ? 'text' : 'none';
  if (ui.cv.style.cursor !== cur) ui.cv.style.cursor = cur;
}
export function region(x, y, w, h, opts = {}) {
  const r = { x, y, w, h, ...opts };
  ui.regions.push(r);
  return r;
}
export const hot = (id) => ui.hover?.id === id && !ui.hover.disabled;
export const pressed = (id) => ui.pressedId === id;

// ---------- drawing helpers ----------
export const fill = (x, y, w, h, c) => { ui.g.fillStyle = c; ui.g.fillRect(x, y, w, h); };
export function frame(x, y, w, h, c = ui.T.ink) { // 1 px outline, outer size w x h
  fill(x, y, w, 1, c); fill(x, y + h - 1, w, 1, c); fill(x, y, 1, h, c); fill(x + w - 1, y, 1, h, c);
}
export function text(t, x, y, c = ui.T.ink) { return drawText(ui.g, t, x, y, c); }
const patterns = new Map();
// Every other pixel in colour c (a checkerboard), the pixel-art way to shade.
export function dither(x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  let p = patterns.get(c);
  if (!p) {
    const cv = newCanvas(2, 2), g = cv.getContext('2d');
    g.fillStyle = c; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
    p = ui.g.createPattern(cv, 'repeat');
    patterns.set(c, p);
  }
  ui.g.fillStyle = p; ui.g.fillRect(x, y, w, h);
}
// Dotted rectangle outline (selection marquee); `phase` makes the dots crawl.
export function ants(x, y, w, h, c, phase = 0) {
  const g = ui.g; g.fillStyle = c;
  for (let i = 0; i < w; i++) { if ((i + phase) % 4 < 2) { g.fillRect(x + i, y, 1, 1); g.fillRect(x + w - 1 - i, y + h - 1, 1, 1); } }
  for (let j = 0; j < h; j++) { if ((j + phase) % 4 < 2) { g.fillRect(x + w - 1, y + j, 1, 1); g.fillRect(x, y + h - 1 - j, 1, 1); } }
}

// ---------- cell strips: buttons sharing 1 px borders, like the drawing ----------
// Big cells: 20x19 inside, pitch 21. Small cells: 12x12 inside, pitch 13.
export const BIG = { w: TOOL_W, h: TOOL_H }, SMALL = { w: CELL, h: CELL };
export const stripW = (n, c = BIG) => n * (c.w + 1) + 1;
// cells: [{ id, icon, small?, on, disabled, tip, key, click, draw(x,y,w,h,ink,face) }]
export function strip(x, y, cells, c = BIG) {
  const T = ui.T;
  const w = stripW(cells.length, c), h = c.h + 2;
  frame(x, y, w, h);
  cells.forEach((cell, k) => {
    const cx = x + 1 + k * (c.w + 1), cy = y + 1;
    if (k) fill(cx - 1, y, 1, h, T.ink);
    if (!cell) return;
    const on = cell.on || (pressed(cell.id) && hot(cell.id));
    const face = cell.face || (on ? T.sel : hot(cell.id) ? T.hover : T.face);
    const ink = cell.disabled ? T.off : on ? T.selInk : (cell.ink || T.ink);
    fill(cx, cy, c.w, c.h, face);
    if (cell.draw) cell.draw(cx, cy, c.w, c.h, ink, face);
    else if (cell.icon) ui.g.drawImage(c === BIG ? toolIcon(cell.icon, ink, on ? 1 : 0) : smallIcon(cell.icon, ink, on ? 1 : 0), cx, cy); // frame 2 when on, if drawn
    if (cell.id) region(cx, cy, c.w, c.h, { cursor: cell.disabled ? 'default' : 'pointer', ...cell });
  });
  return w;
}

// A text button with a frame. Returns its width.
export function button(x, y, label, opts = {}) {
  const T = ui.T;
  const w = opts.w || textWidth(label) + 10, h = 13;
  const on = opts.primary || (pressed(opts.id) && hot(opts.id));
  frame(x, y, w, h);
  fill(x + 1, y + 1, w - 2, h - 2, opts.disabled ? T.face : on ? T.sel : hot(opts.id) ? T.hover : T.face);
  text(label, x + ((w - textWidth(label)) >> 1), y + 4, opts.disabled ? T.off : on ? T.selInk : T.ink);
  region(x, y, w, h, { cursor: opts.disabled ? 'default' : 'pointer', ...opts });
  return w;
}

// ---------- text fields (a hidden <input> does the typing; the canvas shows it) ----------
export function focusField(id, value, opts) {
  const inp = ui.input;
  ui.focus = { id, opts };
  inp.value = value;
  inp.maxLength = opts.max || 40;
  inp.inputMode = opts.numeric ? 'numeric' : 'text';
  inp.focus();
  if (opts.selectAll) inp.select(); else inp.setSelectionRange(value.length, value.length);
}
export function blurField() { if (ui.focus) ui.input.blur(); }
// Draws a field; `value` is shown when it is not being edited.
export function field(x, y, w, id, value, opts = {}) {
  const T = ui.T;
  const h = opts.h || 13, bg = opts.bg || T.face, ink = opts.ink || T.ink;
  const editing = ui.focus?.id === id;
  if (editing) ui.focus.opts = opts;
  if (!opts.bare) { frame(x, y, w, h, opts.frame || T.ink); fill(x + 1, y + 1, w - 2, h - 2, bg); }
  const tx = x + (opts.bare ? 0 : 3), ty = y + ((h - 5) >> 1);
  if (editing) {
    const inp = ui.input, v = inp.value;
    const a = inp.selectionStart ?? v.length, b = inp.selectionEnd ?? a;
    // keep the caret in view
    const room = w - (opts.bare ? 1 : 6);
    let start = 0;
    while (start < a && textWidth(v.slice(start, a)) > room) start++;
    const vis = v.slice(start);
    if (b > a) {
      const sx = tx + textWidth(v.slice(start, a)) + (a > start ? 1 : 0), sw = textWidth(v.slice(a, b)) + 1;
      fill(sx - 1, ty - 1, Math.min(sw + 1, x + w - sx), 7, opts.selBg || T.sel);
    }
    const g = ui.g;
    g.save(); g.beginPath(); g.rect(x + 1, y, w - 2, h); g.clip();
    let cx = tx;
    [...vis].forEach((ch, i) => { const k = start + i; cx += text(ch, cx, ty, k >= a && k < b ? (opts.selInk || T.selInk) : ink) + 1; });
    g.restore();
    if ((ui.frame >> 4) % 2 === 0 || b > a) fill(tx + textWidth(v.slice(start, a)) + (a > start ? 0 : -1), ty - 1, 1, 7, ink);
    // the real input sits under the field (for IMEs), invisible
    const r = ui.cv.getBoundingClientRect(), k = r.width / ui.W;
    Object.assign(ui.input.style, { left: `${r.left + x * k}px`, top: `${r.top + y * k}px`, width: `${w * k}px`, height: `${h * k}px` });
  } else {
    const room = w - (opts.bare ? 0 : 6);
    text(fitText(value, room), tx, ty, ink);
    if (!value && opts.placeholder) text(fitText(opts.placeholder, room), tx, ty, T.dim);
  }
  region(x, y, w, h, {
    id, cursor: opts.readOnly ? 'default' : 'text', tip: opts.tip, wheel: opts.wheel,
    down: () => { if (!opts.readOnly && !editing) focusField(id, String(value), opts); opts.down?.(); },
  });
}
