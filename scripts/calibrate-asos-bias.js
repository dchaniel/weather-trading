#!/usr/bin/env node
/**
 * calibrate-asos-bias.js — Compute Open-Meteo forecast bias vs ASOS for ALL stations
 * 
 * Problem: Open-Meteo forecasts (our signal source) have systematic cold bias
 * vs ASOS observations (Kalshi's settlement source). Without correcting for this,
 * our probability estimates are garbage.
 *
 * This script:
 * 1. Fetches 14-day Open-Meteo archive data for each tradeable station
 * 2. Fetches ASOS observations for the same period
 * 3. Computes bias (OM - ASOS) per station
 * 4. Updates stations.json with corrected bias values
 * 
 * Usage: node scripts/calibrate-asos-bias.js [--days 14] [--dry-run] [--apply]
 */

import { STATIONS, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { fetchObservation } from '../lib/weather/observe.js';
import { fetchJSON, round1 } from '../lib/core/utils.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIONS_PATH = join(__dirname, '..', 'data', 'stations.json');
const OUT_PATH = join(__dirname, '..', 'data', 'asos-calibration.json');
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

const args = process.argv.slice(2);
const days = parseInt(args.find((_, i, a) => a[i-1] === '--days') || '14');
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOMArchive(station, start, end) {
  const s = STATIONS[station];
  if (!s) return null;
  const tz = s.timezone || 'America/New_York';
  const url = `${ARCHIVE_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=${tz}`;
  try {
    const data = await fetchJSON(url);
    const dates = data.daily?.time || [];
    const highs = data.daily?.temperature_2m_max || [];
    const result = {};
    for (let i = 0; i < dates.length; i++) {
      if (highs[i] != null) result[dates[i]] = round1(highs[i]);
    }
    return result;
  } catch (e) {
    console.error(`  OM error ${station}: ${e.message}`);
    return null;
  }
}

async function main() {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // yesterday
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  console.log(`ASOS Bias Calibration: ${start} to ${end} (${days} days)\n`);

  const results = {};

  for (const station of TRADEABLE_STATIONS) {
    process.stdout.write(`${station}: `);
    const omData = await fetchOMArchive(station, start, end);
    if (!omData) { console.log('❌ no OM data'); continue; }

    const comparisons = [];
    for (const date of Object.keys(omData).sort()) {
      try {
        const obs = await fetchObservation(station, date);
        if (!obs || obs.high_f == null) continue;
        const diff = round1(omData[date] - obs.high_f);
        comparisons.push({ date, om: omData[date], asos: obs.high_f, diff });
        await sleep(300); // rate limit NWS API
      } catch { continue; }
    }

    if (comparisons.length < 3) {
      console.log(`only ${comparisons.length} valid days, skipping`);
      continue;
    }

    const diffs = comparisons.map(c => c.diff);
    const bias = round1(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    const mae = round1(diffs.map(Math.abs).reduce((a, b) => a + b, 0) / diffs.length);
    const stdDev = round1(Math.sqrt(diffs.map(d => (d - bias) ** 2).reduce((a, b) => a + b, 0) / diffs.length));
    
    results[station] = { bias, mae, stdDev, n: comparisons.length, comparisons };
    const currentBias = STATIONS[station]?.bias || 0;
    console.log(`bias=${bias > 0 ? '+' : ''}${bias}°F  MAE=${mae}°F  σ=${stdDev}°F  n=${comparisons.length}  (current bias correction: ${currentBias})`);
  }

  // Save raw results
  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nSaved raw results to ${OUT_PATH}`);

  // Apply to stations.json
  if (apply && !dryRun) {
    const stationsData = JSON.parse(readFileSync(STATIONS_PATH, 'utf8'));
    let updated = 0;
    for (const [station, data] of Object.entries(results)) {
      if (stationsData[station]) {
        // Bias correction: we add this to OM forecast to approximate ASOS
        // If OM is -5°F vs ASOS, we need to ADD 5°F → bias correction = -bias
        const correction = round1(-data.bias);
        const oldBias = stationsData[station].bias || 0;
        stationsData[station].bias = correction;
        // Also update baseSigma to reflect actual OM-vs-ASOS spread
        const newSigma = round1(Math.max(data.mae, data.stdDev + Math.abs(data.bias) * 0.3, 3.0));
        stationsData[station].baseSigma = newSigma;
        console.log(`  ${station}: bias ${oldBias} → ${correction}, baseSigma → ${newSigma}`);
        updated++;
      }
    }
    writeFileSync(STATIONS_PATH, JSON.stringify(stationsData, null, 2));
    console.log(`\nUpdated ${updated} stations in stations.json`);
  } else {
    console.log('\nProposed corrections (run with --apply to write):');
    for (const [station, data] of Object.entries(results)) {
      const correction = round1(-data.bias);
      const currentBias = STATIONS[station]?.bias || 0;
      const delta = round1(correction - currentBias);
      if (Math.abs(delta) > 0.5) {
        console.log(`  ${station}: bias ${currentBias} → ${correction} (Δ${delta > 0 ? '+' : ''}${delta}°F)`);
      }
    }
  }
}

main().catch(console.error);
