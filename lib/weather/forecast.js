/**
 * Multi-model weather forecast engine.
 * Supports multi-day forecasting with horizon-adjusted sigma.
 */

import { STATIONS, CLIM_OUTLIER_THRESHOLD_F, MAX_MODEL_SPREAD_F, getModelWeights, getEffectiveSigma } from './stations.js';
import { fetchJSON, round1, sleep, today } from '../core/utils.js';

/** Max acceptable forecast data age in hours */
const MAX_FORECAST_AGE_HOURS = 12;

/**
 * Check if a data timestamp is stale (older than MAX_FORECAST_AGE_HOURS).
 * @param {string} isoTimestamp
 * @returns {{stale: boolean, ageHours: number}}
 */
export function checkDataFreshness(isoTimestamp) {
  if (!isoTimestamp) return { stale: false, ageHours: 0 };
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  const ageHours = ageMs / 3600000;
  return { stale: ageHours > MAX_FORECAST_AGE_HOURS, ageHours: Math.round(ageHours * 10) / 10 };
}

export async function fetchNWS(station, date) {
  const s = STATIONS[station];
  const url = `https://api.weather.gov/gridpoints/${s.nwsOffice}/${s.nwsGridX},${s.nwsGridY}/forecast`;
  const data = await fetchJSON(url);
  const updatedAt = data.properties?.updateTime || data.properties?.generatedAt;
  const freshness = checkDataFreshness(updatedAt);
  const periods = data.properties?.periods || [];
  for (const p of periods) {
    if (p.startTime.slice(0, 10) === date && p.isDaytime) {
      const result = { source: 'NWS', high_f: p.temperature, description: p.shortForecast };
      if (freshness.stale) result.staleWarning = `NWS data is ${freshness.ageHours}h old`;
      return result;
    }
  }
  return null;
}

export async function fetchGFS(station, startDate, endDate) {
  const s = STATIONS[station];
  const end = endDate || startDate;
  const url = `https://api.open-meteo.com/v1/gfs?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit` +
    `&start_date=${startDate}&end_date=${end}&timezone=America%2FNew_York`;
  const data = await fetchJSON(url);
  const dates = data.daily?.time || [];
  const maxTs = data.daily?.temperature_2m_max || [];
  const minTs = data.daily?.temperature_2m_min || [];
  
  if (dates.length === 1 && !endDate) {
    // Single date backward compat
    if (!maxTs.length) return null;
    return { source: 'GFS', high_f: round1(maxTs[0]), low_f: round1(minTs[0]) };
  }
  
  // Multi-date: return map
  const result = {};
  for (let i = 0; i < dates.length; i++) {
    result[dates[i]] = { source: 'GFS', high_f: round1(maxTs[i]), low_f: round1(minTs[i]) };
  }
  return result;
}

export async function fetchECMWF(station, startDate, endDate) {
  const s = STATIONS[station];
  const end = endDate || startDate;
  const url = `https://api.open-meteo.com/v1/ecmwf?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit` +
    `&start_date=${startDate}&end_date=${end}&timezone=America%2FNew_York`;
  try {
    const data = await fetchJSON(url);
    const dates = data.daily?.time || [];
    const maxTs = data.daily?.temperature_2m_max || [];
    const minTs = data.daily?.temperature_2m_min || [];
    
    if (dates.length === 1 && !endDate) {
      if (!maxTs.length) return null;
      return { source: 'ECMWF', high_f: round1(maxTs[0]), low_f: round1(minTs[0]) };
    }
    
    const result = {};
    for (let i = 0; i < dates.length; i++) {
      result[dates[i]] = { source: 'ECMWF', high_f: round1(maxTs[i]), low_f: round1(minTs[i]) };
    }
    return result;
  } catch { return null; }
}

/**
 * Build weighted consensus from multiple model forecasts.
 * Uses inverse-MAE weighting (ECMWF gets more weight when it has lower error).
 */
