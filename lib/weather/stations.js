/**
 * Settlement station metadata.
 * All temperatures in °F. Climatological normals are monthly averages.
 * 
 * Station-specific sigma derived from backtest MAE + safety margin.
 * Season adjustments: winter months (Nov-Mar) get +0.5°F sigma bump.
 */

export const STATIONS = {
  KNYC: {
    name: 'Central Park, NYC',
    city: 'NY',
    lat: 40.7789,
    lon: -73.9692,
    nwsOffice: 'OKX',
    nwsGridX: 33,
    nwsGridY: 37,
    observationStation: 'KNYC',
    kalshiTicker: 'KXHIGHNY',
    kalshiTickerLow: 'KXLOWTNYC',
    kalshiCity: 'NY',
    climNormalHigh: { 1: 39, 2: 40, 3: 48, 4: 62, 5: 72, 6: 80, 7: 85, 8: 84, 9: 77, 10: 65, 11: 54, 12: 42 },
    climNormalLow:  { 1: 27, 2: 28, 3: 35, 4: 45, 5: 55, 6: 65, 7: 70, 8: 69, 9: 62, 10: 51, 11: 42, 12: 32 },
    bias: -1,
    // VALIDATED Feb 9, 2026: actual MAE=0.76°F, recommended winter σ=0.84°F (30 obs)
    // Bayesian σ updating implemented: baseSigma is prior from N=30 calibration.
    // As runningMAE/runningN accumulate, getEffectiveSigma() uses bayesianSigmaUpdate()
    // to shrink toward observed performance. CI [0.74, 0.94] narrows with data.
    baseSigma: 0.84,
    baseSigmaLow: 0.90,  // Low temps slightly harder to forecast (radiative cooling variability)
    ecmwfMAE: 0.75,  // Estimated from calibration performance
    gfsMAE: 0.8,     // Estimated from calibration performance
    tier: 'A',  // VALIDATED edge: market σ often >3.5°F, our σ=0.85°F → strong edge potential
  },
  KMDW: {
    name: 'Chicago Midway',
    city: 'CHI',
    lat: 41.7861,
    lon: -87.7522,
    nwsOffice: 'LOT',
    nwsGridX: 75,
    nwsGridY: 68,
    observationStation: 'KMDW',
    kalshiTicker: 'KXHIGHCHI',
    kalshiTickerLow: 'KXLOWTCHI',
    kalshiCity: 'CHI',
    climNormalHigh: { 1: 32, 2: 36, 3: 47, 4: 59, 5: 70, 6: 80, 7: 84, 8: 82, 9: 75, 10: 62, 11: 48, 12: 35 },
    climNormalLow:  { 1: 19, 2: 23, 3: 32, 4: 42, 5: 52, 6: 63, 7: 68, 8: 67, 9: 59, 10: 47, 11: 35, 12: 23 },
    bias: +2,
    // CORRECTED Feb 9, 2026: actual MAE=2.77°F → recommended winter σ=3.05°F (NO EDGE vs market σ~3.0°F)
    baseSigma: 3.05,
    baseSigmaLow: 3.20,  // Low temps even worse at KMDW
    ecmwfMAE: 2.7,  // Corrected based on actual performance
    gfsMAE: 2.9,    // Corrected based on actual performance  
    tier: 'F',  // FAILED - no tradeable edge, errors too high
    enabled: false, // Disabled: MAE=2.56°F, no edge after costs. Kept for observation/recalibration.
  },
  KMIA: {
    name: 'Miami International',
    city: 'MIA',
    lat: 25.7959,
    lon: -80.2870,
    nwsOffice: 'MFL',
    nwsGridX: 109,
    nwsGridY: 50,
    observationStation: 'KMIA',
    kalshiTicker: 'KXHIGHMIA',
    kalshiTickerLow: 'KXLOWTMIA',
    kalshiCity: 'MIA',
    climNormalHigh: { 1: 77, 2: 78, 3: 80, 4: 83, 5: 87, 6: 90, 7: 91, 8: 91, 9: 90, 10: 86, 11: 82, 12: 78 },
    climNormalLow:  { 1: 61, 2: 62, 3: 65, 4: 68, 5: 73, 6: 76, 7: 77, 8: 77, 9: 76, 10: 73, 11: 67, 12: 63 },
    bias: 0,
    // VALIDATED Feb 9, 2026: actual MAE=0.7°F → baseSigma=0.78°F (MAE × 1.1) (30 obs)
    baseSigma: 0.78,
    baseSigmaLow: 0.82,  // Miami lows are stable (tropical) but slightly more variable than highs
    ecmwfMAE: 0.65,  // Estimated from calibration performance  
    gfsMAE: 0.75,    // Estimated from calibration performance
    tier: 'A',  // Strong edge potential: tropical stability → tight forecasts
  },
  KDEN: {
    name: 'Denver International',
    city: 'DEN',
    lat: 39.8561,
    lon: -104.6737,
    nwsOffice: 'BOU',
    nwsGridX: 62,
    nwsGridY: 60,
    observationStation: 'KDEN',
    kalshiTicker: 'KXHIGHDEN',
    kalshiTickerLow: 'KXLOWTDEN',
    kalshiCity: 'DEN',
    climNormalHigh: { 1: 44, 2: 45, 3: 53, 4: 60, 5: 69, 6: 81, 7: 88, 8: 86, 9: 77, 10: 64, 11: 52, 12: 43 },
    climNormalLow:  { 1: 17, 2: 19, 3: 26, 4: 34, 5: 43, 6: 52, 7: 58, 8: 56, 9: 47, 10: 35, 11: 25, 12: 17 },
    bias: 0,
    // VALIDATED Feb 9, 2026: actual MAE=0.84°F, recommended winter σ=0.92°F (30 obs)
    baseSigma: 0.92,
    baseSigmaLow: 1.05,  // Denver lows more variable (altitude + radiative cooling + chinooks)
    ecmwfMAE: 0.8,   // Estimated from calibration performance
    gfsMAE: 0.9,     // Estimated from calibration performance
    tier: 'B',  // Potential edge when market σ > 2.5°F, chinook volatility in tail risk
  },
  // ── Calibrated Stations (Feb 11, 2026 — N=61, 60-day Open-Meteo historical) ──
  KIAH: {
    name: 'Houston Intercontinental', city: 'HOU',
    lat: 29.9844, lon: -95.3414,
    nwsOffice: 'HGX', nwsGridX: 64, nwsGridY: 104,
    observationStation: 'KIAH', kalshiTicker: 'KXHIGHTHOU', kalshiCity: 'HOU',
    climNormalHigh: { 1: 63, 2: 66, 3: 73, 4: 79, 5: 86, 6: 91, 7: 94, 8: 95, 9: 90, 10: 83, 11: 73, 12: 65 },
    climNormalLow:  { 1: 43, 2: 46, 3: 52, 4: 59, 5: 67, 6: 73, 7: 75, 8: 75, 9: 70, 10: 60, 11: 51, 12: 44 },
    bias: 0,
    // Calibrated Feb 11, 2026: MAE=0.94°F, N=61, bias=+0.52°F
    baseSigma: 1.03,
    ecmwfMAE: 0.78,
    gfsMAE: 1.80,
    tier: 'A',
  },
  KATL: {
    name: 'Atlanta Hartsfield', city: 'ATL',
    lat: 33.6407, lon: -84.4277,
    nwsOffice: 'FFC', nwsGridX: 50, nwsGridY: 82,
    observationStation: 'KATL', kalshiTicker: 'KXHIGHTATL', kalshiCity: 'ATL',
    climNormalHigh: { 1: 52, 2: 56, 3: 64, 4: 73, 5: 80, 6: 87, 7: 90, 8: 89, 9: 83, 10: 73, 11: 63, 12: 54 },
    climNormalLow:  { 1: 34, 2: 37, 3: 43, 4: 51, 5: 60, 6: 68, 7: 72, 8: 71, 9: 65, 10: 53, 11: 43, 12: 36 },
    bias: 0,
    // Calibrated Feb 11, 2026: MAE=0.92°F, N=61, bias=-0.04°F (excellent!)
    baseSigma: 1.01,
    ecmwfMAE: 0.82,
    gfsMAE: 1.68,
    tier: 'A',
  },
  KDFW: {
    name: 'Dallas/Fort Worth', city: 'DFW',
    lat: 32.8998, lon: -97.0403,
    nwsOffice: 'FWD', nwsGridX: 80, nwsGridY: 109,
    observationStation: 'KDFW', kalshiTicker: 'KXHIGHTDAL', kalshiCity: 'DFW',
    climNormalHigh: { 1: 57, 2: 60, 3: 68, 4: 76, 5: 84, 6: 93, 7: 97, 8: 97, 9: 90, 10: 79, 11: 67, 12: 58 },
    climNormalLow:  { 1: 36, 2: 39, 3: 47, 4: 55, 5: 64, 6: 72, 7: 76, 8: 76, 9: 68, 10: 57, 11: 46, 12: 38 },
    bias: 0,
    // Calibrated Feb 11, 2026: MAE=0.76°F, N=61, bias=+0.07°F (excellent!)
    baseSigma: 0.84,
    ecmwfMAE: 1.06,
    gfsMAE: 1.69,
    tier: 'A',
  },
  KLAX: {
    name: 'Los Angeles International', city: 'LA',
    lat: 33.9425, lon: -118.4081,
    nwsOffice: 'LOX', nwsGridX: 149, nwsGridY: 48,
    observationStation: 'KLAX', kalshiTicker: 'KXHIGHLAX', kalshiCity: 'LA',
    climNormalHigh: { 1: 66, 2: 65, 3: 65, 4: 67, 5: 69, 6: 72, 7: 75, 8: 76, 9: 76, 10: 74, 11: 70, 12: 65 },
    climNormalLow:  { 1: 49, 2: 50, 3: 51, 4: 53, 5: 57, 6: 60, 7: 63, 8: 64, 9: 63, 10: 59, 11: 53, 12: 49 },
    bias: +2,  // Strong warm bias detected (+2.13°F)
    // Calibrated Feb 11, 2026: MAE=2.22°F, N=61, bias=+2.13°F — HIGH ERROR
    // Coastal microclimate makes forecasting difficult. Similar to KMDW problem.
    baseSigma: 2.44,
    ecmwfMAE: 2.05,
    gfsMAE: 2.95,
    tier: 'F',  // FAILED — MAE too high for profitable trading after costs
    enabled: false,
  },
  KSFO: {
    name: 'San Francisco International', city: 'SFO',
    lat: 37.6213, lon: -122.3790,
    nwsOffice: 'MTR', nwsGridX: 85, nwsGridY: 98,
    observationStation: 'KSFO', kalshiTicker: 'KXHIGHTSFO', kalshiCity: 'SFO',
    climNormalHigh: { 1: 57, 2: 60, 3: 62, 4: 63, 5: 66, 6: 69, 7: 68, 8: 69, 9: 72, 10: 69, 11: 63, 12: 57 },
    climNormalLow:  { 1: 44, 2: 46, 3: 47, 4: 48, 5: 51, 6: 54, 7: 55, 8: 56, 9: 55, 10: 52, 11: 48, 12: 44 },
    bias: 0,
    // Calibrated Feb 11, 2026: MAE=1.06°F, N=61, bias=-0.42°F
    baseSigma: 1.16,
    ecmwfMAE: 1.38,
    gfsMAE: 1.17,
    tier: 'A',
  },
  KSEA: {
    name: 'Seattle-Tacoma International', city: 'SEA',
    lat: 47.4502, lon: -122.3088,
    nwsOffice: 'SEW', nwsGridX: 124, nwsGridY: 61,
    observationStation: 'KSEA', kalshiTicker: 'KXHIGHTSEA', kalshiCity: 'SEA',
    climNormalHigh: { 1: 47, 2: 49, 3: 53, 4: 58, 5: 64, 6: 69, 7: 76, 8: 76, 9: 70, 10: 59, 11: 51, 12: 45 },
    climNormalLow:  { 1: 36, 2: 36, 3: 38, 4: 41, 5: 47, 6: 52, 7: 56, 8: 57, 9: 52, 10: 45, 11: 39, 12: 35 },
    bias: -1,  // Slight cool bias (-0.68°F)
    // Calibrated Feb 11, 2026: MAE=0.97°F, N=61, bias=-0.68°F
    baseSigma: 1.07,
    ecmwfMAE: 0.81,
    gfsMAE: 1.46,
    tier: 'A',
  },
  KOKC: {
    name: 'Oklahoma City Will Rogers', city: 'OKC',
    lat: 35.3931, lon: -97.6007,
    nwsOffice: 'OUN', nwsGridX: 94, nwsGridY: 90,
    observationStation: 'KOKC', kalshiTicker: 'KXHIGHTOKC', kalshiCity: 'OKC',
    climNormalHigh: { 1: 49, 2: 53, 3: 62, 4: 71, 5: 79, 6: 88, 7: 94, 8: 93, 9: 84, 10: 73, 11: 60, 12: 50 },
    climNormalLow:  { 1: 28, 2: 32, 3: 40, 4: 49, 5: 59, 6: 68, 7: 72, 8: 72, 9: 63, 10: 50, 11: 39, 12: 30 },
    bias: +1,  // Warm bias (+1.09°F)
    // Calibrated Feb 11, 2026: MAE=1.16°F, N=61, bias=+1.09°F
    // P95=3.55°F — tail risk from plains weather volatility
    baseSigma: 1.28,
    ecmwfMAE: 0.71,
    gfsMAE: 2.31,
    tier: 'B',  // Higher tail risk, needs wider sigma
  },
  KDCA: {
    name: 'Washington Reagan National', city: 'DC',
    lat: 38.8512, lon: -77.0402,
    nwsOffice: 'LWX', nwsGridX: 97, nwsGridY: 69,
    observationStation: 'KDCA', kalshiTicker: 'KXHIGHTDC', kalshiCity: 'DC',
    climNormalHigh: { 1: 44, 2: 47, 3: 56, 4: 67, 5: 76, 6: 85, 7: 89, 8: 87, 9: 80, 10: 69, 11: 58, 12: 47 },
    climNormalLow:  { 1: 29, 2: 31, 3: 38, 4: 47, 5: 57, 6: 67, 7: 72, 8: 71, 9: 63, 10: 51, 11: 41, 12: 33 },
    bias: +1,  // Warm bias (+1.32°F)
    // Calibrated Feb 11, 2026: MAE=1.52°F, N=61, bias=+1.32°F
    // Marginal — high bias suggests systematic issue
    baseSigma: 1.67,
    ecmwfMAE: 1.00,
    gfsMAE: 2.20,
    tier: 'B',  // Marginal edge potential, high bias needs monitoring
  },
  KAUS: {
    name: 'Austin-Bergstrom International', city: 'AUS',
    lat: 30.1945, lon: -97.6699,
    nwsOffice: 'EWX', nwsGridX: 159, nwsGridY: 88,
    observationStation: 'KAUS', kalshiTicker: 'KXHIGHAUS', kalshiCity: 'AUS',
    climNormalHigh: { 1: 62, 2: 65, 3: 73, 4: 80, 5: 87, 6: 93, 7: 97, 8: 98, 9: 92, 10: 83, 11: 72, 12: 63 },
    climNormalLow:  { 1: 40, 2: 43, 3: 50, 4: 57, 5: 65, 6: 71, 7: 74, 8: 74, 9: 68, 10: 58, 11: 48, 12: 41 },
    bias: +1,  // Slight warm bias (+0.58°F)
    // Calibrated Feb 11, 2026: MAE=1.05°F, N=61, bias=+0.58°F
    baseSigma: 1.16,
    ecmwfMAE: 0.65,
    gfsMAE: 1.76,
    tier: 'A',
  },
  KMSP: {
    name: 'Minneapolis-Saint Paul International', city: 'MIN',
    lat: 44.8848, lon: -93.2223,
    nwsOffice: 'MPX', nwsGridX: 110, nwsGridY: 68,
    observationStation: 'KMSP', kalshiTicker: 'KXHIGHTMIN', kalshiCity: 'MIN',
    climNormalHigh: { 1: 24, 2: 29, 3: 41, 4: 57, 5: 69, 6: 79, 7: 84, 8: 81, 9: 73, 10: 58, 11: 41, 12: 27 },
    climNormalLow:  { 1: 8, 2: 13, 3: 25, 4: 37, 5: 49, 6: 60, 7: 65, 8: 63, 9: 53, 10: 40, 11: 25, 12: 12 },
    bias: 0,
    // Calibrated Feb 11, 2026: MAE=0.97°F, N=61, bias=+0.45°F
    baseSigma: 1.06,
    ecmwfMAE: 0.58,
    gfsMAE: 1.90,
    tier: 'A',
  },
  KPHL: {
    name: 'Philadelphia International', city: 'PHL',
    lat: 39.8721, lon: -75.2411,
    nwsOffice: 'PHI', nwsGridX: 48, nwsGridY: 72,
    observationStation: 'KPHL', kalshiTicker: 'KXLOWTPHIL', kalshiCity: 'PHL',
    climNormalHigh: { 1: 40, 2: 44, 3: 53, 4: 64, 5: 74, 6: 83, 7: 87, 8: 85, 9: 78, 10: 67, 11: 55, 12: 44 },
    climNormalLow:  { 1: 26, 2: 28, 3: 34, 4: 44, 5: 53, 6: 63, 7: 69, 8: 67, 9: 60, 10: 48, 11: 38, 12: 30 },
    bias: +1,  // Warm bias (+1.15°F)
    // Calibrated Feb 11, 2026: MAE=1.26°F, N=61, bias=+1.15°F
    // NOTE: Only LOW temp markets on Kalshi (KXLOWTPHIL), no HIGH
    baseSigma: 1.38,
    ecmwfMAE: 0.62,
    gfsMAE: 2.21,
    tier: 'B',  // LOW temp only, bias needs monitoring
  },
};

