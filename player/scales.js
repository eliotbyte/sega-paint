// Scale lock: the scales the pen and the keyboard can be locked to, and a guess of the song's scale.
// pcs: pitch classes from the root. Ordered from plain to colourful; hint = how it sounds.
export const SCALE_LIST = [
  { id: 'off', name: 'Off', hint: 'all keys', short: 'SCALE' },
  { id: 'major', name: 'Major', hint: 'bright', short: 'MAJ', pcs: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', hint: 'sad', short: 'MIN', pcs: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'mpent', name: 'Major pent', hint: 'bright, safe', short: 'MAJP', pcs: [0, 2, 4, 7, 9] },
  { id: 'npent', name: 'Minor pent', hint: 'rock, safe', short: 'MINP', pcs: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', hint: 'dirty rock', short: 'BLUES', pcs: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian', name: 'Dorian', hint: 'cool minor', short: 'DOR', pcs: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixo', name: 'Mixolydian', hint: 'rock major', short: 'MIX', pcs: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'phryg', name: 'Phrygian', hint: 'dark, metal', short: 'PHR', pcs: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'harmin', name: 'Harmonic minor', hint: 'drama, boss', short: 'HMIN', pcs: [0, 2, 3, 5, 7, 8, 11] },
];
// Older songs may name scales that are gone: white keys = C major, the rest = off.
export const findScale = (id) => SCALE_LIST.find((x) => x.id === id) || (id === 'white' ? SCALE_LIST[1] : SCALE_LIST[0]);

// Guess from how long each pitch class sounds (hist[12]) and how long it sounds in the bass (bass[12]):
// the scale that covers the most of the music, with the root the music leans on (the bass most of all).
// Smaller scales pay a little per missing note, so a pentatonic wins only when the music really stays in it.
export function guessScale(hist, bass) {
  const total = hist.reduce((a, b) => a + b, 0), btotal = bass.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best = null;
  for (const sc of SCALE_LIST) {
    if (!sc.pcs) continue;
    for (let root = 0; root < 12; root++) {
      let cov = 0;
      for (const pc of sc.pcs) cov += hist[(root + pc) % 12];
      cov /= total;
      const tonic = hist[root] / total + (btotal ? 2 * bass[root] / btotal : 0)
        + 0.5 * (hist[(root + 7) % 12] / total); // the fifth backs the root up
      const score = cov * 3 + tonic - 0.012 * sc.pcs.length;
      if (!best || score > best.score) best = { id: sc.id, root, score, cov };
    }
  }
  return best;
}
