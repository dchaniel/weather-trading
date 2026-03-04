#!/usr/bin/env node
/**
 * validate-asos.js — Compare Open-Meteo archive temps vs NWS ASOS observations
 * 
 * FINDING (Mar 4 2026): Open-Meteo archive has MASSIVE discrepancy vs ASOS.
 * KNYC: MAE=8.7°F, Bias=-8.7°F (OM consistently colder than ASOS)
 * This means ALL backtests using Open-Meteo as ground truth are unreliable.
 * 
 * Usage: node scripts/validate-asos.js [station] [days]
 * Default: KNYC, 7 days
 */

import { STATIONS } from '../lib/weather/stations.js';
import { fetchObservation } from '../lib/weather/observe.js';
import { fetchJSON, round1 } from '../lib/core/utils.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'data', 'asos-validation.json');

const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

async function fetchOpenMeteoArchive(station, startDate, endDate) {
  const s = STATIONS[station];
  if (!s) return null;
  const url = `${ARCHIVE_BASE}?latitude=${s.lat}&longitude=${s.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America/New_York`;
  try {
    const data = await fetchJSON(url);
    const dates = data.daily?.time || [];
    const highs = data.daily?.temperature_2m_max || [];
    const result = {};
    for (let i = 0; i < dates.length; i++) {
      result[dates[i]] = { high_f: round1(highs[i]) };
    }
    return result;
  } catch (e) {
    console.error(`  Open-Meteo error for ${station}: ${e.message}`);
    return null;
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const station = process.argv[2] || 'KNYC';
  const days = parseInt(process.argv[3]) || 7;
  
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  
  console.log(`Validating ${station}: Open-Meteo vs ASOS, ${start} to ${end}\n`);
  
  const omData = await fetchOpenMeteoArchive(station, start, end);
  if (!omData) { console.log('❌ No Open-Meteo data'); return; }
  
  const comparisons = [];
  for (const date of Object.keys(omData).sort()) {
    try {
      const obs = await fetchObservation(station, date);
      if (!obs) { console.log(`  ${date}: no ASOS obs`); continue; }
      
      const diff = round1(omData[date].high_f - obs.high_f);
      comparisons.push({ date, omHigh: omData[date].high_f, asosHigh: obs.high_f, diff });
      console.log(`  ${date}: OM=${omData[date].high_f}°F  ASOS=${obs.high_f}°F  diff=${diff > 0 ? '+' : ''}${diff}°F`);
      await sleep(400);
    } catch { continue; }
  }
  
  if (!comparisons.length) { console.log('No data'); return; }
  
  const diffs = comparisons.map(c => c.diff);
  const mae = round1(diffs.map(Math.abs).reduce((a, b) => a + b, 0) / diffs.length);
  const bias = round1(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  
  console.log(`\n${station} Summary (N=${comparisons.length}):`);
  console.log(`  MAE: ${mae}°F`);
  console.log(`  Bias: ${bias > 0 ? '+' : ''}${bias}°F (OM - ASOS)`);
  console.log(`  baseSigma: ${STATIONS[station]?.baseSigma}°F`);
  console.log(`\n⚠️  If MAE > 2°F, backtests using Open-Meteo as ground truth are unreliable.`);
  
  writeFileSync(OUT_PATH, JSON.stringify({ station, start, end, comparisons, mae, bias }, null, 2));
  console.log(`Saved to ${OUT_PATH}`);
}

main().catch(console.error);
