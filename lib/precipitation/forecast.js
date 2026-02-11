/**
 * Precipitation forecast engine.
 * 
 * Fetches precipitation forecasts from NWS and Open-Meteo (GFS/ECMWF).
 * Handles two forecast types:
 * 1. Daily binary: probability of rain (≥0.01") on a specific date
 * 2. Monthly total: expected total precipitation for a month
 * 
 * Key difference from temperature: precipitation forecasts are inherently
 * probabilistic (NWS issues PoP = Probability of Precipitation).
 */

import { PRECIP_STATIONS } from './stations.js';
import { fetchJSON, round1, round2, sleep, today } from '../core/utils.js';

// ── NWS Forecast (daily rain probability) ────────────────────────────────────

/**
 * Fetch NWS forecast for daily precipitation probability.
 * NWS provides PoP (Probability of Precipitation) directly — this is their bread and butter.
 * @returns {{ rainProb: number, description: string, source: string }}
 */
export async function fetchNWSPrecip(stationKey, date) {
  const s = PRECIP_STATIONS[stationKey];
  if (!s?.nwsOffice) return null;
  
  const url = `https://api.weather.gov/gridpoints/${s.nwsOffice}/${s.nwsGridX || 33},${s.nwsGridY || 37}/forecast`;
  const data = await fetchJSON(url);
  const periods = data.properties?.periods || [];
  
  for (const p of periods) {
    if (p.startTime?.slice(0, 10) === date && p.isDaytime) {
      // NWS PoP is in probabilityOfPrecipitation.value (0-100)
      const pop = p.probabilityOfPrecipitation?.value;
      return {
        source: 'NWS',
        rainProb: pop != null ? pop / 100 : null,
        precipAmount: null,
        description: p.shortForecast,
      };
    }
  }
  return null;
}

// ── Open-Meteo GFS (daily + cumulative) ──────────────────────────────────────

/**
 * Fetch GFS precipitation forecast from Open-Meteo.
 * Returns daily precipitation sum and probability (precipitation_probability_max).
 */
export async function fetchGFSPrecip(stationKey, startDate, endDate) {
  const s = PRECIP_STATIONS[stationKey];
  const end = endDate || startDate;
  const url = `https://api.open-meteo.com/v1/gfs?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=precipitation_sum,precipitation_probability_max,precipitation_hours` +
    `&precipitation_unit=inch&start_date=${startDate}&end_date=${end}` +
    `&timezone=America%2FNew_York`;
  
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const sums = data.daily?.precipitation_sum || [];
  const probs = data.daily?.precipitation_probability_max || [];
  const hours = data.daily?.precipitation_hours || [];
  
  const result = {};
  for (let i = 0; i < dates.length; i++) {
    result[dates[i]] = {
      source: 'GFS',
      precipInches: sums[i] != null ? round2(sums[i]) : null,
      rainProb: probs[i] != null ? probs[i] / 100 : null,
      precipHours: hours[i] ?? null,
    };
  }
  return result;
}

// ── Open-Meteo ECMWF (daily + cumulative) ────────────────────────────────────

/**
 * Fetch ECMWF precipitation forecast from Open-Meteo.
 */
export async function fetchECMWFPrecip(stationKey, startDate, endDate) {
  const s = PRECIP_STATIONS[stationKey];
  const end = endDate || startDate;
  const url = `https://api.open-meteo.com/v1/ecmwf?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=precipitation_sum` +
    `&precipitation_unit=inch&start_date=${startDate}&end_date=${end}` +
    `&timezone=America%2FNew_York`;
  
  try {
    const data = await fetchJSON(url);
    const dates = data.daily?.time || [];
    const sums = data.daily?.precipitation_sum || [];
    
    const result = {};
    for (let i = 0; i < dates.length; i++) {
      result[dates[i]] = {
        source: 'ECMWF',
        precipInches: sums[i] != null ? round2(sums[i]) : null,
        // ECMWF doesn't provide PoP directly; derive from precip amount
        rainProb: sums[i] != null ? (sums[i] > 0.01 ? 1.0 : 0.0) : null,
      };
    }
    return result;
  } catch { return {}; }
}

// ── Consensus Builder ────────────────────────────────────────────────────────

/**
 * Build precipitation consensus for a single date.
 * Combines NWS PoP, GFS, and ECMWF into a calibrated rain probability.
 * 
 * For daily binary: output is P(rain ≥ 0.01")
 * For monthly: output is expected daily contribution to monthly total
 */
