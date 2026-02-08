#!/usr/bin/env node
/**
 * Multi-source weather forecast pipeline.
 * Fetches NWS point forecasts + Open-Meteo GFS, compares them,
 * applies climatological sanity checks, and outputs a consensus or rejection.
 *
 * Usage: node forecast.js [STATION] [YYYY-MM-DD]
 *   e.g. node forecast.js KDEN 2026-02-09
 *   or   node forecast.js          (all stations, today)
 */

import { STATIONS, CLIM_OUTLIER_THRESHOLD_F, MAX_MODEL_SPREAD_F } from './stations.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function cToF(c) { return c * 9 / 5 + 32; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'weather-trading/1.0 (github.com/dchaniel/weather-trading)', ...headers },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

// ── NWS Forecast ─────────────────────────────────────────────────────────────

async function fetchNWSForecast(station, date) {
  const s = STATIONS[station];
  // NWS gridpoint forecast — gives 12h periods with high/low
  const url = `https://api.weather.gov/gridpoints/${s.nwsOffice}/${s.nwsGridX},${s.nwsGridY}/forecast`;
  const data = await fetchJSON(url);
  const periods = data.properties?.periods || [];

  // Find the daytime period matching our target date
  for (const p of periods) {
    const pDate = p.startTime.slice(0, 10);
    if (pDate === date && p.isDaytime) {
      return {
        source: 'NWS',
        high_f: p.temperature, // NWS gives °F directly
        description: p.shortForecast,
      };
    }
  }
  // Fallback: find any period on that date
  for (const p of periods) {
    if (p.startTime.slice(0, 10) === date && p.isDaytime) {
      return { source: 'NWS', high_f: p.temperature, description: p.shortForecast };
    }
  }
  return null;
}

// ── Open-Meteo GFS Forecast ─────────────────────────────────────────────────

async function fetchGFSForecast(station, date) {
  const s = STATIONS[station];
  const url = `https://api.open-meteo.com/v1/gfs?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit` +
    `&start_date=${date}&end_date=${date}&timezone=America%2FNew_York`;
  const data = await fetchJSON(url);
  const maxTemps = data.daily?.temperature_2m_max;
  if (!maxTemps || maxTemps.length === 0) return null;
  return {
    source: 'GFS (Open-Meteo)',
    high_f: Math.round(maxTemps[0] * 10) / 10,
    low_f: Math.round(data.daily.temperature_2m_min[0] * 10) / 10,
  };
}

// ── Open-Meteo ECMWF Forecast ───────────────────────────────────────────────

async function fetchECMWFForecast(station, date) {
  const s = STATIONS[station];
  const url = `https://api.open-meteo.com/v1/ecmwf?latitude=${s.lat}&longitude=${s.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit` +
    `&start_date=${date}&end_date=${date}&timezone=America%2FNew_York`;
  try {
    const data = await fetchJSON(url);
    const maxTemps = data.daily?.temperature_2m_max;
    if (!maxTemps || maxTemps.length === 0) return null;
    return {
      source: 'ECMWF (Open-Meteo)',
      high_f: Math.round(maxTemps[0] * 10) / 10,
      low_f: Math.round(data.daily.temperature_2m_min[0] * 10) / 10,
    };
  } catch {
    return null; // ECMWF may not always be available
  }
}

// ── Climatological Check ─────────────────────────────────────────────────────

function climCheck(station, month, forecastHigh) {
  const s = STATIONS[station];
  const normalHigh = s.climNormalHigh[month];
  const deviation = forecastHigh - normalHigh;
  return {
    normalHigh,
    deviation,
    isOutlier: Math.abs(deviation) > CLIM_OUTLIER_THRESHOLD_F,
  };
}

// ── Consensus Engine ─────────────────────────────────────────────────────────

