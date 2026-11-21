// AudioWorklet: runs the chip emulators in the audio thread.
import { Renderer, useWasm } from './renderer.js';

class SegaPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.main = new Renderer(sampleRate);
    this.preview = null;
    this.clean = true;
    this.main.setClean(true);
    this.playing = false;
    this.tick = 0;
    this.pl = new Float32Array(128); this.pr = new Float32Array(128);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      // the page sends the compiled ym2612.wasm first thing: the main renderer starts over on it
      case 'wasm': {
        useWasm(m.module);
        const r = new Renderer(sampleRate);
        r.loop = this.main.loop; r.passes = this.main.passes; r.fade = this.main.fade; r.gain = this.main.gain; r.setClean(this.clean);
        this.main = r;
        break;
      }
      case 'timeline': {
        const pos = m.pos ?? this.main.pos;
        this.main.setTimeline(m.tl, pos);
        break;
      }
      case 'seek': this.main.seek(m.pos); this.report(); break;
      case 'play': this.playing = true; break;
      case 'pause': this.playing = false; this.report(); break;
      case 'mute': this.main.setMute(m.ym, m.psg); break;
      case 'clean': this.clean = m.on; this.main.setClean(m.on); this.main.seek(this.main.pos); if (this.preview) this.preview.setClean(m.on); break;
      case 'loop': Object.assign(this.main, { loop: m.on, passes: m.passes ?? Infinity, fade: m.fade || 0 }); if (m.reset) this.main.jumps = 0; break;
      case 'gain': this.main.gain = m.gain; if (this.preview) this.preview.gain = m.gain; break;
      case 'preview': {
        const r = new Renderer(sampleRate);
        r.loop = false; r.gain = this.main.gain;
        r.setClean(this.clean);
        r.setTimeline(m.tl, 0);
        this.preview = r;
        break;
      }
      // the FM editor: a held preview note gets the edited registers at once (channel 1), and a key-off when let go
      case 'previewRegs': if (this.preview) for (const [r, v] of m.regs) this.preview.ym.writeReg(0, r, v); break;
      case 'previewOff': {
        const p = this.preview;
        if (!p) break;
        p.ym.writeReg(0, 0x28, 0);
        p.idx = p.tl.n; // nothing more of its timeline
        p.tl = { ...p.tl, end: Math.min(p.tl.end, p.pos + 2 * 44100) }; // the release rings out, then it goes
        break;
      }
    }
  }

  report() { this.port.postMessage({ type: 'pos', pos: this.main.pos, jumps: this.main.jumps, playing: this.playing }); }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    if (this.playing && this.main.tl) {
      this.main.process(L, R);
      if (this.main.done()) {
        this.playing = false;
        this.port.postMessage({ type: 'ended' });
      }
    } else {
      L.fill(0); if (R !== L) R.fill(0);
    }
    if (this.preview) {
      const p = this.preview;
      if (this.pl.length !== L.length) { this.pl = new Float32Array(L.length); this.pr = new Float32Array(L.length); }
      p.process(this.pl, this.pr);
      for (let i = 0; i < L.length; i++) { L[i] += this.pl[i]; if (R !== L) R[i] += this.pr[i]; }
      if (p.pos >= p.tl.end + 22050) this.preview = null;
    }
    if (++this.tick % 8 === 0) this.report();
    return true;
  }
}

registerProcessor('sega-player', SegaPlayer);
