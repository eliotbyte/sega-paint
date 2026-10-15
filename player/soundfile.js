// Sound files: one sound of My sounds as JSON (.spsound), or several at once (.spkit, e.g. a drum kit for DAC1-3
// with a staff row for every drum). The idea of Genny's .gen and GDAC files, in a format of our own.
//   .spsound: { format: 'sega-paint-sound', version: 1, kind, name, sprite, id?, ins?, mac?, p?, gm?, ...,
//               sample?: { rate, pitched, oneShot, loop, base, row, data (base64), voice, steps, baseStep, ... } }
//   .spkit:   { format: 'sega-paint-kit', version: 1, name, sounds: [the same objects, without format / version] }
// A record of My sounds (library.js) goes in whole and comes back the same: every field it has is written.
import { resample, quantize } from './sampler.js';

export const SOUND_EXT = ['spsound', 'spkit'];
export const isSoundFile = (name) => SOUND_EXT.includes((/\.([^.]+)$/.exec(name)?.[1] || '').toLowerCase());
const SOUND = 'sega-paint-sound', KIT = 'sega-paint-kit', VERSION = 1;
const KINDS = ['fm', 'drums', 'psg', 'noise', 'samples'];
// Fields of a sample record that go into `sample` under their own name; pcm, loopAt, transp and drumRow go there
// as data, loop, base and row.
const SMP_FIELDS = ['pitched', 'oneShot', 'voice', 'steps', 'baseStep', 'dpcm', 'budget'];
const NOT_SAVED = ['key', 'created', 'updated', 'game', 'my', 'type', 'pcm', 'loopAt', 'transp', 'drumRow', ...SMP_FIELDS];

const toB64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(t); };
const fromB64 = (t) => Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0));

// A record of My sounds -> the object of a file.
function soundObject(rec, rate) {
  const o = { kind: rec.type, name: rec.name, sprite: rec.sprite };
  for (const [k, v] of Object.entries(rec)) if (v !== undefined && !NOT_SAVED.includes(k) && !(k in o)) o[k] = v;
  if (rec.type === 'samples') {
    const s = { rate, pitched: !!rec.pitched, oneShot: !!rec.oneShot, loop: rec.loopAt ?? -1 };
    if (rec.transp != null) s.base = 60 - rec.transp;
    if (rec.drumRow != null) s.row = rec.drumRow;
    for (const k of SMP_FIELDS) if (rec[k] !== undefined) s[k] = rec[k];
    s.data = toB64(rec.pcm);
    o.sample = s;
  }
  return o;
}
export const writeSound = (rec, rate) => JSON.stringify({ format: SOUND, version: VERSION, ...soundObject(rec, rate) });
export const writeKit = (name, recs, rate) => JSON.stringify({ format: KIT, version: VERSION, name, sounds: recs.map((r) => soundObject(r, rate)) });

// The object of a file -> a record of My sounds (no id unless the file has one), or a reason it is not one.
function soundRecord(o, rate) {
  if (!o || typeof o !== 'object') return 'not a sound';
  const { kind, sample, format, version, ...rest } = o;
  if (!KINDS.includes(kind)) return `unknown kind “${kind}”`;
  const rec = { type: kind, ...rest, name: String(o.name || 'Sound').slice(0, 24), sprite: o.sprite || 'ghost' };
  if (kind === 'samples') {
    if (!sample?.data) return 'a sample without data';
    let pcm = fromB64(sample.data), loopAt = sample.loop ?? -1;
    if (sample.rate && Math.abs(sample.rate - rate) > 1) { // another mixer's rate: resampled to ours
      const x = resample(Float32Array.from(pcm, (b) => (b - 128) / 126.5), sample.rate, rate);
      if (loopAt >= 0) loopAt = Math.min(x.length - 1, Math.round(loopAt * rate / sample.rate));
      pcm = quantize(x);
    }
    for (let i = 0; i < pcm.length; i++) if (!pcm[i]) pcm[i] = 1; // 0 ends a sample
    if (!pcm.length) return 'an empty sample';
    for (const k of SMP_FIELDS) if (sample[k] !== undefined) rec[k] = sample[k];
    if (sample.base != null) rec.transp = 60 - sample.base;
    if (sample.row != null) rec.drumRow = sample.row;
    Object.assign(rec, { pcm, loopAt: loopAt < pcm.length ? loopAt : -1 });
    return rec;
  }
  if (!rec.mac) return 'no macro (mac)';
  if ((kind === 'fm' || kind === 'drums') && !Array.isArray(rec.ins?.regs)) return 'no FM registers (ins.regs)';
  if (kind === 'drums' && rec.gm == null) return 'a drum without its note (gm)';
  return rec;
}

// The text of a .spsound / .spkit -> { name, kit, sounds: [records], skipped: [reasons] }; throws on a file
// that is not one.
export function readSoundFile(fileName, text, rate) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error(`${fileName} is not JSON`); }
  if (o?.format !== SOUND && o?.format !== KIT) throw new Error(`${fileName} is not a Sega Paint sound`);
  if (!(o.version <= VERSION)) throw new Error(`${fileName} is of a newer version (${o.version}): update Sega Paint`);
  const kit = o.format === KIT, sounds = [], skipped = [];
  for (const x of kit ? o.sounds || [] : [o]) {
    const rec = soundRecord(x, rate);
    if (typeof rec === 'string') skipped.push(`${x?.name || 'a sound'}: ${rec}`); else sounds.push(rec);
  }
  return { name: kit ? o.name || fileName : fileName, kit, sounds, skipped };
}