/**
 * Tradeable station whitelist — only trade stations with validated positive edge.
 * KMDW REMOVED: actual MAE=2.56°F vs market σ~3.0°F = insufficient edge after costs.
 * Only stations with market σ significantly above our calibrated σ should be included.
 */
export const TRADEABLE_STATIONS = new Set([
  'KNYC', 'KMIA', 'KDEN',           // Original validated
  'KIAH', 'KATL', 'KDFW',           // Newly calibrated tier A
  'KSFO', 'KSEA', 'KAUS', 'KMSP',   // Newly calibrated tier A
  'KOKC', 'KDCA',                    // Tier B — marginal, trade cautiously
  // KLAX: EXCLUDED (MAE=2.22°F, tier F)
  // KPHL: LOW temp only — needs separate LOW temp pipeline
]);

/**
 * Validated stations — those with sufficient calibration data (N>=30 observations)
 * Calibrated Feb 11, 2026 using 60-day Open-Meteo historical forecast data.
 */
export const VALIDATED_STATIONS = new Set([
  'KNYC', 'KMDW', 'KDEN', 'KMIA',
  'KIAH', 'KATL', 'KDFW', 'KLAX',
  'KSFO', 'KSEA', 'KOKC', 'KDCA', 'KAUS', 'KMSP', 'KPHL',
]);

