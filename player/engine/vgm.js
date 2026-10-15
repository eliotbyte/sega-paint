// VGM parser -> flat timeline of chip writes.
// Timeline: { t: Float64Array (44.1 kHz samples), k: Uint8Array kind (0 = YM part I, 1 = YM part II, 2 = PSG),
//             r: Uint8Array reg, v: Uint8Array val, n: count, end, loopStart }

export const KIND_YM0 = 0, KIND_YM1 = 1, KIND_PSG = 2;

export class TimelineBuilder {
  constructor(cap = 1 << 16) {
    this.t = new Float64Array(cap); this.k = new Uint8Array(cap); this.r = new Uint8Array(cap); this.v = new Uint8Array(cap);
    this.n = 0;
  }
  push(t, k, r, v) {
    if (this.n === this.t.length) {
      const grow = (A) => { const B = new A.constructor(A.length * 2); B.set(A); return B; };
      this.t = grow(this.t); this.k = grow(this.k); this.r = grow(this.r); this.v = grow(this.v);
    }
    const i = this.n++;
    this.t[i] = t; this.k[i] = k; this.r[i] = r; this.v[i] = v;
  }
  // Sort by time; events closer than 1/16 sample keep insertion order.
  finish(end, loopStart) {
    const n = this.n, t = this.t;
    let sorted = true;
    for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) { sorted = false; break; }
    const out = { t: new Float64Array(n), k: new Uint8Array(n), r: new Uint8Array(n), v: new Uint8Array(n), n, end, loopStart };
    if (sorted) {
      out.t.set(t.subarray(0, n)); out.k.set(this.k.subarray(0, n)); out.r.set(this.r.subarray(0, n)); out.v.set(this.v.subarray(0, n));
      return out;
    }
    // pack (time bucket, index) into one float key and use the native numeric sort
    const keys = new Float64Array(n);
    const IDX = 2 ** 22;
    for (let i = 0; i < n; i++) keys[i] = Math.floor(Math.max(0, t[i]) * 16) * IDX + i;
    keys.sort();
    for (let i = 0; i < n; i++) {
      const j = keys[i] % IDX;
      out.t[i] = t[j]; out.k[i] = this.k[j]; out.r[i] = this.r[j]; out.v[i] = this.v[j];
    }
    return out;
  }
}

