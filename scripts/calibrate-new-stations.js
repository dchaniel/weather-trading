#!/usr/bin/env node
/**
 * Calibrate new stations using Open-Meteo historical forecast vs actuals.
 * Fetches 60 days of data per station, computes MAE, bias, model-specific MAE.
 */

import { fetchJSON, round1 } from '../lib/core/utils.js';

const HIST_FORECAST_BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

// All stations to calibrate (new + existing uncalibrated)
const STATIONS_TO_CALIBRATE = {
  // Existing uncalibrated
  KIAH: { name: 'Houston Intercontinental', lat: 29.9844, lon: -95.3414 },
  KLAX: { name: 'Los Angeles International', lat: 33.9425, lon: -118.4081 },
  KATL: { name: 'Atlanta Hartsfield', lat: 33.6407, lon: -84.4277 },
  KDFW: { name: 'Dallas/Fort Worth', lat: 32.8998, lon: -97.0403 },
  // New stations
  KSFO: { name: 'San Francisco International', lat: 37.6213, lon: -122.3790 },
  KSEA: { name: 'Seattle-Tacoma International', lat: 47.4502, lon: -122.3088 },
  KOKC: { name: 'Oklahoma City Will Rogers', lat: 35.3931, lon: -97.6007 },
  KDCA: { name: 'Washington Reagan National', lat: 38.8512, lon: -77.0402 },
  KAUS: { name: 'Austin-Bergstrom International', lat: 30.1945, lon: -97.6699 },
  KMSP: { name: 'Minneapolis-Saint Paul International', lat: 44.8848, lon: -93.2223 },
  KPHL: { name: 'Philadelphia International', lat: 39.8721, lon: -75.2411 },
  // Existing validated (for comparison)
  KNYC: { name: 'Central Park, NYC', lat: 40.7789, lon: -73.9692 },
  KMIA: { name: 'Miami International', lat: 25.7959, lon: -80.2870 },
  KDEN: { name: 'Denver International', lat: 39.8561, lon: -104.6737 },
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function calibrateStation(code, station) {
  // 60 days back from yesterday
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end - 60 * 86400000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  console.log(`\n📊 ${code} (${station.name}): ${startDate} to ${endDate}`);

  // Fetch forecasts
  const fcUrl = `${HIST_FORECAST_BASE}?latitude=${station.lat}&longitude=${station.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max&temperature_unit=fahrenheit` +
    `&models=gfs_seamless,ecmwf_ifs025`;
  
  const actUrl = `${ARCHIVE_BASE}?latitude=${station.lat}&longitude=${station.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max&temperature_unit=fahrenheit`;

  const [fcData, actData] = await Promise.all([
    fetchJSON(fcUrl),
    fetchJSON(actUrl),
  ]);

  const dates = fcData.daily?.time || [];
  const gfs = fcData.daily?.temperature_2m_max_gfs_seamless || [];
  const ecmwf = fcData.daily?.temperature_2m_max_ecmwf_ifs025 || [];
  const actDates = actData.daily?.time || [];
  const actHighs = actData.daily?.temperature_2m_max || [];

  // Build actuals map
  const actuals = {};
  for (let i = 0; i < actDates.length; i++) {
    if (actHighs[i] != null) actuals[actDates[i]] = actHighs[i];
  }

  const errors = [];
  const gfsErrors = [];
  const ecmwfErrors = [];
  const winterErrors = [];
  const biasValues = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const actual = actuals[date];
    if (actual == null) continue;

    const g = gfs[i], e = ecmwf[i];
    const vals = [g, e].filter(v => v != null);
    if (vals.length === 0) continue;

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const err = Math.abs(mean - actual);
    const signedErr = mean - actual;
    errors.push(err);
    biasValues.push(signedErr);

    if (g != null) gfsErrors.push(Math.abs(g - actual));
    if (e != null) ecmwfErrors.push(Math.abs(e - actual));

    const month = parseInt(date.slice(5, 7));
    if ([11, 12, 1, 2, 3].includes(month)) winterErrors.push(err);
  }

  if (errors.length < 20) {
    console.log(`   ⚠️ Only ${errors.length} observations, need ≥20`);
    return null;
  }

  errors.sort((a, b) => a - b);
  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const bias = biasValues.reduce((a, b) => a + b, 0) / biasValues.length;
  const gfsMae = gfsErrors.length > 0 ? gfsErrors.reduce((a, b) => a + b, 0) / gfsErrors.length : null;
  const ecmwfMae = ecmwfErrors.length > 0 ? ecmwfErrors.reduce((a, b) => a + b, 0) / ecmwfErrors.length : null;
  const winterMae = winterErrors.length > 0 ? winterErrors.reduce((a, b) => a + b, 0) / winterErrors.length : mae;
  const p90 = errors[Math.floor(errors.length * 0.9)];
  const p95 = errors[Math.min(Math.floor(errors.length * 0.95), errors.length - 1)];
  const maxErr = errors[errors.length - 1];

  // baseSigma = MAE × 1.1 (10% safety margin, same as existing stations)
  const baseSigma = round1(mae * 1.1 * 100) / 100;
  // Winter sigma would be baseSigma + 0.5
  const winterSigma = round1((baseSigma + 0.5) * 100) / 100;

  const result = {
    code, name: station.name,
    n: errors.length,
    mae: round1(mae * 100) / 100,
    bias: round1(bias * 100) / 100,
    gfsMae: gfsMae ? round1(gfsMae * 100) / 100 : null,
    ecmwfMae: ecmwfMae ? round1(ecmwfMae * 100) / 100 : null,
    winterMae: round1(winterMae * 100) / 100,
    p90: round1(p90 * 100) / 100,
    p95: round1(p95 * 100) / 100,
    maxErr: round1(maxErr * 100) / 100,
    baseSigma,
    winterSigma,
  };

  console.log(`   N=${result.n} | MAE=${result.mae}°F | Bias=${result.bias}°F`);
  console.log(`   GFS MAE=${result.gfsMae}°F | ECMWF MAE=${result.ecmwfMae}°F`);
  console.log(`   Winter MAE=${result.winterMae}°F | P90=${result.p90}°F | P95=${result.p95}°F | Max=${result.maxErr}°F`);
  console.log(`   → baseSigma=${result.baseSigma}°F | winterSigma=${result.winterSigma}°F`);

  return result;
}