export const CLIM_OUTLIER_THRESHOLD_F = 15;
// Model spread limit — overridable via config.json → guard.maxModelSpread
import { readFileSync } from 'fs';
const _cfgPath = new URL('../../config.json', import.meta.url);
let _maxSpread = 3;
try { _maxSpread = JSON.parse(readFileSync(_cfgPath, 'utf8')).guard?.maxModelSpread ?? 3; } catch {}
export const MAX_MODEL_SPREAD_F = _maxSpread;

/** Horizon-dependent sigma multipliers */
export const HORIZON_SIGMA = {
  0: 1.0,   // today
  1: 1.0,   // tomorrow (day+1) — same as today for next-day forecasts
  2: 1.29,  // day+2 — σ=4.5 from base 3.5
  3: 1.57,  // day+3 — σ=5.5 from base 3.5
};

/** Winter months get a sigma bump (forecasts are harder) */
const WINTER_MONTHS = new Set([11, 12, 1, 2, 3]);
const WINTER_SIGMA_BUMP = 0.5;

/**
 * Bayesian σ updating: shrink baseSigma toward observed MAE as N grows.
 * Uses Normal-Inverse-Gamma conjugate prior: posterior mean is a weighted
 * average of prior (baseSigma) and observed sample σ.
 * 
 * @param {number} baseSigma - prior σ from initial calibration (N=30)
 * @param {number} observedMAE - running MAE from new observations (if available)
 * @param {number} nObs - number of new observations since calibration
 * @param {number} nPrior - effective prior sample size (default 30 = original calibration)
 * @returns {number} updated σ estimate
 */
