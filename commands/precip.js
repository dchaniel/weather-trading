/**
 * kalshi precip — Precipitation market analysis and trade recommendations.
 * 
 * Subcommands:
 *   kalshi precip               — Scan all precipitation markets for edges
 *   kalshi precip calibrate     — Run historical calibration
 *   kalshi precip markets       — List active precipitation markets
 *   kalshi precip forecast <st> — Show precipitation forecast for a station
 */

import { PRECIP_STATIONS, PRECIP_TRADEABLE, resolvePrecipStation } from '../lib/precipitation/stations.js';
import { precipForecast, fetchMonthToDateActual } from '../lib/precipitation/forecast.js';
import { scanPrecipMarkets, formatPrecipRec, parsePrecipTicker } from '../lib/precipitation/matcher.js';
import { ensembleDailyRainProb, fitGammaParams, gammaSurvival } from '../lib/precipitation/ensemble.js';
import { calibratePrecipStation } from '../lib/precipitation/calibration.js';
import { getSeriesMarkets } from '../lib/kalshi/client.js';
import { getLedger } from '../lib/core/trade.js';
import { today, round2, sleep } from '../lib/core/utils.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';

export default async function(args) {
  const sub = args[0];
  
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }
  
  if (sub === 'calibrate') return runCalibrate(args.slice(1));
  if (sub === 'markets') return runMarkets(args.slice(1));
  if (sub === 'forecast') return runForecast(args.slice(1));
  
  // Default: scan for trade opportunities
  return runScan(args);
}

// ── Scan (default) ───────────────────────────────────────────────────────────

async function runScan(args) {
  const verbose = args.includes('-v') || args.includes('--verbose');
  const stationFilter = args.find(a => !a.startsWith('-') && a !== 'scan');
  const resolvedStation = stationFilter ? resolvePrecipStation(stationFilter) : null;
  
  const ledger = getLedger();
  const balance = ledger.balance;
  
  console.log(`\n🌧️  Precipitation Market Analysis — ${today()}`);
  console.log(`   Balance: $${balance.toFixed(2)}`);
  console.log('═'.repeat(60));
  
  // Show station overview
  console.log('\n📍 Active Precipitation Stations:');
  for (const [key, s] of Object.entries(PRECIP_STATIONS)) {
    const tradeable = PRECIP_TRADEABLE.has(key);
    const icon = tradeable ? '✅' : '⛔';
    const type = s.marketType === 'daily_binary' ? 'Daily binary' : 'Monthly threshold';
    console.log(`   ${icon} ${key.padEnd(14)} ${s.name.padEnd(30)} ${type}`);
  }
  
  console.log('\n🔍 Scanning markets for edges...\n');
  
  try {
    const recs = await scanPrecipMarkets({
      balance,
      minEdge: 0.05,
      stationFilter: resolvedStation,
    });
    
    if (recs.length === 0) {
      console.log('   ⛔ No precipitation trades with ≥5% edge found.\n');
      console.log('   This is normal — precipitation markets are often efficient.');
      console.log('   Run `kalshi precip markets` to see all active markets.');
      console.log('   Run `kalshi precip calibrate` to check our forecast accuracy.\n');
      return;
    }
    
    // Group by market type
    const dailyRecs = recs.filter(r => r.marketType === 'daily_binary');
    const monthlyRecs = recs.filter(r => r.marketType === 'monthly_threshold');
    
    if (dailyRecs.length > 0) {
      console.log('🌧️  DAILY RAIN MARKETS');
      console.log('─'.repeat(50));
      for (const rec of dailyRecs.slice(0, 5)) {
        console.log(formatPrecipRec(rec));
        console.log();
      }
    }
    
    if (monthlyRecs.length > 0) {
      console.log('📊 MONTHLY TOTAL RAIN MARKETS');
      console.log('─'.repeat(50));
      for (const rec of monthlyRecs.slice(0, 5)) {
        console.log(formatPrecipRec(rec));
        console.log();
      }
    }
    
    // Summary
    const totalEV = recs.reduce((s, r) => s + r.ev, 0);
    console.log('═'.repeat(60));
    console.log(`🎯 ${recs.length} opportunities found | Total EV: $${totalEV.toFixed(2)}`);
    console.log(`   Transaction cost: ${(TRANSACTION_COST * 100).toFixed(0)}¢/contract\n`);
    
    // Risk warnings
    const lowLiq = recs.filter(r => r.lowLiquidity);
    if (lowLiq.length > 0) {
      console.log(`   ⚠️  ${lowLiq.length} recommendation(s) have LOW LIQUIDITY — caution with large orders`);
    }
    
  } catch (e) {
    console.error(`\n   ❌ Error scanning markets: ${e.message}\n`);
    if (verbose) console.error(e.stack);
  }
}

