// YM2612 (OPN2) cycle-accurate emulator for WebAssembly: the same code as player/engine/ym2612.js
// (a port of Nuked OPN2 v1.0.12 by Alexey Khokholov (Nuke.YKT), LGPL-2.1, https://github.com/nukeykt/Nuked-OPN2),
// bit for bit: the player checks it against the JavaScript version.
// Build: cargo build --release --target wasm32-unknown-unknown, copy the .wasm to player/engine/ym2612.wasm
#![no_std]

include!("tables.rs");

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }

const EG_ATTACK: u8 = 0;
const EG_DECAY: u8 = 1;
const EG_SUSTAIN: u8 = 2;
const EG_RELEASE: u8 = 3;

const FN_NOTE: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3];
const EG_STEPHI: [i32; 16] = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0];
const EG_AM_SHIFT: [i32; 4] = [7, 3, 1, 0];
const PG_DETUNE: [i32; 8] = [16, 17, 19, 20, 22, 24, 27, 29];
const LFO_SH1: [i32; 64] = [
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 1, 1, 7, 7, 7, 7, 1, 1, 1, 1,
    7, 7, 7, 1, 1, 1, 1, 0, 7, 7, 1, 1, 0, 0, 0, 0, 7, 7, 1, 1, 0, 0, 0, 0, 7, 7, 1, 1, 0, 0, 0, 0,
];
const LFO_SH2: [i32; 64] = [
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 2, 2, 2, 2, 7, 7, 7, 2, 2, 2, 7, 7, 7, 7, 2, 2, 7, 7, 2, 2,
    7, 7, 2, 7, 7, 7, 2, 7, 7, 7, 7, 2, 7, 7, 2, 1, 7, 7, 7, 2, 7, 7, 2, 1, 7, 7, 7, 2, 7, 7, 2, 1,
];
const OP_OFFSET: [i32; 12] = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102, 0x004, 0x005, 0x006, 0x104, 0x105, 0x106];
const CH_OFFSET: [i32; 6] = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102];
const LFO_CYCLES: [i32; 8] = [108, 77, 71, 67, 62, 44, 8, 5];
// fm_algorithm[op][j][connect] as bit j of ALG[op * 8 + connect]
const ALG: [u8; 32] = {
    const A: [[[u8; 8]; 6]; 4] = [
        [[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,1]],
        [[0,1,0,0,0,1,0,0],[0,0,0,0,0,0,0,0],[1,1,1,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,1,1,1]],
        [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,0,0,1,1,1,1,0],[0,0,0,0,0,0,0,0],[0,0,0,0,1,1,1,1]],
        [[0,0,1,0,0,1,0,0],[0,0,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[1,1,0,1,1,0,0,0],[0,0,1,0,0,0,0,0],[1,1,1,1,1,1,1,1]],
    ];
    let mut out = [0u8; 32];
    let mut op = 0;
    while op < 4 {
        let mut cn = 0;
        while cn < 8 {
            let mut m = 0u8;
            let mut j = 0;
            while j < 6 { if A[op][j][cn] != 0 { m |= 1 << j; } j += 1; }
            out[op * 8 + cn] = m;
            cn += 1;
        }
        op += 1;
    }
    out
};

