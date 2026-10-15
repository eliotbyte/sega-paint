// Plays a write timeline through YM2612 + SN76489 and resamples to the output rate.
import { YM2612Chip } from './ym2612.js';
import { SN76489 } from './sn76489.js';
import { KIND_PSG } from './vgm.js';

export const YM_CLOCK = 7670453;
export const CHIP_RATE = YM_CLOCK / 144; // ≈ 53267 Hz
const FM_SCALE = 1 / 4608;     // 6 channels * 256 * 3
// PSG / FM balance as in Genesis Plus GX with its default settings: FM = 24-cycle sum x 11 (fm_preamp 100),
// one PSG square = +-2800 x 1.5 (psg_preamp 150). In our units: 4200 / 11 / 4608.
const PSG_SCALE = 4200 / 11 * FM_SCALE;

export class Renderer {
  constructor(outRate) {
    this.outRate = outRate;
    this.ym = new YM2612Chip();
    this.psg = new SN76489(3579545, CHIP_RATE);
    this.tl = null;
    this.idx = 0;
    this.pos = 0;           // current position in 44.1 kHz samples
    this.loop = true;
    this.frac = 0;          // resampler phase in chip samples
    this.prev = [0, 0]; this.cur = [0, 0];
    this.tmp = new Int32Array(2);
    this.gain = 1.6;
    // DC blocker state
    this.dcL = 0; this.dcR = 0; this.xl = 0; this.xr = 0;
    this.dcK = Math.exp(-2 * Math.PI * 5 / outRate); // DC blocker pole: 5 Hz at any output rate
  }

  setTimeline(tl, startPos = 0) {
    this.tl = tl;
    this.seek(startPos);
  }

  seek(pos) {
    this.ym.reset(); this.psg.reset();
    this.pos = pos;
    const tl = this.tl;
    // Replay all non-note register state up to pos so the chips are in the right mode (fast-forward without audio).
    // The PSG has no key-on: its tone and volume latches are replayed as they are.
    // FM key-ons are not replayed on the way; notes still held at pos are keyed on again once the channel is set up,
    // so a long note started before pos sounds from pos (from the start of its envelope).
    let i = 0;
    if (tl) {
      const keys = new Map(); // channel (0x28 low bits) -> [kind, operators on]
      for (; i < tl.n && tl.t[i] < pos; i++) {
        const k = tl.k[i], r = tl.r[i];
        if (k === KIND_PSG) { this.psg.write(r); continue; }
        if (r === 0x28) { keys.set(tl.v[i] & 7, [k, tl.v[i] & 0xf0]); continue; }
        if (r === 0x2a) continue;
        this.ym.writeReg(k, r, tl.v[i]);
        // drain queue quickly so it never overflows
        if (this.ym.qLen > 3000) this.flushQueue();
      }
      for (const [ch, [k, ops]] of keys) if (ops) this.ym.writeReg(k, 0x28, ops | ch);
      this.flushQueue();
    }
    this.idx = i;
    this.settle();
  }

  // Every YM2612 channel puts a DC offset on the output even when silent (the DAC ladder). The real chip has it
  // since power-on; here a reset would jump from 0 to that offset and the DC blocker would turn the step into a
  // thump at every start, seek and note preview. Start the blocker and the resampler at the chip's idle output.
  settle() {
    this.ym.render(this.tmp);
    const p = this.psg.render() * PSG_SCALE;
    const l = this.tmp[0] * FM_SCALE + p, r = this.tmp[1] * FM_SCALE + p;
    this.prev[0] = this.cur[0] = l; this.prev[1] = this.cur[1] = r;
    this.xl = l * this.gain; this.xr = r * this.gain; this.dcL = 0; this.dcR = 0;
  }

  flushQueue() {
    const out = this.tmp;
    while (this.ym.qLen) this.ym.render(out);
  }

  setClean(on) { this.ym.core.clean = on; }

  setMute(ymMask, psgMask) { this.ym.setMuteMask(ymMask); this.psg.muteMask = psgMask; }

  chipSample(out) {
    const tl = this.tl;
    const step = 44100 / CHIP_RATE;
    if (tl) {
      while (this.idx < tl.n && tl.t[this.idx] <= this.pos) {
        const i = this.idx++;
        if (tl.k[i] === KIND_PSG) this.psg.write(tl.r[i]);
        else this.ym.writeReg(tl.k[i], tl.r[i], tl.v[i]);
      }
      this.pos += step;
      if (this.pos >= tl.end) {
        if (this.loop && tl.loopStart >= 0) {
          this.pos = tl.loopStart;
          let lo = 0, hi = tl.n;
          while (lo < hi) { const m = (lo + hi) >> 1; if (tl.t[m] < this.pos) lo = m + 1; else hi = m; }
          this.idx = lo;
        }
      }
    }
    this.ym.render(this.tmp);
    const p = this.psg.render() * PSG_SCALE;
    out[0] = this.tmp[0] * FM_SCALE + p;
    out[1] = this.tmp[1] * FM_SCALE + p;
  }

  // Fill Float32 L/R buffers at outRate.
  process(L, R) {
    const ratio = CHIP_RATE / this.outRate;
    const g = this.gain;
    for (let i = 0; i < L.length; i++) {
      this.frac += ratio;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.prev[0] = this.cur[0]; this.prev[1] = this.cur[1];
        this.chipSample(this.cur);
      }
      const f = this.frac;
      let l = (this.prev[0] + (this.cur[0] - this.prev[0]) * f) * g;
      let r = (this.prev[1] + (this.cur[1] - this.prev[1]) * f) * g;
      // DC blocker (the YM2612 ladder effect adds offset)
      this.dcL = l - this.xl + this.dcK * this.dcL; this.xl = l; l = this.dcL;
      this.dcR = r - this.xr + this.dcK * this.dcR; this.xr = r; r = this.dcR;
      L[i] = l < -1 ? -1 : l > 1 ? 1 : l;
      R[i] = r < -1 ? -1 : r > 1 ? 1 : r;
    }
  }
}
