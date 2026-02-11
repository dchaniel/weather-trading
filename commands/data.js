/**
 * kalshi data — Consolidated data command with subcommands
 * 
 * kalshi data collect [--silent]       - Collect IV snapshot to history (for cron)
 * kalshi data snapshot                 - Full data snapshot to JSONL files
 * kalshi data history [options]        - Query historical data
 * kalshi data settle [date]            - Auto-settlement with NWS verification  
 * kalshi data observe [station] [date] - Fetch actual weather observations
 */

import ivCommand from './implied_vol.js';
import { writeFileSync } from 'fs';
import { STATIONS, resolveStation } from '../lib/weather/stations.js';
import { fetchObservation } from '../lib/weather/observe.js';
import { fetchJSON, today, round2, yesterday } from '../lib/core/utils.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';
import { 
  appendForecast, 
  appendMarketSnapshot, 
  appendDecision, 
  readHistoryFile, 
  getHistorySummary 
} from '../lib/core/history.js';

export default async function(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHelp();
    return;
  }

  switch (subcommand) {
    case 'collect':
      return collectCmd(args.slice(1));
    case 'snapshot':
      return snapshotCmd(args.slice(1));
    case 'history':
      return historyCmd(args.slice(1));
    case 'observe':
      return observeCmd(args.slice(1));
    case 'settle':
      console.log('\n  ℹ️  `kalshi data settle` is deprecated. Use `kalshi trade settle` instead.\n');
      return;
    default:
      console.error(`Unknown data command: ${subcommand}`);
      showHelp();
      process.exit(1);
  }
}

async function collectCmd(args) {
  const silent = args.includes('--silent');
  
  if (!silent) console.log('\n📦 Collecting IV snapshot...\n');
  
  // Run IV analysis (reuses the same logic)
  const results = await ivCommand(args.filter(a => a !== '--silent'));
  
  if (!results || results.length === 0) {
    if (!silent) console.log('  No IV data to collect.\n');
    return;
  }

  // Save to JSONL format for each station
  const targetDate = today();
  for (const result of results) {
    try {
      // Log forecast data
      if (result.forecastHigh) {
        appendForecast(result.station, {
          date: targetDate,
          forecast: result.forecastHigh,
          models: {}, // IV command doesn't have individual models
          spread: 0, // Not available in IV analysis
          climNormal: null,
          climDev: null,
        });
      }
      
      // Log market snapshot data  
      if (result.contracts && result.marketSigma && result.ourSigma) {
        appendMarketSnapshot(result.station, result.contracts, result.marketSigma, result.ourSigma);
      }
    } catch (e) {
      if (!silent) console.error(`Warning: Failed to log history for ${result.station}: ${e.message}`);
    }
  }

  if (!silent) {
    console.log(`\n  ✅ Snapshot saved to JSONL history`);
    console.log(`  📁 data/history/*.jsonl\n`);
  }

  return snapshot;
}

// settleCmd removed — use `kalshi trade settle` (delegates to lib/core/settlement.js)

async function observeCmd(args) {
  const station = resolveStation(args[0]);
  const date = args[1] || yesterday();
  const stations = station ? [station] : Object.keys(STATIONS);

  console.log(`\n🌤️  Observations — ${date}`);
  console.log('═'.repeat(50));

  for (const st of stations) {
    try {
      const obs = await fetchObservation(st, date);
      if (obs) {
        console.log(`  ${st}: High ${obs.high_f}°F / Low ${obs.low_f}°F (${obs.observations} obs)`);
      } else {
        console.log(`  ${st}: No data`);
      }
    } catch (e) {
      console.log(`  ${st}: Error — ${e.message}`);
    }
  }
  console.log();
}

/**
 * Fetch actual observed temperature from NWS or Open-Meteo
 * @param {string} station - Station code (e.g., 'KNYC')
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Object|null>} Observation data
 */
// fetchActualObservation removed — use fetchObservation from lib/weather/observe.js

async function snapshotCmd(args) {
  const silent = args.includes('--silent');
  if (!silent) console.log('\n📸 Full Data Snapshot...\n');

  const { forecast } = await import('../lib/weather/forecast.js');
  const { runGuards } = await import('../lib/core/guard.js');
  const { TRADEABLE_STATIONS, getEffectiveSigma } = await import('../lib/weather/stations.js');
  const { fetchStationMarkets } = await import('../lib/weather/matcher.js');
  const targetDate = today();
  let stats = { forecasts: 0, contracts: 0, decisions: 0 };

  for (const station of TRADEABLE_STATIONS) {
    try {
      if (!silent) console.log(`  Processing ${station}...`);
      const fc = await forecast(station, targetDate);
      if (!fc?.consensus) continue;

      appendForecast(station, { date: targetDate, forecast: fc.consensus.adjustedMean,
        models: { nws: fc.nws?.high_f || fc.nws?.temperature, gfs: fc.gfs?.high_f, ecmwf: fc.ecmwf?.high_f },
        spread: fc.consensus.spread || 0, climNormal: fc.consensus?.climNormalHigh || null, climDev: fc.consensus?.climDeviation || null });
      stats.forecasts++;

      const { markets, marketSigma } = await fetchStationMarkets(station, targetDate, fc.consensus.adjustedMean).catch(() => ({ markets: [], marketSigma: null }));
      if (markets.length > 0) {
        const contracts = markets.map(m => ({ ticker: m.ticker, yesBid: m.yesBid || 0, yesAsk: m.yesAsk || 0 }));
        const ourSigma = getEffectiveSigma(station, parseInt(targetDate.slice(5, 7)), fc.horizonDays || 0);
        appendMarketSnapshot(station, contracts, marketSigma, ourSigma);
        stats.contracts += contracts.length;

        const guardResult = runGuards({ station, qty: 10, forecastSpread: fc.consensus.spread, marketSigma, forecastHigh: fc.consensus.adjustedMean, date: targetDate });
        const netEdge = marketSigma && ourSigma ? marketSigma - ourSigma - TRANSACTION_COST : null;
        appendDecision(station, guardResult.pass ? 'APPROVED' : 'BLOCKED', guardResult.guardStates || {}, netEdge);
        stats.decisions++;
      }
    } catch (e) { if (!silent) console.log(`  ❌ ${station}: ${e.message}`); }
  }

  if (!silent) console.log(`\n  ✅ Snapshot: ${stats.forecasts} forecasts, ${stats.contracts} contracts, ${stats.decisions} decisions → data/history/*.jsonl\n`);
  return { stations: stats.forecasts };
}

