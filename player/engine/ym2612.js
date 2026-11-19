// YM2612 (OPN2) cycle-accurate emulator.
// JavaScript port of Nuked OPN2 v1.0.12 by Alexey Khokholov (Nuke.YKT), LGPL-2.1.
// Original: https://github.com/nukeykt/Nuked-OPN2
// Timers / status reads / test-register readback are omitted (not needed for playback).

const logsinrom = new Uint16Array([
  0x859,0x6c3,0x607,0x58b,0x52e,0x4e4,0x4a6,0x471,0x443,0x41a,0x3f5,0x3d3,0x3b5,0x398,0x37e,0x365,
  0x34e,0x339,0x324,0x311,0x2ff,0x2ed,0x2dc,0x2cd,0x2bd,0x2af,0x2a0,0x293,0x286,0x279,0x26d,0x261,
  0x256,0x24b,0x240,0x236,0x22c,0x222,0x218,0x20f,0x206,0x1fd,0x1f5,0x1ec,0x1e4,0x1dc,0x1d4,0x1cd,
  0x1c5,0x1be,0x1b7,0x1b0,0x1a9,0x1a2,0x19b,0x195,0x18f,0x188,0x182,0x17c,0x177,0x171,0x16b,0x166,
  0x160,0x15b,0x155,0x150,0x14b,0x146,0x141,0x13c,0x137,0x133,0x12e,0x129,0x125,0x121,0x11c,0x118,
  0x114,0x10f,0x10b,0x107,0x103,0x0ff,0x0fb,0x0f8,0x0f4,0x0f0,0x0ec,0x0e9,0x0e5,0x0e2,0x0de,0x0db,
  0x0d7,0x0d4,0x0d1,0x0cd,0x0ca,0x0c7,0x0c4,0x0c1,0x0be,0x0bb,0x0b8,0x0b5,0x0b2,0x0af,0x0ac,0x0a9,
  0x0a7,0x0a4,0x0a1,0x09f,0x09c,0x099,0x097,0x094,0x092,0x08f,0x08d,0x08a,0x088,0x086,0x083,0x081,
  0x07f,0x07d,0x07a,0x078,0x076,0x074,0x072,0x070,0x06e,0x06c,0x06a,0x068,0x066,0x064,0x062,0x060,
  0x05e,0x05c,0x05b,0x059,0x057,0x055,0x053,0x052,0x050,0x04e,0x04d,0x04b,0x04a,0x048,0x046,0x045,
  0x043,0x042,0x040,0x03f,0x03e,0x03c,0x03b,0x039,0x038,0x037,0x035,0x034,0x033,0x031,0x030,0x02f,
  0x02e,0x02d,0x02b,0x02a,0x029,0x028,0x027,0x026,0x025,0x024,0x023,0x022,0x021,0x020,0x01f,0x01e,
  0x01d,0x01c,0x01b,0x01a,0x019,0x018,0x017,0x017,0x016,0x015,0x014,0x014,0x013,0x012,0x011,0x011,
  0x010,0x00f,0x00f,0x00e,0x00d,0x00d,0x00c,0x00c,0x00b,0x00a,0x00a,0x009,0x009,0x008,0x008,0x007,
  0x007,0x007,0x006,0x006,0x005,0x005,0x005,0x004,0x004,0x004,0x003,0x003,0x003,0x002,0x002,0x002,
  0x002,0x001,0x001,0x001,0x001,0x001,0x001,0x001,0x000,0x000,0x000,0x000,0x000,0x000,0x000,0x000,
]);

const exprom = new Uint16Array([
  0x000,0x003,0x006,0x008,0x00b,0x00e,0x011,0x014,0x016,0x019,0x01c,0x01f,0x022,0x025,0x028,0x02a,
  0x02d,0x030,0x033,0x036,0x039,0x03c,0x03f,0x042,0x045,0x048,0x04b,0x04e,0x051,0x054,0x057,0x05a,
  0x05d,0x060,0x063,0x066,0x069,0x06c,0x06f,0x072,0x075,0x078,0x07b,0x07e,0x082,0x085,0x088,0x08b,
  0x08e,0x091,0x094,0x098,0x09b,0x09e,0x0a1,0x0a4,0x0a8,0x0ab,0x0ae,0x0b1,0x0b5,0x0b8,0x0bb,0x0be,
  0x0c2,0x0c5,0x0c8,0x0cc,0x0cf,0x0d2,0x0d6,0x0d9,0x0dc,0x0e0,0x0e3,0x0e7,0x0ea,0x0ed,0x0f1,0x0f4,
  0x0f8,0x0fb,0x0ff,0x102,0x106,0x109,0x10c,0x110,0x114,0x117,0x11b,0x11e,0x122,0x125,0x129,0x12c,
  0x130,0x134,0x137,0x13b,0x13e,0x142,0x146,0x149,0x14d,0x151,0x154,0x158,0x15c,0x160,0x163,0x167,
  0x16b,0x16f,0x172,0x176,0x17a,0x17e,0x181,0x185,0x189,0x18d,0x191,0x195,0x199,0x19c,0x1a0,0x1a4,
  0x1a8,0x1ac,0x1b0,0x1b4,0x1b8,0x1bc,0x1c0,0x1c4,0x1c8,0x1cc,0x1d0,0x1d4,0x1d8,0x1dc,0x1e0,0x1e4,
  0x1e8,0x1ec,0x1f0,0x1f5,0x1f9,0x1fd,0x201,0x205,0x209,0x20e,0x212,0x216,0x21a,0x21e,0x223,0x227,
  0x22b,0x230,0x234,0x238,0x23c,0x241,0x245,0x249,0x24e,0x252,0x257,0x25b,0x25f,0x264,0x268,0x26d,
  0x271,0x276,0x27a,0x27f,0x283,0x288,0x28c,0x291,0x295,0x29a,0x29e,0x2a3,0x2a8,0x2ac,0x2b1,0x2b5,
  0x2ba,0x2bf,0x2c4,0x2c8,0x2cd,0x2d2,0x2d6,0x2db,0x2e0,0x2e5,0x2e9,0x2ee,0x2f3,0x2f8,0x2fd,0x302,
  0x306,0x30b,0x310,0x315,0x31a,0x31f,0x324,0x329,0x32e,0x333,0x338,0x33d,0x342,0x347,0x34c,0x351,
  0x356,0x35b,0x360,0x365,0x36a,0x370,0x375,0x37a,0x37f,0x384,0x38a,0x38f,0x394,0x399,0x39f,0x3a4,
  0x3a9,0x3ae,0x3b4,0x3b9,0x3bf,0x3c4,0x3c9,0x3cf,0x3d4,0x3da,0x3df,0x3e4,0x3ea,0x3ef,0x3f5,0x3fa,
]);

