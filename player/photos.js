// Song pictures: the art editor's tab for the Description panel's pictures (player/songs/_games/<game>/<name>.png,
// used by meta.json "info" pages). Open any image (a screenshot from an emulator, a photo of the composer, box art),
// frame the part to keep, and it comes out at the panel's size, 124×86, in Mega Drive colours: the same steps as
// tools/song_pictures.py. The dev server (tools/serve.py) writes the picture and keeps the image it was made from
// and the framing in art-src/_pictures/<game>/, so it can be framed again later.

export const PIC_W = 124, PIC_H = 86;
const ASPECT = PIC_H / PIC_W;
const LEVELS = [0, 52, 87, 116, 144, 172, 206, 255]; // the Mega Drive's colour DAC, 3 bits per channel
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
const MAX_SRC = 2000; // a bigger photo is shrunk on opening: plenty for 124×86, and the kept copy stays small
const DEFAULTS = {
  shot: { mode: 'shot', colors: 15, dither: 0, bright: 1, contrast: 1, sat: 1, flip: false },
  photo: { mode: 'photo', colors: 15, dither: 0.5, bright: 1, contrast: 1.1, sat: 1.25, flip: false },
};

const snap = (v) => { let b = 0; for (let k = 1; k < 8; k++) if (Math.abs(LEVELS[k] - v) < Math.abs(LEVELS[b] - v)) b = k; return LEVELS[b]; };
const slug = (s) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

// ---------- the picture: frame, shrink, colours ----------
// The colours of a game screenshot (a few dozen), put on the console's grid; null for a photo (too many).
function gameColours(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, seen = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (!seen.has(k)) { if (seen.size >= 256) return null; seen.set(k, 1); }
  }
  const out = new Map();
  for (const k of seen.keys()) { const c = [snap(k >> 16), snap((k >> 8) & 255), snap(k & 255)]; out.set(c.join(), c); }
  return [...out.values()];
}
// The framed part at 124×86. A screenshot is averaged over each pixel's area (smoothing rings around its dithering);
// a photo is shrunk by the browser's own high-quality scaler.
function shrink(src, crop, sharp, flip) {
  const h = crop.w * ASPECT, out = new Float32Array(PIC_W * PIC_H * 3);
  if (sharp) {
    const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, W = src.width;
    const sx = crop.w / PIC_W, sy = h / PIC_H;
    for (let y = 0; y < PIC_H; y++) {
      const y0 = crop.y + y * sy, y1 = y0 + sy;
      for (let x = 0; x < PIC_W; x++) {
        const x0 = crop.x + (flip ? PIC_W - 1 - x : x) * sx, x1 = x0 + sx;
        let r = 0, g = 0, b = 0, n = 0;
        for (let py = Math.floor(y0); py < y1; py++) {
          const wy = Math.min(y1, py + 1) - Math.max(y0, py);
          for (let px = Math.floor(x0); px < x1; px++) {
            const w = wy * (Math.min(x1, px + 1) - Math.max(x0, px)), i = (Math.min(src.height - 1, py) * W + Math.min(W - 1, px)) * 4;
            r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
          }
        }
        const o = (y * PIC_W + x) * 3;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
    }
    return out;
  }
  // big steps first: one jump from a 2000 px photo down to 124 skips most of its pixels
  let cur = src, cx = crop.x, cy = crop.y, cw = crop.w, ch = h;
  while (cw > PIC_W * 2.5) {
    const t = document.createElement('canvas');
    t.width = Math.ceil(cw / 2); t.height = Math.ceil(ch / 2);
    const g = t.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(cur, cx, cy, cw, ch, 0, 0, cw / 2, ch / 2);
    cur = t; cx = 0; cy = 0; cw /= 2; ch /= 2;
  }
  const t = document.createElement('canvas');
  t.width = PIC_W; t.height = PIC_H;
  const g = t.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (flip) { g.translate(PIC_W, 0); g.scale(-1, 1); }
  g.drawImage(cur, cx, cy, cw, ch, 0, 0, PIC_W, PIC_H);
  const d = g.getImageData(0, 0, PIC_W, PIC_H).data;
  for (let i = 0, o = 0; i < d.length; i += 4, o += 3) { out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; }
  return out;
}
// Brightness, then colour (from grey), then contrast (from the picture's mean grey), as PIL's ImageEnhance.
function adjust(px, s) {
  if (s.bright === 1 && s.sat === 1 && s.contrast === 1) return;
  let mean = 0;
  for (let i = 0; i < px.length; i += 3) {
    let r = px[i] * s.bright, g = px[i + 1] * s.bright, b = px[i + 2] * s.bright;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    px[i] = l + (r - l) * s.sat; px[i + 1] = l + (g - l) * s.sat; px[i + 2] = l + (b - l) * s.sat;
    mean += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  mean /= px.length / 3;
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, mean + (px[i] - mean) * s.contrast));
}
// A photo's own main colours (median cut), moved onto the console's grid.
function mainColours(px, n) {
  const all = [];
  for (let i = 0; i < px.length; i += 3) all.push([px[i], px[i + 1], px[i + 2]]);
  const range = (box) => {
    let best = 0, ch = 0;
    for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of box) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); } if (hi - lo > best) { best = hi - lo; ch = c; } }
    return [best, ch];
  };
  const boxes = [all];
  while (boxes.length < n) {
    let k = -1, score = 0, ch = 0;
    boxes.forEach((b, j) => { if (b.length < 2) return; const [r, c] = range(b); if (r * Math.sqrt(b.length) > score) { score = r * Math.sqrt(b.length); k = j; ch = c; } });
    if (k < 0) break;
    const b = boxes[k].sort((p, q) => p[ch] - q[ch]), m = b.length >> 1;
    boxes.splice(k, 1, b.slice(0, m), b.slice(m));
  }
  const out = new Map();
  for (const b of boxes) {
    const c = [0, 1, 2].map((j) => snap(b.reduce((a, p) => a + p[j], 0) / b.length));
    out.set(c.join(), c);
  }
  return [...out.values()];
}
// Ordered dithering: nudge every pixel by its place in the 4×4 Bayer matrix, then take the nearest colour.
function paint(px, pal, spread) {
  const out = new ImageData(PIC_W, PIC_H), d = out.data, step = (255 / 7) * spread, used = new Set();
  for (let y = 0; y < PIC_H; y++) for (let x = 0; x < PIC_W; x++) {
    const i = (y * PIC_W + x) * 3, t = BAYER[(y & 3) * 4 + (x & 3)] * step;
    const r = px[i] + t, g = px[i + 1] + t, b = px[i + 2] + t;
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) { const c = pal[k], e = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (e < bd) { bd = e; best = k; } }
    const c = pal[best], o = (y * PIC_W + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    used.add(best);
  }
  return [out, used.size];
}

