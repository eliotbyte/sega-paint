#!/usr/bin/env node
// Sega Paint for language models: songs and FM sounds as text, without the GUI. usage: node llm/sp.mjs help
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { UserError, outPath, stem, writeWav, songBars, loadSongFile, loadSongObject, renderSong, voiceOf, RATE } from './core.mjs';
import { buildFile } from './sps.mjs';
import { importSong } from './import.mjs';
import { listen, parseBars } from './listen.mjs';
import { checkSong, formatCheck } from './check.mjs';
import { listSounds, formatTable, gameNames } from './sounds.mjs';

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
      for (const [k, x] of Object.entries(COMMANDS)) if (x.usage) console.log(`  ${x.usage.padEnd(62)} ${x.help.split('\n')[0]}`);
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
