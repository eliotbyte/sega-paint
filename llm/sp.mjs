#!/usr/bin/env node
// Sega Paint for language models: songs and FM sounds as text, without the GUI. usage: node llm/sp.mjs help
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { UserError, outPath, stem, writeWav, songBars, loadSongFile, loadSongObject, renderSong, voiceOf, noteName, parseNote, RATE } from './core.mjs';
import { buildFile } from './sps.mjs';
import { importSong } from './import.mjs';
import { listen, parseBars } from './listen.mjs';
import { soundRecord, writeSpp, readSpp, sppToSound, explainPatch } from './patch.mjs';
import { hear, compare, nearest, isWav } from './hear.mjs';
import { fit, formatFit } from './fit.mjs';
import { checkSong, formatCheck } from './check.mjs';
import { listSounds, formatTable, gameNames } from './sounds.mjs';

const slugName = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sound';

// argv -> { _: positional, flag: value | true }; flags listed in `bool` take no value
export function parseArgs(argv, bool = []) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      o[k] = v ?? (bool.includes(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--') ? true : argv[++i]);
    } else o._.push(a);
  }
  return o;
}
const num = (o, k, def) => {
  if (o[k] == null) return def;
  const v = +o[k];
  if (!Number.isFinite(v)) throw new UserError(`--${k}: a number, not "${o[k]}"`);
  return v;
};
// a duration in seconds: 1, 1s, 1.5s or 300ms
const secs = (o, k, def) => {
  if (o[k] == null) return def;
  const m = /^\s*(\d*\.?\d+)\s*(s|ms)?\s*$/i.exec(String(o[k]));
  if (!m) throw new UserError(`--${k}: a duration (1, 1s, 300ms), not "${o[k]}"`);
  return m[2]?.toLowerCase() === 'ms' ? m[1] / 1000 : +m[1];
};
const list = (v) => (v == null || v === true ? null : String(v).split(',').map((x) => x.trim()).filter(Boolean));
// a song.json, or a .sps built on the fly
export const loadAny = (file) => (/\.sps$/i.test(file) ? loadSongObject(buildFile(file), file) : loadSongFile(file));