// ---------- the tab ----------
export function makePhotos({ $, btn, status, view, wrap }) {
  const ph = {
    src: null, game: null, name: '', loaded: null, games: {}, crop: null, set: { ...DEFAULTS.photo },
    palette: null, drag: null, dirty: false, out: null, used: 0, fileName: '',
  };
  const maxW = () => Math.min(ph.src.width, ph.src.height / ASPECT);
  function clampCrop(c) {
    const w = Math.max(16, Math.min(maxW(), c.w)), h = w * ASPECT;
    return { w, x: Math.max(0, Math.min(ph.src.width - w, c.x)), y: Math.max(0, Math.min(ph.src.height - h, c.y)) };
  }
  // the whole picture, cut to the panel's shape around the middle
  const fitCrop = () => { const w = maxW(); return { w, x: (ph.src.width - w) / 2, y: (ph.src.height - w * ASPECT) / 2 }; };
  // n source pixels per picture pixel, around the frame's middle (1: a screenshot's own pixels)
  function scaleCrop(n) {
    if (!ph.src) return;
    const c = ph.crop, mx = c.x + c.w / 2, my = c.y + (c.w * ASPECT) / 2, w = PIC_W * n;
    if (w > maxW() + 0.01) { status(`Too small for ×${n}: the image is ${ph.src.width}×${ph.src.height}`); return; }
    setCrop({ w, x: Math.round(mx - w / 2), y: Math.round(my - (w * ASPECT) / 2) });
  }
  // close to 1, 2, 3… image pixels per picture pixel: exactly that, so a screenshot's pixels stay even
  function snapW(w) {
    const n = Math.round(w / PIC_W);
    return n >= 1 && Math.abs(w - n * PIC_W) < 4 + n * 2 ? n * PIC_W : w;
  }
  function setCrop(c) { ph.crop = clampCrop(c); changed(); }
  function changed() { ph.dirty = !!ph.src; process(); render(); showCrop(); }

  function process() {
    if (!ph.src) { ph.out = null; return; }
    const s = ph.set, shot = s.mode === 'shot' && ph.palette;
    const px = shrink(ph.src, ph.crop, shot, s.flip);
    adjust(px, s);
    let pal = shot ? ph.palette : mainColours(px, s.colors);
    if (shot && (s.bright !== 1 || s.sat !== 1 || s.contrast !== 1)) { // the game's colours, moved like the picture
      const f = new Float32Array(pal.flat()); adjust(f, s);
      pal = [...new Map(pal.map((_, k) => { const c = [0, 1, 2].map((j) => snap(f[k * 3 + j])); return [c.join(), c]; })).values()];
    }
    const [img, used] = paint(px, pal, s.dither);
    const cv = ph.out || document.createElement('canvas');
    cv.width = PIC_W; cv.height = PIC_H;
    cv.getContext('2d').putImageData(img, 0, 0);
    ph.out = cv; ph.used = used;
    showPreview();
  }

  // ---------- opening ----------
  // target: the saved picture this image replaces ({ game, name }); without it, a new picture
  function openImage(blob, name, target = null) {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, MAX_SRC / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, cv.width, cv.height);
      ph.loaded = target;
      if (target) { ph.game = target.game; ph.name = target.name; } else ph.name = '';
      useSource(cv, null);
      status(`Opened ${name || 'the pasted image'} (${img.width}×${img.height}${k < 1 ? `, shrunk to ${cv.width}×${cv.height}` : ''}) · `
        + (target ? `frame it, then Replace ${target.name}` : 'frame it, type a name, then save'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); status('Not an image the browser can open'); };
    img.src = url;
  }
  function useSource(cv, settings) {
    ph.src = cv;
    ph.palette = gameColours(cv);
    ph.set = { ...DEFAULTS[ph.palette ? 'shot' : 'photo'], ...(settings?.set || {}) };
    ph.crop = settings?.crop ? clampCrop(settings.crop) : fitCrop();
    // a screenshot at the console's size: 2 pixels per picture pixel fits it best (320×224 -> 248×172)
    if (!settings && ph.palette && ph.src.width >= PIC_W * 2 && ph.src.height >= PIC_H * 2) { ph.crop = fitCrop(); scaleCrop(2); }
    buildBar(); buildSide(); buildList(); changed();
    ph.dirty = !settings;
  }
  async function openSaved(game, item) {
    if (ph.dirty && !confirm('The picture being framed is not saved. Open another one?')) return;
    ph.game = game; ph.name = item.name; ph.loaded = { game, name: item.name };
    let src = null;
    if (item.source) src = (await post({ get: true, game, name: item.name }).catch(() => null))?.source;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      useSource(cv, src || { crop: { x: 0, y: 0, w: cv.width }, set: { dither: 0 } });
      status(src ? `${game}/${item.name}: framed again from the image it was made from`
        : `${game}/${item.name}: its image was not kept, so this is the picture itself (open an image to replace it)`);
    };
    img.src = src ? src.image : `songs/_games/${game}/${item.name}.png?v=${Date.now()}`;
  }
  const post = (body) => fetch('api/game-pictures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { const res = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status })); if (!res.ok) throw new Error(res.error); return res; });
  async function loadList() {
    const r = await fetch('api/game-pictures', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    ph.games = r?.games || {};
    if (!ph.game || !(ph.game in ph.games)) ph.game = Object.keys(ph.games)[0] || null;
    if (!r) status('The list of pictures needs the dev server (python tools/serve.py)');
  }

  // ---------- saving ----------
  async function save() {
    if (!ph.out) { status('Open an image first'); return; }
    const game = $('phGame').value, name = $('phName').value.trim();
    if (!game) { status('Choose the game the picture is for'); return; }
    if (!SLUG.test(name)) { status('Name: small letters, digits and -, like vancouver-3'); $('phName').focus(); return; }
    const taken = (ph.games[game] || []).some((p) => p.name === name);
    status('Saving…');
    try {
      const res = await post({ game, name, replace: taken, png: ph.out.toDataURL('image/png'), source: ph.src.toDataURL('image/png'), settings: { crop: ph.crop, set: ph.set } });
      ph.loaded = { game, name }; ph.game = game; ph.name = name; ph.dirty = false;
      await loadList(); buildList(); buildSide();
      status(`Saved songs/_games/${game}/${name}.png${taken ? ` · the old one is in art/backup/${res.backup}` : ''} · a song shows it from its meta.json: "picture": "../_games/${game}/${name}.png"`);
    } catch (e) { status('Not saved: ' + e.message); }
  }
  async function remove() {
    const l = ph.loaded;
    if (!l || !confirm(`Delete ${l.game}/${l.name}? Songs that show it will show an empty box.`)) return;
    try {
      const res = await post({ delete: true, game: l.game, name: l.name });
      ph.loaded = null; ph.dirty = true;
      await loadList(); buildList(); buildSide();
      status(`Deleted · a copy is in art/backup/${res.backup}`);
    } catch (e) { status('Not deleted: ' + e.message); }
  }
  function newGame() {
    const g = slug(prompt('Folder for the new game (small letters, digits, -), like sonic-2:') || '');
    if (!g) return;
    if (!(g in ph.games)) ph.games[g] = [];
    ph.game = g;
    buildList(); buildSide();
  }

  // ---------- left: the pictures, by game ----------
  function buildList() {
    const box = $('left');
    box.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'tools';
    top.append(btn('New picture…', () => pickFile()), btn('+ Game', newGame));
    box.append(top);
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Or drop an image on the canvas, or paste one (Ctrl+V). To replace a picture, drop an image on it in this list.';
    box.append(note);
    for (const [game, pics] of Object.entries(ph.games)) {
      const h = document.createElement('h2');
      h.textContent = game;
      box.append(h);
      if (!pics.length) { const n = document.createElement('div'); n.className = 'note'; n.textContent = 'No pictures yet.'; box.append(n); }
      for (const p of pics) {
        const b = document.createElement('button');
        b.className = 'item' + (ph.loaded?.game === game && ph.loaded?.name === p.name ? ' on' : '');
        const im = new Image();
        im.src = `songs/_games/${game}/${p.name}.png?v=${Date.now()}`;
        im.width = 62; im.height = 43;
        b.append(im, document.createTextNode(p.name));
        b.title = p.source ? 'Open: frame it again' : 'Open (its image was not kept: only the picture)';
        b.onclick = () => openSaved(game, p);
        // an image dropped here replaces this picture
        b.ondragover = (e) => { e.preventDefault(); b.classList.add('on'); };
        b.ondragleave = () => b.classList.toggle('on', ph.loaded?.game === game && ph.loaded?.name === p.name);
        b.ondrop = (e) => {
          e.preventDefault();
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
          if (f && (!ph.dirty || confirm('The picture being framed is not saved. Open another image?'))) openImage(f, f.name, { game, name: p.name });
        };
        box.append(b);
      }
    }
  }
  function pickFile(target = null) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { const f = inp.files[0]; if (f && (!ph.dirty || confirm('The picture being framed is not saved. Open another image?'))) openImage(f, f.name, target); };
    inp.click();
  }

  // ---------- the bar over the canvas ----------
  function buildBar() {
    const bar = $('bar');
    bar.innerHTML = '';
    if (!ph.src) {
      const s = document.createElement('span');
      s.className = 'hint';
      s.textContent = 'Open an image (left), drop one here or paste one: a screenshot, a photo, box art.';
      bar.append(s);
      return;
    }
    const b = document.createElement('b');
    b.id = 'phCrop';
    bar.append(b);
    bar.append(btn('Whole', () => setCrop(fitCrop())));
    for (const n of [1, 2, 3]) { const x = btn(`×${n}`, () => scaleCrop(n)); x.title = n === 1 ? 'One image pixel per picture pixel (a screenshot stays sharp)' : `${n}×${n} image pixels per picture pixel`; bar.append(x); }
    const f = btn('Mirror', () => { ph.set.flip = !ph.set.flip; buildBar(); changed(); }, ph.set.flip);
    f.title = 'Flip left to right';
    bar.append(f);
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'drag: move · corners or wheel: size · arrows: 1 px (Shift: 10)';
    bar.append(hint);
    showCrop();
  }
  function showCrop() {
    const el = $('phCrop');
    if (!el || !ph.crop) return;
    const c = ph.crop, k = c.w / PIC_W, whole = Math.abs(k - Math.round(k)) < 1e-6;
    el.textContent = `Frame ${Math.round(c.w)}×${Math.round(c.w * ASPECT)} → picture 124×86 · `
      + (whole ? (k === 1 ? '×1: every image pixel kept' : `×${k}: ${k}×${k} image pixels make one`) : `×${k.toFixed(2)}: in between, pixels get uneven`);
    el.style.color = whole ? '' : '#b62400';
  }

  // ---------- right: preview, colours, save ----------
  function buildSide() {
    const s = ph.set, shot = s.mode === 'shot';
    $('phShot').disabled = !ph.palette;
    $('phShot').classList.toggle('on', shot && !!ph.palette);
    $('phPhoto').classList.toggle('on', !shot || !ph.palette);
    $('phModeNote').textContent = !ph.src ? '' : ph.palette
      ? (shot ? `The game's own ${ph.palette.length} colours, as in the screenshot.` : 'The picture gets its own colours.')
      : 'A photo: it gets its own colours (too many for a screenshot).';
    $('phColorsRow').classList.toggle('hidden', shot && !!ph.palette);
    for (const [id, key, f] of [['phColors', 'colors', 1], ['phDither', 'dither', 100], ['phBright', 'bright', 100], ['phContrast', 'contrast', 100], ['phSat', 'sat', 100]]) {
      $(id).value = Math.round(s[key] * f);
      $(id + 'V').textContent = key === 'colors' ? s[key] : Math.round(s[key] * 100) + '%';
    }
    const sel = $('phGame');
    sel.innerHTML = '';
    for (const g of Object.keys(ph.games)) { const o = document.createElement('option'); o.value = o.textContent = g; sel.append(o); }
    sel.value = ph.game || '';
    $('phName').value = ph.name;
    $('phDelete').disabled = !ph.loaded;
    $('phReplace').disabled = !ph.loaded;
    showTarget();
    showPreview();
  }
  // what Save does: a new picture, or which one it replaces
  function showTarget() {
    const game = $('phGame').value, name = $('phName').value.trim();
    const taken = (ph.games[game] || []).some((p) => p.name === name);
    $('phSave').disabled = !ph.src || !name;
    $('phSave').textContent = !name ? 'Type a name to save' : taken ? `Replace ${name}` : 'Save new picture';
    $('phTarget').textContent = !ph.src ? 'Open an image, or click a picture on the left to frame it again.'
      : taken ? `Replaces ${game}/${name}.png (the old one goes to art/backup).` : name ? `New: ${game}/${name}.png` : 'New picture: type its name.';
  }
  function showPreview() {
    for (const id of ['phBig', 'phReal']) {
      const cv = $(id), g = cv.getContext('2d');
      g.fillStyle = '#929292'; g.fillRect(0, 0, cv.width, cv.height);
      if (ph.out) g.drawImage(ph.out, 0, 0);
    }
    const sh = ph.set.mode === 'shot' && ph.palette;
    $('phUsed').textContent = ph.out ? `${ph.used} colours${sh ? '' : ` of ${ph.set.colors}`} · the console shows 15 per palette line + 1 background` : '';
  }
  function bindSide() {
    $('phShot').onclick = () => { ph.set = { ...DEFAULTS.shot, flip: ph.set.flip }; buildSide(); changed(); };
    $('phPhoto').onclick = () => { ph.set = { ...DEFAULTS.photo, flip: ph.set.flip }; buildSide(); changed(); };
    for (const [id, key, f] of [['phColors', 'colors', 1], ['phDither', 'dither', 100], ['phBright', 'bright', 100], ['phContrast', 'contrast', 100], ['phSat', 'sat', 100]]) {
      $(id).oninput = () => { ph.set[key] = +$(id).value / f; $(id + 'V').textContent = key === 'colors' ? ph.set[key] : $(id).value + '%'; changed(); };
    }
    $('phReset').onclick = () => { ph.set = { ...DEFAULTS[ph.set.mode === 'shot' && ph.palette ? 'shot' : 'photo'], flip: ph.set.flip }; buildSide(); changed(); };
    $('phGame').onchange = () => { ph.game = $('phGame').value; showTarget(); };
    $('phName').oninput = () => { ph.name = $('phName').value; showTarget(); };
    $('phReplace').onclick = () => ph.loaded && pickFile(ph.loaded);
    $('phName').onkeydown = (e) => { if (e.key === 'Enter') save(); };
    $('phSave').onclick = save;
    $('phDelete').onclick = remove;
    // drop or paste an image
    wrap.addEventListener('dragover', (e) => { if (active()) e.preventDefault(); });
    wrap.addEventListener('drop', (e) => {
      if (!active()) return;
      e.preventDefault();
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
      if (f && (!ph.dirty || confirm('The picture being framed is not saved. Open another image?'))) openImage(f, f.name);
    });
    window.addEventListener('paste', (e) => {
      if (!active() || e.target.tagName === 'INPUT') return;
      const f = [...e.clipboardData.items].find((x) => x.type.startsWith('image/'))?.getAsFile();
      if (f) { e.preventDefault(); openImage(f, ''); }
    });
  }
  let active = () => false;

  // ---------- the canvas: the image with the frame ----------
  function layout() {
    const W = wrap.clientWidth, H = wrap.clientHeight, s0 = Math.min((W - 40) / ph.src.width, (H - 40) / ph.src.height);
    const s = s0 >= 2 ? Math.floor(s0) : s0; // whole steps keep a screenshot's pixels even
    return { s, ox: Math.round((W - ph.src.width * s) / 2), oy: Math.round((H - ph.src.height * s) / 2) };
  }
  function render(c = view.getContext('2d')) {
    if (!active()) return;
    const W = view.width, H = view.height;
    c.fillStyle = '#929292'; c.fillRect(0, 0, W, H);
    if (!ph.src) return;
    const { s, ox, oy } = layout(), cr = ph.crop;
    c.imageSmoothingEnabled = !ph.palette && s < 1;
    c.drawImage(ph.src, ox, oy, ph.src.width * s, ph.src.height * s);
    const x = ox + cr.x * s, y = oy + cr.y * s, w = cr.w * s, h = cr.w * ASPECT * s;
    // outside the frame: darker
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(ox, oy, ph.src.width * s, y - oy);
    c.fillRect(ox, y + h, ph.src.width * s, oy + ph.src.height * s - y - h);
    c.fillRect(ox, y, x - ox, h);
    c.fillRect(x + w, y, ox + ph.src.width * s - x - w, h);
    c.strokeStyle = '#fff'; c.lineWidth = 1;
    c.strokeRect(Math.round(x) - 0.5, Math.round(y) - 0.5, Math.round(w) + 1, Math.round(h) + 1);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    for (const k of [1, 2]) { c.moveTo(x + (w * k) / 3, y); c.lineTo(x + (w * k) / 3, y + h); c.moveTo(x, y + (h * k) / 3); c.lineTo(x + w, y + (h * k) / 3); }
    c.stroke();
    // the picture's own size, 124×86 image pixels, in the frame's middle: how much the frame shrinks
    if (Math.abs(cr.w - PIC_W) > 0.5) {
      const rw = PIC_W * s, rh = PIC_H * s, rx = Math.round(x + (w - rw) / 2), ry = Math.round(y + (h - rh) / 2);
      c.strokeStyle = '#ff2400'; c.lineWidth = 2;
      c.strokeRect(rx - 1, ry - 1, Math.round(rw) + 2, Math.round(rh) + 2);
      c.font = 'bold 11px ui-monospace, Consolas, monospace';
      const label = '124×86', lw = c.measureText(label).width + 6;
      c.fillStyle = '#ff2400'; c.fillRect(rx - 2, ry - 15, lw, 13);
      c.fillStyle = '#fff'; c.fillText(label, rx + 1, ry - 5);
      c.lineWidth = 1;
    }
    c.fillStyle = '#fff'; c.strokeStyle = '#000';
    for (const [hx, hy] of corners(x, y, w, h)) { c.fillRect(hx - 4, hy - 4, 8, 8); c.strokeRect(hx - 4.5, hy - 4.5, 9, 9); }
  }
  const corners = (x, y, w, h) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  function at(e) {
    const r = view.getBoundingClientRect(), { s, ox, oy } = layout();
    return { sx: (e.clientX - r.left - ox) / s, sy: (e.clientY - r.top - oy) / s, mx: e.clientX - r.left, my: e.clientY - r.top, s, ox, oy };
  }
  function down(e) {
    if (!ph.src || e.button !== 0) return;
    e.preventDefault();
    const p = at(e), cr = ph.crop, h = cr.w * ASPECT;
    const k = corners(p.ox + cr.x * p.s, p.oy + cr.y * p.s, cr.w * p.s, h * p.s).findIndex(([hx, hy]) => Math.abs(hx - p.mx) <= 8 && Math.abs(hy - p.my) <= 8);
    if (k >= 0) { // size from the opposite corner
      const ax = k & 1 ? cr.x : cr.x + cr.w, ay = k & 2 ? cr.y : cr.y + h;
      ph.drag = { size: true, ax, ay, dx: k & 1 ? 1 : -1, dy: k & 2 ? 1 : -1 };
      return;
    }
    if (!(p.sx >= cr.x && p.sx < cr.x + cr.w && p.sy >= cr.y && p.sy < cr.y + h)) setCrop({ ...cr, x: p.sx - cr.w / 2, y: p.sy - h / 2 });
    ph.drag = { sx: p.sx, sy: p.sy, x: ph.crop.x, y: ph.crop.y };
  }
  function move(e) {
    const d = ph.drag;
    if (!d || !ph.src) {
      if (ph.src && active()) { // the pointer shows what a press does
        const p = at(e), cr = ph.crop;
        const corner = corners(p.ox + cr.x * p.s, p.oy + cr.y * p.s, cr.w * p.s, cr.w * ASPECT * p.s).findIndex(([hx, hy]) => Math.abs(hx - p.mx) <= 8 && Math.abs(hy - p.my) <= 8);
        view.style.cursor = corner < 0 ? 'move' : corner === 0 || corner === 3 ? 'nwse-resize' : 'nesw-resize';
      }
      return;
    }
    const p = at(e);
    if (d.size) {
      let w = Math.max((p.sx - d.ax) * d.dx, ((p.sy - d.ay) * d.dy) / ASPECT);
      // not past the image's edge from the fixed corner
      w = Math.max(16, Math.min(w, d.dx > 0 ? ph.src.width - d.ax : d.ax, (d.dy > 0 ? ph.src.height - d.ay : d.ay) / ASPECT));
      w = snapW(w);
      if (ph.palette) w = Math.round(w);
      ph.crop = clampCrop({ w, x: d.dx > 0 ? d.ax : d.ax - w, y: d.dy > 0 ? d.ay : d.ay - w * ASPECT });
    } else {
      const x = d.x + p.sx - d.sx, y = d.y + p.sy - d.sy;
      ph.crop = clampCrop({ w: ph.crop.w, x: ph.palette ? Math.round(x) : x, y: ph.palette ? Math.round(y) : y });
    }
    changed();
  }
  function up() { ph.drag = null; }
  function wheel(e) {
    if (!ph.src) return;
    const cr = ph.crop, mx = cr.x + cr.w / 2, my = cr.y + (cr.w * ASPECT) / 2;
    let w = cr.w * (e.deltaY < 0 ? 1 / 1.06 : 1.06);
    // the wheel stops at every whole step on its way
    const n = cr.w / PIC_W, next = e.deltaY < 0 ? Math.ceil(n - 1e-6) - 1 : Math.floor(n + 1e-6) + 1;
    if (next >= 1 && (e.deltaY < 0 ? w < next * PIC_W : w > next * PIC_W)) w = next * PIC_W;
    if (ph.palette) w = Math.round(w);
    setCrop({ w, x: mx - w / 2, y: my - (w * ASPECT) / 2 });
  }
  function key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyS') { e.preventDefault(); save(); return true; }
    if (mod && e.code === 'KeyO') { e.preventDefault(); pickFile(); return true; }
    if (!ph.src || mod) return false;
    const n = e.shiftKey ? 10 : 1, cr = ph.crop;
    const mv = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.code];
    if (mv) { e.preventDefault(); setCrop({ ...cr, x: cr.x + mv[0], y: cr.y + mv[1] }); return true; }
    if (e.key === '+' || e.key === '=' || e.key === '-') { e.preventDefault(); wheel({ deltaY: e.key === '-' ? 1 : -1 }); return true; }
    return false;
  }

  bindSide();
  return {
    async enter(isActive) {
      active = isActive;
      if (!Object.keys(ph.games).length) await loadList();
      buildList(); buildBar(); buildSide(); render();
    },
    render, down, move, up, wheel, key, save,
    get dirty() { return ph.dirty; },
    refreshBar: buildBar,
  };
}
