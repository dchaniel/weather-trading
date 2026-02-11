/**
 * Crypto price prediction models.
 * GARCH-like vol, Student-t fat tails, momentum adjustments.
 * 
 * Strategy maturity: PAPER-ONLY — pending live validation.
 */

import { round2, normalCDF, studentTCDF } from '../core/utils.js';

/**
 * Detect average period between data points in hours.
 */
function detectFrequencyHours(prices) {
  if (prices.length < 2) return 24;
  const diffs = [];
  for (let i = 1; i < Math.min(prices.length, 20); i++) {
    const dt = prices[i].timestamp - prices[i - 1].timestamp;
    if (dt > 0) diffs.push(dt / (1000 * 60 * 60)); // ms to hours
  }
  if (diffs.length === 0) return 24;
  const median = diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  return Math.max(0.5, median);
}

/**
 * GARCH(1,1)-like volatility estimation.
 * Automatically detects data frequency and annualizes correctly.
 * σ²_t = ω + α·r²_{t-1} + β·σ²_{t-1}
 */
export function garchVolatility(prices, window = 30) {
  if (prices.length < 5) return 0;
  const slice = prices.slice(-Math.max(window * 6, 30)); // more points for sub-daily data
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].price > 0) {
      returns.push(Math.log(slice[i].price / slice[i - 1].price));
    }
  }
  if (returns.length < 5) return 0;

  // Detect frequency: periods per year
  const freqHours = detectFrequencyHours(prices.slice(-Math.min(prices.length, 50)));
  const periodsPerYear = (365 * 24) / freqHours;

  // Long-run variance (sample variance of all returns)
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const longRunVar = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);

  // GARCH parameter estimation via method-of-moments (Bollerslev 1986 approx)
  // Estimate α from kurtosis of returns, β from autocorrelation of squared returns
  let alpha, beta;
  if (returns.length >= 50) {
    // Autocorrelation of squared residuals at lag 1
    const sqResid = returns.map(r => (r - mean) ** 2);
    const sqMean = sqResid.reduce((a, b) => a + b, 0) / sqResid.length;
    let num = 0, den = 0;
    for (let i = 1; i < sqResid.length; i++) {
      num += (sqResid[i] - sqMean) * (sqResid[i - 1] - sqMean);
      den += (sqResid[i] - sqMean) ** 2;
    }
    const rho1 = den > 0 ? num / den : 0;
    // Method-of-moments: α + β ≈ ρ₁(ε²), with α constrained to [0.02, 0.15]
    const persistence = Math.max(0.5, Math.min(0.98, rho1));
    alpha = Math.max(0.02, Math.min(0.15, persistence * 0.1));
    beta = Math.max(0.5, Math.min(0.95, persistence - alpha));
  } else {
    // Fallback: conservative defaults for small samples
    alpha = 0.05;
    beta = 0.90;
  }
  const omega = (1 - alpha - beta) * longRunVar;
  
  // Sanity check: if alpha + beta >= 1, vol explodes (non-stationary)
  if (alpha + beta >= 0.99) {
    console.warn(`Warning: GARCH parameters sum to ${(alpha + beta).toFixed(3)} - near unit root, using fallback vol`);
    return Math.sqrt(longRunVar * periodsPerYear);
  }

  // Initialize with sample variance
  let sigma2 = longRunVar;
  for (let i = 0; i < returns.length; i++) {
    sigma2 = omega + alpha * (returns[i] - mean) ** 2 + beta * sigma2;
  }

  // Annualize using correct frequency
  const annualVol = Math.sqrt(sigma2 * periodsPerYear);
  
  // Cap at reasonable levels: crypto rarely exceeds 200% annualized vol
  const MAX_CRYPTO_VOL = 2.0; // 200%
  const MIN_CRYPTO_VOL = 0.1; // 10%
  
  return Math.max(MIN_CRYPTO_VOL, Math.min(MAX_CRYPTO_VOL, annualVol));
}

/**
 * Simple realized volatility for comparison.
 * Auto-detects data frequency for correct annualization.
 */