export const COMMANDS = {
  help: {
    usage: 'sp help [command]',
    help: 'This list, or one command in detail.',
    run(a) {
      const c = a._[0];
      if (c) {
        const x = COMMANDS[c];
        if (!x?.usage) throw new UserError(`no command "${c}"; sp help lists them`);
        console.log(`${x.usage}\n\n${x.help}${x.more ? '\n\n' + x.more : ''}`);
        return;
      }
      console.log('Sega Paint tools for language models (node llm/sp.mjs <command> ...). Guide: llm/README.md\n');
      for (const x of Object.values(COMMANDS)) if (x.usage) console.log(`  ${x.usage}\n      ${x.help.split('\n')[0]}`);
      console.log('\nsp help <command> for details.');
    },
  },
  sounds: {
    usage: 'sp sounds [--game X] [--kind fm|drums|psg|noise|samples] [--find word]',
    help: 'The sound library: key, name, kind, voices it plays on, details. The key goes into a .sps (sound x = "key").',
    more: 'voices: FM1-5 = an FM track; "FM1-5 kit" = an FM drum on a drum track; PSG1-3 = square waves (A2 and up);\n' +
      'NOISE = the noise voice; DAC1-3 = samples at their own pitch (drums); DAC4 pitched = samples that follow the note.\n' +
      `games: ${gameNames().join(', ')}`,
    run(a) {
      const rows = listSounds({ game: a.game, kind: a.kind, find: a.find });
      if (!rows.length) { console.log('no sounds match'); return; }
      console.log(formatTable(rows, ['KEY', 'NAME', 'KIND', 'VOICES', 'DETAILS']));
      console.log(`${rows.length} sounds`);
    },
  },
  render: {
    usage: 'sp render song.json|song.sps [out.wav] [--from bar] [--bars N] [--solo FM1,DAC2]',
    help: 'Render the song (or bars of it) to a WAV through the Sega Paint engine, as the player plays it.',
    more: 'out.wav defaults to llm/out/<name>.wav. --from: first bar (from 1); --bars: how many; --solo: only these voices.',
    run(a) {
      const [file, out0] = a._;
      if (!file) throw new UserError('which song? sp render song.json');
      const doc = loadAny(file);
      const fromBar = num(a, 'from', 1), bars = num(a, 'bars', 0);
      const { L, R, from, to } = renderSong(doc, { fromBar, bars, solo: list(a.solo) });
      const out = out0 || outPath(stem(file) + (a.solo ? '-' + list(a.solo).join('-').toLowerCase() : '') + '.wav');
      writeWav(out, L, R);
      let peak = 0, rms = 0;
      for (const x of [L, R]) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; rms += v * v; }
      rms = Math.sqrt(rms / (2 * L.length || 1));
      const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
      console.log(`${out}: ${((to - from) / RATE).toFixed(1)} s (bars ${fromBar}-${bars ? fromBar + bars - 1 : songBars(doc.song)} of ${songBars(doc.song)}), peak ${db(peak)} dBFS, rms ${db(rms)} dBFS${peak >= 0.999 ? ', CLIPS' : ''}`);
    },
  },
  build: {
    usage: 'sp build song.sps [out.json]',
    help: 'Build a .sps into a song.json that Sega Paint opens with Import; check runs on it.',
    more: 'out.json defaults to the .sps name next to it. Syntax: llm/README.md.',
    run(a) {
      const [file, out0] = a._;
      if (!file) throw new UserError('which .sps? sp build song.sps');
      const json = buildFile(file);
      const out = out0 || file.replace(/\.sps$/i, '') + '.json';
      fs.writeFileSync(out, JSON.stringify(json));
      const doc = loadSongObject(json, out);
      const s = doc.song;
      console.log(`${out}: "${s.title}", ${songBars(s)} bars, ${(s.end / RATE).toFixed(1)} s at ${s.bpm} bpm, loop ${s.loopStart < 0 ? 'from the start' : 'from ' + (s.loopStart / RATE).toFixed(1) + ' s'}`);
      for (const L of s.layers) console.log(`  ${voiceOf(L).padEnd(5)} ${String(L.notes.length).padStart(4)} notes  ${L.name}`);
      const res = checkSong(s);
      console.log(formatCheck(res));
      if (res.errors.length) process.exitCode = 1;
    },
  },
  import: {
    usage: 'sp import song.json [out.sps]',
    help: 'Turn a song.json (a game track of player/songs, or an export of Sega Paint) into a .sps; sp build gives it back.',
    more: 'Repeats fold into patterns (x N, +semitones). A song made in Sega Paint from library sounds on its even grid\n' +
      'comes out plain; a game track keeps its recording as exact data ({m=..} {d=..}, song:... sounds, the exact: block).\n' +
      'out.sps defaults to llm/out/<name>.sps.',
    run(a) {
      const [file, out0] = a._;
      if (!file) throw new UserError('which song? sp import song.json');
      const { text, plain } = importSong(file);
      const out = out0 || outPath(stem(file) + '.sps');
      fs.writeFileSync(out, text);
      const pats = (text.match(/^pattern /gm) || []).length, lines = text.split('\n').findIndex((l) => l.startsWith('exact:'));
      console.log(`${out}: ${plain ? 'plain' : 'exact'} mode, ${pats} patterns, ${lines < 0 ? text.split('\n').length : lines} lines of notation; sp build gives back the same timeline (checked)`);
    },
  },
  listen: {
    usage: 'sp listen song.sps|song.json [--bars 1-16] [--roll 1-8] [--all] [--no-render]',
    help: 'A text report instead of ears: piano roll, chords, key, clashes, voice load, loudness and buried voices.',
    more: 'Default: the whole song up to 32 bars, else bars 1-16; the roll shows 16 bars (--roll for others).\n' +
      '--all: every problem, not the first few; --no-render: skip the sound part (faster).',
    bool: ['all', 'no-render'],
    run(a) {
      const file = a._[0];
      if (!file) throw new UserError('which song? sp listen song.sps');
      const doc = loadAny(file);
      const total = songBars(doc.song);
      console.log(listen(doc, { bars: parseBars(a.bars, total), roll: parseBars(a.roll, total), all: !!a.all, render: !a['no-render'] }));
    },
  },
  patch: {
    usage: 'sp patch get <key|file.spsound> [out.spp] | save x.spp [--name N] [out.spsound] | explain x.spp|<key>',
    help: 'FM patches as text (.spp): get one from the library, save it as a .spsound for Sega Paint, explain it in words.',
    more: 'get: writes llm/out/<name>.spp (or out.spp) and prints it. save: a .spsound the app imports into My sounds\n' +
      '(drop it on the window); default llm/out/<name>.spsound. explain: algorithm, who modulates whom, ratios, depth,\n' +
      'envelopes, and the note measured through the engine. The .spp format: llm/README.md.',
    run(a) {
      const [sub, x, out0] = a._;
      if (sub === 'get') {
        if (!x) throw new UserError('sp patch get <key>   (keys: sp sounds --kind fm)');
        const rec = soundRecord(x), text = writeSpp(rec);
        const out = out0 || outPath(slugName(rec.name) + '.spp');
        fs.writeFileSync(out, text);
        console.log(text + `(saved ${out})`);
      } else if (sub === 'save') {
        if (!x) throw new UserError('sp patch save x.spp [--name N] [out.spsound]');
        const rec = readSpp(x), json = sppToSound(rec, a.name);
        const out = out0 || outPath(slugName(a.name || rec.name) + '.spsound');
        fs.writeFileSync(out, json);
        console.log(`${out}: "${(a.name || rec.name).slice(0, 24)}", ${rec.type === 'drums' ? 'FM drum' : 'FM sound'}, note ${noteName(rec.p)}. Drop it on Sega Paint: it goes to My sounds.`);
      } else if (sub === 'explain') {
        if (!x) throw new UserError('sp patch explain x.spp');
        console.log(explainPatch(soundRecord(x)));
      } else throw new UserError('sp patch get | save | explain (sp help patch)');
    },
  },
  hear: {
    usage: 'sp hear x.spp|<key>|x.spsound|target.wav [--notes A2,A4] [--hold 1s] [--png] [--wav]',
    help: 'One sound in numbers: attack, peak, decay, sustain, release, brightness over time, harmonics, noise.',
    more: 'A patch is played on FM1 through the engine at each note (default: its note and an octave each way; a drum\n' +
      'at its own), held --hold seconds (1, 1s, 300ms; default 1 s), then released. A WAV is summed to mono, its\n' +
      'leading silence cut.\n' +
      '--png: a spectrogram per note in llm/out/; --wav: the rendered notes as WAV files in llm/out/.',
    bool: ['png', 'wav'],
    run(a) {
      const ref = a._[0];
      if (!ref) throw new UserError('what to hear? sp hear bass.spp  (or a library key, or a .wav)');
      const notes = list(a.notes)?.map((t) => { const p = parseNote(t); if (p == null) throw new UserError(`--notes: "${t}" is not a note`); return p; });
      const hold = secs(a, 'hold', isWav(ref) ? null : 1);
      console.log(hear(ref, { notes, hold, png: !!a.png, wav: !!a.wav, out: (n) => outPath(`${slugName(stem(ref))}-${n.replace('#', 's')}.png`) }));
    },
  },
  compare: {
    usage: 'sp compare x.spp|<key> target.wav|<key> [--note A2] [--hold 1s]',
    help: 'How a patch differs from a target, in words and one distance (0 = the same, ~1 = clearly different).',
    more: 'The patch plays at the target\'s pitch (or --note), as long as the target, its key going up where the\n' +
      'target\'s level starts falling clearly faster (the release): when a WAV shows a few such points, each is\n' +
      'tried and the closest kept; the first line says which. --hold 0.75 (or 0.75s, 750ms) sets the key-up instead.\n' +
      'Levels are matched before the distance (a log spectrogram at three resolutions + the envelope); a level\n' +
      'difference is reported in words only.',
    run(a) {
      const [x, t] = a._;
      if (!x || !t) throw new UserError('sp compare patch.spp target.wav');
      const note = a.note ? parseNote(a.note) : null;
      if (a.note && note == null) throw new UserError(`--note: "${a.note}" is not a note`);
      console.log(compare(x, t, { note, hold: secs(a, 'hold', null) }).text);
    },
  },
  nearest: {
    usage: 'sp nearest target.wav|x.spp|<key> [--n 5] [--kit my.spkit] [--note A2] [--hold 1s]',
    help: 'The FM sounds of the library (and of a My sounds export) closest to a target: a good patch to start from.',
    more: 'Each sound plays as in compare: at the target\'s pitch (or --note), its key going up where the target\'s\n' +
      'release starts (found in the WAV; the first line says where). --hold 0.75 (or 0.75s, 750ms) sets the\n' +
      'key-up when that guess is wrong (a slow fade, a recording with reverb). --n: how many; --kit: the sounds of\n' +
      'a My sounds export too.',
    run(a) {
      const t = a._[0];
      if (!t) throw new UserError('sp nearest target.wav');
      const note = a.note ? parseNote(a.note) : null;
      const { target, list: res } = nearest(t, { n: num(a, 'n', 5), kits: list(a.kit) || [], note, hold: secs(a, 'hold', null) });
      console.log(`nearest to ${t} (${target.note != null ? `pitch ${noteName(target.note)}` : 'no clear pitch'}, key-up ${target.holds.length > 1 ? 'tried at ' : 'at '}${target.holds.join(' or ')} s):`);
      res.forEach((r, i) => console.log(`  ${i + 1}. ${r.key.padEnd(20)} "${r.rec.name}"  distance ${r.d.toFixed(3)}  (played at ${noteName(r.p)})`));
      console.log('next: sp patch get <key>, then sp compare it with the target');
    },
  },
  fit: {
    usage: 'sp fit x.spp|<key> target.wav|<key> [out.spp] [--free tl,env] [--budget 2000] [--time 60]',
    help: 'Tune the numbers of a patch to a target: a search over the free parameters by the distance of compare.',
    more: 'You choose the structure (alg, mul, dt: edit the .spp); fit moves the free numbers. --free: op1.tl,op3.dr,fb\n' +
      '(fields as in the .spp: tl ar dr sl sr rr ks am mul dt ssg; d1r d2r work too), op2 = its TL and envelope,\n' +
      'tl / env / ar ... = on all four operators, fb ams fms. Default: tl,env (every TL and envelope).\n' +
      '--budget: renders at most; --time: seconds at most; --note / --hold as in compare; --seed for another search.\n' +
      'The level is left out of the distance; when the carriers\' TLs are free, it is matched at the end.\n' +
      'out.spp defaults to llm/out/<name>-fit.spp. A WAV of another FM chip fits well, a live instrument only roughly.',
    async run(a) {
      const [x, t, out0] = a._;
      if (!x || !t) throw new UserError('sp fit patch.spp target.wav [out.spp]');
      const note = a.note ? parseNote(a.note) : null;
      if (a.note && note == null) throw new UserError(`--note: "${a.note}" is not a note`);
      const rec = soundRecord(x);
      const r = await fit(rec, t, { free: a.free ?? 'tl,env', budget: num(a, 'budget', 2000), time: secs(a, 'time', 60), note, hold: secs(a, 'hold', null), seed: num(a, 'seed', 1), threads: num(a, 'threads', 0) });
      const out = out0 || outPath(slugName(rec.name) + '-fit.spp');
      fs.writeFileSync(out, writeSpp(r.rec));
      console.log(formatFit(r, t) + `\nsaved ${out}; next: sp compare ${out} ${t}`);
    },
  },
  check: {
    usage: 'sp check song.json|song.sps',
    help: 'Hardware rules in words: voices used twice, FM6, two notes at once on a voice, DAC pitch, volume range...',
    run(a) {
      const file = a._[0];
      if (!file) throw new UserError('which song? sp check song.json');
      const res = checkSong(loadAny(file).song);
      console.log(formatCheck(res));
      if (res.errors.length) process.exitCode = 1;
    },
  },
};

export async function main(argv) {
  const [cmd = 'help', ...rest] = argv;
  const c = COMMANDS[cmd];
  if (!c?.run) throw new UserError(`no command "${cmd}"; sp help lists them`);
  await c.run(parseArgs(rest, c.bool || []));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (e instanceof UserError) { console.error('error: ' + e.message); process.exitCode = 2; } else throw e;
  });
}
