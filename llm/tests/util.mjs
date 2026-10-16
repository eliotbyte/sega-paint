// Helpers of the checks.
import { power, db } from '../dsp.mjs';

// Mean difference (dB) of 24 log bands over 2048-sample frames, bands quieter than -20 dB in both skipped
// (the comparison of tools/verify2.mjs / vgm_export.mjs).
export function bandDiff(a, b) {
  const N = 2048, B = 24;
  const bands = (x, at) => {
    const p = power(x, at, N), e = new Float64Array(B);
    for (let k = 1; k < N / 2; k++) e[Math.min(B - 1, Math.floor(Math.log2(k) * B / Math.log2(N / 2)))] += p[k];
    return Array.from(e, (v) => db(v + 1e-9, -90));
  };
  let tot = 0, n = 0;
  for (let s = 0; s + N <= Math.min(a.length, b.length); s += N) {
    const A = bands(a, s), Bb = bands(b, s);
    let d = 0, w = 0;
    for (let k = 0; k < B; k++) { if (Math.max(A[k], Bb[k]) < -20) continue; d += Math.abs(A[k] - Bb[k]); w++; }
    if (w) { tot += d / w; n++; }
  }
  return n ? tot / n : 0;
}
export const maxDiff = (a, b) => { let m = a.length === b.length ? 0 : Infinity; for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