const fn_note = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3];
const eg_stephi = [[0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 1, 0], [1, 1, 1, 0]];
const eg_am_shift = [7, 3, 1, 0];
const pg_detune = [16, 17, 19, 20, 22, 24, 27, 29];
const pg_lfo_sh1 = [
  [7, 7, 7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 7, 1, 1], [7, 7, 7, 7, 1, 1, 1, 1],
  [7, 7, 7, 1, 1, 1, 1, 0], [7, 7, 1, 1, 0, 0, 0, 0], [7, 7, 1, 1, 0, 0, 0, 0], [7, 7, 1, 1, 0, 0, 0, 0],
];
const pg_lfo_sh2 = [
  [7, 7, 7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 2, 2, 2, 2], [7, 7, 7, 2, 2, 2, 7, 7], [7, 7, 2, 2, 7, 7, 2, 2],
  [7, 7, 2, 7, 7, 7, 2, 7], [7, 7, 7, 2, 7, 7, 2, 1], [7, 7, 7, 2, 7, 7, 2, 1], [7, 7, 7, 2, 7, 7, 2, 1],
];
const op_offset = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102, 0x004, 0x005, 0x006, 0x104, 0x105, 0x106];
const ch_offset = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102];
const lfo_cycles = [108, 77, 71, 67, 62, 44, 8, 5];
const fm_algorithm = [
  [[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,1]],
  [[0,1,0,0,0,1,0,0],[0,0,0,0,0,0,0,0],[1,1,1,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,1,1,1]],
  [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,0,0,1,1,1,1,0],[0,0,0,0,0,0,0,0],[0,0,0,0,1,1,1,1]],
  [[0,0,1,0,0,1,0,0],[0,0,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[1,1,0,1,1,0,0,0],[0,0,1,0,0,0,0,0],[1,1,1,1,1,1,1,1]],
];

const EG_ATTACK = 0, EG_DECAY = 1, EG_SUSTAIN = 2, EG_RELEASE = 3;

// Per-cycle lookups (the original computes (cycles + k) % 24, slot / 6 and walks nested tables every cycle).
const ADD = (k) => Uint8Array.from({ length: 24 }, (_, c) => (c + k) % 24);
const C6 = ADD(6), C18 = ADD(18), C19 = ADD(19), C20 = ADD(20), C22 = ADD(22), C23 = ADD(23);
const OPOF = Uint8Array.from({ length: 24 }, (_, c) => (c / 6) | 0); // operator of a slot
const NEXTCH = Uint8Array.from({ length: 24 }, (_, c) => ((c % 6) + 1) % 6);
// fm_algorithm[op][j][connect] as bit j of ALG[op * 8 + connect]
const ALG = new Uint8Array(32);
for (let op = 0; op < 4; op++) for (let cn = 0; cn < 8; cn++) {
  let m = 0;
  for (let j = 0; j < 6; j++) if (fm_algorithm[op][j][cn]) m |= 1 << j;
  ALG[op * 8 + cn] = m;
}
const EG_STEPHI = Uint8Array.from(eg_stephi.flat());
const LFO_SH1 = Uint8Array.from(pg_lfo_sh1.flat()), LFO_SH2 = Uint8Array.from(pg_lfo_sh2.flat());
const PG_DETUNE = Uint8Array.from(pg_detune);
const FN_NOTE = Uint8Array.from(fn_note);
const AM_SHIFT = Uint8Array.from(eg_am_shift);
const LFO_CYCLES = Uint8Array.from(lfo_cycles);

export class YM2612 {
  // clean: no discrete-DAC "ladder" distortion and no 9-bit rounding of the channel sum (like a YM3438 with a fine DAC);
  // false: the Model 1 YM2612 as it is.
  constructor() { this.muteMask = 0; this.clean = false; this.sumL = 0; this.sumR = 0; this.reset(); }

