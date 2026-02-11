/**
 * Precipitation uncertainty modeling.
 * 
 * CRITICAL STATISTICAL DIFFERENCES FROM TEMPERATURE:
 * 
 * 1. Daily rain is binary → use calibrated probability, not normal distribution
 * 2. Monthly totals are zero-inflated, right-skewed → use Gamma distribution, NOT normal
 * 3. Forecast uncertainty grows faster for precip than temp (chaotic convection)
 * 4. Model agreement matters more (ensemble spread is signal)
 * 
 * Two probability models:
 * - Daily binary: logistic calibration of forecast PoP → true P(rain)
 * - Monthly total: Gamma CDF for P(total > threshold) with Bayesian updating
 */

import { PRECIP_STATIONS, getClimMonthly } from './stations.js';
import { round2 } from '../core/utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY BINARY MODEL: Calibrated PoP → True P(rain)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calibrate a raw rain probability forecast.
 * 
 * NWS PoP forecasts are already well-calibrated (their core product), but
 * GFS/ECMWF model output needs adjustment. We use Platt scaling (logistic
 * calibration) — the standard approach for binary probability calibration.
 * 
 * The calibration function maps: rawPoP → calibratedPoP
 * using: calibrated = 1 / (1 + exp(-(a * rawPoP + b)))
 * 
 * Default coefficients from literature on NWS PoP verification:
 * - NWS forecasts: nearly identity (a≈4.5, b≈-2.25) — already well-calibrated
 * - GFS raw: slight overforecast of light rain (a≈3.5, b≈-1.8)
 * - ECMWF raw: similar bias (a≈3.8, b≈-2.0)
 * 
 * @param {number} rawProb — raw probability (0-1)
 * @param {string} source — 'NWS', 'GFS', or 'ECMWF'
 * @param {number} horizonDays — forecast lead time
 * @returns {number} calibrated probability (0-1)
 */
export function calibrateDailyRainProb(rawProb, source = 'NWS', horizonDays = 0) {
  if (rawProb == null) return null;
  
  // Clamp input
  const p = Math.max(0, Math.min(1, rawProb));
  
  // NWS PoP is already well-calibrated for day 0-2; just apply horizon decay
  if (source === 'NWS') {
    // NWS calibration is tight for short range; widen toward climatology at longer range
    const horizonDecay = Math.min(horizonDays * 0.03, 0.15); // max 15% shrinkage
    return round2(p * (1 - horizonDecay) + 0.33 * horizonDecay); // blend toward climatology
  }
  
  // GFS/ECMWF: Platt scaling coefficients
  // These correct the known overforecasting of light precipitation
  const coeffs = source === 'ECMWF'
    ? { a: 3.8, b: -2.0 }
    : { a: 3.5, b: -1.8 }; // GFS default
  
  const logit = coeffs.a * p + coeffs.b;
  let calibrated = 1 / (1 + Math.exp(-logit));
  
  // Horizon degradation: forecast skill decays with lead time
  // Blend toward climatology as horizon increases
  const horizonBlend = Math.min(horizonDays * 0.05, 0.30);
  calibrated = calibrated * (1 - horizonBlend) + 0.33 * horizonBlend;
  
  return round2(Math.max(0.01, Math.min(0.99, calibrated)));
}

/**
 * Compute ensemble-calibrated daily rain probability.
 * Combines multiple model forecasts with inverse-Brier-score weighting.
 * 
 * @param {Object} consensus — from buildPrecipConsensus
 * @param {string} stationKey
 * @returns {{ prob: number, uncertainty: number, confidence: string }}
 */
