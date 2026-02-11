/**
 * Shared utilities for the trading CLI.
 */

const UA = 'kalshi-trading/3.0 (multi-strategy trading platform)';

export function cToF(c) { return c * 9 / 5 + 32; }
export function fToC(f) { return (f - 32) * 5 / 9; }
export function round1(n) { return Math.round(n * 10) / 10; }
export function round2(n) { return Math.round(n * 100) / 100; }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function fetchJSON(url, headers = {}, { retries = 2, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        // Rate limited — exponential backoff
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30000);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        throw new Error(`${url} → 429 Rate Limited (after ${retries + 1} attempts)`);
      }
      if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
      return res.json();
    } catch (e) {
      if (attempt === retries) throw e;
      const backoff = 1000 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

/** Format a number with sign prefix */
export function signed(n, decimals = 1) {
  const s = n.toFixed(decimals);
  return n >= 0 ? `+${s}` : s;
}

/** Simple table formatting — array of objects to aligned columns */
export function table(rows, columns) {
  if (rows.length === 0) return '  (no data)';
  const lines = [];
  lines.push(columns.map(c => c.label.padEnd(c.width)).join(' '));
  lines.push(columns.map(c => '─'.repeat(c.width)).join(' '));
  for (const row of rows) {
    lines.push(columns.map(c => {
      const val = String(c.fn ? c.fn(row) : row[c.key] ?? '');
      return c.align === 'right' ? val.padStart(c.width) : val.padEnd(c.width);
    }).join(' '));
  }
  return lines.map(l => '  ' + l).join('\n');
}

/** Get today's date as YYYY-MM-DD */
export function today() { return new Date().toISOString().slice(0, 10); }

/** Get yesterday's date as YYYY-MM-DD */
export function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD to Date */
export function parseDate(s) { return new Date(s + 'T12:00:00Z'); }

/** Iterate dates from start to end (inclusive), yielding YYYY-MM-DD strings */
export function* dateRange(start, end) {
  const d = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  while (d <= e) {
    yield d.toISOString().slice(0, 10);
    d.setDate(d.getDate() + 1);
  }
}

/** Parse a YYYY-MM-DD date from CLI args, defaulting to today */
export function parseDateArg(args) {
  return args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || today();
}

/** P(high >= threshold) using Student-t distribution (nu=5 for fat tails) */
export function probAboveThreshold(forecastHigh, threshold, sigma, { nu = 5 } = {}) {
  const z = (forecastHigh - threshold) / sigma;
  return studentTCDF(z, nu);
}

/** P(high in [lo, hi)) for bracket markets using Student-t */
export function probInBracket(forecastHigh, bracketLow, bracketHigh, sigma, { nu = 5 } = {}) {
  return studentTCDF((forecastHigh - bracketLow) / sigma, nu) - studentTCDF((forecastHigh - bracketHigh) / sigma, nu);
}

/**
 * Student-t CDF approximation using regularized incomplete beta function.
 * Used for fat-tail probability estimation (weather forecast errors aren't perfectly Gaussian).
 * @param {number} z - z-score
 * @param {number} nu - degrees of freedom (nu=5 gives ~5% heavier tails than normal)
 */
export function studentTCDF(z, nu = 5) {
  // Use the relationship: T_CDF(z, nu) = 1 - 0.5 * I_x(nu/2, 0.5) where x = nu/(nu + z^2)
  const x = nu / (nu + z * z);
  const half = 0.5 * regBetaI(x, nu / 2, 0.5);
  return z >= 0 ? 1 - half : half;
}

/** Regularized incomplete beta function via continued fraction (Lentz) */
function regBetaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;
  // Lentz continued fraction
  let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;
  for (let m = 1; m <= 200; m++) {
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = d * c; f *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return front * f;
}

/** Log-gamma via Lanczos approximation */
export function lnGamma(z) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Standard normal CDF approximation */
export function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}