  reset() {
    this.cycles = 0; this.channel = 0; this.mol = 0; this.mor = 0;
    this.write_data = 0; this.write_a = 0; this.write_d = 0; this.write_a_en = 0; this.write_d_en = 0;
    this.write_busy = 0; this.write_busy_cnt = 0; this.write_fm_address = 0; this.write_fm_data = 0;
    this.write_fm_mode_a = 0; this.address = 0; this.data = 0;
    this.lfo_en = 0; this.lfo_freq = 0; this.lfo_pm = 0; this.lfo_am = 0; this.lfo_cnt = 0; this.lfo_inc = 0; this.lfo_quotient = 0;
    this.pg_fnum = 0; this.pg_block = 0; this.pg_kcode = 0;
    this.pg_inc = new Uint32Array(24); this.pg_phase = new Uint32Array(24); this.pg_reset = new Uint8Array(24);
    this.eg_cycle = 0; this.eg_cycle_stop = 0; this.eg_shift = 0; this.eg_shift_lock = 0; this.eg_timer_low_lock = 0;
    this.eg_timer = 0; this.eg_timer_inc = 0; this.eg_quotient = 0; this.eg_custom_timer = 0;
    this.eg_rate = 0; this.eg_ksv = 0; this.eg_inc = 0; this.eg_ratemax = 0;
    this.eg_sl0 = 0; this.eg_sl1 = 0; this.eg_lfo_am = 0; this.eg_tl0 = 0; this.eg_tl1 = 0;
    this.eg_state = new Uint8Array(24).fill(EG_RELEASE);
    this.eg_level = new Uint16Array(24).fill(0x3ff);
    this.eg_out = new Uint16Array(24).fill(0x3ff);
    this.eg_kon = new Uint8Array(24); this.eg_kon_csm = new Uint8Array(24); this.eg_kon_latch = new Uint8Array(24);
    this.eg_ssg_enable = new Uint8Array(24); this.eg_ssg_pgrst_latch = new Uint8Array(24);
    this.eg_ssg_repeat_latch = new Uint8Array(24); this.eg_ssg_hold_up_latch = new Uint8Array(24);
    this.eg_ssg_dir = new Uint8Array(24); this.eg_ssg_inv = new Uint8Array(24);
    this.fm_op1 = new Int16Array(12); // [channel*2 + i]
    this.fm_op2 = new Int16Array(6); this.fm_out = new Int16Array(24); this.fm_mod = new Uint16Array(24);
    this.ch_acc = new Int16Array(6); this.ch_out = new Int16Array(6);
    this.ch_lock = 0; this.ch_lock_l = 0; this.ch_lock_r = 0; this.ch_lock_mute = 0;
    // test registers 21 / 2C as bytes (bit n = the original mode_test_xx[n])
    this.test21 = 0; this.test2c = 0;
    this.mode_ch3 = 0; this.mode_kon_channel = 0; this.mode_kon_operator = new Uint8Array(4);
    this.mode_kon = new Uint8Array(24); this.mode_csm = 0; this.mode_kon_csm = 0;
    this.dacen = 0; this.dacdata = 0;
    this.ks = new Uint8Array(24); this.ar = new Uint8Array(24); this.sr = new Uint8Array(24); this.dt = new Uint8Array(24);
    this.multi = new Uint8Array(24).fill(1); this.sl = new Uint8Array(24); this.rr = new Uint8Array(24);
    this.dr = new Uint8Array(24); this.am = new Uint8Array(24); this.tl = new Uint8Array(24); this.ssg_eg = new Uint8Array(24);
    this.fnum = new Uint16Array(6); this.block = new Uint8Array(6); this.kcode = new Uint8Array(6);
    this.fnum_3ch = new Uint16Array(6); this.block_3ch = new Uint8Array(6); this.kcode_3ch = new Uint8Array(6);
    this.reg_a4 = 0; this.reg_ac = 0;
    this.connect = new Uint8Array(6); this.fb = new Uint8Array(6);
    this.pan_l = new Uint8Array(6).fill(1); this.pan_r = new Uint8Array(6).fill(1);
    this.ams = new Uint8Array(6); this.pms = new Uint8Array(6);
  }

