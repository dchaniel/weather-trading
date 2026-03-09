/**
 * Settlement station metadata & helpers.
 *
 * Station data lives in data/stations.json (pure config).
 * This module loads it and derives runtime sets + helpers.
 *
 * ── Calibration note ──
 * baseSigma values re-calibrated Mar 9 2026 from 60 days of realized forecast
 * accuracy data (Jan 7 - Mar 8 2026). Previous values (Mar 3 recalibration) were
 * 2-5x too high — they prevented any trades but left real edge on the table.
 * New values = realized σ × 1.5 with a floor of 2.0°F. This is still conservative
 * but should allow the model to identify genuine edge when forecasts are confident.
 *
 * History:
 * - Pre-Mar 3: baseSigma = 2.0 everywhere → too tight → 0/25 loss streak
 * - Mar 3: baseSigma = 3-8°F → too loose → no trades found at all
 * - Mar 9: baseSigma = realized σ × 1.5 → balanced (2.0-4.9°F range)
 *
 * IMPORTANT: These are winter values. Reassess in spring/summer when convective
 * variability increases (especially KDEN, KOKC, KDFW, KIAH).
 *
 * ── Open-Meteo vs NWS settlement validation ──
 * TODO: Add periodic validation comparing Open-Meteo archive temperatures to
 * NWS ASOS observations (the actual settlement source). Any systematic offset
 * between Open-Meteo gridded data and the point ASOS reading could bias our
 * probability estimates. Target: monthly comparison script.
 *
 * ── Geographic correlation ──
 * Stations are tagged with correlationGroup in stations.json. Correlated groups:
 *   texas_oklahoma: KDFW, KAUS, KOKC, KIAH — shared frontal systems, avoid
 *     simultaneous large positions across this group.
 *   northeast: KNYC, KPHL, KDCA — coastal NE corridor, correlated in winter.
 *   west_coast: KSFO, KLAX, KSEA — Pacific pattern driven.
 * Kelly sizing should treat correlated stations as partially the same bet.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stationsPath = join(__dirname, '..', '..', 'data', 'stations.json');

/** Station config loaded from data/stations.json */
export const STATIONS = JSON.parse(readFileSync(stationsPath, 'utf8'));

/**
 * Tradeable stations — derived from tier + enabled status.
 * Tier A/B stations that aren't explicitly disabled are tradeable.
 * Single source of truth: edit tier/enabled in stations.json, this set follows.
 */
export const TRADEABLE_STATIONS = new Set(
  Object.keys(STATIONS).filter(s =>
    STATIONS[s].enabled !== false && ['A', 'B'].includes(STATIONS[s].tier)
  )
);

/**
 * Validated stations — those with sufficient calibration data (N>=30).
 * Derived: any station with a baseSigma has been calibrated.
 */
export const VALIDATED_STATIONS = new Set(
  Object.keys(STATIONS).filter(s => STATIONS[s].baseSigma != null)
);

/**
 * Correlation groups — derived from stations.json correlationGroup field.
 * Map<groupName, stationId[]>
 */
export const CORRELATION_GROUPS = (() => {
  const groups = {};
  for (const [k, v] of Object.entries(STATIONS)) {
    if (v.correlationGroup) {
      (groups[v.correlationGroup] ||= []).push(k);
    }
  }
  return groups;
})();

export const CLIM_OUTLIER_THRESHOLD_F = 15;

// Model spread limit — overridable via config.json → guard.maxModelSpread
const _cfgPath = join(__dirname, '..', '..', 'config.json');
let _maxSpread = 3;
try { _maxSpread = JSON.parse(readFileSync(_cfgPath, 'utf8')).guard?.maxModelSpread ?? 3; } catch {}
export const MAX_MODEL_SPREAD_F = _maxSpread;

/** Horizon-dependent sigma multipliers */
export const HORIZON_SIGMA = {
  0: 1.0,
  1: 1.0,
  2: 1.29,
  3: 1.57,
};

/** Winter months get a sigma bump (forecasts are harder) */
const WINTER_MONTHS = new Set([11, 12, 1, 2, 3]);
const WINTER_SIGMA_BUMP = 0.75;

/**
 * Bayesian σ updating: shrink baseSigma toward observed MAE as N grows.
 * Uses Normal-Inverse-Gamma conjugate prior.
 */
export function bayesianSigmaUpdate(baseSigma, observedMAE, nObs, nPrior = 30) {
  if (!observedMAE || nObs < 5) return baseSigma;
  const observedSigma = observedMAE * 1.253;
  const posteriorSigma = (nPrior * baseSigma + nObs * observedSigma) / (nPrior + nObs);
  return Math.round(posteriorSigma * 100) / 100;
}

/**
 * Get effective sigma for a station, date, and forecast horizon.
 * Incorporates: station base, seasonal adjustment, horizon scaling, Bayesian update.
 */
export function getEffectiveSigma(station, month, horizonDays = 0, tempType = 'high') {
  const s = STATIONS[station];
  if (!s) return 3.5;

  let sigma = tempType === 'low' ? (s.baseSigmaLow || s.baseSigma || 3.5) : (s.baseSigma || 3.5);
  if (s.runningMAE && s.runningN) {
    sigma = bayesianSigmaUpdate(sigma, s.runningMAE, s.runningN);
  }

  if (WINTER_MONTHS.has(month)) {
    sigma += WINTER_SIGMA_BUMP;
  }

  const multiplier = HORIZON_SIGMA[Math.min(horizonDays, 3)] || HORIZON_SIGMA[3];
  sigma *= multiplier;

  return Math.round(sigma * 10) / 10;
}

/**
 * Get model weights (inverse-MAE weighting).
 */
export function getModelWeights(station) {
  const s = STATIONS[station];
  if (!s || !s.ecmwfMAE || !s.gfsMAE) return { nws: 0.2, gfs: 0.35, ecmwf: 0.45 };

  const ecmwfInv = 1 / s.ecmwfMAE;
  const gfsInv = 1 / s.gfsMAE;
  const total = ecmwfInv + gfsInv;

  return {
    nws: 0.15,
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

/** Find station by Kalshi city code */
export function stationByCity(cityCode) {
  for (const [k, v] of Object.entries(STATIONS)) {
    if (v.kalshiCity === cityCode || v.city === cityCode) return k;
  }
  return null;
}