struct Chip {
    clean: bool, mute_mask: i32,
    cycles: usize, channel: usize,
    write_data: i32, write_a: i32, write_d: i32, write_a_en: i32, write_d_en: i32,
    write_busy: i32, write_busy_cnt: i32, write_fm_address: i32, write_fm_data: i32,
    write_fm_mode_a: i32, address: i32, data: i32,
    lfo_en: i32, lfo_freq: usize, lfo_pm: i32, lfo_am: i32, lfo_cnt: i32, lfo_inc: i32, lfo_quotient: i32,
    pg_fnum: i32, pg_block: i32, pg_kcode: i32,
    pg_inc: [u32; 24], pg_phase: [u32; 24], pg_reset: [u8; 24],
    eg_cycle: i32, eg_cycle_stop: i32, eg_shift: i32, eg_shift_lock: i32, eg_timer_low_lock: i32,
    eg_timer: i32, eg_timer_inc: i32, eg_quotient: i32,
    eg_rate: i32, eg_ksv: i32, eg_inc: i32, eg_ratemax: i32,
    eg_sl0: i32, eg_sl1: i32, eg_lfo_am: i32, eg_tl0: i32, eg_tl1: i32,
    eg_state: [u8; 24], eg_level: [u16; 24], eg_out: [u16; 24],
    eg_kon: [u8; 24], eg_kon_csm: [u8; 24], eg_kon_latch: [u8; 24],
    eg_ssg_enable: [u8; 24], eg_ssg_pgrst_latch: [u8; 24], eg_ssg_repeat_latch: [u8; 24],
    eg_ssg_hold_up_latch: [u8; 24], eg_ssg_dir: [u8; 24], eg_ssg_inv: [u8; 24],
    fm_op1: [i16; 12], fm_op2: [i16; 6], fm_out: [i16; 24], fm_mod: [u16; 24],
    ch_acc: [i16; 6], ch_out: [i16; 6],
    ch_lock: i32, ch_lock_l: i32, ch_lock_r: i32, ch_lock_mute: i32,
    test21: i32, test2c: i32,
    mode_ch3: i32, mode_kon_channel: i32, mode_kon_operator: [u8; 4], mode_kon: [u8; 24], mode_csm: i32,
    dacen: i32, dacdata: i32,
    ks: [u8; 24], ar: [u8; 24], sr: [u8; 24], dt: [u8; 24], multi: [u8; 24], sl: [u8; 24], rr: [u8; 24],
    dr: [u8; 24], am: [u8; 24], tl: [u8; 24], ssg_eg: [u8; 24],
    fnum: [u16; 6], block: [u8; 6], kcode: [u8; 6],
    fnum_3ch: [u16; 6], block_3ch: [u8; 6], kcode_3ch: [u8; 6],
    reg_a4: i32, reg_ac: i32,
    connect: [u8; 6], fb: [u8; 6], pan_l: [u8; 6], pan_r: [u8; 6], ams: [u8; 6], pms: [u8; 6],
    sum_l: f64, sum_r: f64,
    // the register-write queue of YM2612Chip
    q_part: [u8; 4096], q_reg: [u8; 4096], q_val: [u8; 4096], q_head: usize, q_len: usize,
    out_r: f64,
}

const fn new_chip() -> Chip {
    Chip {
        clean: false, mute_mask: 0, cycles: 0, channel: 0,
        write_data: 0, write_a: 0, write_d: 0, write_a_en: 0, write_d_en: 0,
        write_busy: 0, write_busy_cnt: 0, write_fm_address: 0, write_fm_data: 0,
        write_fm_mode_a: 0, address: 0, data: 0,
        lfo_en: 0, lfo_freq: 0, lfo_pm: 0, lfo_am: 0, lfo_cnt: 0, lfo_inc: 0, lfo_quotient: 0,
        pg_fnum: 0, pg_block: 0, pg_kcode: 0,
        pg_inc: [0; 24], pg_phase: [0; 24], pg_reset: [0; 24],
        eg_cycle: 0, eg_cycle_stop: 0, eg_shift: 0, eg_shift_lock: 0, eg_timer_low_lock: 0,
        eg_timer: 0, eg_timer_inc: 0, eg_quotient: 0,
        eg_rate: 0, eg_ksv: 0, eg_inc: 0, eg_ratemax: 0,
        eg_sl0: 0, eg_sl1: 0, eg_lfo_am: 0, eg_tl0: 0, eg_tl1: 0,
        eg_state: [EG_RELEASE; 24], eg_level: [0x3ff; 24], eg_out: [0x3ff; 24],
        eg_kon: [0; 24], eg_kon_csm: [0; 24], eg_kon_latch: [0; 24],
        eg_ssg_enable: [0; 24], eg_ssg_pgrst_latch: [0; 24], eg_ssg_repeat_latch: [0; 24],
        eg_ssg_hold_up_latch: [0; 24], eg_ssg_dir: [0; 24], eg_ssg_inv: [0; 24],
        fm_op1: [0; 12], fm_op2: [0; 6], fm_out: [0; 24], fm_mod: [0; 24],
        ch_acc: [0; 6], ch_out: [0; 6],
        ch_lock: 0, ch_lock_l: 0, ch_lock_r: 0, ch_lock_mute: 0,
        test21: 0, test2c: 0,
        mode_ch3: 0, mode_kon_channel: 0, mode_kon_operator: [0; 4], mode_kon: [0; 24], mode_csm: 0,
        dacen: 0, dacdata: 0,
        ks: [0; 24], ar: [0; 24], sr: [0; 24], dt: [0; 24], multi: [1; 24], sl: [0; 24], rr: [0; 24],
        dr: [0; 24], am: [0; 24], tl: [0; 24], ssg_eg: [0; 24],
        fnum: [0; 6], block: [0; 6], kcode: [0; 6],
        fnum_3ch: [0; 6], block_3ch: [0; 6], kcode_3ch: [0; 6],
        reg_a4: 0, reg_ac: 0,
        connect: [0; 6], fb: [0; 6], pan_l: [1; 6], pan_r: [1; 6], ams: [0; 6], pms: [0; 6],
        sum_l: 0.0, sum_r: 0.0,
        q_part: [0; 4096], q_reg: [0; 4096], q_val: [0; 4096], q_head: 0, q_len: 0,
        out_r: 0.0,
    }
}