export function ensembleDailyRainProb(consensus, stationKey) {
  if (!consensus?.rainProb) {
    return { prob: null, uncertainty: 1.0, confidence: 'NONE' };
  }
  
  const sources = consensus.sources || [];
  if (sources.length === 0) {
    return { prob: consensus.rainProb, uncertainty: 0.3, confidence: 'LOW' };
  }
  
  // Calibrate each source
  const calibrated = sources.map(s => ({
    ...s,
    calibratedProb: calibrateDailyRainProb(s.prob, s.source, consensus.horizonDays || 0),
  }));
  
  // Weighted mean of calibrated probabilities
  let weightedSum = 0, totalWeight = 0;
  for (const s of calibrated) {
    if (s.calibratedProb != null) {
      weightedSum += s.calibratedProb * s.weight;
      totalWeight += s.weight;
    }
  }
  const prob = totalWeight > 0 ? round2(weightedSum / totalWeight) : consensus.rainProb;
  
  // Uncertainty from model spread (Bayesian: wider spread = more uncertain)
  const probSpread = consensus.probSpread || 0;
  const uncertainty = round2(Math.min(0.5, probSpread * 0.5 + 0.05));
  
  // Confidence classification
  let confidence;
  if (probSpread < 0.10 && sources.length >= 2) confidence = 'HIGH';
  else if (probSpread < 0.25) confidence = 'MODERATE';
  else confidence = 'LOW';
  
  return {
    prob: Math.max(0.01, Math.min(0.99, prob)),
    uncertainty,
    confidence,
    calibratedSources: calibrated,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY TOTAL MODEL: Gamma Distribution
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fit Gamma distribution parameters from month-to-date observations + forecast.
 * 
 * The Gamma distribution is the standard model for monthly precipitation because:
 * 1. It's non-negative (rain can't be negative)
 * 2. It's right-skewed (occasional very wet months)
 * 3. It has two parameters (shape α, rate β) that map to mean/variance
 * 4. It naturally handles the zero-inflation via P(X=0) in mixed models
 * 
 * We use a Bayesian approach:
 * - Prior: climatological mean and variance for this month
 * - Update: month-to-date actual precipitation narrows the posterior
 * - Forecast: remaining days' expected precip added to posterior mean
 * 
 * @param {Object} params
 * @param {number} params.climMean — climatological monthly mean (inches)
 * @param {number} params.climStd — climatological monthly std dev (inches)
 * @param {number} params.mtdActual — month-to-date actual precipitation (inches)
 * @param {number} params.mtdDays — days elapsed in month
 * @param {number} params.totalDays — total days in month
 * @param {number} params.forecastRemaining — forecast precipitation for remaining days (inches)
 * @param {number} params.forecastUncertainty — uncertainty in remaining forecast (std dev, inches)
 * @returns {{ alpha: number, beta: number, mean: number, variance: number }}
 */
export function fitGammaParams({ climMean, climStd, mtdActual = 0, mtdDays = 0, totalDays = 28, forecastRemaining = null, forecastUncertainty = null }) {
  // Prior from climatology
  const climVariance = climStd * climStd;
  
  if (mtdDays === 0 && forecastRemaining == null) {
    // Pure climatological prior
    const alpha = (climMean * climMean) / climVariance;
    const beta = climMean / climVariance;
    return { alpha, beta, mean: climMean, variance: climVariance };
  }
  
  // Posterior: condition on month-to-date actual + forecast for remainder
  const fractionElapsed = mtdDays / totalDays;
  
  // Expected total = actual so far + expected remaining
  let expectedRemaining;
  let remainingUncertainty;
  
  if (forecastRemaining != null) {
    // We have a model forecast for remaining days
    expectedRemaining = forecastRemaining;
    remainingUncertainty = forecastUncertainty ?? (forecastRemaining * 0.5); // 50% uncertainty default
  } else {
    // No forecast — use climatological proportion for remaining days
    expectedRemaining = climMean * (1 - fractionElapsed);
    remainingUncertainty = climStd * Math.sqrt(1 - fractionElapsed);
  }
  
  const posteriorMean = mtdActual + expectedRemaining;
  // Variance shrinks: actual part has 0 variance, only remaining part is uncertain
  const posteriorVariance = remainingUncertainty * remainingUncertainty;
  
  // Convert to Gamma parameters
  // α = mean² / variance, β = mean / variance  
  // Guard against zero/negative variance
  const safeVariance = Math.max(posteriorVariance, 0.01);
  const safeMean = Math.max(posteriorMean, 0.01);
  
  const alpha = (safeMean * safeMean) / safeVariance;
  const beta = safeMean / safeVariance;
  
  return {
    alpha: round2(alpha),
    beta: round2(beta),
    mean: round2(posteriorMean),
    variance: round2(posteriorVariance),
    mtdActual: round2(mtdActual),
    expectedRemaining: round2(expectedRemaining),
  };
}

/**
 * P(monthly total > threshold) using Gamma CDF.
 * This is the core probability function for monthly threshold markets.
 * 
 * Uses the regularized incomplete gamma function for the CDF:
 * P(X > t) = 1 - Γ(α, β*t) / Γ(α)
 * 
 * @param {number} threshold — threshold in inches
 * @param {number} alpha — Gamma shape parameter
 * @param {number} beta — Gamma rate parameter
 * @returns {number} P(total > threshold)
 */
export function gammaSurvival(threshold, alpha, beta) {
  if (threshold <= 0) return 1.0;
  if (alpha <= 0 || beta <= 0) return 0.5; // degenerate case
  
  const x = beta * threshold;
  const cdf = regularizedGammaP(alpha, x);
  return round2(Math.max(0.001, Math.min(0.999, 1 - cdf)));
}

/**
 * Regularized lower incomplete gamma function P(a, x) = γ(a,x) / Γ(a)
 * Uses series expansion for x < a+1, continued fraction otherwise.
 */
function regularizedGammaP(a, x) {
  if (x < 0) return 0;
  if (x === 0) return 0;
  
  if (x < a + 1) {
    // Series expansion
    return gammaSeriesP(a, x);
  } else {
    // Continued fraction (complement is more stable)
    return 1 - gammaCFQ(a, x);
  }
}

/** Series expansion for regularized lower incomplete gamma P(a, x) */
function gammaSeriesP(a, x) {
  const lnGammaA = lnGamma(a);
  let sum = 1 / a;
  let term = 1 / a;
  
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
  }
  
  return sum * Math.exp(-x + a * Math.log(x) - lnGammaA);
}

