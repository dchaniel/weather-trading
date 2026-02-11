/**
 * Real historical forecast and actuals from Open-Meteo APIs.
 */

import { STATIONS } from './stations.js';
import { fetchJSON, round1, sleep } from '../core/utils.js';

const HIST_FORECAST_BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

export async function fetchHistoricalForecasts(station, startDate, endDate) {
  const s = STATIONS[station];
  const url = `${HIST_FORECAST_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max&temperature_unit=fahrenheit` +
    `&models=gfs_seamless,ecmwf_ifs025`;
  
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const gfs = data.daily?.temperature_2m_max_gfs_seamless || [];
  const ecmwf = data.daily?.temperature_2m_max_ecmwf_ifs025 || [];
  
  const result = new Map();
  for (let i = 0; i < dates.length; i++) {
    if (gfs[i] == null && ecmwf[i] == null) continue;
    const g = gfs[i], e = ecmwf[i];
    const vals = [g, e].filter(v => v != null);
    const mean = round1(vals.reduce((a, b) => a + b, 0) / vals.length);
    const spread = vals.length > 1 ? round1(Math.abs(g - e)) : 0;
    result.set(dates[i], { gfs: g, ecmwf: e, mean, spread });
  }
  return result;
}

export async function fetchHistoricalActuals(station, startDate, endDate) {
  const s = STATIONS[station];
  const url = `${ARCHIVE_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max&temperature_unit=fahrenheit`;
  
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const highs = data.daily?.temperature_2m_max || [];
  
  const result = new Map();
  for (let i = 0; i < dates.length; i++) {
    if (highs[i] != null) {
      result.set(dates[i], { high_f: round1(highs[i]) });
    }
  }
  return result;
}

export async function fetchHistoricalData(station, startDate, endDate) {
  const allForecasts = new Map();
  const allActuals = new Map();
  
  const start = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 59);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    
    const s = cursor.toISOString().slice(0, 10);
    const e = chunkEnd.toISOString().slice(0, 10);
    
    const [forecasts, actuals] = await Promise.all([
      fetchHistoricalForecasts(station, s, e),
      fetchHistoricalActuals(station, s, e),
    ]);
    
    for (const [k, v] of forecasts) allForecasts.set(k, v);
    for (const [k, v] of actuals) allActuals.set(k, v);
    
    cursor.setDate(cursor.getDate() + 60);
    await sleep(300);
  }
  
  const errors = [];
  const gfsErrors = [];
  const ecmwfErrors = [];
  
  for (const [date, fc] of allForecasts) {
    const actual = allActuals.get(date);
    if (!actual) continue;
    const err = fc.mean - actual.high_f;
    errors.push({ date, forecast: fc.mean, actual: actual.high_f, error: err, spread: fc.spread });
    if (fc.gfs != null) gfsErrors.push(fc.gfs - actual.high_f);
    if (fc.ecmwf != null) ecmwfErrors.push(fc.ecmwf - actual.high_f);
  }
  
  const mae = errors.length > 0 ? round1(errors.reduce((s, e) => s + Math.abs(e.error), 0) / errors.length) : 0;
  const bias = errors.length > 0 ? round1(errors.reduce((s, e) => s + e.error, 0) / errors.length) : 0;
  const stdDev = errors.length > 1 ? round1(Math.sqrt(errors.reduce((s, e) => s + e.error * e.error, 0) / (errors.length - 1))) : 3;
  
  const gfsMae = gfsErrors.length > 0 ? round1(gfsErrors.reduce((s, e) => s + Math.abs(e), 0) / gfsErrors.length) : 0;
  const ecmwfMae = ecmwfErrors.length > 0 ? round1(ecmwfErrors.reduce((s, e) => s + Math.abs(e), 0) / ecmwfErrors.length) : 0;
  
  return {
    station, startDate, endDate,
    forecasts: allForecasts,
    actuals: allActuals,
    errors,
    stats: { mae, bias, stdDev, gfsMae, ecmwfMae, count: errors.length },
  };
}

/**
 * Simulate a forecast from actual data (for backtesting).
 */
export function simulateForecast(actualHigh, station, month) {
  const s = STATIONS[station];
  const bias = s.bias || 0;
  const noise = (Math.sin(actualHigh * 17.3) * 0.5 + Math.sin(actualHigh * 7.1) * 0.3) * 1.5;
  const forecastHigh = actualHigh + bias + noise;
  const spread = Math.abs(noise) * 0.8;
  return {
    adjustedMean: round1(forecastHigh),
    spread: round1(spread),
  };
}
