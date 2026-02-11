/**
 * Precipitation forecast calibration using historical data.
 * 
 * Fetches historical precipitation forecasts and actuals from Open-Meteo,
 * then computes:
 * 1. Brier scores for daily binary rain forecasts
 * 2. Gamma distribution fit quality for monthly totals
 * 3. Calibration curves (reliability diagrams)
 * 
 * This is essential: we CANNOT trade without knowing our forecast accuracy.
 */

import { PRECIP_STATIONS } from './stations.js';
import { fetchJSON, round2, sleep } from '../core/utils.js';

const HIST_FORECAST_BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

// ── Historical Data Fetching ─────────────────────────────────────────────────

/**
 * Fetch historical precipitation forecasts (GFS + ECMWF) for a station.
 * Returns daily precipitation amounts from each model.
 */
export async function fetchHistoricalPrecipForecasts(stationKey, startDate, endDate) {
  const s = PRECIP_STATIONS[stationKey];
  const url = `${HIST_FORECAST_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=precipitation_sum,precipitation_probability_max` +
    `&precipitation_unit=inch` +
    `&models=gfs_seamless,ecmwf_ifs025`;
  
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const gfsPrecip = data.daily?.precipitation_sum_gfs_seamless || [];
  const ecmwfPrecip = data.daily?.precipitation_sum_ecmwf_ifs025 || [];
  const gfsProb = data.daily?.precipitation_probability_max_gfs_seamless || [];
  
  const result = new Map();
  for (let i = 0; i < dates.length; i++) {
    result.set(dates[i], {
      gfsPrecip: gfsPrecip[i],
      ecmwfPrecip: ecmwfPrecip[i],
      gfsProb: gfsProb[i] != null ? gfsProb[i] / 100 : null,
    });
  }
  return result;
}

/**
 * Fetch historical actual precipitation.
 */
export async function fetchHistoricalPrecipActuals(stationKey, startDate, endDate) {
  const s = PRECIP_STATIONS[stationKey];
  const url = `${ARCHIVE_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=precipitation_sum&precipitation_unit=inch`;
  
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const sums = data.daily?.precipitation_sum || [];
  
  const result = new Map();
  for (let i = 0; i < dates.length; i++) {
    if (sums[i] != null) result.set(dates[i], { precipInches: round2(sums[i]) });
  }
  return result;
}

// ── Calibration Metrics ──────────────────────────────────────────────────────

/**
 * Compute Brier score for binary rain forecasts.
 * Brier score = mean(( forecast_prob - outcome )²)
 * Lower is better: 0 = perfect, 0.25 = random coin flip
 * 
 * Also computes reliability diagram bins.
 */
export function computeBrierScore(pairs) {
  if (pairs.length === 0) return { brier: null, n: 0 };
  
  let sum = 0;
  const bins = {}; // reliability diagram: bin forecast probs, track actual frequency
  
  for (const { forecastProb, actual } of pairs) {
    const outcome = actual > 0.01 ? 1 : 0; // ≥0.01" counts as rain
    sum += (forecastProb - outcome) ** 2;
    
    // Bin into 10% buckets for reliability diagram
    const bin = Math.min(9, Math.floor(forecastProb * 10));
    if (!bins[bin]) bins[bin] = { sum: 0, count: 0, forecastSum: 0 };
    bins[bin].sum += outcome;
    bins[bin].count += 1;
    bins[bin].forecastSum += forecastProb;
  }
  
  const brier = round2(sum / pairs.length);
  
  // Climatological Brier score (for skill comparison)
  const climProb = pairs.reduce((s, p) => s + (p.actual > 0.01 ? 1 : 0), 0) / pairs.length;
  const brierClim = round2(climProb * (1 - climProb));
  const brierSkill = brierClim > 0 ? round2(1 - brier / brierClim) : 0;
  
  // Reliability diagram
  const reliability = Object.entries(bins).map(([bin, data]) => ({
    binCenter: (parseInt(bin) + 0.5) / 10,
    forecastMean: round2(data.forecastSum / data.count),
    observedFreq: round2(data.sum / data.count),
    count: data.count,
  })).sort((a, b) => a.binCenter - b.binCenter);
  
  return {
    brier,
    brierClim,
    brierSkill, // BSS: 1 = perfect, 0 = no better than climatology, <0 = worse
    n: pairs.length,
    climProb: round2(climProb),
    reliability,
  };
}

/**
 * Compute calibration metrics for monthly total precipitation.
 * Tests whether our Gamma model correctly predicts P(total > threshold).
 */
export function computeMonthlyCalibration(monthlyPairs) {
  if (monthlyPairs.length === 0) return { n: 0 };
  
  // For each month, we predicted Gamma parameters and can check:
  // 1. Was actual total within our predicted 50% CI?
  // 2. How well-calibrated are our threshold probabilities?
  
  let within50CI = 0;
  let within90CI = 0;
  const thresholdPairs = []; // { predictedProb, actualAbove }
  
  for (const { predictedMean, predictedStd, actualTotal, thresholds } of monthlyPairs) {
    // Check coverage of prediction intervals
    const z50 = 0.674; // 50% CI
    const z90 = 1.645; // 90% CI
    const dev = Math.abs(actualTotal - predictedMean);
    if (dev <= z50 * predictedStd) within50CI++;
    if (dev <= z90 * predictedStd) within90CI++;
    
    // Check individual threshold predictions
    if (thresholds) {
      for (const { threshold, predictedProb } of thresholds) {
        thresholdPairs.push({
          forecastProb: predictedProb,
          actual: actualTotal > threshold ? 1 : 0,
        });
      }
    }
  }
  
  const n = monthlyPairs.length;
  const thresholdBrier = thresholdPairs.length > 0 ? computeBrierScore(thresholdPairs) : null;
  
  return {
    n,
    coverage50: round2(within50CI / n),  // Should be ~0.50
    coverage90: round2(within90CI / n),  // Should be ~0.90
    thresholdBrier,
    overconfident50: within50CI / n < 0.40, // Too narrow CIs
    overconfident90: within90CI / n < 0.80, // Too narrow CIs
  };
}