  doRegWrite(cycles, channel) {
    let slot = cycles >= 12 ? cycles - 12 : cycles;
    if (this.write_fm_data) {
      if (op_offset[slot] === (this.address & 0x107)) {
        if (this.address & 0x08) slot += 12;
        const d = this.data;
        switch (this.address & 0xf0) {
          case 0x30: {
            const m = d & 0x0f;
            this.multi[slot] = m ? m << 1 : 1;
            this.dt[slot] = (d >> 4) & 7;
            break;
          }
          case 0x40: this.tl[slot] = d & 0x7f; break;
          case 0x50: this.ar[slot] = d & 0x1f; this.ks[slot] = (d >> 6) & 3; break;
          case 0x60: this.dr[slot] = d & 0x1f; this.am[slot] = (d >> 7) & 1; break;
          case 0x70: this.sr[slot] = d & 0x1f; break;
          case 0x80: {
            this.rr[slot] = d & 0x0f;
            let s = (d >> 4) & 0x0f;
            s |= (s + 1) & 0x10;
            this.sl[slot] = s;
            break;
          }
          case 0x90: this.ssg_eg[slot] = d & 0x0f; break;
        }
      }
      if (ch_offset[channel] === (this.address & 0x103)) {
        const d = this.data;
        switch (this.address & 0xfc) {
          case 0xa0:
            this.fnum[channel] = (d & 0xff) | ((this.reg_a4 & 7) << 8);
            this.block[channel] = (this.reg_a4 >> 3) & 7;
            this.kcode[channel] = (this.block[channel] << 2) | FN_NOTE[this.fnum[channel] >> 7];
            break;
          case 0xa4: this.reg_a4 = d & 0xff; break;
          case 0xa8:
            this.fnum_3ch[channel] = (d & 0xff) | ((this.reg_ac & 7) << 8);
            this.block_3ch[channel] = (this.reg_ac >> 3) & 7;
            this.kcode_3ch[channel] = (this.block_3ch[channel] << 2) | FN_NOTE[this.fnum_3ch[channel] >> 7];
            break;
          case 0xac: this.reg_ac = d & 0xff; break;
          case 0xb0: this.connect[channel] = d & 7; this.fb[channel] = (d >> 3) & 7; break;
          case 0xb4:
            this.pms[channel] = d & 7; this.ams[channel] = (d >> 4) & 3;
            this.pan_l[channel] = (d >> 7) & 1; this.pan_r[channel] = (d >> 6) & 1;
            break;
        }
      }
    }

    if (this.write_a_en || this.write_d_en) {
      if (this.write_a_en) this.write_fm_data = 0;
      if (this.write_fm_address && this.write_d_en) this.write_fm_data = 1;
      if (this.write_a_en) {
        if ((this.write_data & 0xf0) !== 0) { this.address = this.write_data; this.write_fm_address = 1; }
        else this.write_fm_address = 0;
      }
      if (this.write_d_en && (this.write_data & 0x100) === 0) {
        const wd = this.write_data;
        switch (this.write_fm_mode_a) {
          case 0x21: this.test21 = wd & 0xff; break;
          case 0x22: this.lfo_en = ((wd >> 3) & 1) ? 0x7f : 0; this.lfo_freq = wd & 7; break;
          case 0x27: this.mode_ch3 = (wd & 0xc0) >> 6; this.mode_csm = this.mode_ch3 === 2 ? 1 : 0; break;
          case 0x28:
            for (let i = 0; i < 4; i++) this.mode_kon_operator[i] = (wd >> (4 + i)) & 1;
            this.mode_kon_channel = (wd & 3) === 3 ? 0xff : (wd & 3) + ((wd >> 2) & 1) * 3;
            break;
          case 0x2a: this.dacdata = (this.dacdata & 1) | (((wd ^ 0x80) & 0xff) << 1); break;
          case 0x2b: this.dacen = (wd >> 7) & 1; break;
          case 0x2c:
            this.test2c = wd & 0xff;
            this.dacdata = (this.dacdata & 0x1fe) | ((wd >> 3) & 1);
            this.eg_custom_timer = (!((wd >> 7) & 1) && ((wd >> 6) & 1)) ? 1 : 0;
            break;
        }
      }
      if (this.write_a_en) this.write_fm_mode_a = this.write_data & 0x1ff;
    }
    if (this.write_fm_data) this.data = this.write_data & 0xff;
  }

