#!/usr/bin/env node
/**
 * Recalibrate baseSigma values using real historical forecast vs actual data.
 * 
 * The problem: Current baseSigma values (0.68-1.72°F) are WAY too low compared 
 * to market implied σ (3-6°F), causing false edge detection.
 * 
 * Solution: Use Open-Meteo historical forecast API to compute actual forecast
 * error standard deviations over the last 60-90 days, with a 2°F minimum floor.
 */

import { fetchHistoricalData } from '../lib/weather/historical.js';
import { STATIONS, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stationsPath = join(__dirname, '..', 'data', 'stations.json');

// Configuration
const MIN_SIGMA_FLOOR = 2.0;  // Minimum baseSigma - floor at 2°F
const LOOKBACK_DAYS = 90;     // Look back 90 days for calibration data
const MIN_SAMPLES = 20;       // Minimum samples needed for recalibration

/**
 * Get date range for historical analysis
 */
function getDateRange() {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // Yesterday (avoid incomplete data)
  
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);
  
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10)
  };
}

/**
 * Recalibrate a single station
 */
async function recalibrateStation(stationId) {
  const { startDate, endDate } = getDateRange();
  
  console.log(`\n📊 Analyzing ${stationId} (${STATIONS[stationId]?.name || stationId})`);
  console.log(`   Period: ${startDate} to ${endDate}`);
  
  try {
    const data = await fetchHistoricalData(stationId, startDate, endDate);
    
    if (data.errors.length < MIN_SAMPLES) {
      console.log(`   ❌ Insufficient data: ${data.errors.length} samples (need ${MIN_SAMPLES}+)`);
      return null;
    }
    
    // Current values
    const currentSigma = STATIONS[stationId].baseSigma || 0;
    const currentMAE = data.stats.mae;
    const actualStdDev = data.stats.stdDev;
    
    // NEW baseSigma = max(actual_std_dev, MIN_SIGMA_FLOOR)
    const newSigma = Math.max(actualStdDev, MIN_SIGMA_FLOOR);
    
    console.log(`   📈 Current baseSigma: ${currentSigma}°F`);
    console.log(`   📊 Historical MAE: ${currentMAE}°F`);
    console.log(`   📊 Historical σ (std dev): ${actualStdDev}°F`);
    console.log(`   🎯 NEW baseSigma: ${newSigma}°F (${((newSigma / currentSigma - 1) * 100).toFixed(0)}% change)`);
    console.log(`   📝 Samples: ${data.errors.length}`);
    
    // Calculate sigma ratio (what market σ needs to be for us to have edge)
    const minMarketSigmaForEdge = newSigma + 1.5; // Need at least 1.5°F gap
    console.log(`   💰 Need market σ ≥ ${minMarketSigmaForEdge.toFixed(1)}°F for edge`);
    
    return {
      stationId,
      currentSigma,
      newSigma: Math.round(newSigma * 100) / 100,
      mae: currentMAE,
      stdDev: actualStdDev,
      samples: data.errors.length,
      percentChange: ((newSigma / currentSigma - 1) * 100).toFixed(0)
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Update stations.json with new baseSigma values
 */
function updateStationsFile(recalibrations) {
  console.log(`\n📝 Updating stations.json...`);
  
  // Read current stations data
  const stations = JSON.parse(readFileSync(stationsPath, 'utf8'));
  
  let updatedCount = 0;
  for (const recal of recalibrations) {
    if (recal && stations[recal.stationId]) {
      const oldSigma = stations[recal.stationId].baseSigma;
      stations[recal.stationId].baseSigma = recal.newSigma;
      
      // Also update MAE for reference
      stations[recal.stationId].currentMAE = recal.mae;
      stations[recal.stationId].currentStdDev = recal.stdDev;
      
      console.log(`   ✅ ${recal.stationId}: ${oldSigma}°F → ${recal.newSigma}°F`);
      updatedCount++;
    }
  }
  
  // Add recalibration metadata
  stations._recalibration = {
    date: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    minSigmaFloor: MIN_SIGMA_FLOOR,
    updatedStations: updatedCount,
    version: '1.0.0'
  };
  
  // Write back to file
  writeFileSync(stationsPath, JSON.stringify(stations, null, 2));
  console.log(`   💾 Updated ${updatedCount} stations in stations.json`);
}

/**
 * Generate summary report
 */
function generateSummary(recalibrations) {
  console.log(`\n📋 RECALIBRATION SUMMARY`);
  console.log(`═`.repeat(80));
  
  const valid = recalibrations.filter(r => r !== null);
  const avgChange = valid.reduce((sum, r) => sum + parseFloat(r.percentChange), 0) / valid.length;
  
  console.log(`Total stations analyzed: ${recalibrations.length}`);
  console.log(`Successfully recalibrated: ${valid.length}`);
  console.log(`Average σ increase: ${avgChange.toFixed(0)}%`);
  console.log(`Minimum σ floor applied: ${MIN_SIGMA_FLOOR}°F`);
  
  // Show biggest changes
  console.log(`\n🏆 Largest adjustments:`);
  const sorted = valid.sort((a, b) => Math.abs(parseFloat(b.percentChange)) - Math.abs(parseFloat(a.percentChange)));
  for (const r of sorted.slice(0, 5)) {
    console.log(`   ${r.stationId}: ${r.currentSigma}°F → ${r.newSigma}°F (${r.percentChange > 0 ? '+' : ''}${r.percentChange}%)`);
  }
  
  console.log(`\n⚠️  NEXT STEPS:`);
  console.log(`   1. Test new values: npm run recommend --dry-run`);
  console.log(`   2. Should see FEWER trades with realistic edges`);
  console.log(`   3. Commit changes and create PR`);
  console.log(`   4. Review trading guards for appropriate σ ratio thresholds`);
  
  return {
    totalAnalyzed: recalibrations.length,
    successfullyRecalibrated: valid.length,
    averageChange: avgChange
  };
}

/**
 * Main execution
 */
async function main() {
  console.log(`🔧 KALSHI WEATHER SIGMA RECALIBRATION`);
  console.log(`═`.repeat(80));
  console.log(`Problem: baseSigma values are too low (0.68-1.72°F) vs market σ (3-6°F)`);
  console.log(`Solution: Recalibrate using ${LOOKBACK_DAYS}-day historical forecast errors`);
  console.log(`Minimum floor: ${MIN_SIGMA_FLOOR}°F (realistic lower bound)`);
  
  const stationsToAnalyze = Array.from(TRADEABLE_STATIONS);
  console.log(`\nAnalyzing ${stationsToAnalyze.length} tradeable stations...`);
  
  const recalibrations = [];
  
  for (const stationId of stationsToAnalyze) {
    const result = await recalibrateStation(stationId);
    recalibrations.push(result);
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Update stations file
  updateStationsFile(recalibrations);
  
  // Generate summary
  const summary = generateSummary(recalibrations);
  
  console.log(`\n✅ Recalibration complete!`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  });
}