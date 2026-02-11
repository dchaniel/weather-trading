/**
 * Precipitation station metadata and configuration.
 * 
 * Two market types on Kalshi:
 * 1. Daily binary rain (KXRAINNYC): "Will it rain in NYC on date X?" — single YES/NO
 * 2. Monthly total rain (KXRAIN*M): "Total rain > X inches in month" — threshold contracts
 * 
 * Precipitation differs fundamentally from temperature:
 * - Zero-inflated: many days have 0 rain → cannot use normal/Student-t
 * - Daily rain is binary (rain/no rain) + amount conditional on rain
 * - Monthly totals follow a gamma-like distribution (right-skewed, non-negative)
 * - Forecast skill varies enormously by lead time and season
 */

import { readFileSync } from 'fs';

// ── Station Configurations ───────────────────────────────────────────────────

export const PRECIP_STATIONS = {
  // ── Daily Binary Rain Markets ──────────────────────────────────────────
  NYC_DAILY: {
    name: 'New York City (daily rain)',
    city: 'NYC',
    lat: 40.7789,
    lon: -73.9692,
    kalshiSeries: 'KXRAINNYC',
    marketType: 'daily_binary',       // YES/NO: will it rain?
    nwsOffice: 'OKX',
    nwsGridX: 33,
    nwsGridY: 37,
    // Climatological rain probability by month (fraction of days with ≥0.01" rain)
    climRainProb: { 1: 0.35, 2: 0.33, 3: 0.35, 4: 0.36, 5: 0.35, 6: 0.36, 7: 0.33, 8: 0.32, 9: 0.30, 10: 0.30, 11: 0.32, 12: 0.35 },
    // Calibration: forecast error rates (from historical NWS/GFS precipitation forecasts)
    // These are Brier skill scores — lower is better, 0 = perfect, 0.25 = climatology
    // MUST be calibrated from historical data before live trading
    calibrated: false,
    // Prior from literature: NWS PoP forecasts have ~0.08 Brier score for day+0/+1
    brierScorePrior: 0.08,
    tier: 'A',  // Good volume, single binary contract = clean edge estimation
  },

  // ── Monthly Total Rain Markets ─────────────────────────────────────────
  DEN_MONTHLY: {
    name: 'Denver (monthly rain)',
    city: 'DEN',
    lat: 39.8561,
    lon: -104.6737,
    kalshiSeries: 'KXRAINDENM',
    marketType: 'monthly_threshold',  // "Total > X inches"
    nwsOffice: 'BOU',
    // Monthly mean total precipitation (inches) and std dev — from NOAA normals
    climMonthlyMean:  { 1: 0.45, 2: 0.42, 3: 1.28, 4: 1.93, 5: 2.32, 6: 1.86, 7: 2.17, 8: 1.82, 9: 1.14, 10: 0.99, 11: 0.79, 12: 0.54 },
    climMonthlyStd:   { 1: 0.45, 2: 0.42, 3: 0.95, 4: 1.20, 5: 1.30, 6: 1.20, 7: 1.40, 8: 1.20, 9: 0.90, 10: 0.80, 11: 0.65, 12: 0.50 },
    // Gamma distribution shape parameter (α) — fitted from historical data
    // α < 1 = highly right-skewed (dry climate), α > 2 = more symmetric
    gammaShapePrior: 1.2,
    calibrated: false,
    tier: 'B',
  },
  CHI_MONTHLY: {
    name: 'Chicago (monthly rain)',
    city: 'CHI',
    lat: 41.8781,
    lon: -87.6298,
    kalshiSeries: 'KXRAINCHIM',
    marketType: 'monthly_threshold',
    nwsOffice: 'LOT',
    climMonthlyMean:  { 1: 2.05, 2: 1.88, 3: 2.71, 4: 3.57, 5: 4.33, 6: 4.10, 7: 4.09, 8: 4.01, 9: 3.29, 10: 3.22, 11: 3.01, 12: 2.36 },
    climMonthlyStd:   { 1: 1.30, 2: 1.20, 3: 1.50, 4: 1.80, 5: 2.00, 6: 2.20, 7: 2.30, 8: 2.20, 9: 1.80, 10: 1.70, 11: 1.60, 12: 1.40 },
    gammaShapePrior: 2.5,
    calibrated: false,
    tier: 'B',
  },
  SFO_MONTHLY: {
    name: 'San Francisco (monthly rain)',
    city: 'SFO',
    lat: 37.7749,
    lon: -122.4194,
    kalshiSeries: 'KXRAINSFOM',
    marketType: 'monthly_threshold',
    nwsOffice: 'MTR',
    // SF has extreme seasonality: very dry summers, wet winters
    climMonthlyMean:  { 1: 4.40, 2: 4.01, 3: 3.26, 4: 1.46, 5: 0.70, 6: 0.16, 7: 0.01, 8: 0.07, 9: 0.21, 10: 1.04, 11: 2.52, 12: 4.44 },
    climMonthlyStd:   { 1: 3.50, 2: 3.20, 3: 2.80, 4: 1.40, 5: 0.80, 6: 0.30, 7: 0.05, 8: 0.15, 9: 0.40, 10: 1.20, 11: 2.40, 12: 3.60 },
    gammaShapePrior: 1.5,
    calibrated: false,
    tier: 'A',  // High volume on some contracts, strong seasonal signal
  },
  AUS_MONTHLY: {
    name: 'Austin (monthly rain)',
    city: 'AUS',
    lat: 30.2672,
    lon: -97.7431,
    kalshiSeries: 'KXRAINAUSM',
    marketType: 'monthly_threshold',
    nwsOffice: 'EWX',
    climMonthlyMean:  { 1: 2.24, 2: 1.89, 3: 2.34, 4: 2.97, 5: 4.68, 6: 4.42, 7: 1.97, 8: 2.43, 9: 3.39, 10: 3.91, 11: 2.61, 12: 2.36 },
    climMonthlyStd:   { 1: 1.80, 2: 1.70, 3: 2.00, 4: 2.30, 5: 3.20, 6: 3.50, 7: 1.80, 8: 2.20, 9: 3.00, 10: 3.50, 11: 2.30, 12: 2.00 },
    gammaShapePrior: 1.8,
    calibrated: false,
    tier: 'C',  // Low volume
  },
  DAL_MONTHLY: {
    name: 'Dallas (monthly rain)',
    city: 'DAL',
    lat: 32.7767,
    lon: -96.7970,
    kalshiSeries: 'KXRAINDALM',
    marketType: 'monthly_threshold',
    nwsOffice: 'FWD',
    climMonthlyMean:  { 1: 2.26, 2: 2.62, 3: 3.23, 4: 3.39, 5: 4.87, 6: 3.84, 7: 2.12, 8: 2.19, 9: 3.06, 10: 4.55, 11: 2.81, 12: 2.64 },
    climMonthlyStd:   { 1: 1.80, 2: 2.00, 3: 2.30, 4: 2.50, 5: 3.30, 6: 3.00, 7: 1.80, 8: 2.00, 9: 2.80, 10: 3.50, 11: 2.20, 12: 2.10 },
    gammaShapePrior: 1.8,
    calibrated: false,
    tier: 'C',  // Low volume
  },
};