async function main() {
  console.log('🔬 New Station Calibration — 60-day Historical Analysis');
  console.log('═'.repeat(60));

  const results = {};
  for (const [code, station] of Object.entries(STATIONS_TO_CALIBRATE)) {
    try {
      results[code] = await calibrateStation(code, station);
      await sleep(500); // Rate limit
    } catch (e) {
      console.log(`   ❌ Failed: ${e.message}`);
    }
  }

  console.log('\n\n' + '═'.repeat(60));
  console.log('📋 CALIBRATION SUMMARY');
  console.log('═'.repeat(60));
  console.log('Station  | N  | MAE   | Bias  | GFS   | ECMWF | baseSigma | Tier');
  console.log('---------|----|----- -|-------|-------|-------|-----------|-----');
  for (const [code, r] of Object.entries(results)) {
    if (!r) continue;
    // Tier: A if MAE < 1.5, B if < 2.5, F if >= 2.5
    const tier = r.mae < 1.5 ? 'A' : r.mae < 2.5 ? 'B' : 'F';
    console.log(`${code.padEnd(9)}| ${String(r.n).padEnd(3)}| ${String(r.mae).padEnd(6)}| ${String(r.bias).padEnd(6)}| ${String(r.gfsMae).padEnd(6)}| ${String(r.ecmwfMae).padEnd(6)}| ${String(r.baseSigma).padEnd(10)}| ${tier}`);
  }

  // Output JSON for programmatic use
  console.log('\n\n📦 JSON Results:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
