// A tiny immediate-mode GUI on one low-res canvas. Every frame the app draws the whole screen and
// registers the clickable rectangles (regions); mouse events go to the topmost region of the last frame.
import { THEMES, toolIcon, smallIcon, drawText, textWidth, fitText, TOOL_W, TOOL_H, CELL, newCanvas, boxSprite } from './pixel.js';

export const ui = {
  cv: null, g: null, W: 0, H: 0, SC: 1, dpr: 1, T: THEMES.dark,
  regions: [], hover: null, capture: null, mouse: { x: -1, y: -1, inside: false, buttons: 0 },
  scale: 4, fit: 1, // chosen scale; the biggest one the window allows
  focus: null, // { id, opts } of the text field being edited
  input: null, frame: 0, onResize: null, pressedId: null,
};

// The screen is scaled by a whole number (ui.scale, chosen in the settings), but never so much that
// fewer than this many art pixels are left.
const MIN_W = 440, MIN_H = 240;

export function initScreen(canvas, input) {
  // CPU-backed: boxes copy what is under them into small canvases (frame / keepUnder); from a GPU canvas every copy is a readback
  ui.cv = canvas; ui.g = canvas.getContext('2d', { willReadFrequently: true }); ui.input = input;
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
  unders.clear();
  ui.under = ui.T.bg;
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
// ui.still: no new regions (a panel sliding while it folds: what is drawn is not where it will be)
export function region(x, y, w, h, opts = {}) {
  const r = { x, y, w, h, ...opts };
  if (!ui.still) ui.regions.push(r);
  return r;
}
export const hot = (id) => ui.hover?.id === id && !ui.hover.disabled;
export const pressed = (id) => ui.pressedId === id;

// ---------- drawing helpers ----------
export const fill = (x, y, w, h, c) => { ui.g.fillStyle = c; ui.g.fillRect(x, y, w, h); };
// What is under each box (by its x,y), kept when frame() paints it: the box sprite's transparent pixels show it.
// Usually a colour: ui.under, what the boxes are drawn on now (the background; a panel's or a dialog's face while
// their insides are drawn), or one given to frame(). 'copy' (pop-ups over anything) copies the pixels instead;
// every such copy makes the browser finish drawing the frame so far (and keeps the canvas on the CPU), so the
// many boxes of every frame must not use it: ~90 copies a frame made Chrome drop frames.
const unders = new Map(); // 'x,y' -> colour or canvas, drawn this frame
const underPool = new Map(); // 'x,y' -> canvas, reused across frames
function keepUnder(x, y, w, h) {
  const k = x + ',' + y;
  let cv = underPool.get(k);
  if (!cv || cv.width < w || cv.height < h) {
    if (underPool.size > 500) underPool.clear();
    cv = newCanvas(Math.max(w, cv?.width || 0), Math.max(h, cv?.height || 0));
    underPool.set(k, cv);
  }
  const g = cv.getContext('2d'), m = ui.g.getTransform(); // (drawn moved: a panel sliding while it folds)
  g.globalCompositeOperation = 'copy';
  g.drawImage(ui.cv, x + m.e, y + m.f, w, h, 0, 0, w, h);
  unders.set(k, cv);
}
// box: the box sprite it is rounded with (round), 'button' or 'listItem'
export function frame(x, y, w, h, c = ui.T.edge, box = 'button', under = ui.under) { // 1 px outline, outer size w x h (corners: round())
  const cs = boxSprite(box);
  if (cs || w < 4 || h < 4) {
    if (cs?.outside) { if (under === 'copy') keepUnder(x, y, w, h); else unders.set(x + ',' + y, under); } // for its transparent pixels
    fill(x, y, w, 1, c); fill(x, y + h - 1, w, 1, c); fill(x, y, 1, h, c); fill(x + w - 1, y, 1, h, c);
    return;
  }
  fill(x + 1, y, w - 2, 1, c); fill(x + 1, y + h - 1, w - 2, 1, c); fill(x, y + 1, 1, h - 2, c); fill(x + w - 1, y + 1, 1, h - 2, c);
}
// Text with a 1 px shadow down and right (the panels: theme colours panelInk / textShade)
export function shadowText(t, x, y, c = ui.T.panelInk, s = ui.T.textShade) {
  drawText(ui.g, t, x + 1, y + 1, s);
  return drawText(ui.g, t, x, y, c);
}
// Rounded corners: frame() leaves its corner pixels out; after the inside is filled, this puts the inner corner
// pixels in the frame colour (three at each corner), so the box looks rounded. which: 'tb' both rows, 't' top, 'b' bottom.
// bev / sh: the colours of the box sprite's light edge and shadow
// The light edge and shadow of a box with this fill: an on / chosen box (sel) has its own.
export const boxTone = (face) => (face === ui.T.sel ? [ui.T.selBevel, ui.T.selShade] : [ui.T.bevel, ui.T.boxShade]);
export function round(x, y, w, h, c = ui.T.edge, which = 'tbs', box = 'button', bev = ui.T.bevel, sh = ui.T.boxShade) {
  const cs = boxSprite(box);
  if (cs) return nineSlice(cs, x, y, w, h, c, which, bev, sh);
  if (w < 6 || h < 6) return;
  const corner = (cx, cy, dx, dy) => { fill(cx, cy, 1, 1, c); fill(cx + dx, cy, 1, 1, c); fill(cx, cy + dy, 1, 1, c); };
  if (which.includes('t')) { corner(x + 1, y + 1, 1, 1); corner(x + w - 2, y + 1, -1, 1); }
  if (which.includes('b')) { corner(x + 1, y + h - 2, 1, -1); corner(x + w - 2, y + h - 2, -1, -1); }
}
// The box sprite of the art editor (art/pictures/button.png, 9-slice) over a box already drawn: transparent pixels
// show what is under the box (frame() keeps that colour), black ones the frame colour, white ones leave the box's own
// fill (and what is drawn on it), other light ones the light edge (theme colour bevel), other dark ones the shadow
// (theme colour boxShade). which: 't' the top row of slices,
// 'b' the bottom row, 's' the sides between them (to the box's bottom when 'b' is not there); 'l' / 'r' round only
// the left / right corners (the other side square: its edge goes on to the frame), neither = both.
// Each box's overlay is drawn once into a small canvas (per sprite, size, rows and colours) and stamped with one
// drawImage: drawing it pixel by pixel every frame cost thousands of fillRects.
const sliceCache = new WeakMap(); // sprite -> Map(key -> canvas)
function nineSlice(cs, x, y, w, h, c, which = 'tbs', bev = ui.T.bevel, sh = ui.T.boxShade) {
  const [L, Tp, R, B] = cs.slice, top = which.includes('t'), bot = which.includes('b');
  if (w < L + R + 1 || h < (top ? Tp : 0) + (bot ? B : 0) + 1) return;
  let m = sliceCache.get(cs);
  if (!m) sliceCache.set(cs, (m = new Map()));
  const cached = (key, draw) => {
    let cv = m.get(key);
    if (!cv) {
      if (m.size > 2000) m.clear();
      cv = newCanvas(w, h);
      draw(cv.getContext('2d'));
      m.set(key, cv);
    }
    return cv;
  };
  const size = w + ',' + h + ',' + which;
  ui.g.drawImage(cached(size + ',' + c + ',' + bev + ',' + sh, (g) => sliceOnto(g, cs, w, h, c, bev, null, which, sh)), x, y);
  // the transparent pixels: what was under the box, through a mask of them
  const under = cs.outside && unders.get(x + ',' + y);
  if (typeof under === 'string') ui.g.drawImage(cached(size + ',u,' + under, (g) => sliceOnto(g, cs, w, h, null, null, under, which)), x, y);
  else if (under) { // a copy (kept as it is: a panel rounds its top and, later, its bottom)
    if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(w, scratch.width); scratch.height = Math.max(h, scratch.height); }
    const g = scratch.getContext('2d');
    g.globalCompositeOperation = 'copy';
    g.drawImage(under, 0, 0, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(cached(size + ',mask', (mg) => sliceOnto(mg, cs, w, h, null, null, '#fff', which)), 0, 0);
    ui.g.drawImage(scratch, 0, 0, w, h, x, y, w, h);
  }
}
const scratch = newCanvas(1, 1);
function sliceOnto(g, cs, w, h, c, bev, under, which, sh = null) {
  const [L, Tp, R, B] = cs.slice, top = which.includes('t'), bot = which.includes('b'), sides = which.includes('s');
  const both = !/[lr]/.test(which), left = both || which.includes('l'), right = both || which.includes('r');
  const mw = cs.w - L - R, mh = cs.h - Tp - B;
  const put = (sx, sy, px, py) => {
    const v = cs.cell[sy * cs.w + sx];
    const col = v === 1 ? c : v === 3 ? bev : v === 4 ? sh : v === 0 ? under : null;
    if (col) { g.fillStyle = col; g.fillRect(px, py, 1, 1); }
  };
  // one row band of slices (sy0..sy0+n source rows) onto box rows py0..: left corner, repeated middle, right corner
  const band = (sy0, n, py0, rows) => {
    for (let r = 0; r < rows; r++) {
      const sy = sy0 + (n ? r % n : 0), py = py0 + r;
      if (left) for (let i = 0; i < L; i++) put(i, sy, i, py);
      // the middle repeated; where a corner is not rounded, on over it to the frame's column
      if (mw > 0) for (let px = left ? L : 1, end = right ? w - R : w - 1; px < end; px++) put(L + (((px - L) % mw) + mw) % mw, sy, px, py);
      if (right) for (let i = 0; i < R; i++) put(cs.w - R + i, sy, w - R + i, py);
    }
  };
  if (top) band(0, Tp, 0, Tp);
  if (bot) band(cs.h - B, B, h - B, B);
  if (sides && mh > 0) {
    const y0 = top ? Tp : 0, y1 = bot ? h - B : h;
    for (let py = y0; py < y1; py++) {
      const sy = Tp + (py - y0) % mh;
      for (let i = 0; i < L; i++) put(i, sy, i, py);
      for (let i = 0; i < R; i++) put(cs.w - R + i, sy, w - R + i, py);
    }
  }
}
// The light edge of a raised bar: 1 px along its top and left (theme colour bevel)
export function bevel(x, y, w, h, c = ui.T.bevel) { fill(x, y, w, 1, c); fill(x, y, 1, h, c); }
// All text has the 1 px shadow down and right (theme colour textShade), as shadowText.
export function text(t, x, y, c = ui.T.ink) { return shadowText(t, x, y, c); }
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
// A toolbar icon's colours: black = the outline (edge), white = the fill (second text, dim), light grey = the light
// edge (icons and text, ink), dark grey = the shadow (iconShade); a disabled button: all of it in off.
function iconColors(cell) {
  const T = ui.T, off = cell.disabled;
  return off ? [T.off, T.off, T.off, T.off] : [T.edge, T.dim, T.ink, T.iconShade];
}
export function strip(x, y, cells, c = BIG) {
  const T = ui.T;
  const w = stripW(cells.length, c), h = c.h + 2;
  frame(x, y, w, h);
  let allOn = cells.some(Boolean);
  cells.forEach((cell, k) => {
    const cx = x + 1 + k * (c.w + 1), cy = y + 1;
    if (k) fill(cx - 1, y, 1, h, T.edge);
    if (!cell) return;
    const on = cell.on || (pressed(cell.id) && hot(cell.id));
    const face = cell.face || (on ? T.sel : hot(cell.id) ? T.hover : T.face);
    if (face !== T.sel) allOn = false;
    const ink = cell.disabled ? T.off : on ? T.selInk : (cell.ink || T.ink);
    fill(cx, cy, c.w, c.h, face);
    if (cell.draw) cell.draw(cx, cy, c.w, c.h, ink, face);
    else if (cell.icon) ui.g.drawImage(c === BIG ? toolIcon(cell.icon, iconColors(cell), cell.frame ?? (on ? 1 : 0)) : smallIcon(cell.icon, ink, cell.frame ?? (on ? 1 : 0)), cx, cy); // frame 2 when on, if drawn
    if (cell.id) region(cx, cy, c.w, c.h, { cursor: cell.disabled ? 'default' : 'pointer', ...cell });
  });
  round(x, y, w, h, T.edge, 'tbs', 'button', ...boxTone(allOn ? T.sel : T.face)); // a box that is all on: its own edges
  return w;
}

// A text button with a frame. Returns its width.
export function button(x, y, label, opts = {}) {
  const T = ui.T;
  const w = opts.w || textWidth(label) + 10, h = 13;
  const on = opts.primary || (pressed(opts.id) && hot(opts.id));
  frame(x, y, w, h);
  const face = opts.disabled ? T.face : on ? T.sel : hot(opts.id) ? T.hover : T.face;
  fill(x + 1, y + 1, w - 2, h - 2, face);
  shadowText(label, x + ((w - textWidth(label)) >> 1), y + 4, opts.disabled ? T.off : on ? T.selInk : T.ink);
  round(x, y, w, h, T.edge, 'tbs', 'button', ...boxTone(face));
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
  if (!opts.bare) { frame(x, y, w, h, opts.frame || T.edge); fill(x + 1, y + 1, w - 2, h - 2, bg); round(x, y, w, h, opts.frame || T.edge); }
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