// ── Markets ──────────────────────────────────────────────────────────────────

async function runMarkets(args) {
  console.log(`\n📋 Active Precipitation Markets — ${today()}`);
  console.log('═'.repeat(70));
  
  for (const [key, station] of Object.entries(PRECIP_STATIONS)) {
    const tradeable = PRECIP_TRADEABLE.has(key);
    
    try {
      const events = await getSeriesMarkets(station.kalshiSeries);
      if (!events.length) {
        console.log(`\n  ${key}: ${station.name} — No active markets`);
        continue;
      }
      
      console.log(`\n  ${tradeable ? '✅' : '⛔'} ${key}: ${station.name} (${station.kalshiSeries})`);
      
      for (const event of events) {
        console.log(`     ${event.title}`);
        console.log(`     ${'Ticker'.padEnd(25)} ${'Bid'.padEnd(6)} ${'Ask'.padEnd(6)} ${'Mid'.padEnd(6)} ${'Vol'.padEnd(8)} OI`);
        console.log(`     ${'─'.repeat(60)}`);
        
        for (const mkt of event.markets || []) {
          const mid = ((mkt.yesBid + mkt.yesAsk) / 2 * 100).toFixed(0);
          console.log(
            `     ${mkt.ticker.padEnd(25)} ` +
            `${(mkt.yesBid * 100).toFixed(0).padEnd(6)} ` +
            `${(mkt.yesAsk * 100).toFixed(0).padEnd(6)} ` +
            `${mid.padEnd(6)} ` +
            `${String(mkt.volume || 0).padEnd(8)} ` +
            `${mkt.openInterest || 0}`
          );
        }
      }
    } catch (e) {
      console.log(`\n  ${key}: ${station.name} — Error: ${e.message}`);
    }
    
    await sleep(200);
  }
  console.log();
}

// ── Forecast ─────────────────────────────────────────────────────────────────

