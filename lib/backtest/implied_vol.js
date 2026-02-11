/**
 * Implied volatility analysis for Kalshi temperature contracts.
 * 
 * Given a market price for "high temp >= T" and a forecast mean,
 * back out the σ the market is implicitly pricing.
 * 
 * P(X >= T) = 1 - Φ((T - μ) / σ)
 * marketPrice = 1 - Φ((T - μ) / σ)
 * Φ⁻¹(1 - marketPrice) = (T - μ) / σ
 * σ = (T - μ) / Φ⁻¹(1 - marketPrice)
 */

import { normalCDF } from '../core/utils.js';

/**
 * Inverse normal CDF (probit function) via rational approximation.
 * Abramowitz & Stegun 26.2.23, accurate to ~4.5e-4.
 */
export function normalInvCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  
  // Rational approximation
  const a = [
    -3.969683028665376e1, 2.209460984245205e2,
    -2.759285104469687e2, 1.383577518672690e2,
    -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2,
    -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838e0, -2.549732539343734e0,
    4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996e0, 3.754408661907416e0,
  ];
  
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;
  
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/**
 * Back out implied σ from a single contract price.
 * @param {number} forecastMean - our forecast mean temperature
 * @param {number} threshold - the strike (e.g., "high >= 75°F")
 * @param {number} marketPrice - market probability (0-1)
 * @returns {number|null} implied σ, or null if undefined
 */
export function impliedSigma(forecastMean, threshold, marketPrice) {
  // P(X >= T) = marketPrice
  // 1 - Φ((T - μ) / σ) = marketPrice
  // Φ((T - μ) / σ) = 1 - marketPrice
  // (T - μ) / σ = Φ⁻¹(1 - marketPrice)
  // σ = (T - μ) / Φ⁻¹(1 - marketPrice)
  
  const z = normalInvCDF(1 - marketPrice);
  if (Math.abs(z) < 0.01) return null; // market price ~50%, σ undefined (T ≈ μ)
  
  const sigma = (threshold - forecastMean) / z;
  if (sigma <= 0 || sigma > 20) return null; // nonsensical
  return sigma;
}

/**
 * Analyze implied σ across multiple contracts for a given day.
 * Uses multiple thresholds to get a more robust estimate.
 * @param {number} forecastMean
 * @param {Array<{threshold: number, marketPrice: number}>} contracts
 * @returns {{meanImpliedSigma: number, medianImpliedSigma: number, samples: Array}}
 */
export function analyzeImpliedVol(forecastMean, contracts) {
  const samples = [];
  for (const c of contracts) {
    const sigma = impliedSigma(forecastMean, c.threshold, c.marketPrice);
    if (sigma !== null) {
      samples.push({ threshold: c.threshold, marketPrice: c.marketPrice, impliedSigma: Math.round(sigma * 100) / 100 });
    }
  }
  
  if (!samples.length) return { meanImpliedSigma: null, medianImpliedSigma: null, samples: [] };
  
  const sigmas = samples.map(s => s.impliedSigma).sort((a, b) => a - b);
  const mean = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
  const median = sigmas[Math.floor(sigmas.length / 2)];
  
  return {
    meanImpliedSigma: Math.round(mean * 100) / 100,
    medianImpliedSigma: median,
    samples,
  };
}

/**
 * Estimate required market inefficiency for profitability.
 * Given our σ and transaction costs, what σ must the market be using
 * for us to have positive expected value?
 * 
 * Edge = |P_ours - P_market|
 * For edge > cost, we need sufficient σ gap.
 */
export function requiredMarketSigma(ourSigma, transactionCostPerContract, avgThresholdDistance = 3) {
  // At a threshold distance d from forecast mean:
  // P_ours = 1 - Φ(d / σ_ours)
  // P_market = 1 - Φ(d / σ_market)
  // edge = P_ours - P_market > cost
  // 
  // Solve for σ_market given cost
  const d = avgThresholdDistance;
  const pOurs = 1 - normalCDF(d / ourSigma);
  const pTarget = pOurs - transactionCostPerContract; // need market to price at least this much lower
  
  if (pTarget <= 0 || pTarget >= 1) return null;
  
  const zTarget = normalInvCDF(1 - pTarget);
  if (Math.abs(zTarget) < 0.01) return null;
  
  const sigmaMarket = d / zTarget;
  return sigmaMarket > 0 ? Math.round(sigmaMarket * 100) / 100 : null;
}