static mut CHIP: Chip = new_chip();

#[inline(always)]
fn add(c: usize, k: usize) -> usize { let x = c + k; if x >= 24 { x - 24 } else { x } }

impl Chip {
    fn reset(&mut self) {
        let clean = self.clean;
        let mute = self.mute_mask;
        *self = new_chip();
        self.clean = clean;
        self.mute_mask = mute;
    }

    fn do_reg_write(&mut self, cycles: usize, channel: usize) {
        let mut slot = if cycles >= 12 { cycles - 12 } else { cycles };
        if self.write_fm_data != 0 {
            if OP_OFFSET[slot] == (self.address & 0x107) {
                if self.address & 0x08 != 0 { slot += 12; }
                let d = self.data;
                match self.address & 0xf0 {
                    0x30 => {
                        let m = d & 0x0f;
                        self.multi[slot] = (if m != 0 { m << 1 } else { 1 }) as u8;
                        self.dt[slot] = ((d >> 4) & 7) as u8;
                    }
                    0x40 => self.tl[slot] = (d & 0x7f) as u8,
                    0x50 => { self.ar[slot] = (d & 0x1f) as u8; self.ks[slot] = ((d >> 6) & 3) as u8; }
                    0x60 => { self.dr[slot] = (d & 0x1f) as u8; self.am[slot] = ((d >> 7) & 1) as u8; }
                    0x70 => self.sr[slot] = (d & 0x1f) as u8,
                    0x80 => {
                        self.rr[slot] = (d & 0x0f) as u8;
                        let mut s = (d >> 4) & 0x0f;
                        s |= (s + 1) & 0x10;
                        self.sl[slot] = s as u8;
                    }
                    0x90 => self.ssg_eg[slot] = (d & 0x0f) as u8,
                    _ => {}
                }
            }
            if CH_OFFSET[channel] == (self.address & 0x103) {
                let d = self.data;
                match self.address & 0xfc {
                    0xa0 => {
                        self.fnum[channel] = ((d & 0xff) | ((self.reg_a4 & 7) << 8)) as u16;
                        self.block[channel] = ((self.reg_a4 >> 3) & 7) as u8;
                        self.kcode[channel] = (self.block[channel] << 2) | FN_NOTE[(self.fnum[channel] >> 7) as usize];
                    }
                    0xa4 => self.reg_a4 = d & 0xff,
                    0xa8 => {
                        self.fnum_3ch[channel] = ((d & 0xff) | ((self.reg_ac & 7) << 8)) as u16;
                        self.block_3ch[channel] = ((self.reg_ac >> 3) & 7) as u8;
                        self.kcode_3ch[channel] = (self.block_3ch[channel] << 2) | FN_NOTE[(self.fnum_3ch[channel] >> 7) as usize];
                    }
                    0xac => self.reg_ac = d & 0xff,
                    0xb0 => { self.connect[channel] = (d & 7) as u8; self.fb[channel] = ((d >> 3) & 7) as u8; }
                    0xb4 => {
                        self.pms[channel] = (d & 7) as u8; self.ams[channel] = ((d >> 4) & 3) as u8;
                        self.pan_l[channel] = ((d >> 7) & 1) as u8; self.pan_r[channel] = ((d >> 6) & 1) as u8;
                    }
                    _ => {}
                }
            }
        }
        if self.write_a_en != 0 || self.write_d_en != 0 {
            if self.write_a_en != 0 { self.write_fm_data = 0; }
            if self.write_fm_address != 0 && self.write_d_en != 0 { self.write_fm_data = 1; }
            if self.write_a_en != 0 {
                if (self.write_data & 0xf0) != 0 { self.address = self.write_data; self.write_fm_address = 1; } else { self.write_fm_address = 0; }
            }
            if self.write_d_en != 0 && (self.write_data & 0x100) == 0 {
                let wd = self.write_data;
                match self.write_fm_mode_a {
                    0x21 => self.test21 = wd & 0xff,
                    0x22 => { self.lfo_en = if (wd >> 3) & 1 != 0 { 0x7f } else { 0 }; self.lfo_freq = (wd & 7) as usize; }
                    0x27 => { self.mode_ch3 = (wd & 0xc0) >> 6; self.mode_csm = if self.mode_ch3 == 2 { 1 } else { 0 }; }
                    0x28 => {
                        for i in 0..4 { self.mode_kon_operator[i] = ((wd >> (4 + i)) & 1) as u8; }
                        self.mode_kon_channel = if (wd & 3) == 3 { 0xff } else { (wd & 3) + ((wd >> 2) & 1) * 3 };
                    }
                    0x2a => self.dacdata = (self.dacdata & 1) | (((wd ^ 0x80) & 0xff) << 1),
                    0x2b => self.dacen = (wd >> 7) & 1,
                    0x2c => {
                        self.test2c = wd & 0xff;
                        self.dacdata = (self.dacdata & 0x1fe) | ((wd >> 3) & 1);
                    }
                    _ => {}
                }
            }
            if self.write_a_en != 0 { self.write_fm_mode_a = self.write_data & 0x1ff; }
        }
        if self.write_fm_data != 0 { self.data = self.write_data & 0xff; }
    }