export function bayesianSigmaUpdate(baseSigma, observedMAE, nObs, nPrior = 30) {
  if (!observedMAE || nObs < 5) return baseSigma; // Not enough data to update
  // Convert MAE to σ estimate (for normal: σ ≈ MAE × √(π/2) ≈ MAE × 1.253)
  const observedSigma = observedMAE * 1.253;
  // Posterior mean: weighted by sample sizes
  const posteriorSigma = (nPrior * baseSigma + nObs * observedSigma) / (nPrior + nObs);
  return Math.round(posteriorSigma * 100) / 100;
}

/**
 * Get effective sigma for a station, date, and forecast horizon.
 * Incorporates: station-specific base, seasonal adjustment, horizon scaling,
 * and Bayesian updating from accumulated observations.
 */
export function getEffectiveSigma(station, month, horizonDays = 0, tempType = 'high') {
  const s = STATIONS[station];
  if (!s) return 3.5;
  
  // Start with baseSigma (or baseSigmaLow for low temps), optionally updated via Bayesian posterior
  let sigma = tempType === 'low' ? (s.baseSigmaLow || s.baseSigma || 3.5) : (s.baseSigma || 3.5);
  if (s.runningMAE && s.runningN) {
    sigma = bayesianSigmaUpdate(sigma, s.runningMAE, s.runningN);
  }
  
  // Seasonal adjustment
  if (WINTER_MONTHS.has(month)) {
    sigma += WINTER_SIGMA_BUMP;
  }
  
  // Horizon scaling
  const multiplier = HORIZON_SIGMA[Math.min(horizonDays, 3)] || HORIZON_SIGMA[3];
  sigma *= multiplier;
  
  return Math.round(sigma * 10) / 10;
}