  // Runs n chip cycles (the original OPN2_Clock n times); the summed left / right output goes to sumL / sumR.
  // All stages of a cycle are inlined, in the order of Nuked OPN2's OPN2_Clock.
  run(n) {
    const clean = this.clean;
    const pg_inc = this.pg_inc, pg_phase = this.pg_phase, pg_reset = this.pg_reset;
    const eg_state = this.eg_state, eg_level = this.eg_level, eg_out = this.eg_out;
    const eg_kon = this.eg_kon, eg_kon_csm = this.eg_kon_csm, eg_kon_latch = this.eg_kon_latch;
    const eg_ssg_enable = this.eg_ssg_enable, eg_ssg_pgrst_latch = this.eg_ssg_pgrst_latch;
    const eg_ssg_repeat_latch = this.eg_ssg_repeat_latch, eg_ssg_hold_up_latch = this.eg_ssg_hold_up_latch;
    const eg_ssg_dir = this.eg_ssg_dir, eg_ssg_inv = this.eg_ssg_inv;
    const fm_op1 = this.fm_op1, fm_op2 = this.fm_op2, fm_out = this.fm_out, fm_mod = this.fm_mod;
    const ch_acc = this.ch_acc, ch_out = this.ch_out;
    const mode_kon = this.mode_kon, mode_kon_operator = this.mode_kon_operator;
    const ks = this.ks, ar = this.ar, sr = this.sr, dt = this.dt, multi = this.multi, sl = this.sl, rr = this.rr;
    const dr = this.dr, am = this.am, tl = this.tl, ssg_eg = this.ssg_eg;
    const fnum = this.fnum, block = this.block, kcode = this.kcode;
    const fnum_3ch = this.fnum_3ch, block_3ch = this.block_3ch, kcode_3ch = this.kcode_3ch;
    const connect = this.connect, fb = this.fb, pan_l = this.pan_l, pan_r = this.pan_r, ams = this.ams, pms = this.pms;
    const lim = clean ? 8192 : 256;
    let sumL = 0, sumR = 0;
    // hot state in locals for the loop (written back at the end)
    let _eg_cycle = this.eg_cycle, _eg_cycle_stop = this.eg_cycle_stop, _eg_shift = this.eg_shift,
      _eg_shift_lock = this.eg_shift_lock, _eg_timer_low_lock = this.eg_timer_low_lock, _eg_timer = this.eg_timer,
      _eg_timer_inc = this.eg_timer_inc, _eg_quotient = this.eg_quotient, _eg_rate = this.eg_rate,
      _eg_ksv = this.eg_ksv, _eg_inc = this.eg_inc, _eg_ratemax = this.eg_ratemax, _eg_sl0 = this.eg_sl0,
      _eg_sl1 = this.eg_sl1, _eg_tl0 = this.eg_tl0, _eg_tl1 = this.eg_tl1, _eg_lfo_am = this.eg_lfo_am,
      _lfo_pm = this.lfo_pm, _lfo_am = this.lfo_am, _lfo_cnt = this.lfo_cnt, _lfo_inc = this.lfo_inc,
      _lfo_quotient = this.lfo_quotient, _pg_fnum = this.pg_fnum, _pg_block = this.pg_block,
      _pg_kcode = this.pg_kcode, _ch_lock = this.ch_lock, _ch_lock_l = this.ch_lock_l, _ch_lock_r = this.ch_lock_r,
      _ch_lock_mute = this.ch_lock_mute, _cycles = this.cycles, _channel = this.channel;

    for (let k = 0; k < n; k++) {
      const cycles = _cycles, chan = _channel;
      const t21 = this.test21;
      const test_dac = (this.test2c >> 5) & 1;

      // ---- timers (start of OPN2_Clock)
      _lfo_inc = (t21 >> 1) & 1;
      _eg_cycle++;
      if (cycles === 1 && _eg_quotient === 2) {
        _eg_shift_lock = _eg_cycle_stop ? 0 : _eg_shift + 1;
        _eg_timer_low_lock = _eg_timer & 3;
      }
      if (cycles === 0) {
        const lc = _lfo_cnt;
        _lfo_pm = lc >> 2;
        _lfo_am = ((lc & 0x40) ? (lc & 0x3f) : (lc ^ 0x3f)) << 1;
      } else if (cycles === 1) {
        _eg_quotient = _eg_quotient === 2 ? 0 : _eg_quotient + 1;
        _eg_cycle = 0; _eg_cycle_stop = 1; _eg_shift = 0;
        _eg_timer_inc |= _eg_quotient >> 1;
        const t = _eg_timer + _eg_timer_inc;
        _eg_timer_inc = t >> 12;
        _eg_timer = t & 0xfff;
      } else if (cycles === 13) {
        _eg_cycle = 0; _eg_cycle_stop = 1; _eg_shift = 0;
        const t = _eg_timer + _eg_timer_inc;
        _eg_timer_inc = t >> 12;
        _eg_timer = t & 0xfff;
      } else if (cycles === 23) {
        _lfo_inc |= 1;
      }
      if (t21 & 0x20) _eg_timer &= ~(1 << _eg_cycle) & 0xffff;
      if ((_eg_timer >> _eg_cycle) & _eg_cycle_stop) {
        _eg_shift = _eg_cycle;
        _eg_cycle_stop = 0;
      }

      // ---- doIO
      if (this.write_a | this.write_d | this.write_busy) {
        this.write_a_en = (this.write_a & 3) === 1 ? 1 : 0;
        this.write_d_en = (this.write_d & 3) === 1 ? 1 : 0;
        this.write_a = (this.write_a << 1) & 0xff;
        this.write_d = (this.write_d << 1) & 0xff;
        this.write_busy_cnt = (this.write_busy_cnt + this.write_busy) & 0xff;
        this.write_busy = ((this.write_busy && !(this.write_busy_cnt >> 5)) || this.write_d_en) ? 1 : 0;
        this.write_busy_cnt &= 0x1f;
      } else {
        this.write_a_en = 0; this.write_d_en = 0;
      }

      // ---- keyOn
      eg_kon_latch[cycles] = mode_kon[cycles];
      eg_kon_csm[cycles] = 0;
      if (cycles === this.mode_kon_channel) {
        mode_kon[chan] = mode_kon_operator[0];
        mode_kon[chan + 12] = mode_kon_operator[1];
        mode_kon[chan + 6] = mode_kon_operator[2];
        mode_kon[chan + 18] = mode_kon_operator[3];
      }

      // ---- chOutput
      {
        const channel = cycles < 12 ? chan + 1 : chan;
        if ((cycles & 3) === 0) {
          if (!test_dac) _ch_lock = ch_out[channel];
          _ch_lock_l = pan_l[channel];
          _ch_lock_r = pan_r[channel];
          _ch_lock_mute = (this.muteMask >> channel) & 1; // mute is decided for the channel being latched
        }
        let out;
        if (((cycles >> 2) === 1 && this.dacen) || test_dac) {
          const v = this.dacdata;
          out = (this.muteMask & 0x40) ? 0 : (v & 0xff) - (v & 0x100);
          if (clean) out *= 32;
        } else {
          out = _ch_lock_mute ? 0 : _ch_lock;
        }
        if (clean) { // YM3438 mode: output on 3 of every 4 cycles, no offset
          if (((cycles & 3) !== 0) || test_dac) {
            if (_ch_lock_l) sumL += out * 0.03125;
            if (_ch_lock_r) sumR += out * 0.03125;
          }
        } else { // YM2612 mode (discrete DAC "ladder" effect)
          const out_en = ((cycles & 3) === 3) || test_dac;
          let sign = out >> 8;
          if (out >= 0) { out++; sign++; }
          sumL += (_ch_lock_l && out_en ? out : sign) * 3;
          sumR += (_ch_lock_r && out_en ? out : sign) * 3;
        }
      }

      // ---- chGenerate
      const s18 = C18[cycles];
      const op18 = OPOF[s18];
      const cn = connect[chan];
      {
        let acc = ch_acc[chan];
        let add = test_dac;
        if (op18 === 0 && !test_dac) acc = 0;
        if ((ALG[op18 * 8 + cn] & 0x20) && !test_dac) add += clean ? fm_out[s18] : fm_out[s18] >> 5;
        let sum = acc + add;
        if (sum > lim - 1) sum = lim - 1; else if (sum < -lim) sum = -lim;
        if (op18 === 0 || test_dac) ch_out[chan] = ch_acc[chan];
        ch_acc[chan] = sum;
      }

      // ---- fmPrepare
      {
        const slot = C6[cycles];
        const op = OPOF[slot];
        const alg = ALG[op * 8 + cn];
        let mod1 = 0, mod2 = 0;
        if (alg & 1) mod2 |= fm_op1[chan * 2];
        if (alg & 2) mod1 |= fm_op1[chan * 2 + 1];
        if (alg & 4) mod1 |= fm_op2[chan];
        if (alg & 8) mod2 |= fm_out[s18];
        if (alg & 16) mod1 |= fm_out[s18];
        let mod = ((mod1 + mod2) << 16) >> 16;
        if (op === 0) {
          const f = fb[chan];
          mod = f ? mod >> (10 - f) : 0;
        } else {
          mod >>= 1;
        }
        fm_mod[slot] = mod & 0xffff;
        if (op18 === 0) {
          fm_op1[chan * 2 + 1] = fm_op1[chan * 2];
          fm_op1[chan * 2] = fm_out[s18];
        } else if (op18 === 2) fm_op2[chan] = fm_out[s18];
      }

      // ---- fmGenerate
      const s19 = C19[cycles];
      {
        const phase = (fm_mod[s19] + (pg_phase[s19] >> 10)) & 0x3ff;
        const quarter = (phase & 0x100) ? ((phase ^ 0xff) & 0xff) : (phase & 0xff);
        let level = logsinrom[quarter] + (eg_out[s19] << 2);
        if (level > 0x1fff) level = 0x1fff;
        let output = ((exprom[(level & 0xff) ^ 0xff] | 0x400) << 2) >> (level >> 8);
        const t = ((t21 >> 4) & 1) << 13;
        if (phase & 0x200) output = ((~output) ^ t) + 1;
        else output = output ^ t;
        fm_out[s19] = (output & 0x1fff) - (output & 0x2000);
      }

      // ---- phaseGenerate
      {
        const s20 = C20[cycles];
        if (pg_reset[s20]) pg_inc[s20] = 0;
        if (pg_reset[s19] || (t21 & 8)) pg_phase[s19] = 0;
        pg_phase[s19] = (pg_phase[s19] + pg_inc[s19]) & 0xfffff;
      }

      // ---- phaseCalcIncrement
      {
        let fn = _pg_fnum;
        const fnum_h = fn >> 4;
        const lfo = _lfo_pm;
        let lfo_l = lfo & 0x0f;
        const p = pms[chan];
        const d = dt[cycles];
        const dt_l = d & 3;
        let detune = 0;
        fn <<= 1;
        if (lfo_l & 8) lfo_l ^= 0x0f;
        let fm = (fnum_h >> LFO_SH1[p * 8 + lfo_l]) + (fnum_h >> LFO_SH2[p * 8 + lfo_l]);
        if (p > 5) fm <<= p - 5;
        fm >>= 2;
        if (lfo & 0x10) fn -= fm; else fn += fm;
        fn &= 0xfff;
        let basefreq = (fn << _pg_block) >> 2;
        if (dt_l) {
          let kc = _pg_kcode;
          if (kc > 0x1c) kc = 0x1c;
          const s = (kc >> 2) + 9 + ((dt_l === 3 ? 1 : 0) | (dt_l & 2));
          detune = PG_DETUNE[((s & 1) << 2) | (kc & 3)] >> (9 - (s >> 1));
        }
        if (d & 4) basefreq -= detune; else basefreq += detune;
        basefreq &= 0x1ffff;
        pg_inc[cycles] = ((basefreq * multi[cycles]) >> 1) & 0xfffff;
      }

      // ---- envelopeADSR
      {
        const slot = C22[cycles];
        const nkon = eg_kon_latch[slot];
        const okon = eg_kon[slot];
        const state = eg_state[slot];
        let nextstate = state;
        let inc = 0;
        pg_reset[slot] = ((nkon && !okon) || eg_ssg_pgrst_latch[slot]) ? 1 : 0;
        const kon_event = (nkon && !okon) || (okon && eg_ssg_repeat_latch[slot]);
        let level = eg_level[slot];
        if (okon && !nkon && eg_ssg_inv[slot]) level = (512 - level) & 0x3ff;
        const ssgen = eg_ssg_enable[slot];
        const eg_off = ssgen ? level >> 9 : ((level & 0x3f0) === 0x3f0 ? 1 : 0);
        let nextlevel = level;
        const egi = _eg_inc;
        if (kon_event) {
          nextstate = EG_ATTACK;
          if (_eg_ratemax) nextlevel = 0;
          else if (state === EG_ATTACK && level !== 0 && egi && nkon) inc = (((~level << egi) >> 5) << 16) >> 16;
        } else {
          if (state === EG_ATTACK) {
            if (level === 0) nextstate = EG_DECAY;
            else if (egi && !_eg_ratemax && nkon) inc = (((~level << egi) >> 5) << 16) >> 16;
          } else if (state === EG_DECAY) {
            if ((level >> 4) === (_eg_sl1 << 1)) nextstate = EG_SUSTAIN;
            else if (!eg_off && egi) {
              inc = 1 << (egi - 1);
              if (ssgen) inc <<= 2;
            }
          } else if (!eg_off && egi) {
            inc = 1 << (egi - 1);
            if (ssgen) inc <<= 2;
          }
          if (!nkon) nextstate = EG_RELEASE;
        }
        if (eg_kon_csm[slot]) nextlevel |= _eg_tl1 << 3;
        if (!kon_event && !eg_ssg_hold_up_latch[slot] && state !== EG_ATTACK && eg_off) {
          nextstate = EG_RELEASE;
          nextlevel = 0x3ff;
        }
        nextlevel += inc;
        eg_kon[slot] = nkon;
        eg_level[slot] = nextlevel & 0x3ff;
        eg_state[slot] = nextstate;
      }

      // ---- envelopeGenerate
      {
        const slot = C23[cycles];
        let level = eg_level[slot];
        if (eg_ssg_inv[slot]) level = 512 - level;
        if (t21 & 0x20) level = 0;
        level &= 0x3ff;
        level += _eg_lfo_am;
        if (!(this.mode_csm && chan === 3)) level += _eg_tl0 << 3;
        if (level > 0x3ff) level = 0x3ff;
        eg_out[slot] = level;
      }

      // ---- envelopeSSGEG
      {
        const ssg = ssg_eg[cycles];
        if (ssg & 8) {
          let direction = eg_ssg_dir[cycles];
          eg_ssg_pgrst_latch[cycles] = 0;
          eg_ssg_repeat_latch[cycles] = 0;
          eg_ssg_hold_up_latch[cycles] = 0;
          if (eg_level[cycles] & 0x200) {
            if ((ssg & 3) === 0) eg_ssg_pgrst_latch[cycles] = 1;
            if ((ssg & 1) === 0) eg_ssg_repeat_latch[cycles] = 1;
            if ((ssg & 3) === 2) direction ^= 1;
            if ((ssg & 3) === 3) direction = 1;
          }
          if (eg_kon_latch[cycles] && ((ssg & 7) === 5 || (ssg & 7) === 3)) eg_ssg_hold_up_latch[cycles] = 1;
          direction &= eg_kon[cycles];
          eg_ssg_dir[cycles] = direction;
          eg_ssg_enable[cycles] = 1;
          eg_ssg_inv[cycles] = (direction ^ ((ssg >> 2) & 1)) & eg_kon[cycles];
        } else {
          eg_ssg_pgrst_latch[cycles] = 0;
          eg_ssg_repeat_latch[cycles] = 0;
          eg_ssg_hold_up_latch[cycles] = 0;
          eg_ssg_dir[cycles] = 0;
          eg_ssg_enable[cycles] = 0;
          eg_ssg_inv[cycles] = 0;
        }
      }

      // ---- envelopePrepare
      {
        let inc = 0;
        let rate = (_eg_rate << 1) + _eg_ksv;
        if (rate > 0x3f) rate = 0x3f;
        if (_eg_rate !== 0 && _eg_quotient === 2) {
          if (rate < 48) {
            const sum = ((rate >> 2) + _eg_shift_lock) & 0x0f;
            if (sum === 12) inc = 1;
            else if (sum === 13) inc = (rate >> 1) & 1;
            else if (sum === 14) inc = rate & 1;
          } else {
            inc = EG_STEPHI[(rate & 3) * 4 + _eg_timer_low_lock] + (rate >> 2) - 11;
            if (inc > 4) inc = 4;
          }
        }
        _eg_inc = inc;
        _eg_ratemax = (rate >> 1) === 0x1f ? 1 : 0;

        let rate_sel = eg_state[cycles];
        if ((eg_kon[cycles] && eg_ssg_repeat_latch[cycles]) || (!eg_kon[cycles] && eg_kon_latch[cycles])) rate_sel = EG_ATTACK;
        if (rate_sel === EG_ATTACK) _eg_rate = ar[cycles];
        else if (rate_sel === EG_DECAY) _eg_rate = dr[cycles];
        else if (rate_sel === EG_SUSTAIN) _eg_rate = sr[cycles];
        else _eg_rate = (rr[cycles] << 1) | 1;
        _eg_ksv = _pg_kcode >> (ks[cycles] ^ 3);
        _eg_lfo_am = am[cycles] ? (_lfo_am >> AM_SHIFT[ams[chan]]) : 0;
        _eg_tl1 = _eg_tl0;
        _eg_tl0 = tl[cycles];
        _eg_sl1 = _eg_sl0;
        _eg_sl0 = sl[cycles];
      }

      // ---- the next channel's frequency
      const nch = NEXTCH[cycles];
      if (this.mode_ch3 && (cycles === 1 || cycles === 7 || cycles === 13)) {
        const i = cycles === 1 ? 1 : cycles === 7 ? 0 : 2;
        _pg_fnum = fnum_3ch[i]; _pg_block = block_3ch[i]; _pg_kcode = kcode_3ch[i];
      } else {
        _pg_fnum = fnum[nch]; _pg_block = block[nch]; _pg_kcode = kcode[nch];
      }

      // ---- updateLFO
      {
        const c = LFO_CYCLES[this.lfo_freq];
        if ((_lfo_quotient & c) === c) {
          _lfo_quotient = 0;
          _lfo_cnt = (_lfo_cnt + 1) & 0xff;
        } else {
          _lfo_quotient = (_lfo_quotient + _lfo_inc) & 0xff;
        }
        _lfo_cnt &= this.lfo_en;
      }

      if (this.write_fm_data || this.write_a_en || this.write_d_en) this.doRegWrite(cycles, chan);
      _cycles = cycles === 23 ? 0 : cycles + 1;
      _channel = nch;
    }
    this.eg_cycle = _eg_cycle; this.eg_cycle_stop = _eg_cycle_stop; this.eg_shift = _eg_shift;
    this.eg_shift_lock = _eg_shift_lock; this.eg_timer_low_lock = _eg_timer_low_lock; this.eg_timer = _eg_timer;
    this.eg_timer_inc = _eg_timer_inc; this.eg_quotient = _eg_quotient; this.eg_rate = _eg_rate;
    this.eg_ksv = _eg_ksv; this.eg_inc = _eg_inc; this.eg_ratemax = _eg_ratemax; this.eg_sl0 = _eg_sl0;
    this.eg_sl1 = _eg_sl1; this.eg_tl0 = _eg_tl0; this.eg_tl1 = _eg_tl1; this.eg_lfo_am = _eg_lfo_am;
    this.lfo_pm = _lfo_pm; this.lfo_am = _lfo_am; this.lfo_cnt = _lfo_cnt; this.lfo_inc = _lfo_inc;
    this.lfo_quotient = _lfo_quotient; this.pg_fnum = _pg_fnum; this.pg_block = _pg_block; this.pg_kcode = _pg_kcode;
    this.ch_lock = _ch_lock; this.ch_lock_l = _ch_lock_l; this.ch_lock_r = _ch_lock_r;
    this.ch_lock_mute = _ch_lock_mute; this.cycles = _cycles; this.channel = _channel;
    this.sumL = sumL; this.sumR = sumR;
  }

