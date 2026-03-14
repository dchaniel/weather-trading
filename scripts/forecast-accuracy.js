#!/usr/bin/env node
/**
 * forecast-accuracy.js — Compare actual forecasts from history against NWS ASOS observations
 * 
 * Uses REAL forecasts from data/history/forecasts.jsonl and compares them to
 * NWS ASOS observations (the actual settlement source) via the existing observe.js module.
 * 
 * Usage: node scripts/forecast-accuracy.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { STATIONS } from '../lib/weather/stations.js';
import { fetchObservation } from '../lib/weather/observe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load forecast history
const forecastLines = readFileSync(join(__dirname, '..', 'data', 'history', 'forecasts.jsonl'), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l));

// Group by station, dedupe keeping latest per date
const byStation = {};
for (const f of forecastLines) {
  if (!byStation[f.station]) byStation[f.station] = {};
  if (!byStation[f.station][f.date] || f.timestamp > byStation[f.station][f.date].timestamp) {
    byStation[f.station][f.date] = f;
  }
}

// Rate-limited delay
const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const stationNames = Object.keys(byStation).sort();
  const allResults = [];
  
  console.log('📊 Forecast Accuracy vs ASOS — Actual Forecasts from History');
  console.log('═'.repeat(70));
  
  for (const station of stationNames) {
    const forecasts = Object.values(byStation[station]).sort((a, b) => a.date.localeCompare(b.date));
    const minDate = forecasts[0].date;
    const maxDate = forecasts[forecasts.length - 1].date;
    
    process.stdout.write(`\n  ${station}: ${forecasts.length} days (${minDate} to ${maxDate})... `);
    
    const comparisons = [];
    for (const f of forecasts) {
      try {
        const obs = await fetchObservation(station, f.date);
        if (!obs || obs.high_f == null) continue;
        
        const error = f.forecast - obs.high_f;
        comparisons.push({
          date: f.date,
          forecast: f.forecast,
          actual: obs.high_f,
          error: Math.round(error * 10) / 10,
        });
      } catch (e) {
        // skip failed observations
      }
      await delay(200); // Rate limit NWS API
    }
    
    if (comparisons.length === 0) {
      console.log('no obs data');
      continue;
    }
    
    const errors = comparisons.map(c => c.error);
    const absErrors = errors.map(e => Math.abs(e));
    const mae = absErrors.reduce((a, b) => a + b, 0) / errors.length;
    const bias = errors.reduce((a, b) => a + b, 0) / errors.length;
    // Std dev of errors (residual after removing bias)
    const variance = errors.reduce((s, e) => s + (e - bias) ** 2, 0) / errors.length;
    const residualStd = Math.sqrt(variance);
    const within2 = errors.filter(e => Math.abs(e) <= 2).length;
    
    const s = STATIONS[station];
    console.log(`${comparisons.length} days matched`);
    console.log(`    MAE:  ${mae.toFixed(1)}°F  |  Bias: ${bias >= 0 ? '+' : ''}${bias.toFixed(1)}°F  |  Residual σ: ${residualStd.toFixed(1)}°F`);
    console.log(`    Within ±2°F: ${within2}/${comparisons.length} (${(within2/comparisons.length*100).toFixed(0)}%)`);
    console.log(`    Current baseSigma: ${s?.baseSigma || '?'}  |  bias correction: ${s?.bias || 0}`);
    // baseSigma should approximate the residual std (after bias correction)
    const suggested = Math.max(2.0, Math.round(residualStd * 1.3 * 10) / 10);
    console.log(`    Suggested baseSigma: ${suggested} (residualσ × 1.3, floor 2.0)`);
    
    allResults.push({ station, n: comparisons.length, mae, bias, residualStd, suggested, comparisons });
  }
  
  console.log('\n\n📋 Summary — baseSigma Recommendations');
  console.log('─'.repeat(70));
  console.log('  Station  N    MAE    Bias   Res.σ  Current  Suggest  Action');
  for (const r of allResults) {
    const s = STATIONS[r.station];
    const current = s?.baseSigma || 0;
    const action = Math.abs(current - r.suggested) > 0.5 ? '⚠️ UPDATE' : '✅ OK';
    console.log(`  ${r.station.padEnd(7)} ${String(r.n).padStart(3)}  ${r.mae.toFixed(1).padStart(5)}  ${((r.bias >= 0 ? '+' : '') + r.bias.toFixed(1)).padStart(5)}  ${r.residualStd.toFixed(1).padStart(5)}  ${String(current).padStart(7)}  ${String(r.suggested).padStart(7)}  ${action}`);
  }
}

main().catch(console.error);