export function realizedVolatility(prices, window = 30) {
  if (prices.length < 2) return 0;
  const slice = prices.slice(-window * 6); // more points for sub-daily
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].price > 0) {
      returns.push(Math.log(slice[i].price / slice[i - 1].price));
    }
  }
  if (returns.length < 2) return 0;
  const freqHours = detectFrequencyHours(prices.slice(-Math.min(prices.length, 50)));
  const periodsPerYear = (365 * 24) / freqHours;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const annualVol = Math.sqrt(variance * periodsPerYear);
  
  // Apply same caps as GARCH
  const MAX_CRYPTO_VOL = 2.0; // 200%
  const MIN_CRYPTO_VOL = 0.1; // 10%
  
  return Math.max(MIN_CRYPTO_VOL, Math.min(MAX_CRYPTO_VOL, annualVol));
}

/**
 * Estimate excess kurtosis from return series.
 * Crypto typically has kurtosis 5-15 (vs 0 for normal).
 */
export function excessKurtosis(prices, window = 30) {
  if (prices.length < 10) return 3; // default to mild fat tails
  const slice = prices.slice(-window);
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].price > 0) {
      returns.push(Math.log(slice[i].price / slice[i - 1].price));
    }
  }
  if (returns.length < 10) return 3;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const m2 = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const m4 = returns.reduce((s, r) => s + (r - mean) ** 4, 0) / returns.length;
  if (m2 === 0) return 0;
  return (m4 / (m2 * m2)) - 3; // excess kurtosis
}

/**
 * Student-t CDF approximation via normal CDF with tail correction.
 * For df degrees of freedom, we approximate:
 *   P(T < x) ≈ Φ(x * g(x))
 * where g adjusts for fat tails.
 *
 * Uses the Cornish-Fisher expansion to map Student-t quantiles
 * back to normal quantiles, accounting for kurtosis.
 */
// Shared Student-t CDF imported from core/utils.js

/**
 * Degrees of freedom for Student-t from excess kurtosis.
 * For Student-t: kurtosis = 6/(df-4) for df>4, so df = 6/kurtosis + 4
 * Clamp to [4, 100].
 */
function kurtosisToDF(exKurt) {
  if (exKurt <= 0.5) return 100; // normal or thinner-than-normal tails
  const df = 6 / exKurt + 4;
  return Math.max(4.1, Math.min(100, df));
}

/**
 * RSI
 */
export function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const slice = prices.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const change = slice[i].price - slice[i - 1].price;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return round2(100 - 100 / (1 + rs));
}

/**
 * Bollinger Bands position.
 */
export function bollingerBands(prices, period = 20, numStdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const closes = slice.map(p => p.price);
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const stdDev = Math.sqrt(closes.reduce((s, p) => s + (p - mean) ** 2, 0) / closes.length);
  const upper = mean + numStdDev * stdDev;
  const lower = mean - numStdDev * stdDev;
  const current = closes[closes.length - 1];
  const pctB = stdDev > 0 ? (current - lower) / (upper - lower) : 0.5;
  return { upper: round2(upper), middle: round2(mean), lower: round2(lower), pctB: round2(pctB) };
}

/**
 * MA crossover signal.
 */
export function movingAverageCrossover(prices) {
  if (prices.length < 30) return { sma7: null, sma30: null, signal: 'neutral' };
  const sma = (arr, n) => arr.slice(-n).reduce((s, p) => s + p.price, 0) / n;
  const sma7 = round2(sma(prices, 7));
  const sma30 = round2(sma(prices, 30));
  const signal = sma7 > sma30 * 1.005 ? 'bullish' : sma7 < sma30 * 0.995 ? 'bearish' : 'neutral';
  return { sma7, sma30, signal };
}

/**
 * Compute momentum-based drift adjustment.
 * Returns a small annual drift term based on technical signals.
 * Capped at ±15% annualized to avoid overconfidence.
 */
