// Reads the compact song.json of the games' songs (written by tools/songpack.py): the same song, stored by column.
// A packed song has "$pack": 1 at the top; anything else is returned as it is.
//   {"$O": keys, "n": rows, "c": columns}  a list of objects          {"$A": columns, "n": rows}  a list of lists
//   {"$L": lengths, "v": rows}             a list of lists of rows (all the rows in one table)
// A column is a list, {"$S": gaps, "v": column} (only some rows have it), {"$D": [first, steps...], "k": scale}
// (running sums, values = ints / k), {"$R": [value, count, ...]} (runs) or {"$R": ..., "d": 1} (runs of steps).

function runs(r) {
  const out = [];
  for (let i = 0; i < r.length; i += 2) for (let j = 0; j < r[i + 1]; j++) out.push(r[i]);
  return out;
}
function sums(steps, k = 1) {
  const out = new Array(steps.length);
  let s = 0;
  for (let i = 0; i < steps.length; i++) {
    s = i === 0 ? steps[0] : s + steps[i];
    out[i] = k === 1 ? s : s / k;
  }
  return out;
}

function column(c) {
  if (c && !Array.isArray(c) && typeof c === 'object') {
    if (c.$R) return c.d ? sums(runs(c.$R), c.k || 1) : runs(c.$R);
    if (c.$D) return sums(c.$D, c.k || 1);
  }
  return unpack(c);
}

// a column of a table: n values and which of them are there
function tableColumn(c, n) {
  if (c && typeof c === 'object' && !Array.isArray(c) && c.$S) {
    const gaps = column(c.$S), vals = column(c.v);
    const out = new Array(n), has = new Uint8Array(n);
    let i = -1;
    for (let j = 0; j < gaps.length; j++) { i += gaps[j]; out[i] = vals[j]; has[i] = 1; }
    return [out, has];
  }
  const vals = column(c);
  return [vals, null];
}

export function unpack(x) {
  if (Array.isArray(x)) return x.map(unpack);
  if (!x || typeof x !== 'object') return x;
  if (x.$L) {
    const flat = column(x.v), lens = column(x.$L), out = [];
    let i = 0;
    for (const n of lens) { out.push(flat.slice(i, i + n)); i += n; }
    return out;
  }
  if (x.$O) {
    const rows = Array.from({ length: x.n }, () => ({}));
    x.$O.forEach((key, j) => {
      const [vals, has] = tableColumn(x.c[j], x.n);
      for (let i = 0; i < x.n; i++) if (!has || has[i]) rows[i][key] = vals[i];
    });
    return rows;
  }
  if (x.$A) {
    const rows = Array.from({ length: x.n }, () => []);
    for (const c of x.$A) {
      const [vals, has] = tableColumn(c, x.n);
      for (let i = 0; i < x.n; i++) if (!has || has[i]) rows[i].push(vals[i]);
    }
    return rows;
  }
  const out = {};
  for (const k in x) out[k] = unpack(x[k]);
  return out;
}

export const isPacked = (song) => !!song && song.$pack === 1;

export function unpackSong(song) {
  if (!isPacked(song)) return song;
  const { $pack, ...rest } = song;
  return unpack(rest);
}