/**
 * Get ECMWF weight for consensus (it's consistently better).
 * Returns [gfsWeight, ecmwfWeight] that sum to ~1 (NWS gets small weight separately).
 */
export function getModelWeights(station) {
  const s = STATIONS[station];
  if (!s || !s.ecmwfMAE || !s.gfsMAE) return { nws: 0.2, gfs: 0.35, ecmwf: 0.45 };
  
  // Inverse-MAE weighting: lower error → higher weight
  const ecmwfInv = 1 / s.ecmwfMAE;
  const gfsInv = 1 / s.gfsMAE;
  const total = ecmwfInv + gfsInv;
  
  return {
    nws: 0.15,  // NWS gets fixed small weight (human forecaster value)
    gfs: 0.85 * (gfsInv / total),
    ecmwf: 0.85 * (ecmwfInv / total),
  };
}

export function resolveStation(arg) {
  if (!arg) return null;
  const u = arg.toUpperCase();
  if (STATIONS[u]) return u;
  for (const [k, v] of Object.entries(STATIONS)) {
    if (v.city === u || v.kalshiCity === u || v.kalshiTicker?.includes(u) || v.kalshiTickerLow?.includes(u)) return k;
  }
  return null;
}

/** Find station by Kalshi city code (from parsed ticker) */
export function stationByCity(cityCode) {
  for (const [k, v] of Object.entries(STATIONS)) {
    if (v.kalshiCity === cityCode || v.city === cityCode) return k;
  }
  return null;
}
