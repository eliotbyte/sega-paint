// SN76489 (Sega VDP PSG variant): 3 square channels + noise.
// Runs at clock/16 internally and box-filters down to the output rate.

const VOL = new Float32Array(16);
for (let i = 0; i < 15; i++) VOL[i] = Math.pow(10, -i * 2 / 20);
VOL[15] = 0;

export class SN76489 {
  constructor(clock = 3579545, outRate = 53267) {
    this.step = clock / 16 / outRate; // internal ticks per output sample
    this.muteMask = 0; // bit n = mute channel n (3 = noise)
    this.reset();
  }
  reset() {
    this.tone = new Uint16Array(4);
    this.vol = new Uint8Array([15, 15, 15, 15]);
    this.cnt = new Int32Array(4);
    this.out = new Int8Array([1, 1, 1, 1]);
    this.latch = 0;
    this.lfsr = 0x8000;
    this.acc = 0;
  }
  write(v) {
    if (v & 0x80) {
      this.latch = (v >> 5) & 3;
      if (v & 0x10) { this.vol[this.latch] = v & 15; return; }
      const ch = this.latch;
      this.tone[ch] = (this.tone[ch] & 0x3f0) | (v & 15);
      if (ch === 3) this.lfsr = 0x8000;
    } else {
      const ch = this.latch;
      if (ch === 3) { this.tone[3] = v & 7; this.lfsr = 0x8000; return; }
      this.tone[ch] = (this.tone[ch] & 15) | ((v & 0x3f) << 4);
    }
  }
  // Returns one mono sample in range about ±4 (sum of channels, each ±1 * volume).
  render() {
    this.acc += this.step;
    let ticks = this.acc | 0;
    this.acc -= ticks;
    const n = ticks || 1;
    let sum = 0;
    for (let k = 0; k < ticks; k++) {
      for (let ch = 0; ch < 3; ch++) {
        if (--this.cnt[ch] <= 0) {
          const p = this.tone[ch];
          this.cnt[ch] = p || 1;
          this.out[ch] = p <= 1 ? 1 : -this.out[ch];
        }
      }
      if (--this.cnt[3] <= 0) {
        const r = this.tone[3] & 3;
        this.cnt[3] = r === 3 ? (this.tone[2] || 1) * 2 : (0x10 << r);
        const fb = (this.tone[3] & 4) ? ((this.lfsr & 1) ^ ((this.lfsr >> 3) & 1)) : (this.lfsr & 1);
        this.lfsr = (this.lfsr >> 1) | (fb << 15);
        this.out[3] = (this.lfsr & 1) ? 1 : -1;
      }
      for (let ch = 0; ch < 4; ch++) {
        if (!((this.muteMask >> ch) & 1)) sum += this.out[ch] * VOL[this.vol[ch]];
      }
    }
    return sum / n;
  }
}