async function runForecast(args) {
  const stationArg = args[0];
  if (!stationArg) {
    console.log('Usage: kalshi precip forecast <station>');
    console.log('Stations:', Object.keys(PRECIP_STATIONS).join(', '));
    return;
  }
  
  const stationKey = resolvePrecipStation(stationArg);
  if (!stationKey) {
    console.log(`Unknown station: ${stationArg}`);
    return;
  }
  
  const station = PRECIP_STATIONS[stationKey];
  const dateArg = args[1] || today();
  
  console.log(`\n🌧️  Precipitation Forecast — ${station.name}`);
  console.log('═'.repeat(60));
  
  if (station.marketType === 'daily_binary') {
    // Show 3-day daily forecast
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      
      try {
        const fc = await precipForecast(stationKey, date);
        const ensemble = ensembleDailyRainProb(fc.consensus, stationKey);
        
        console.log(`\n  📅 ${date} (day+${i}):`);
        if (fc.nws) console.log(`     NWS: PoP=${fc.nws.rainProb != null ? (fc.nws.rainProb * 100).toFixed(0) + '%' : 'N/A'} — ${fc.nws.description || ''}`);
        if (fc.gfs) console.log(`     GFS: ${fc.gfs.precipInches}" precip, PoP=${fc.gfs.rainProb != null ? (fc.gfs.rainProb * 100).toFixed(0) + '%' : 'N/A'}`);
        if (fc.ecmwf) console.log(`     ECMWF: ${fc.ecmwf.precipInches}" precip`);
        console.log(`     📊 Calibrated P(rain): ${ensemble.prob != null ? (ensemble.prob * 100).toFixed(1) + '%' : 'N/A'} (${ensemble.confidence})`);
      } catch (e) {
        console.log(`\n  📅 ${date}: Error — ${e.message}`);
      }
    }
  } else {
    // Show monthly total forecast
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const totalDays = new Date(year, month, 0).getDate();
    
    try {
      const mtd = await fetchMonthToDateActual(stationKey, year, month);
      const clim = { mean: station.climMonthlyMean?.[month] || 2, std: station.climMonthlyStd?.[month] || 1 };
      
      console.log(`\n  📅 ${year}-${String(month).padStart(2, '0')} Monthly Total:`);
      console.log(`     Month-to-date actual: ${mtd.totalInches}" (${mtd.daysWithData} days)`);
      console.log(`     Climatological mean: ${clim.mean}" ± ${clim.std}"`);
      
      const params = fitGammaParams({
        climMean: clim.mean,
        climStd: clim.std,
        mtdActual: mtd.totalInches,
        mtdDays: mtd.daysWithData,
        totalDays,
      });
      
      console.log(`     Gamma model: α=${params.alpha} β=${params.beta} μ=${params.mean}"`);
      console.log(`\n     Threshold probabilities:`);
      for (let t = 1; t <= 7; t++) {
        const p = gammaSurvival(t, params.alpha, params.beta);
        const bar = '█'.repeat(Math.round(p * 30));
        console.log(`       P(>${t}"): ${(p * 100).toFixed(1).padStart(5)}% ${bar}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  console.log();
}

// ── Calibrate ────────────────────────────────────────────────────────────────

async function runCalibrate(args) {
  const days = parseInt(args.find(a => /^\d+$/.test(a))) || 90;
  const stationArg = args.find(a => !/^\d+$/.test(a) && !a.startsWith('-'));
  
  console.log(`\n📐 Precipitation Forecast Calibration (${days} days)`);
  console.log('═'.repeat(60));
  
  const stations = stationArg
    ? [resolvePrecipStation(stationArg)].filter(Boolean)
    : Object.keys(PRECIP_STATIONS);
  
  for (const stationKey of stations) {
    try {
      const result = await calibratePrecipStation(stationKey, days);
      
      console.log(`\n  📍 ${result.name}`);
      console.log(`     Period: ${result.period.startDate} to ${result.period.endDate}`);
      console.log(`\n     Daily Binary Calibration (N=${result.daily.n}):`);
      console.log(`       Rain frequency: ${result.daily.rainFrequency != null ? (result.daily.rainFrequency * 100).toFixed(1) + '%' : 'N/A'} (${result.daily.rainDays} rain / ${result.daily.dryDays} dry)`);
      
      if (result.daily.brier?.brier != null) {
        const b = result.daily.brier;
        console.log(`       Brier score: ${b.brier} (climatology: ${b.brierClim})`);
        console.log(`       Brier skill score: ${b.brierSkill} ${b.brierSkill > 0.2 ? '✅ Good' : b.brierSkill > 0 ? '⚠️ Marginal' : '❌ Poor'}`);
        
        if (b.reliability?.length > 0) {
          console.log(`\n       Reliability Diagram:`);
          console.log(`       ${'Forecast'.padEnd(10)} ${'Observed'.padEnd(10)} ${'N'.padEnd(6)} Calibration`);
          for (const bin of b.reliability) {
            const diff = Math.abs(bin.forecastMean - bin.observedFreq);
            const cal = diff < 0.05 ? '✅' : diff < 0.10 ? '⚠️' : '❌';
            console.log(`       ${(bin.forecastMean * 100).toFixed(0).padEnd(10)} ${(bin.observedFreq * 100).toFixed(0).padEnd(10)} ${String(bin.count).padEnd(6)} ${cal}`);
          }
        }
      }
      
      console.log(`\n     Forecast Amount Errors:`);
      console.log(`       GFS MAE: ${result.daily.gfsMAE ?? 'N/A'}" | ECMWF MAE: ${result.daily.ecmwfMAE ?? 'N/A'}"`);
      
      if (result.monthly.n > 0) {
        console.log(`\n     Monthly Total Calibration (N=${result.monthly.n}):`);
        const mc = result.monthly.calibration;
        console.log(`       50% CI coverage: ${(mc.coverage50 * 100).toFixed(0)}% (ideal: 50%) ${mc.overconfident50 ? '❌ Overconfident' : '✅'}`);
        console.log(`       90% CI coverage: ${(mc.coverage90 * 100).toFixed(0)}% (ideal: 90%) ${mc.overconfident90 ? '❌ Overconfident' : '✅'}`);
      }
      
    } catch (e) {
      console.log(`\n  ❌ ${stationKey}: ${e.message}`);
    }
    
    await sleep(500);
  }
  console.log();
}

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Usage: kalshi precip [subcommand] [options]

Precipitation market analysis for Kalshi rain and snow markets.

Subcommands:
  (default)                  Scan all markets for trade opportunities
  markets                    List all active precipitation markets  
  forecast <station>         Show precipitation forecast for a station
  calibrate [days] [station] Run historical forecast calibration

Options:
  -v, --verbose    Show detailed output
  -h, --help       Show this help

Stations:
  NYC_DAILY    — NYC daily rain (binary: will it rain?)
  DEN_MONTHLY  — Denver monthly total rain (> X inches)
  CHI_MONTHLY  — Chicago monthly total rain
  SFO_MONTHLY  — San Francisco monthly total rain
  AUS_MONTHLY  — Austin monthly total rain
  DAL_MONTHLY  — Dallas monthly total rain

Examples:
  kalshi precip                        # Scan all markets
  kalshi precip markets                # List markets + prices
  kalshi precip forecast NYC_DAILY     # NYC rain forecast
  kalshi precip forecast DEN_MONTHLY   # Denver monthly forecast
  kalshi precip calibrate 90           # 90-day calibration
  kalshi precip calibrate 60 SFO       # SF 60-day calibration
`);
}