  // one cycle, as the original's OPN2_Clock (output in mol / mor)
  clock() { this.run(1); this.mol = this.sumL; this.mor = this.sumR; }

  // Raw bus write. port: 0 = addr (part I), 1 = data, 2 = addr (part II), 3 = data.
  write(port, data) {
    port &= 3;
    this.write_data = ((port << 7) & 0x100) | data;
    if (port & 1) this.write_d |= 1; else this.write_a |= 1;
  }
}

// Convenience wrapper: one output sample = 24 chip cycles (clock / 144 ≈ 53267 Hz).
// Register writes are queued and applied one per output sample, like the busy-wait a real driver does.
export class YM2612Chip {
  constructor() {
    this.core = new YM2612();
    this.qPart = new Uint8Array(4096); this.qReg = new Uint8Array(4096); this.qVal = new Uint8Array(4096);
    this.qHead = 0; this.qLen = 0;
  }
  reset() { this.core.reset(); this.qHead = 0; this.qLen = 0; }
  setClean(on) { this.core.clean = on; }
  // bit n = mute FM channel n (0..5), bit 6 = mute DAC
  setMuteMask(m) { this.core.muteMask = m; }
  writeReg(part, reg, val) {
    // DAC data is latched immediately; drop stale DAC values if queue is congested.
    if (this.qLen >= 4096) return;
    const i = (this.qHead + this.qLen) & 4095;
    this.qPart[i] = part; this.qReg[i] = reg; this.qVal[i] = val; this.qLen++;
  }
  // Renders one sample, returns via out[0], out[1] (raw ints, ~±4608 full scale).
  render(out) {
    const c = this.core;
    let l = 0, r = 0;
    let n = 0;
    if (this.qLen) {
      const i = this.qHead;
      const part = this.qPart[i], reg = this.qReg[i], val = this.qVal[i];
      this.qHead = (this.qHead + 1) & 4095; this.qLen--;
      c.write(part << 1, reg); c.run(1); l += c.sumL; r += c.sumR;
      c.write((part << 1) | 1, val); c.run(1); l += c.sumL; r += c.sumR;
      n = 2;
    }
    c.run(24 - n);
    out[0] = l + c.sumL; out[1] = r + c.sumR;
  }
}

// The same chip compiled to WebAssembly (engine-src/ym2612-wasm, bit for bit the code above, about twice as fast).
// module: a compiled WebAssembly.Module of player/engine/ym2612.wasm; every chip gets its own instance.
export class YM2612Wasm {
  constructor(module) {
    this.x = new WebAssembly.Instance(module, {}).exports;
  }
  get qLen() { return this.x.q_len(); }
  reset() { this.x.reset(); }
  setClean(on) { this.x.set_clean(on ? 1 : 0); }
  setMuteMask(m) { this.x.set_mute(m); }
  writeReg(part, reg, val) { this.x.write_reg(part, reg, val); }
  render(out) { out[0] = this.x.render(); out[1] = this.x.out_r(); }
}