export function parseVGM(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const ver = u32(8);
  const loopOff = u32(0x1c) ? 0x1c + u32(0x1c) : 0;
  let p = ver >= 0x150 && u32(0x34) ? 0x34 + u32(0x34) : 0x40;
  const tb = new TimelineBuilder(1 << 20);
  let t = 0, loopStart = -1;
  const pcm = [];
  let pcmBank = new Uint8Array(0), pcmPos = 0;
  // DAC streams (0x90-0x94) of the YM2612: their writes are put on the timeline as time passes
  const streams = new Map();
  const stream = (id) => { if (!streams.has(id)) streams.set(id, { ym: false, port: 0, reg: 0, step: 1, base: 0, hz: 0, off: 0, k: 0, len: 0, t0: 0 }); return streams.get(id); };
  const flush = (until) => {
    for (const s of streams.values()) {
      if (!s.ym || !s.hz) { s.k = s.len; continue; }
      for (; s.k < s.len; s.k++) {
        const at = s.t0 + s.k * 44100 / s.hz;
        if (at >= until) break;
        tb.push(at, s.port ? KIND_YM1 : KIND_YM0, s.reg, pcmBank[s.off + s.k * s.step + s.base] ?? 0x80);
      }
    }
  };
  const wait = (k) => { flush(t + k); t += k; };
  while (p < d.length) {
    if (p === loopOff) loopStart = t;
    const c = d[p];
    if (c === 0x66) { flush(t); break; }
    else if (c === 0x67) {
      const sz = u32(p + 3);
      if (d[p + 2] === 0) pcm.push(d.subarray(p + 7, p + 7 + sz));
      p += 7 + sz;
      if (pcm.length) {
        let total = 0; for (const b of pcm) total += b.length;
        pcmBank = new Uint8Array(total); let o = 0; for (const b of pcm) { pcmBank.set(b, o); o += b.length; }
      }
    }
    else if (c === 0x52) { tb.push(t, KIND_YM0, d[p + 1], d[p + 2]); p += 3; }
    else if (c === 0x53) { tb.push(t, KIND_YM1, d[p + 1], d[p + 2]); p += 3; }
    else if (c === 0x50) { tb.push(t, KIND_PSG, d[p + 1], 0); p += 2; }
    else if (c === 0x4f) p += 2;
    else if (c === 0x61) { wait(dv.getUint16(p + 1, true)); p += 3; }
    else if (c === 0x62) { wait(735); p += 1; }
    else if (c === 0x63) { wait(882); p += 1; }
    else if (c >= 0x70 && c <= 0x7f) { wait((c & 15) + 1); p += 1; }
    else if (c >= 0x80 && c <= 0x8f) { tb.push(t, KIND_YM0, 0x2a, pcmBank[pcmPos++]); wait(c & 15); p += 1; }
    else if (c === 0xe0) { pcmPos = u32(p + 1); p += 5; }
    else if (c === 0x90) { const s = stream(d[p + 1]); s.ym = (d[p + 2] & 0x7f) === 0x02; s.port = d[p + 3]; s.reg = d[p + 4]; p += 5; }
    else if (c === 0x91) { const s = stream(d[p + 1]); s.step = d[p + 3]; s.base = d[p + 4]; p += 5; }
    else if (c === 0x92) { stream(d[p + 1]).hz = u32(p + 2); p += 6; }
    else if (c === 0x93) { // start: offset, length mode (1 = commands, 2 = msec, 3 = to the block end), length
      const s = stream(d[p + 1]), off = u32(p + 2), mode = d[p + 6] & 3, len = u32(p + 7);
      if (off !== 0xffffffff) s.off = off;
      s.k = 0; s.t0 = t;
      s.len = mode === 1 ? len : mode === 2 ? Math.round(len * s.hz / 1000) : mode === 3 ? Math.floor((pcmBank.length - s.off) / Math.max(1, s.step)) : 0;
      p += 11;
    }
    else if (c === 0x94) { for (const [id, s] of streams) if (d[p + 1] === 0xff || id === d[p + 1]) s.len = s.k; p += 2; }
    else if (c === 0x95) p += 5;
    else if (c >= 0x30 && c <= 0x3f) p += 2;
    else if (c >= 0x40 && c <= 0x4e) p += 3;
    else if (c >= 0xa0 && c <= 0xbf) p += 3;
    else if (c >= 0xc0 && c <= 0xdf) p += 4;
    else if (c >= 0xe1) p += 5;
    else throw new Error('Unknown VGM command 0x' + c.toString(16) + ' at 0x' + p.toString(16));
  }
  return tb.finish(t, loopStart);
}

// ---------- timeline -> VGM 1.71 ----------
// The timeline plays like the renderer plays it: writes at or after `end` never sound, the loop jumps back to the
// first write at or after `loopStart`. Times are rounded to whole 44.1 kHz samples (the VGM time unit).
// DAC writes (YM part I, 0x2A) all go into one PCM data block (0x67 0x66 0x00). Music repeats, and so does its
// DAC mix: the stream is cut into pieces that are either new data (added to the block) or data already in it.
// The pieces play either as DAC streams (0x90-0x94: one command per piece, the default) or, with
// { dac: 'pcm' } for old players, byte by byte with 0x8n (1 byte per sample) and 0xE0 seeks.
export const VGM_YM_CLOCK = 7670453, VGM_PSG_CLOCK = 3579545;
const DAC_BURST_GAP = 32; // samples: DAC writes closer than this belong to one burst