async function historyCmd(args) {
  const station = args.find(arg => arg.match(/^K[A-Z]{3}$/));
  const stationFlag = args.indexOf('--station');
  const targetStation = stationFlag >= 0 ? args[stationFlag + 1] : station;
  
  const daysFlag = args.indexOf('--days');
  const days = daysFlag >= 0 ? parseInt(args[daysFlag + 1]) : null;
  
  const exportFlag = args.indexOf('--export');
  const exportFormat = exportFlag >= 0 ? args[exportFlag + 1] : null;
  
  // Calculate date range
  let startDate = null;
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    startDate = d.toISOString().slice(0, 10);
  }
  
  if (!targetStation && !exportFormat) {
    // Show summary
    console.log('\n📊 Historical Data Summary');
    console.log('═'.repeat(60));
    
    const summary = getHistorySummary();
    
    for (const [fileType, stats] of Object.entries(summary)) {
      console.log(`\n  ${fileType.toUpperCase()}`);
      console.log(`    Records: ${stats.totalRecords}`);
      if (stats.dateRange) {
        console.log(`    Date range: ${stats.dateRange.start} → ${stats.dateRange.end}`);
      }
      if (stats.stations) {
        console.log(`    Stations: ${stats.stations.join(', ')}`);
      }
    }
    console.log();
    return;
  }
  
  if (targetStation) {
    // Show station-specific history
    console.log(`\n📈 ${targetStation} History ${days ? `(last ${days} days)` : ''}`);
    console.log('═'.repeat(60));
    
    const forecastData = readHistoryFile('forecasts', { startDate })
      .filter(r => r.station === targetStation);
    const marketData = readHistoryFile('markets', { startDate })
      .filter(r => r.station === targetStation);
    const decisionData = readHistoryFile('decisions', { startDate })
      .filter(r => r.station === targetStation);
    
    console.log(`\n  FORECASTS: ${forecastData.length} records`);
    for (const record of forecastData.slice(-5)) {
      console.log(`    ${record.date}: ${record.forecast}°F (spread: ${record.spread}°F)`);
    }
    
    console.log(`\n  MARKET DATA: ${marketData.length} records`);
    for (const record of marketData.slice(-5)) {
      console.log(`    ${record.date}: σ gap ${(record.sigmaGap || 0).toFixed(2)}°F (market: ${(record.marketSigma || 0).toFixed(2)}, ours: ${(record.ourSigma || 0).toFixed(2)})`);
    }
    
    console.log(`\n  DECISIONS: ${decisionData.length} records`);
    for (const record of decisionData.slice(-5)) {
      console.log(`    ${record.date}: ${record.action} (edge: ${(record.netEdge || 0).toFixed(3)})`);
    }
    
    console.log();
    return;
  }
  
  if (exportFormat === 'csv') {
    // Export to CSV
    console.log('\n📤 Exporting to CSV...\n');
    
    // Simple CSV export for each file type
    const files = ['forecasts', 'observations', 'markets', 'decisions', 'trades'];
    
    for (const fileType of files) {
      const data = readHistoryFile(fileType);
      if (data.length === 0) continue;
      
      const csvPath = `data/history/${fileType}.csv`;
      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
          const value = row[h];
          if (value === null || value === undefined || value === '') {
            return '"N/A"';
          }
          return JSON.stringify(value);
        }).join(','))
      ].join('\n');
      
      writeFileSync(csvPath, csvContent);
      console.log(`  ✅ ${csvPath} (${data.length} records)`);
    }
    
    console.log();
  }
}

function showHelp() {
  console.log(`
kalshi data — Unified data management

Commands:
  kalshi data collect [--silent]           Collect IV snapshot to history (for cron)
  kalshi data snapshot [--silent]          Full data snapshot to JSONL files ⭐
  kalshi data history [options]            Query historical data ⭐
  kalshi data observe [station] [date]     Fetch actual weather observations
  kalshi data settle <date>                Auto-settlement with verification

History Options:
  kalshi data history                      Show summary of all data
  kalshi data history --station KNYC      Show KNYC history
  kalshi data history --station KNYC --days 30   Last 30 days for KNYC
  kalshi data history --export csv        Export all data to CSV

Examples:
  kalshi data collect                      Collect current IV snapshot
  kalshi data collect --silent            Collect quietly (for cron)
  kalshi data snapshot                     Full snapshot for backtesting ⭐
  kalshi data history --station KNYC --days 7    KNYC last week ⭐
  kalshi data observe KNYC                 Observe KNYC yesterday
  kalshi data observe KNYC 2026-02-08     Observe KNYC specific date
  kalshi data settle 2026-02-08           Settle all trades for date
`);
}