// ── Tradeable Stations ───────────────────────────────────────────────────────
// Only trade stations with sufficient volume and calibration
export const PRECIP_TRADEABLE = new Set(['NYC_DAILY', 'SFO_MONTHLY', 'DEN_MONTHLY', 'CHI_MONTHLY']);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve station by key, city, or Kalshi series ticker */
export function resolvePrecipStation(arg) {
  if (!arg) return null;
  const u = arg.toUpperCase();
  if (PRECIP_STATIONS[u]) return u;
  for (const [k, v] of Object.entries(PRECIP_STATIONS)) {
    if (v.city === u || v.kalshiSeries === u || v.kalshiSeries?.toUpperCase() === u) return k;
  }
  // Try partial match
  for (const [k, v] of Object.entries(PRECIP_STATIONS)) {
    if (u.includes(v.city) || v.kalshiSeries?.includes(u)) return k;
  }
  return null;
}

/** Get climatological rain probability for a daily binary station */
export function getClimRainProb(stationKey, month) {
  const s = PRECIP_STATIONS[stationKey];
  return s?.climRainProb?.[month] ?? 0.33;
}

/** Get climatological monthly total (mean, std) for a monthly threshold station */
export function getClimMonthly(stationKey, month) {
  const s = PRECIP_STATIONS[stationKey];
  return {
    mean: s?.climMonthlyMean?.[month] ?? 2.0,
    std: s?.climMonthlyStd?.[month] ?? 1.5,
    gammaShape: s?.gammaShapePrior ?? 2.0,
  };
}