class Bytes {
  constructor(cap = 1 << 16) { this.a = new Uint8Array(cap); this.n = 0; }
  room(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  u8(...v) { this.room(v.length); for (const x of v) this.a[this.n++] = x; }
  u16(v) { this.u8(v & 255, (v >> 8) & 255); }
  u32(v) { this.u8(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
  bytes(u) { this.room(u.length); this.a.set(u, this.n); this.n += u.length; }
  get out() { return this.a.subarray(0, this.n); }
}

// The PCM block, with an LZ77-style index to find data that is already in it.
const LZ_K = 16, LZ_BITS = 16, LZ_CHAIN = 48;
class PcmBlock extends Bytes {
  constructor() { super(); this.head = new Int32Array(1 << LZ_BITS).fill(-1); this.prev = new Int32Array(1 << 16); }
  static hash(a, p) { let h = 0; for (let k = 0; k < LZ_K; k++) h = (Math.imul(h, 31) + a[p + k]) | 0; return (h ^ (h >>> 15)) & ((1 << LZ_BITS) - 1); }
  add(v) {
    this.u8(v);
    const p = this.n - LZ_K;
    if (p < 0) return;
    if (p >= this.prev.length) { const b = new Int32Array(this.prev.length * 2); b.set(this.prev); this.prev = b; }
    const h = PcmBlock.hash(this.a, p);
    this.prev[p] = this.head[h]; this.head[h] = p;
  }
  // longest copy of d[p..] in the block: [offset, length]
  find(d, p, max) {
    if (d.length - p < LZ_K) return [0, 0];
    let best = 0, at = 0;
    for (let c = this.head[PcmBlock.hash(d, p)], k = 0; c >= 0 && k < LZ_CHAIN; c = this.prev[c], k++) {
      let l = 0;
      const lim = Math.min(max, d.length - p, this.n - c);
      while (l < lim && this.a[c + l] === d[p + l]) l++;
      if (l > best) { best = l; at = c; if (l === lim) break; }
    }
    return [at, best];
  }
}

// YM registers whose repeated value changes nothing (key on/off, the DAC, the frequency latch pairs and the
// timers are always written).
const ymPlain = (r) => r === 0x22 || r === 0x2b || (r >= 0x30 && r < 0xa0) || (r >= 0xb0 && r <= 0xb6);

// meta: { title, game, system, author, date, converter, notes }
// opts: { dac: 'stream' | 'pcm', dedup: false to keep writes that change nothing (for tests) }
export function writeVGM(tl, meta = {}, opts = {}) {
  const streams = opts.dac !== 'pcm';
  const end = Math.max(0, Math.round(tl.end));
  let n = 0;
  while (n < tl.n && tl.t[n] < tl.end) n++;
  const looped = tl.loopStart >= 0 && tl.loopStart < tl.end;
  let li = n;
  if (looped) { li = 0; while (li < n && tl.t[li] < tl.loopStart) li++; }
  const loopT = looped ? Math.round(tl.loopStart) : 0;
  const time = (i) => Math.max(0, Math.round(tl.t[i]));
  const isDac = (i) => tl.k[i] === KIND_YM0 && tl.r[i] === 0x2a;

  // the DAC mixer's period: the most common gap between DAC writes; a stream plays at a whole number of Hz
  const dacIdx = [];
  for (let i = 0; i < n; i++) if (isDac(i)) dacIdx.push(i);
  const gaps = new Map();
  for (let j = 1; j < dacIdx.length; j++) { const g = Math.round((tl.t[dacIdx[j]] - tl.t[dacIdx[j - 1]]) * 1000); gaps.set(g, (gaps.get(g) || 0) + 1); }
  let mode = 0, pc = 0, period = 0, sum = 0, cnt = 0;
  for (const [g, c] of gaps) if (c > pc && g > 0) { pc = c; mode = g; }
  for (let j = 1; j < dacIdx.length; j++) { // the exact period: the mean of the gaps in that bucket
    const g = tl.t[dacIdx[j]] - tl.t[dacIdx[j - 1]];
    if (Math.round(g * 1000) === mode) { sum += g; cnt++; }
  }
  if (cnt) period = sum / cnt;
  const hz = period ? Math.round(44100 / period) : 0;
  // a stream piece may drift from the mixer's times by at most a quarter sample
  const drift = Math.abs(44100 / (hz || 1) - period);
  const maxRun = drift > 0 ? Math.max(256, Math.floor(0.25 / drift)) : 1 << 30;

  // DAC bursts -> pieces: { at: event index, src: block offset, len, stream }
  const pcm = new PcmBlock(), pieces = new Map(), inStream = new Uint8Array(n);
  const MIN_COPY = streams ? 48 : 16;
  for (let a = 0; a < dacIdx.length;) {
    let b = a + 1;
    // a burst ends at the loop point, at a pause, and (for streams) where the writes leave the mixer's period
    const next = (b) => {
      const g = tl.t[dacIdx[b]] - tl.t[dacIdx[b - 1]];
      return (dacIdx[a] < li) === (dacIdx[b] < li) && g <= DAC_BURST_GAP && (!streams || Math.abs(g - period) < 0.01);
    };
    while (b < dacIdx.length && next(b)) b++;
    const idx = dacIdx.slice(a, b);
    const even = streams && idx.length >= 8;
    const d = Uint8Array.from(idx, (e) => tl.v[e]);
    let last = null;
    for (let p = 0; p < d.length;) {
      const cap = even ? maxRun : 1 << 30;
      const [src, len] = pcm.find(d, p, cap);
      if (len >= MIN_COPY) {
        pieces.set(idx[p], last = { src, len, stream: even });
        p += len; last = null;
        continue;
      }
      if (!last || last.src + last.len !== pcm.n || last.len >= cap) pieces.set(idx[p], last = { src: pcm.n, len: 0, stream: even });
      pcm.add(d[p]); last.len++; p++;
    }
    if (even) for (const e of idx) inStream[e] = 1;
    a = b;
  }

  const cmd = new Bytes();
  let cur = 0, lastDac = -1; // lastDac: position of a 0x80 (wait 0) that a following wait can fold into
  const wait = (t) => {
    let gap = t - cur;
    if (gap <= 0) return;
    cur = t;
    if (lastDac >= 0) { const k = Math.min(15, gap); cmd.a[lastDac] |= k; gap -= k; lastDac = -1; }
    while (gap > 0) {
      if (gap <= 16) { cmd.u8(0x70 + gap - 1); gap = 0; }
      else if (gap === 735 || gap === 882) { cmd.u8(gap === 735 ? 0x62 : 0x63); gap = 0; }
      else if (gap === 1470 || gap === 1764) { cmd.u8(gap === 1470 ? 0x62 : 0x63, gap === 1470 ? 0x62 : 0x63); gap = 0; }
      else if (gap > 735 && gap <= 735 + 16) { cmd.u8(0x62); gap -= 735; }
      else if (gap > 882 && gap <= 882 + 16) { cmd.u8(0x63); gap -= 882; }
      else { const k = Math.min(65535, gap); cmd.u8(0x61); cmd.u16(k); gap -= k; }
    }
  };
  const usesStreams = [...pieces.values()].some((x) => x.stream);
  if (usesStreams) { // stream 0: YM2612 port 0 register 0x2A, from data bank 0, one byte per step
    cmd.u8(0x90, 0, 0x02, 0, 0x2a);
    cmd.u8(0x91, 0, 0x00, 1, 0);
    cmd.u8(0x92, 0); cmd.u32(hz);
  }

  // shadows for dropping writes that change nothing; cleared at the loop point (the chip then holds the song end)
  let ym = new Map(), psg = null, ptr = -1, loopPos = -1;
  const resetShadow = () => { ym = new Map(); psg = { latch: -1, low: [-1, -1, -1], high: [-1, -1, -1], vol: [-1, -1, -1, -1] }; ptr = -1; };
  resetShadow();
  // true when the PSG byte changes nothing: same latch and same bits. The noise register is always written
  // (any write to it restarts the noise), and a latch byte that moves the latch is kept for the data bytes after it.
  const psgSame = (v) => {
    const s = psg;
    if (v & 0x80) {
      const ch = (v >> 5) & 3, same = ch === s.latch;
      s.latch = ch;
      const bits = v & 15;
      if (v & 0x10) { if (same && s.vol[ch] === bits) return true; s.vol[ch] = bits; return false; }
      if (ch === 3) return false;
      if (same && s.low[ch] === bits) return true;
      s.low[ch] = bits;
      return false;
    }
    const ch = s.latch;
    if (ch < 0 || ch === 3) return false;
    if (s.high[ch] === (v & 0x3f)) return true;
    s.high[ch] = v & 0x3f;
    return false;
  };

  let written = 0, dropped = 0;
  for (let i = 0; i <= n; i++) {
    if (i === li) {
      wait(loopT); lastDac = -1; loopPos = cmd.n; resetShadow();
    }
    if (i === n) break;
    const t = time(i), k = tl.k[i], r = tl.r[i], v = tl.v[i];
    if (isDac(i)) {
      const pc = pieces.get(i);
      if (inStream[i]) {
        if (pc) { wait(t); lastDac = -1; cmd.u8(0x93, 0); cmd.u32(pc.src); cmd.u8(0x01); cmd.u32(pc.len); written++; }
        continue;
      }
      if (pc && pc.src !== ptr) { wait(t); cmd.u8(0xe0); cmd.u32(pc.src); ptr = pc.src; }
      wait(t);
      lastDac = cmd.n; cmd.u8(0x80); ptr++; written++;
      continue;
    }
    if (k === KIND_PSG) {
      if (psgSame(r) && opts.dedup !== false) { dropped++; continue; }
      wait(t); lastDac = -1; cmd.u8(0x50, r); written++;
      continue;
    }
    const key = (k << 8) | r;
    if (ymPlain(r) && ym.get(key) === v && opts.dedup !== false) { dropped++; continue; }
    ym.set(key, v);
    wait(t); lastDac = -1; cmd.u8(k === KIND_YM0 ? 0x52 : 0x53, r, v); written++;
  }
  wait(end);
  if (usesStreams) cmd.u8(0x94, 0); // a stream still running at the song end must not go on after the jump
  cmd.u8(0x66);

  // GD3 tag: UTF-16LE strings, each ending in 0
  const gd3s = new Bytes();
  for (const s of [meta.title, '', meta.game ?? 'Sega Paint', '', meta.system ?? 'Sega Mega Drive / Genesis', '',
    meta.author, '', meta.date, meta.converter ?? 'Sega Paint', meta.notes]) {
    for (const ch of String(s ?? '')) { const c = ch.codePointAt(0); if (c < 0x10000) gd3s.u16(c); else { const x = c - 0x10000; gd3s.u16(0xd800 + (x >> 10)); gd3s.u16(0xdc00 + (x & 1023)); } }
    gd3s.u16(0);
  }

  const HEAD = 0x100;
  const block = pcm.n ? 7 + pcm.n : 0;
  const gd3At = HEAD + block + cmd.n;
  const size = gd3At + 12 + gd3s.n;
  const f = new Bytes(size);
  f.u8(0x56, 0x67, 0x6d, 0x20);          // "Vgm "
  f.u32(size - 4);                       // EOF offset
  f.u32(0x171);                          // version 1.71
  f.u32(VGM_PSG_CLOCK);                  // 0x0C SN76489
  f.u32(0);                              // 0x10 YM2413
  f.u32(gd3At - 0x14);                   // 0x14 GD3 offset
  f.u32(end);                            // 0x18 total samples
  f.u32(looped ? HEAD + block + loopPos - 0x1c : 0); // 0x1C loop offset
  f.u32(looped ? end - loopT : 0);       // 0x20 loop samples
  f.u32(0);                              // 0x24 rate
  f.u16(0x0009); f.u8(16, 0);            // 0x28 SN feedback, shift register width, flags
  f.u32(VGM_YM_CLOCK);                   // 0x2C YM2612
  f.u32(0);                              // 0x30 YM2151
  f.u32(HEAD - 0x34);                    // 0x34 data offset
  f.room(HEAD - f.n); f.n = HEAD;        // the rest of the header stays 0
  if (pcm.n) { f.u8(0x67, 0x66, 0x00); f.u32(pcm.n); f.bytes(pcm.out); }
  f.bytes(cmd.out);
  f.u8(0x47, 0x64, 0x33, 0x20);          // "Gd3 "
  f.u32(0x100); f.u32(gd3s.n); f.bytes(gd3s.out);
  return { bytes: f.out, samples: end, loopSamples: looped ? end - loopT : 0, dacBytes: dacIdx.length, pcmBytes: pcm.n, written, dropped };
}