/** Continued fraction for regularized upper incomplete gamma Q(a, x) = 1 - P(a, x) */
function gammaCFQ(a, x) {
  const lnGammaA = lnGamma(a);
  
  // Lentz's algorithm
  let f = 1e-30;
  let c = 1e-30;
  let d = x + 1 - a;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;
  
  for (let n = 1; n < 200; n++) {
    const an = n * (a - n);
    const bn = x + 2 * n + 1 - a;
    
    d = bn + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    
    c = bn + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    
    const delta = d * c;
    f *= delta;
    
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  
  return f * Math.exp(-x + a * Math.log(x) - lnGammaA);
}

/** Log-gamma via Lanczos approximation (copied from core/utils.js pattern) */
function lnGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNCERTAINTY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze ensemble uncertainty for precipitation forecast.
 * @param {Object} forecast — from precipForecast()
 * @param {string} stationKey
 * @returns {Object} uncertainty analysis
 */
export function analyzePrecipUncertainty(forecast, stationKey) {
  const s = PRECIP_STATIONS[stationKey];
  const c = forecast.consensus;
  
  if (!c?.tradeable) {
    return { level: 'UNKNOWN', tradeable: false, reason: c?.reason || 'No data' };
  }
  
  const isDaily = s?.marketType === 'daily_binary';
  
  if (isDaily) {
    const ensemble = ensembleDailyRainProb(c, stationKey);
    return {
      level: ensemble.confidence,
      tradeable: true,
      calibratedProb: ensemble.prob,
      uncertainty: ensemble.uncertainty,
      probSpread: c.probSpread,
      type: 'daily_binary',
    };
  }
  
  // Monthly: use amount spread as uncertainty indicator
  return {
    level: c.amountSpread < 0.2 ? 'HIGH' : c.amountSpread < 0.5 ? 'MODERATE' : 'LOW',
    tradeable: true,
    precipAmount: c.precipAmount,
    amountSpread: c.amountSpread,
    type: 'monthly_threshold',
  };
}