export function buildConsensus(forecasts, station, month, horizonDays = 0, tempType = 'high') {
  const valid = forecasts.filter(Boolean);
  if (valid.length < 2) {
    return { tradeable: false, reason: `Only ${valid.length} source(s), need ≥2`, forecasts: valid };
  }

  const tempKey = tempType === 'low' ? 'low_f' : 'high_f';
  const weights = getModelWeights(station);
  const sigma = getEffectiveSigma(station, month, horizonDays, tempType);
  
  // Weighted mean using model-specific weights
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of valid) {
    const temp = f[tempKey] ?? f.high_f; // fallback for NWS which only has high_f
    if (temp == null) continue;
    const w = f.source === 'NWS' ? weights.nws : f.source === 'ECMWF' ? weights.ecmwf : weights.gfs;
    weightedSum += temp * w;
    totalWeight += w;
  }
  if (totalWeight === 0) {
    return { tradeable: false, reason: `No ${tempType} temp data available`, forecasts: valid };
  }
  const weightedMean = weightedSum / totalWeight;

  const temps = valid.map(f => f[tempKey] ?? f.high_f).filter(t => t != null);
  const spread = Math.max(...temps) - Math.min(...temps);
  const simpleMean = temps.reduce((a, b) => a + b, 0) / temps.length;

  const s = STATIONS[station];
  const adjustedMean = round1(weightedMean + (s.bias || 0));
  const climNormals = tempType === 'low' ? s.climNormalLow : s.climNormalHigh;
  const normalTemp = climNormals?.[month];
  const climDev = normalTemp != null ? round1(adjustedMean - normalTemp) : 0;

  const result = {
    forecasts: valid,
    spread: round1(spread),
    mean: round1(simpleMean),
    weightedMean: round1(weightedMean),
    adjustedMean,
    climDeviation: climDev,
    climNormal: normalTemp,
    climNormalHigh: tempType === 'high' ? normalTemp : s.climNormalHigh?.[month],
    tempType,
    sigma,
    horizonDays,
    tradeable: true,
    warnings: [],
  };

  if (spread > MAX_MODEL_SPREAD_F) {
    result.tradeable = false;
    result.reason = `Model spread ${spread.toFixed(1)}°F exceeds ${MAX_MODEL_SPREAD_F}°F limit`;
  }
  if (Math.abs(climDev) > CLIM_OUTLIER_THRESHOLD_F) {
    result.tradeable = false;
    result.reason = `Forecast ${adjustedMean.toFixed(1)}°F is ${Math.abs(climDev).toFixed(1)}°F from normal (${normalHigh}°F)`;
    result.warnings.push('CLIM_OUTLIER');
  }
  if (spread > 1 && spread <= MAX_MODEL_SPREAD_F) {
    result.warnings.push(`Spread ${spread.toFixed(1)}°F near threshold`);
  }
  if (horizonDays >= 2) {
    result.warnings.push(`Day+${horizonDays} forecast (σ=${sigma}°F)`);
  }
  // Data staleness warnings
  for (const f of valid) {
    if (f.staleWarning) result.warnings.push(f.staleWarning);
  }

  return result;
}

/**
 * Forecast a single date for a station.
 */
export async function forecast(station, date) {
  const todayStr = today();
  const horizonDays = Math.max(0, Math.round((new Date(date) - new Date(todayStr)) / 86400000));
  const month = parseInt(date.slice(5, 7));
  
  const [nws, gfs, ecmwf] = await Promise.all([
    fetchNWS(station, date).catch(() => null),
    fetchGFS(station, date).catch(() => null),
    fetchECMWF(station, date).catch(() => null),
  ]);
  const consensus = buildConsensus([nws, gfs, ecmwf], station, month, horizonDays);
  const consensusLow = buildConsensus([nws, gfs, ecmwf], station, month, horizonDays, 'low');
  return { station, date, horizonDays, nws, gfs, ecmwf, consensus, consensusLow };
}

/**
 * Forecast multiple dates for a station (efficient — single API calls).
 */
export async function forecastRange(station, startDate, endDate) {
  const todayStr = today();
  const results = [];
  
  const [nwsData, gfsData, ecmwfData] = await Promise.all([
    fetchNWS(station, startDate).catch(() => null),  // NWS only gives ~7 day forecast
    fetchGFS(station, startDate, endDate).catch(() => null),
    fetchECMWF(station, startDate, endDate).catch(() => null),
  ]);
  
  // Iterate dates
  const d = new Date(startDate + 'T12:00:00Z');
  const e = new Date(endDate + 'T12:00:00Z');
  while (d <= e) {
    const date = d.toISOString().slice(0, 10);
    const horizonDays = Math.max(0, Math.round((d - new Date(todayStr + 'T12:00:00Z')) / 86400000));
    const month = d.getMonth() + 1;
    
    const gfs = gfsData && typeof gfsData === 'object' && gfsData[date] ? gfsData[date] : (typeof gfsData === 'object' && gfsData.source ? gfsData : null);
    const ecmwf = ecmwfData && typeof ecmwfData === 'object' && ecmwfData[date] ? ecmwfData[date] : (typeof ecmwfData === 'object' && ecmwfData.source ? ecmwfData : null);
    // NWS: only works for the requested date
    const nws = date === startDate ? nwsData : null;
    
    const validForecasts = [nws, gfs, ecmwf].filter(Boolean);
    const consensus = buildConsensus(validForecasts, station, month, horizonDays);
    const consensusLow = buildConsensus(validForecasts, station, month, horizonDays, 'low');
    results.push({ station, date, horizonDays, nws, gfs, ecmwf, consensus, consensusLow });
    
    d.setDate(d.getDate() + 1);
  }
  
  return results;
}
