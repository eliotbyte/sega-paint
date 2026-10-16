// Signal analysis without dependencies: FFT, spectra, levels.

// In-place radix-2 FFT of re / im (length a power of two).
export function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const u = i + k, v = u + h;
        const xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const hanns = new Map();
export function hann(N) {
  if (!hanns.has(N)) hanns.set(N, Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)));
  return hanns.get(N);
}
// Power spectrum (N/2 bins) of x[at .. at+N), Hann window; outside the signal counts as silence.
export function power(x, at, N) {
  const re = new Float64Array(N), im = new Float64Array(N), w = hann(N);
  for (let i = 0; i < N; i++) { const j = at + i; re[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0; }
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
export const db = (x, floor = -120) => (x > 0 ? Math.max(floor, 10 * Math.log10(x)) : floor); // of a power
export const dbAmp = (x, floor = -120) => (x > 0 ? Math.max(floor, 20 * Math.log10(x)) : floor);

// Spectral centroid (Hz) of a power spectrum.
export function centroid(p, rate) {
  let s = 0, w = 0;
  for (let k = 1; k < p.length; k++) { s += p[k] * k; w += p[k]; }
  return w > 0 ? s / w * rate / (2 * p.length) : 0;
}
// RMS of x[a..b)
export function rms(x, a = 0, b = x.length) {
  let s = 0;
  a = Math.max(0, a); b = Math.min(x.length, b);
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return b > a ? Math.sqrt(s / (b - a)) : 0;
}
export function peak(x, a = 0, b = x.length) {
  let m = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
  return m;
}