function buildConsensus(forecasts, station, month) {
  const valid = forecasts.filter(f => f !== null);
  if (valid.length < 2) {
    return { tradeable: false, reason: `Only ${valid.length} source(s) available, need ≥2` };
  }

  const highs = valid.map(f => f.high_f);
  const min = Math.min(...highs);
  const max = Math.max(...highs);
  const spread = max - min;
  const mean = highs.reduce((a, b) => a + b, 0) / highs.length;
  const median = [...highs].sort((a, b) => a - b)[Math.floor(highs.length / 2)];

  // Apply station bias
  const s = STATIONS[station];
  const adjustedMean = mean + (s.bias || 0);

  // Climatological sanity
  const clim = climCheck(station, month, adjustedMean);

  const result = {
    forecasts: valid,
    spread: Math.round(spread * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    median: Math.round(median * 10) / 10,
    adjustedMean: Math.round(adjustedMean * 10) / 10,
    climDeviation: Math.round(clim.deviation * 10) / 10,
    climNormalHigh: clim.normalHigh,
    tradeable: true,
    warnings: [],
  };

  if (spread > MAX_MODEL_SPREAD_F) {
    result.tradeable = false;
    result.reason = `Model spread ${spread.toFixed(1)}°F exceeds ${MAX_MODEL_SPREAD_F}°F threshold`;
  }

  if (clim.isOutlier) {
    result.tradeable = false;
    result.reason = `Forecast ${adjustedMean.toFixed(1)}°F is ${Math.abs(clim.deviation).toFixed(1)}°F from normal (${clim.normalHigh}°F) — climatological outlier`;
    result.warnings.push('CLIM_OUTLIER');
  }

  if (spread > 1 && spread <= MAX_MODEL_SPREAD_F) {
    result.warnings.push(`Model spread ${spread.toFixed(1)}°F — near threshold`);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const stationArg = process.argv[2]?.toUpperCase();
  const dateArg = process.argv[3] || new Date().toISOString().slice(0, 10);
  const month = parseInt(dateArg.slice(5, 7));

  const stationsToCheck = stationArg && STATIONS[stationArg]
    ? [stationArg]
    : Object.keys(STATIONS);

  console.log(`\n📡 Weather Forecast Pipeline — ${dateArg}`);
  console.log('═'.repeat(60));

  const results = {};

  for (const station of stationsToCheck) {
    console.log(`\n🌡️  ${station} (${STATIONS[station].name})`);
    console.log('─'.repeat(50));

    const [nws, gfs, ecmwf] = await Promise.all([
      fetchNWSForecast(station, dateArg).catch(e => { console.log(`  ⚠ NWS error: ${e.message}`); return null; }),
      fetchGFSForecast(station, dateArg).catch(e => { console.log(`  ⚠ GFS error: ${e.message}`); return null; }),
      fetchECMWFForecast(station, dateArg).catch(e => { console.log(`  ⚠ ECMWF error: ${e.message}`); return null; }),
    ]);

    if (nws) console.log(`  NWS:   ${nws.high_f}°F — ${nws.description || ''}`);
    if (gfs) console.log(`  GFS:   ${gfs.high_f}°F`);
    if (ecmwf) console.log(`  ECMWF: ${ecmwf.high_f}°F`);

    const consensus = buildConsensus([nws, gfs, ecmwf], station, month);

    if (consensus.tradeable) {
      console.log(`  ✅ TRADEABLE — Consensus high: ${consensus.adjustedMean}°F (spread: ${consensus.spread}°F, clim dev: ${consensus.climDeviation > 0 ? '+' : ''}${consensus.climDeviation}°F)`);
    } else {
      console.log(`  ❌ NO TRADE — ${consensus.reason}`);
    }
    if (consensus.warnings?.length) {
      for (const w of consensus.warnings) console.log(`  ⚠ ${w}`);
    }

    results[station] = consensus;
    await sleep(200); // be nice to APIs
  }

  // Output JSON for programmatic use
  const outFile = `forecast-${dateArg}.json`;
  const { writeFileSync } = await import('fs');
  writeFileSync(outFile, JSON.stringify({ date: dateArg, results }, null, 2));
  console.log(`\n📄 Saved to ${outFile}`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