    fn run(&mut self, n: u32) {
        let clean = self.clean;
        let lim: i32 = if clean { 8192 } else { 256 };
        let mut sum_l = 0.0f64;
        let mut sum_r = 0.0f64;
        for _ in 0..n {
            let cycles = self.cycles;
            let chan = self.channel;
            let t21 = self.test21;
            let test_dac = (self.test2c >> 5) & 1;

            // ---- timers
            self.lfo_inc = (t21 >> 1) & 1;
            self.eg_cycle += 1;
            if cycles == 1 && self.eg_quotient == 2 {
                self.eg_shift_lock = if self.eg_cycle_stop != 0 { 0 } else { self.eg_shift + 1 };
                self.eg_timer_low_lock = self.eg_timer & 3;
            }
            if cycles == 0 {
                let lc = self.lfo_cnt;
                self.lfo_pm = lc >> 2;
                self.lfo_am = (if lc & 0x40 != 0 { lc & 0x3f } else { lc ^ 0x3f }) << 1;
            } else if cycles == 1 {
                self.eg_quotient = if self.eg_quotient == 2 { 0 } else { self.eg_quotient + 1 };
                self.eg_cycle = 0; self.eg_cycle_stop = 1; self.eg_shift = 0;
                self.eg_timer_inc |= self.eg_quotient >> 1;
                let t = self.eg_timer + self.eg_timer_inc;
                self.eg_timer_inc = t >> 12;
                self.eg_timer = t & 0xfff;
            } else if cycles == 13 {
                self.eg_cycle = 0; self.eg_cycle_stop = 1; self.eg_shift = 0;
                let t = self.eg_timer + self.eg_timer_inc;
                self.eg_timer_inc = t >> 12;
                self.eg_timer = t & 0xfff;
            } else if cycles == 23 {
                self.lfo_inc |= 1;
            }
            if t21 & 0x20 != 0 { self.eg_timer &= !(1i32.wrapping_shl(self.eg_cycle as u32)) & 0xffff; }
            if (self.eg_timer.wrapping_shr(self.eg_cycle as u32)) & self.eg_cycle_stop != 0 {
                self.eg_shift = self.eg_cycle;
                self.eg_cycle_stop = 0;
            }

            // ---- doIO
            if (self.write_a | self.write_d | self.write_busy) != 0 {
                self.write_a_en = if (self.write_a & 3) == 1 { 1 } else { 0 };
                self.write_d_en = if (self.write_d & 3) == 1 { 1 } else { 0 };
                self.write_a = (self.write_a << 1) & 0xff;
                self.write_d = (self.write_d << 1) & 0xff;
                self.write_busy_cnt = (self.write_busy_cnt + self.write_busy) & 0xff;
                self.write_busy = if (self.write_busy != 0 && (self.write_busy_cnt >> 5) == 0) || self.write_d_en != 0 { 1 } else { 0 };
                self.write_busy_cnt &= 0x1f;
            } else {
                self.write_a_en = 0; self.write_d_en = 0;
            }

            // ---- keyOn
            self.eg_kon_latch[cycles] = self.mode_kon[cycles];
            self.eg_kon_csm[cycles] = 0;
            if cycles as i32 == self.mode_kon_channel {
                self.mode_kon[chan] = self.mode_kon_operator[0];
                self.mode_kon[chan + 12] = self.mode_kon_operator[1];
                self.mode_kon[chan + 6] = self.mode_kon_operator[2];
                self.mode_kon[chan + 18] = self.mode_kon_operator[3];
            }

            // ---- chOutput
            {
                let channel = if cycles < 12 { chan + 1 } else { chan };
                if (cycles & 3) == 0 {
                    if test_dac == 0 { self.ch_lock = self.ch_out[channel] as i32; }
                    self.ch_lock_l = self.pan_l[channel] as i32;
                    self.ch_lock_r = self.pan_r[channel] as i32;
                    self.ch_lock_mute = (self.mute_mask >> channel) & 1;
                }
                let mut out: i32;
                if ((cycles >> 2) == 1 && self.dacen != 0) || test_dac != 0 {
                    let v = self.dacdata;
                    out = if self.mute_mask & 0x40 != 0 { 0 } else { (v & 0xff) - (v & 0x100) };
                    if clean { out *= 32; }
                } else {
                    out = if self.ch_lock_mute != 0 { 0 } else { self.ch_lock };
                }
                if clean {
                    if (cycles & 3) != 0 || test_dac != 0 {
                        if self.ch_lock_l != 0 { sum_l += out as f64 * 0.03125; }
                        if self.ch_lock_r != 0 { sum_r += out as f64 * 0.03125; }
                    }
                } else {
                    let out_en = (cycles & 3) == 3 || test_dac != 0;
                    let mut sign = out >> 8;
                    if out >= 0 { out += 1; sign += 1; }
                    sum_l += ((if self.ch_lock_l != 0 && out_en { out } else { sign }) * 3) as f64;
                    sum_r += ((if self.ch_lock_r != 0 && out_en { out } else { sign }) * 3) as f64;
                }
            }

            // ---- chGenerate
            let s18 = add(cycles, 18);
            let op18 = s18 / 6;
            let cn = self.connect[chan] as usize;
            {
                let mut acc = self.ch_acc[chan] as i32;
                let mut add_ = test_dac;
                if op18 == 0 && test_dac == 0 { acc = 0; }
                if (ALG[op18 * 8 + cn] & 0x20) != 0 && test_dac == 0 {
                    let fo = self.fm_out[s18] as i32;
                    add_ += if clean { fo } else { fo >> 5 };
                }
                let mut sum = acc + add_;
                if sum > lim - 1 { sum = lim - 1; } else if sum < -lim { sum = -lim; }
                if op18 == 0 || test_dac != 0 { self.ch_out[chan] = self.ch_acc[chan]; }
                self.ch_acc[chan] = sum as i16;
            }

            // ---- fmPrepare
            {
                let slot = add(cycles, 6);
                let op = slot / 6;
                let alg = ALG[op * 8 + cn];
                let mut mod1: i32 = 0;
                let mut mod2: i32 = 0;
                if alg & 1 != 0 { mod2 |= self.fm_op1[chan * 2] as i32; }
                if alg & 2 != 0 { mod1 |= self.fm_op1[chan * 2 + 1] as i32; }
                if alg & 4 != 0 { mod1 |= self.fm_op2[chan] as i32; }
                if alg & 8 != 0 { mod2 |= self.fm_out[s18] as i32; }
                if alg & 16 != 0 { mod1 |= self.fm_out[s18] as i32; }
                let mut m = ((mod1.wrapping_add(mod2)) << 16) >> 16;
                if op == 0 {
                    let f = self.fb[chan] as i32;
                    m = if f != 0 { m >> (10 - f) } else { 0 };
                } else {
                    m >>= 1;
                }
                self.fm_mod[slot] = (m & 0xffff) as u16;
                if op18 == 0 {
                    self.fm_op1[chan * 2 + 1] = self.fm_op1[chan * 2];
                    self.fm_op1[chan * 2] = self.fm_out[s18];
                } else if op18 == 2 {
                    self.fm_op2[chan] = self.fm_out[s18];
                }
            }

            // ---- fmGenerate
            let s19 = add(cycles, 19);
            {
                let phase = (self.fm_mod[s19] as i32 + (self.pg_phase[s19] >> 10) as i32) & 0x3ff;
                let quarter = if phase & 0x100 != 0 { (phase ^ 0xff) & 0xff } else { phase & 0xff };
                let mut level = LOGSINROM[quarter as usize] as i32 + ((self.eg_out[s19] as i32) << 2);
                if level > 0x1fff { level = 0x1fff; }
                let mut output = ((EXPROM[((level & 0xff) ^ 0xff) as usize] as i32 | 0x400) << 2) >> (level >> 8);
                let t = ((t21 >> 4) & 1) << 13;
                if phase & 0x200 != 0 { output = ((!output) ^ t).wrapping_add(1); } else { output ^= t; }
                self.fm_out[s19] = ((output & 0x1fff) - (output & 0x2000)) as i16;
            }

            // ---- phaseGenerate
            {
                let s20 = add(cycles, 20);
                if self.pg_reset[s20] != 0 { self.pg_inc[s20] = 0; }
                if self.pg_reset[s19] != 0 || (t21 & 8) != 0 { self.pg_phase[s19] = 0; }
                self.pg_phase[s19] = (self.pg_phase[s19] + self.pg_inc[s19]) & 0xfffff;
            }

            // ---- phaseCalcIncrement
            {
                let mut fnv = self.pg_fnum;
                let fnum_h = fnv >> 4;
                let lfo = self.lfo_pm;
                let mut lfo_l = lfo & 0x0f;
                let p = self.pms[chan] as i32;
                let d = self.dt[cycles] as i32;
                let dt_l = d & 3;
                let mut detune = 0;
                fnv <<= 1;
                if lfo_l & 8 != 0 { lfo_l ^= 0x0f; }
                let idx = (p * 8 + lfo_l) as usize;
                let mut fm = (fnum_h >> LFO_SH1[idx]) + (fnum_h >> LFO_SH2[idx]);
                if p > 5 { fm <<= p - 5; }
                fm >>= 2;
                if lfo & 0x10 != 0 { fnv -= fm; } else { fnv += fm; }
                fnv &= 0xfff;
                let mut basefreq = (fnv << self.pg_block) >> 2;
                if dt_l != 0 {
                    let mut kc = self.pg_kcode;
                    if kc > 0x1c { kc = 0x1c; }
                    let s = (kc >> 2) + 9 + ((if dt_l == 3 { 1 } else { 0 }) | (dt_l & 2));
                    detune = PG_DETUNE[(((s & 1) << 2) | (kc & 3)) as usize] >> (9 - (s >> 1));
                }
                if d & 4 != 0 { basefreq -= detune; } else { basefreq += detune; }
                basefreq &= 0x1ffff;
                self.pg_inc[cycles] = (((basefreq * self.multi[cycles] as i32) >> 1) & 0xfffff) as u32;
            }

            // ---- envelopeADSR
            {
                let slot = add(cycles, 22);
                let nkon = self.eg_kon_latch[slot];
                let okon = self.eg_kon[slot];
                let state = self.eg_state[slot];
                let mut nextstate = state;
                let mut inc: i32 = 0;
                self.pg_reset[slot] = if (nkon != 0 && okon == 0) || self.eg_ssg_pgrst_latch[slot] != 0 { 1 } else { 0 };
                let kon_event = (nkon != 0 && okon == 0) || (okon != 0 && self.eg_ssg_repeat_latch[slot] != 0);
                let mut level = self.eg_level[slot] as i32;
                if okon != 0 && nkon == 0 && self.eg_ssg_inv[slot] != 0 { level = (512 - level) & 0x3ff; }
                let ssgen = self.eg_ssg_enable[slot] != 0;
                let eg_off = if ssgen { level >> 9 } else if (level & 0x3f0) == 0x3f0 { 1 } else { 0 };
                let mut nextlevel = level;
                let egi = self.eg_inc;
                if kon_event {
                    nextstate = EG_ATTACK;
                    if self.eg_ratemax != 0 { nextlevel = 0; }
                    else if state == EG_ATTACK && level != 0 && egi != 0 && nkon != 0 {
                        inc = (((!level) << egi) >> 5) << 16 >> 16;
                    }
                } else {
                    if state == EG_ATTACK {
                        if level == 0 { nextstate = EG_DECAY; }
                        else if egi != 0 && self.eg_ratemax == 0 && nkon != 0 { inc = (((!level) << egi) >> 5) << 16 >> 16; }
                    } else if state == EG_DECAY {
                        if (level >> 4) == (self.eg_sl1 << 1) { nextstate = EG_SUSTAIN; }
                        else if eg_off == 0 && egi != 0 {
                            inc = 1 << (egi - 1);
                            if ssgen { inc <<= 2; }
                        }
                    } else if eg_off == 0 && egi != 0 {
                        inc = 1 << (egi - 1);
                        if ssgen { inc <<= 2; }
                    }
                    if nkon == 0 { nextstate = EG_RELEASE; }
                }
                if self.eg_kon_csm[slot] != 0 { nextlevel |= self.eg_tl1 << 3; }
                if !kon_event && self.eg_ssg_hold_up_latch[slot] == 0 && state != EG_ATTACK && eg_off != 0 {
                    nextstate = EG_RELEASE;
                    nextlevel = 0x3ff;
                }
                nextlevel += inc;
                self.eg_kon[slot] = nkon;
                self.eg_level[slot] = (nextlevel & 0x3ff) as u16;
                self.eg_state[slot] = nextstate;
            }

            // ---- envelopeGenerate
            {
                let slot = add(cycles, 23);
                let mut level = self.eg_level[slot] as i32;
                if self.eg_ssg_inv[slot] != 0 { level = 512 - level; }
                if t21 & 0x20 != 0 { level = 0; }
                level &= 0x3ff;
                level += self.eg_lfo_am;
                if !(self.mode_csm != 0 && chan == 3) { level += self.eg_tl0 << 3; }
                if level > 0x3ff { level = 0x3ff; }
                self.eg_out[slot] = level as u16;
            }

            // ---- envelopeSSGEG
            {
                let ssg = self.ssg_eg[cycles];
                self.eg_ssg_pgrst_latch[cycles] = 0;
                self.eg_ssg_repeat_latch[cycles] = 0;
                self.eg_ssg_hold_up_latch[cycles] = 0;
                if ssg & 8 != 0 {
                    let mut direction = self.eg_ssg_dir[cycles];
                    if self.eg_level[cycles] & 0x200 != 0 {
                        if (ssg & 3) == 0 { self.eg_ssg_pgrst_latch[cycles] = 1; }
                        if (ssg & 1) == 0 { self.eg_ssg_repeat_latch[cycles] = 1; }
                        if (ssg & 3) == 2 { direction ^= 1; }
                        if (ssg & 3) == 3 { direction = 1; }
                    }
                    if self.eg_kon_latch[cycles] != 0 && ((ssg & 7) == 5 || (ssg & 7) == 3) { self.eg_ssg_hold_up_latch[cycles] = 1; }
                    direction &= self.eg_kon[cycles];
                    self.eg_ssg_dir[cycles] = direction;
                    self.eg_ssg_enable[cycles] = 1;
                    self.eg_ssg_inv[cycles] = (direction ^ ((ssg >> 2) & 1)) & self.eg_kon[cycles];
                } else {
                    self.eg_ssg_dir[cycles] = 0;
                    self.eg_ssg_enable[cycles] = 0;
                    self.eg_ssg_inv[cycles] = 0;
                }
            }

            // ---- envelopePrepare
            {
                let mut inc = 0;
                let mut rate = (self.eg_rate << 1) + self.eg_ksv;
                if rate > 0x3f { rate = 0x3f; }
                if self.eg_rate != 0 && self.eg_quotient == 2 {
                    if rate < 48 {
                        let sum = ((rate >> 2) + self.eg_shift_lock) & 0x0f;
                        if sum == 12 { inc = 1; }
                        else if sum == 13 { inc = (rate >> 1) & 1; }
                        else if sum == 14 { inc = rate & 1; }
                    } else {
                        inc = EG_STEPHI[((rate & 3) * 4 + self.eg_timer_low_lock) as usize] + (rate >> 2) - 11;
                        if inc > 4 { inc = 4; }
                    }
                }
                self.eg_inc = inc;
                self.eg_ratemax = if (rate >> 1) == 0x1f { 1 } else { 0 };
                let mut rate_sel = self.eg_state[cycles];
                if (self.eg_kon[cycles] != 0 && self.eg_ssg_repeat_latch[cycles] != 0) || (self.eg_kon[cycles] == 0 && self.eg_kon_latch[cycles] != 0) {
                    rate_sel = EG_ATTACK;
                }
                self.eg_rate = match rate_sel {
                    EG_ATTACK => self.ar[cycles] as i32,
                    EG_DECAY => self.dr[cycles] as i32,
                    EG_SUSTAIN => self.sr[cycles] as i32,
                    _ => ((self.rr[cycles] as i32) << 1) | 1,
                };
                self.eg_ksv = self.pg_kcode >> (self.ks[cycles] ^ 3);
                self.eg_lfo_am = if self.am[cycles] != 0 { self.lfo_am >> EG_AM_SHIFT[self.ams[chan] as usize] } else { 0 };
                self.eg_tl1 = self.eg_tl0;
                self.eg_tl0 = self.tl[cycles] as i32;
                self.eg_sl1 = self.eg_sl0;
                self.eg_sl0 = self.sl[cycles] as i32;
            }

            // ---- the next channel's frequency
            let nch = if chan == 5 { 0 } else { chan + 1 };
            if self.mode_ch3 != 0 && (cycles == 1 || cycles == 7 || cycles == 13) {
                let i = if cycles == 1 { 1 } else if cycles == 7 { 0 } else { 2 };
                self.pg_fnum = self.fnum_3ch[i] as i32; self.pg_block = self.block_3ch[i] as i32; self.pg_kcode = self.kcode_3ch[i] as i32;
            } else {
                self.pg_fnum = self.fnum[nch] as i32; self.pg_block = self.block[nch] as i32; self.pg_kcode = self.kcode[nch] as i32;
            }

            // ---- updateLFO
            {
                let c = LFO_CYCLES[self.lfo_freq];
                if (self.lfo_quotient & c) == c {
                    self.lfo_quotient = 0;
                    self.lfo_cnt = (self.lfo_cnt + 1) & 0xff;
                } else {
                    self.lfo_quotient = (self.lfo_quotient + self.lfo_inc) & 0xff;
                }
                self.lfo_cnt &= self.lfo_en;
            }

            if self.write_fm_data != 0 || self.write_a_en != 0 || self.write_d_en != 0 { self.do_reg_write(cycles, chan); }
            self.cycles = if cycles == 23 { 0 } else { cycles + 1 };
            self.channel = nch;
        }
        self.sum_l = sum_l;
        self.sum_r = sum_r;
    }