export function momentumDrift(signals) {
  let drift = 0;

  // RSI mean-reversion: extreme RSI suggests reversion
  if (signals.rsi > 75) drift -= 0.10;
  else if (signals.rsi > 65) drift -= 0.04;
  else if (signals.rsi < 25) drift += 0.10;
  else if (signals.rsi < 35) drift += 0.04;

  // Bollinger band mean-reversion
  if (signals.bollinger) {
    if (signals.bollinger.pctB > 1.1) drift -= 0.06;
    else if (signals.bollinger.pctB > 0.9) drift -= 0.02;
    else if (signals.bollinger.pctB < -0.1) drift += 0.06;
    else if (signals.bollinger.pctB < 0.1) drift += 0.02;
  }

  // MA crossover momentum (trend-following, smaller weight)
  if (signals.maCrossover.signal === 'bullish') drift += 0.03;
  else if (signals.maCrossover.signal === 'bearish') drift -= 0.03;

  // Cap at ±15% annualized
  return Math.max(-0.15, Math.min(0.15, drift));
}

/**
 * Estimate probability that price will be above threshold at expiry.
 * Uses Student-t distribution to account for fat tails.
 *
 * @param {number} currentPrice — current spot price
 * @param {number} threshold — strike price
 * @param {number} annualVol — GARCH-estimated annualized vol
 * @param {number} daysToExpiry — days until settlement (can be fractional)
 * @param {number} drift — annualized drift from momentum signals
 * @param {number} exKurt — excess kurtosis of returns
 * @returns {number} probability 0-1
 */
export function cryptoProbAbove(currentPrice, threshold, annualVol, daysToExpiry, drift = 0, exKurt = 3) {
  if (currentPrice <= 0 || threshold <= 0 || annualVol <= 0 || daysToExpiry <= 0) return 0.5;

  const t = daysToExpiry / 365;
  const logRatio = Math.log(currentPrice / threshold);
  const mu = (drift - annualVol ** 2 / 2) * t;
  const sigma = annualVol * Math.sqrt(t);

  if (sigma < 1e-10) return currentPrice >= threshold ? 1 : 0;

  const z = (logRatio + mu) / sigma;

  // Use Student-t if we have meaningful kurtosis
  const df = kurtosisToDF(Math.max(0, exKurt));
  if (df < 80) {
    return studentTCDF(z, df);
  }
  return normalCDF(z);
}

/**
 * Generate full forecast signals for a coin.
 */
export function generateSignals(history) {
  if (!history.length) return null;

  const current = history[history.length - 1].price;
  const vol7d = garchVolatility(history, 7);
  const vol30d = garchVolatility(history, 30);
  const realVol7d = realizedVolatility(history, 7);
  const realVol30d = realizedVolatility(history, 30);
  const rsi = computeRSI(history);
  const bollinger = bollingerBands(history);
  const maCrossover = movingAverageCrossover(history);
  const exKurt = excessKurtosis(history, 30);

  const signals = [];
  if (rsi > 70) signals.push('overbought');
  else if (rsi < 30) signals.push('oversold');
  if (bollinger && bollinger.pctB > 1) signals.push('above upper band');
  else if (bollinger && bollinger.pctB < 0) signals.push('below lower band');
  if (maCrossover.signal === 'bullish') signals.push('MA bullish crossover');
  else if (maCrossover.signal === 'bearish') signals.push('MA bearish crossover');

  const signalData = {
    currentPrice: round2(current),
    vol7d: round2(vol7d),
    vol30d: round2(vol30d),
    realVol7d: round2(realVol7d),
    realVol30d: round2(realVol30d),
    excessKurtosis: round2(exKurt),
    rsi,
    bollinger,
    maCrossover,
    signals,
    sentiment: signals.some(s => s.includes('oversold') || s.includes('below') || s.includes('bullish'))
      ? 'bullish'
      : signals.some(s => s.includes('overbought') || s.includes('above') || s.includes('bearish'))
        ? 'bearish'
        : 'neutral',
  };

  // Pre-compute drift for use in probability calculations
  signalData.drift = momentumDrift(signalData);

  return signalData;
}
