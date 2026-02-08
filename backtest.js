#!/usr/bin/env node
/**
 * Backtest: compare past forecasts to actual observations.
 * Reads forecast-YYYY-MM-DD.json and observations-YYYY-MM-DD.json files.
 *
 * Usage: node backtest.js [YYYY-MM-DD]
 */

import { readFileSync, existsSync } from 'fs';

const date = process.argv[2] || (() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const fcstFile = `forecast-${date}.json`;
const obsFile = `observations-${date}.json`;

if (!existsSync(fcstFile)) { console.log(`No forecast file: ${fcstFile}`); process.exit(1); }
if (!existsSync(obsFile)) { console.log(`No observations file: ${obsFile}. Run: node observe.js ${date}`); process.exit(1); }

const fcst = JSON.parse(readFileSync(fcstFile, 'utf8'));
const obs = JSON.parse(readFileSync(obsFile, 'utf8'));

console.log(`\n📊 Backtest — ${date}`);
console.log('═'.repeat(60));
console.log(`${'Station'.padEnd(8)} ${'Forecast'.padStart(10)} ${'Actual'.padStart(10)} ${'Error'.padStart(10)} ${'Tradeable'.padStart(12)}`);
console.log('─'.repeat(60));

for (const [station, consensus] of Object.entries(fcst.results)) {
  const actual = obs.results?.[station];
  if (!actual) { console.log(`${station.padEnd(8)} ${'—'.padStart(10)} ${'no obs'.padStart(10)}`); continue; }

  const fcstHigh = consensus.adjustedMean || consensus.mean;
  const error = fcstHigh - actual.high_f;
  const absErr = Math.abs(error).toFixed(1);
  const sign = error >= 0 ? '+' : '';

  console.log(
    `${station.padEnd(8)} ${(fcstHigh + '°F').padStart(10)} ${(actual.high_f + '°F').padStart(10)} ${(sign + error.toFixed(1) + '°F').padStart(10)} ${(consensus.tradeable ? '✅' : '❌').padStart(12)}`
  );
}