    fn write(&mut self, port: i32, data: i32) {
        let port = port & 3;
        self.write_data = ((port << 7) & 0x100) | data;
        if port & 1 != 0 { self.write_d |= 1; } else { self.write_a |= 1; }
    }
}

// ---- the exports: YM2612Chip of ym2612.js
#[no_mangle]
pub extern "C" fn reset() { unsafe { let c = &mut *core::ptr::addr_of_mut!(CHIP); c.reset(); } }
#[no_mangle]
pub extern "C" fn set_clean(on: i32) { unsafe { (*core::ptr::addr_of_mut!(CHIP)).clean = on != 0; } }
#[no_mangle]
pub extern "C" fn set_mute(mask: i32) { unsafe { (*core::ptr::addr_of_mut!(CHIP)).mute_mask = mask; } }
#[no_mangle]
pub extern "C" fn q_len() -> i32 { unsafe { (*core::ptr::addr_of!(CHIP)).q_len as i32 } }
#[no_mangle]
pub extern "C" fn write_reg(part: i32, reg: i32, val: i32) {
    let c = unsafe { &mut *core::ptr::addr_of_mut!(CHIP) };
    if c.q_len >= 4096 { return; }
    let i = (c.q_head + c.q_len) & 4095;
    c.q_part[i] = part as u8; c.q_reg[i] = reg as u8; c.q_val[i] = val as u8; c.q_len += 1;
}
/// one output sample (24 cycles); returns the left sum, out_r() the right one
#[no_mangle]
pub extern "C" fn render() -> f64 {
    let c = unsafe { &mut *core::ptr::addr_of_mut!(CHIP) };
    let mut l = 0.0f64;
    let mut r = 0.0f64;
    let mut n = 0;
    if c.q_len != 0 {
        let i = c.q_head;
        let part = c.q_part[i] as i32;
        let reg = c.q_reg[i] as i32;
        let val = c.q_val[i] as i32;
        c.q_head = (c.q_head + 1) & 4095; c.q_len -= 1;
        c.write(part << 1, reg); c.run(1); l += c.sum_l; r += c.sum_r;
        c.write((part << 1) | 1, val); c.run(1); l += c.sum_l; r += c.sum_r;
        n = 2;
    }
    c.run(24 - n);
    c.out_r = r + c.sum_r;
    l + c.sum_l
}
#[no_mangle]
pub extern "C" fn out_r() -> f64 { unsafe { (*core::ptr::addr_of!(CHIP)).out_r } }