export function buildPrecipConsensus(forecasts, stationKey, date) {
  const { nws, gfs, ecmwf } = forecasts;
  const sources = [];
  
  // Collect rain probabilities from each source
  if (nws?.rainProb != null) sources.push({ source: 'NWS', prob: nws.rainProb, weight: 0.40 });
  if (gfs?.rainProb != null) sources.push({ source: 'GFS', prob: gfs.rainProb, weight: 0.35 });
  if (ecmwf?.rainProb != null) sources.push({ source: 'ECMWF', prob: ecmwf.rainProb, weight: 0.25 });
  
  // Collect precipitation amounts
  const amounts = [];
  if (gfs?.precipInches != null) amounts.push({ source: 'GFS', inches: gfs.precipInches, weight: 0.5 });
  if (ecmwf?.precipInches != null) amounts.push({ source: 'ECMWF', inches: ecmwf.precipInches, weight: 0.5 });
  
  if (sources.length === 0 && amounts.length === 0) {
    return { tradeable: false, reason: 'No forecast data available' };
  }
  
  // Weighted rain probability
  let rainProb = null;
  if (sources.length > 0) {
    let weightedSum = 0, totalWeight = 0;
    for (const s of sources) {
      weightedSum += s.prob * s.weight;
      totalWeight += s.weight;
    }
    rainProb = round2(weightedSum / totalWeight);
  }
  
  // If we have amounts but no probability, derive probability from amounts
  // Using empirical relationship: P(rain) ≈ 1 if amount > 0.05", else logistic
  if (rainProb == null && amounts.length > 0) {
    const meanAmount = amounts.reduce((s, a) => s + a.inches * a.weight, 0) / amounts.reduce((s, a) => s + a.weight, 0);
    // Logistic mapping: amount → probability
    // At 0.01" forecast → ~50% chance of measurable rain (forecast threshold effect)
    // At 0.10" forecast → ~85% chance
    // At 0.50" forecast → ~97% chance
    rainProb = round2(logistic(meanAmount, 0.02, 80));
  }
  
  // Weighted mean precipitation amount
  let precipAmount = null;
  if (amounts.length > 0) {
    let weightedSum = 0, totalWeight = 0;
    for (const a of amounts) {
      weightedSum += a.inches * a.weight;
      totalWeight += a.weight;
    }
    precipAmount = round2(weightedSum / totalWeight);
  }
  
  // Model spread (disagreement)
  const probSpread = sources.length >= 2
    ? round2(Math.max(...sources.map(s => s.prob)) - Math.min(...sources.map(s => s.prob)))
    : 0;
  const amountSpread = amounts.length >= 2
    ? round2(Math.max(...amounts.map(a => a.inches)) - Math.min(...amounts.map(a => a.inches)))
    : 0;
  
  return {
    tradeable: true,
    rainProb,
    precipAmount,
    probSpread,
    amountSpread,
    sourceCount: sources.length + amounts.length,
    sources,
    warnings: [],
    date,
  };
}

/**
 * Logistic function: maps continuous value to (0, 1)
 * @param {number} x — input value
 * @param {number} x0 — midpoint (x where output = 0.5)
 * @param {number} k — steepness
 */
function logistic(x, x0, k) {
  return 1 / (1 + Math.exp(-k * (x - x0)));
}

// ── High-Level Forecast Functions ────────────────────────────────────────────

/**
 * Get precipitation forecast for a single date at a station.
 */
export async function precipForecast(stationKey, date) {
  const todayStr = today();
  const horizonDays = Math.max(0, Math.round((new Date(date) - new Date(todayStr)) / 86400000));
  
  const [nws, gfsAll, ecmwfAll] = await Promise.all([
    fetchNWSPrecip(stationKey, date).catch(() => null),
    fetchGFSPrecip(stationKey, date).catch(() => null),
    fetchECMWFPrecip(stationKey, date).catch(() => null),
  ]);
  
  const gfs = gfsAll?.[date] || null;
  const ecmwf = ecmwfAll?.[date] || null;
  const consensus = buildPrecipConsensus({ nws, gfs, ecmwf }, stationKey, date);
  consensus.horizonDays = horizonDays;
  
  return { stationKey, date, horizonDays, nws, gfs, ecmwf, consensus };
}

/**
 * Get precipitation forecast for a date range (efficient batch).
 * Used for monthly total calculations — sums up daily forecasts.
 */
export async function precipForecastRange(stationKey, startDate, endDate) {
  const todayStr = today();
  
  const [gfsAll, ecmwfAll] = await Promise.all([
    fetchGFSPrecip(stationKey, startDate, endDate).catch(() => ({})),
    fetchECMWFPrecip(stationKey, startDate, endDate).catch(() => ({})),
  ]);
  
  const results = [];
  const d = new Date(startDate + 'T12:00:00Z');
  const e = new Date(endDate + 'T12:00:00U');
  
  while (d <= e) {
    const date = d.toISOString().slice(0, 10);
    const horizonDays = Math.max(0, Math.round((d - new Date(todayStr + 'T12:00:00Z')) / 86400000));
    
    const gfs = gfsAll[date] || null;
    const ecmwf = ecmwfAll[date] || null;
    const consensus = buildPrecipConsensus({ nws: null, gfs, ecmwf }, stationKey, date);
    consensus.horizonDays = horizonDays;
    
    results.push({ stationKey, date, horizonDays, gfs, ecmwf, consensus });
    d.setDate(d.getDate() + 1);
  }
  
  return results;
}

/**
 * Get month-to-date actual precipitation from Open-Meteo archive.
 * Critical for monthly threshold markets — need to know how much has already fallen.
 */
export async function fetchMonthToDateActual(stationKey, year, month) {
  const s = PRECIP_STATIONS[stationKey];
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const todayStr = today();
  // Don't fetch future dates
  const endDate = todayStr < startDate ? startDate : todayStr;
  
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=precipitation_sum&precipitation_unit=inch&timezone=America%2FNew_York`;
  
  try {
    const data = await fetchJSON(url);
    const dates = data.daily?.time || [];
    const sums = data.daily?.precipitation_sum || [];
    
    let totalInches = 0;
    let daysWithData = 0;
    const daily = [];
    
    for (let i = 0; i < dates.length; i++) {
      if (sums[i] != null) {
        totalInches += sums[i];
        daysWithData++;
        daily.push({ date: dates[i], inches: round2(sums[i]) });
      }
    }
    
    return {
      totalInches: round2(totalInches),
      daysWithData,
      daily,
      startDate,
      endDate,
    };
  } catch {
    return { totalInches: 0, daysWithData: 0, daily: [], startDate, endDate };
  }
}
