// Pieces of player/app.js run as they are: the checks compare llm/ with the app's own code without changing it.
// extract(['libSound', 'KIT', ...], { S, hzMidi, ... }) -> { libSound, KIT, ... }: each top-level function or const
// is cut out of app.js and evaluated with the given globals (app.js itself is a browser module and cannot be imported).
import fs from 'node:fs';
import path from 'node:path';
import { PLAYER } from '../core.mjs';

const SRCS = new Map();
const src = (file) => { if (!SRCS.has(file)) SRCS.set(file, fs.readFileSync(path.join(PLAYER, file), 'utf8')); return SRCS.get(file); };

// index just past the end of a balanced block or statement starting at i (strings, comments and regexes skipped)
function scan(src, i, untilSemicolon) {
  let depth = 0, seenBrace = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && /[(,=:!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && src[i + 1] !== '/') { // a regex literal
      for (i++; i < src.length && src[i] !== '/'; i++) { if (src[i] === '\\') i++; else if (src[i] === '[') { while (src[i] !== ']') { if (src[i] === '\\') i++; i++; } } }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; if (c === '{') seenBrace = true; }
    else if (c === ')' || c === ']' || c === '}') { depth--; if (!untilSemicolon && depth === 0 && c === '}' && seenBrace) return i + 1; }
    else if (untilSemicolon && c === ';' && depth === 0) return i + 1;
  }
  throw new Error('unbalanced source');
}
export function source(name, file = 'app.js') {
  const SRC = src(file);
  let m = new RegExp(`^(export )?(async )?function ${name}\\(`, 'm').exec(SRC);
  if (m) return SRC.slice(m.index, scan(SRC, m.index, false)).replace(/^export /, '');
  m = new RegExp(`^(export )?(const|let) ${name} = `, 'm').exec(SRC);
  if (m) return SRC.slice(m.index, scan(SRC, m.index, true)).replace(/^export /, '');
  throw new Error(`${file} has no top-level ${name}`);
}
// one line of a file of player/ that contains `marker` (for a rule inside a bigger function)
export function line(marker, file = 'app.js') {
  const l = src(file).split('\n').find((x) => x.includes(marker));
  if (!l) throw new Error(`${file} has no line with ${marker}`);
  return l.trim();
}
export function extract(names, globals = {}, extra = '', file = 'app.js') {
  const code = names.map((x) => source(x, file)).join('\n') + '\n' + extra + `\nreturn { ${names.join(', ')} };`;
  return new Function(...Object.keys(globals), code)(...Object.values(globals));
}