// ── Full Calibration Pipeline ────────────────────────────────────────────────

/**
 * Run full calibration for a precipitation station.
 * Fetches ~90 days of historical data and computes all metrics.
 * 
 * @param {string} stationKey
 * @param {number} days — days of history to use (default 90)
 * @returns {Object} calibration results
 */
export async function calibratePrecipStation(stationKey, days = 90) {
  const s = PRECIP_STATIONS[stationKey];
  if (!s) throw new Error(`Unknown precipitation station: ${stationKey}`);
  
  // Date range: go back `days` days from yesterday
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  
  console.log(`  Fetching ${days} days of historical data for ${s.name}...`);
  
  // Fetch historical data
  const [forecasts, actuals] = await Promise.all([
    fetchHistoricalPrecipForecasts(stationKey, startDate, endDate).catch(() => new Map()),
    fetchHistoricalPrecipActuals(stationKey, startDate, endDate).catch(() => new Map()),
  ]);
  
  // Build paired observations for daily binary calibration
  const dailyPairs = [];
  for (const [date, fc] of forecasts) {
    const actual = actuals.get(date);
    if (!actual) continue;
    
    // Use GFS probability if available, else derive from amount
    let forecastProb = fc.gfsProb;
    if (forecastProb == null && fc.gfsPrecip != null) {
      forecastProb = fc.gfsPrecip > 0.01 ? 0.8 : 0.1;
    }
    if (forecastProb == null && fc.ecmwfPrecip != null) {
      forecastProb = fc.ecmwfPrecip > 0.01 ? 0.8 : 0.1;
    }
    if (forecastProb == null) continue;
    
    dailyPairs.push({
      date,
      forecastProb,
      actual: actual.precipInches,
      gfsPrecip: fc.gfsPrecip,
      ecmwfPrecip: fc.ecmwfPrecip,
    });
  }
  
  // Compute daily Brier score
  const brierResult = computeBrierScore(dailyPairs);
  
  // Compute forecast amount errors (MAE for precipitation amount)
  const amountErrors = dailyPairs
    .filter(p => p.gfsPrecip != null && p.actual != null)
    .map(p => Math.abs(p.gfsPrecip - p.actual));
  const gfsMAE = amountErrors.length > 0
    ? round2(amountErrors.reduce((a, b) => a + b, 0) / amountErrors.length)
    : null;
  
  const ecmwfErrors = dailyPairs
    .filter(p => p.ecmwfPrecip != null && p.actual != null)
    .map(p => Math.abs(p.ecmwfPrecip - p.actual));
  const ecmwfMAE = ecmwfErrors.length > 0
    ? round2(ecmwfErrors.reduce((a, b) => a + b, 0) / ecmwfErrors.length)
    : null;
  
  // Monthly totals calibration
  const monthlyTotals = {};
  for (const [date, actual] of actuals) {
    const ym = date.slice(0, 7);
    if (!monthlyTotals[ym]) monthlyTotals[ym] = { actual: 0, forecast: 0, days: 0, fcDays: 0 };
    monthlyTotals[ym].actual += actual.precipInches;
    monthlyTotals[ym].days++;
    const fc = forecasts.get(date);
    if (fc?.gfsPrecip != null) {
      monthlyTotals[ym].forecast += fc.gfsPrecip;
      monthlyTotals[ym].fcDays++;
    }
  }
  
  const monthlyCalibPairs = Object.entries(monthlyTotals)
    .filter(([, m]) => m.days >= 20) // Need most of the month
    .map(([ym, m]) => ({
      yearMonth: ym,
      predictedMean: round2(m.forecast * m.days / Math.max(m.fcDays, 1)),
      predictedStd: round2(Math.sqrt(m.actual) * 0.5 + 0.3), // rough estimate
      actualTotal: round2(m.actual),
    }));
  
  const monthlyCalib = computeMonthlyCalibration(monthlyCalibPairs);
  
  return {
    stationKey,
    name: s.name,
    period: { startDate, endDate, days },
    daily: {
      n: dailyPairs.length,
      brier: brierResult,
      gfsMAE,
      ecmwfMAE,
      rainDays: dailyPairs.filter(p => p.actual > 0.01).length,
      dryDays: dailyPairs.filter(p => p.actual <= 0.01).length,
      rainFrequency: dailyPairs.length > 0 
        ? round2(dailyPairs.filter(p => p.actual > 0.01).length / dailyPairs.length)
        : null,
    },
    monthly: {
      n: monthlyCalibPairs.length,
      calibration: monthlyCalib,
      totals: monthlyCalibPairs,
    },
  };
}
