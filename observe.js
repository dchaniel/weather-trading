#!/usr/bin/env node
/**
 * Fetch actual observations from NWS for backtesting and settlement verification.
 *
 * Usage: node observe.js [STATION] [YYYY-MM-DD]
 *   e.g. node observe.js KDEN 2026-02-08
 *   or   node observe.js          (all stations, yesterday)
 */

import { STATIONS } from './stations.js';

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'weather-trading/1.0 (github.com/dchaniel/weather-trading)' },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function cToF(c) { return Math.round(c * 9 / 5 + 32 * 10) / 10; }

async function fetchObservations(station, date) {
  const s = STATIONS[station];
  const start = `${date}T00:00:00Z`;
  const nextDay = new Date(date + 'T00:00:00Z');
  nextDay.setDate(nextDay.getDate() + 1);
  const end = nextDay.toISOString().slice(0, 10) + 'T06:00:00Z'; // extend to 6am next day for late reports

  const url = `https://api.weather.gov/stations/${s.observationStation}/observations?start=${start}&end=${end}`;
  const data = await fetchJSON(url);
  const features = data.features || [];

  if (features.length === 0) return null;

  const temps = features
    .map(f => f.properties?.temperature?.value)
    .filter(t => t !== null && t !== undefined);

  if (temps.length === 0) return null;

  const maxC = Math.max(...temps);
  const minC = Math.min(...temps);

  return {
    station,
    date,
    observations: temps.length,
    high_f: Math.round(cToF(maxC) * 10) / 10,
    low_f: Math.round(cToF(minC) * 10) / 10,
    high_c: Math.round(maxC * 10) / 10,
    low_c: Math.round(minC * 10) / 10,
  };
}

async function run() {
  const stationArg = process.argv[2]?.toUpperCase();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateArg = process.argv[3] || yesterday.toISOString().slice(0, 10);

  const stations = stationArg && STATIONS[stationArg]
    ? [stationArg]
    : Object.keys(STATIONS);

  console.log(`\n🌤️  Actual Observations — ${dateArg}`);
  console.log('═'.repeat(50));

  const results = {};

  for (const station of stations) {
    try {
      const obs = await fetchObservations(station, dateArg);
      if (obs) {
        console.log(`  ${station}: High ${obs.high_f}°F / Low ${obs.low_f}°F (${obs.observations} obs)`);
        results[station] = obs;
      } else {
        console.log(`  ${station}: No data`);
      }
    } catch (e) {
      console.log(`  ${station}: Error — ${e.message}`);
    }
  }

  const { writeFileSync } = await import('fs');
  const outFile = `observations-${dateArg}.json`;
  writeFileSync(outFile, JSON.stringify({ date: dateArg, results }, null, 2));
  console.log(`\n📄 Saved to ${outFile}`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
