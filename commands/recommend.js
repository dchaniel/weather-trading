/**
 * kalshi recommend — Trade recommendation engine (coordinator)
 * 
 * Fetches forecasts, matches to markets, scores opportunities, displays results.
 * Optionally executes trades with --execute flag.
 */

import { STATIONS, getEffectiveSigma, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { forecast } from '../lib/weather/forecast.js';
import { getLedger } from '../lib/core/trade.js';
import { today, signed, sleep, parseDateArg } from '../lib/core/utils.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';
import { runCryptoStrategy } from '../lib/crypto/strategy.js';
import { runGasStrategy } from '../lib/gas/strategy.js';
import { runGuards } from '../lib/core/guard.js';
import { checkRiskLimits } from '../lib/core/risk.js';
import { appendDecision } from '../lib/core/history.js';
import { fetchStationMarkets, scoreContract, getEffectiveSigmaForForecast } from '../lib/weather/matcher.js';
import { writeFileSync } from 'fs';

export default async function(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: kalshi recommend [date] [flags]

Generate trade recommendations with position sizing.

Arguments:
  date              Target date (YYYY-MM-DD, default: today)

Flags:
  --execute         Execute recommended trades (paper trading)
  --dry-run         Show what would execute without trading
  --save            Save recommendations to file
  --min-edge <pct>  Minimum edge % to recommend (default: 5)
  --days <n>        Look ahead N days (default: 1)
  -h, --help        Show this help

Examples:
  kalshi recommend                    # Today's recommendations
  kalshi recommend --execute          # Execute best trades
  kalshi recommend --min-edge 8       # Only show ≥8% edge
  kalshi recommend 2026-02-15         # Specific date
`);
    return;
  }

  const startDate = parseDateArg(args);
  const saveMode = args.includes('--save');
  const executeMode = args.includes('--execute');
  const dryRunMode = args.includes('--dry-run');
  
  const minEdgeIndex = args.findIndex(a => a === '--min-edge');
  const customMinEdge = minEdgeIndex !== -1 && args[minEdgeIndex + 1] 
    ? parseFloat(args[minEdgeIndex + 1]) / 100 : 0.05;
  
  const ledger = getLedger();
  const dates = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(startDate + 'T12:00:00Z');
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const sessionId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

  console.log(`\n🤖 Trade Recommendations — ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`   Balance: $${ledger.balance.toFixed(2)}`);
  if (minEdgeIndex !== -1) console.log(`   Min edge: ${(customMinEdge * 100).toFixed(0)}¢ (custom)`);
  if (executeMode) console.log(`   Session ID: ${sessionId}`);
  console.log('═'.repeat(60));

  const activeStations = Object.keys(STATIONS).filter(k => TRADEABLE_STATIONS.has(k));

  // Show IV summary
  console.log('\n📊 Market Conditions (σ gap):');
  const ivMonth = parseInt(dates[0].slice(5, 7));
  for (const st of activeStations) {
    const ourSigma = getEffectiveSigma(st, ivMonth, 0);
    console.log(`  ${st}: our σ=${ourSigma}°F (seasonal adj) | need market σ ≥ ${(ourSigma + 0.5).toFixed(1)}°F`);
  }
  console.log('  → Run `kalshi iv` for live market implied σ');
  console.log('─'.repeat(60));

  // ── Weather: scan all stations × dates (high + low) ────────────────
  const allRecs = [];
  const stationMarketSigma = {};

  let stationIdx = 0;
  for (const st of activeStations) {
    stationIdx++;
    process.stdout.write(`\r  ⏳ Scanning ${st} (${stationIdx}/${activeStations.length})...`);
    for (const date of dates) {
      try {
        const fc = await forecast(st, date);

        // ── High temp ──
        const c = fc.consensus;
        if (c.tradeable) {
          const { markets, marketSigma } = await fetchStationMarkets(st, date, c.adjustedMean).catch(() => ({ markets: [], marketSigma: null }));
          if (!stationMarketSigma[st] && marketSigma) stationMarketSigma[st] = marketSigma;
          const sigma = getEffectiveSigmaForForecast(fc, st, date);
          for (const mkt of markets) {
            const rec = scoreContract(mkt, fc, st, date, sigma, stationMarketSigma[st], ledger.balance, customMinEdge);
            if (rec) allRecs.push(rec);
          }
        }

        // ── Low temp ──
        const cl = fc.consensusLow;
        if (cl?.tradeable && STATIONS[st]?.kalshiTickerLow) {
          const { markets: lowMarkets, marketSigma: lowMktSigma } = await fetchStationMarkets(st, date, cl.adjustedMean, 'low').catch(() => ({ markets: [], marketSigma: null }));
          const lowSigma = getEffectiveSigmaForForecast(fc, st, date, 'low');
          // Build a synthetic forecast object with low consensus as primary
          const fcLow = { ...fc, consensus: cl };
          for (const mkt of lowMarkets) {
            const rec = scoreContract(mkt, fcLow, st, date, lowSigma, lowMktSigma, ledger.balance, customMinEdge);
            if (rec) allRecs.push(rec);
          }
        }
      } catch { /* skip failing stations */ }
      await sleep(150);
    }
  }

  process.stdout.write(`\r  ✅ Scanned ${activeStations.length} stations × ${dates.length} days          \n`);

  // ── Flights ──────────────────────────────────────────────────────────
  const flightRecs = await withTimeout(fetchFlightRecs(dates, customMinEdge, ledger.balance), 20000, 'Flights').catch(e => {
    console.log(`\n✈️  FLIGHTS\n` + '─'.repeat(50)); console.log(`  ⚠ ${e.message}`); return [];
  });

  // ── Precipitation ────────────────────────────────────────────────────
  const precipRecs = await withTimeout(fetchPrecipRecs(ledger.balance), 20000, 'Precipitation').catch(e => {
    console.log(`\n🌧️  PRECIPITATION\n` + '─'.repeat(50)); console.log(`  ⚠ ${e.message}`); return [];
  });

  // ── Crypto ───────────────────────────────────────────────────────────
  const cryptoRecs = await withTimeout(fetchCryptoRecs(), 20000, 'Crypto').catch(e => {
    console.log(`\n₿  CRYPTO\n` + '─'.repeat(50)); console.log(`  ⚠ ${e.message}`); return [];
  });

  // ── Gas ─────────────────────────────────────────────────────────────
  const gasRecs = await withTimeout(fetchGasRecs(), 20000, 'Gas').catch(e => {
    console.log('\n⛽ GAS\n' + '─'.repeat(50)); console.log(`  ⚠ ${e.message}`); return [];
  });

  // ── Run guards on weather recs ────────────────────────────────────────
  for (const rec of allRecs) {
    const guardResult = runGuards({
      station: rec.station, qty: rec.sizing.contracts,
      forecastSpread: rec.forecastSpread, marketSigma: rec.marketSigma,
      forecastHigh: rec.forecastHigh, date: rec.date,
    });
    rec.guardPass = guardResult.pass;
    rec.guardReasons = guardResult.reasons;
    rec.guardWarnings = guardResult.warnings || [];
    logDecision(rec, guardResult);
  }

  const passedWeather = allRecs.filter(r => r.guardPass);
  const blockedWeather = allRecs.filter(r => !r.guardPass);

  // Show calibration warnings (non-blocking)
  const allWarnings = [...new Set(allRecs.flatMap(r => r.guardWarnings || []))];
  for (const w of allWarnings) console.log(`\n  ${w}`);

  if (blockedWeather.length > 0) {
    console.log(`\n  🚫 ${blockedWeather.length} weather trade(s) blocked by guards:`);
    for (const r of blockedWeather.slice(0, 3)) console.log(`     ${r.ticker}: ${r.guardReasons[0]}`);
  }

  // ── Combine & rank ──────────────────────────────────────────────────
  const combined = [...passedWeather, ...precipRecs, ...flightRecs, ...cryptoRecs, ...gasRecs].sort((a, b) => b.ev - a.ev).slice(0, 5);

  if (!combined.length) {
    console.log('\n  No trades with edge ≥ 5% found across weather or crypto.\n');
    return;
  }

  displayResults(combined);

  if (dryRunMode) return displayDryRun(combined);
  if (saveMode) savePending(combined, dates[0]);
  if (executeMode) {
    const { executeApprovedTrades } = await import('../lib/core/executor.js');
    await executeApprovedTrades(combined, blockedWeather, dates, sessionId);
  }

  console.log();
}

// ── Flights fetcher ───────────────────────────────────────────────────
/** Race a promise against a timeout — returns fallback on timeout */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))
  ]);
}

async function fetchFlightRecs(dates, minEdge, balance) {
  const recs = [];
  try {
    const { runFlightStrategy } = await import('../lib/flights/matcher.js');
    for (const date of dates) {
      const result = await runFlightStrategy({ date, minEdge, balance });
      if (result.marketsFound > 0) {
        console.log(`\n✈️  FLIGHTS (${date})\n` + '─'.repeat(50));
        console.log(`  Weather: ${result.summary.weatherCategory} | P(delay): ${(result.summary.pDelay * 100).toFixed(1)}%`);
      }
      for (const rec of result.recommendations) {
        recs.push(rec);
      }
      if (result.marketsFound === 0 && dates.indexOf(date) === 0) {
        console.log(`\n✈️  FLIGHTS\n` + '─'.repeat(50));
        console.log(`  ⚠️ No active ORDDLY/FLIGHTORD markets. Strategy ready but markets dormant.`);
      }
    }
  } catch (e) {
    console.log(`\n✈️  FLIGHTS\n` + '─'.repeat(50));
    console.log(`  ⚠ ${e.message}`);
  }
  return recs;
}

// ── Precipitation fetcher ─────────────────────────────────────────────
async function fetchPrecipRecs(balance) {
  try {
    const { scanPrecipMarkets, formatPrecipRec } = await import('../lib/precipitation/matcher.js');
    const recs = await scanPrecipMarkets({ balance, minEdge: 0.05 });
    if (recs.length > 0) {
      console.log('\n🌧️  PRECIPITATION\n' + '─'.repeat(50));
      for (const r of recs.slice(0, 3)) console.log(formatPrecipRec(r));
    } else {
      console.log('\n🌧️  PRECIPITATION\n' + '─'.repeat(50));
      console.log('  ⛔ No precipitation trades — no edges ≥5% at executable prices.');
    }
    return recs;
  } catch (e) {
    console.log('\n🌧️  PRECIPITATION\n' + '─'.repeat(50));
    console.log(`  ⚠ ${e.message}`);
    return [];
  }
}

// ── Crypto fetcher ────────────────────────────────────────────────────
async function fetchCryptoRecs() {
  const recs = [];
  try {
    const crypto = await runCryptoStrategy();
    for (const rec of crypto.recommendations || []) {
      recs.push({
        strategy: 'crypto', ticker: rec.ticker, side: rec.side,
        price: rec.execPrice, pEst: rec.pEst, edge: rec.edge,
        ev: rec.edge * (rec.contracts || 1),
        sizing: { contracts: rec.contracts, fraction: 0, dollarRisk: rec.dollarRisk, edge: rec.edge },
        symbol: rec.symbol, threshold: rec.threshold, daysToExpiry: rec.daysToExpiry, vol: rec.vol,
      });
      try { appendDecision(rec.symbol, rec.edge >= 0.05 ? 'CRYPTO_RECOMMENDED' : 'CRYPTO_FILTERED', {}, rec.edge - TRANSACTION_COST); } catch {}
    }
    if (crypto.recommendations.length === 0) {
      console.log('\n₿  CRYPTO\n' + '─'.repeat(50));
      console.log(`  ⛔ No crypto trades — ${crypto.summary.marketsFound} markets, ${crypto.summary.marketsLiquid} liquid, no edges ≥5% at executable prices.`);
      try { appendDecision('crypto', 'NO_TRADE', { reason: 'no edges >= 5%' }, 0); } catch {}
    }
  } catch (e) {
    console.log('\n₿  CRYPTO\n' + '─'.repeat(50));
    console.log(`  ⚠ ${e.message}`);
  }
  return recs;
}

// ── Gas fetcher ───────────────────────────────────────────────────────
async function fetchGasRecs() {
  const recs = [];
  try {
    const gas = await runGasStrategy();
    for (const rec of gas.markets.recommendations || []) {
      recs.push({
        strategy: 'gas', ticker: rec.ticker, side: rec.side,
        price: rec.execPrice, pEst: rec.pEst, edge: rec.edge,
        ev: rec.ev,
        sizing: { contracts: rec.contracts, fraction: 0, dollarRisk: rec.dollarRisk, edge: rec.edge },
        threshold: rec.threshold, daysToExpiry: rec.daysToSettle,
        seriesLabel: rec.seriesLabel,
      });
      try { appendDecision('GAS', rec.edge >= 0.05 ? 'GAS_RECOMMENDED' : 'GAS_FILTERED', {}, rec.edge); } catch {}
    }
    if (gas.markets.recommendations.length === 0) {
      console.log('\n⛽ GAS\n' + '─'.repeat(50));
      console.log(`  ⛔ No gas trades — ${gas.markets.summary.marketsFound} markets, ${gas.markets.summary.marketsLiquid} liquid, no edges ≥5%.`);
      try { appendDecision('GAS', 'NO_TRADE', { reason: 'no edges >= 5%' }, 0); } catch {}
    }
  } catch (e) {
    console.log('\n⛽ GAS\n' + '─'.repeat(50));
    console.log(`  ⚠ ${e.message}`);
  }
  return recs;
}

// ── Display ───────────────────────────────────────────────────────────
function displayResults(combined) {
  const weatherTrades = combined.filter(r => r.strategy === 'weather');
  const cryptoTrades = combined.filter(r => r.strategy === 'crypto');

  if (weatherTrades.length) {
    console.log('\n🌡️  WEATHER\n' + '─'.repeat(50));
    for (const r of weatherTrades) {
      const horizon = r.horizonDays > 0 ? ` (day+${r.horizonDays})` : '';
      const tempLabel = r.tempType === 'low' ? '❄️ ' : '';
      console.log(`  ${tempLabel}${r.side} ${r.ticker} @ $${r.price.toFixed(2)}${horizon}`);
      const tempWord = r.tempType === 'low' ? 'Low' : 'High';
      console.log(`    ${tempWord}: ${r.forecastHigh}°F → ${r.type === 'threshold' ? `T${r.threshold}` : `B${r.threshold}`} | σ=${r.sigma}°F`);
      console.log(`    P(est): ${(r.pEst * 100).toFixed(1)}%  Edge: ${signed(r.edge * 100, 1)}%  Kelly: ${(r.sizing.fraction * 100).toFixed(2)}%`);
      const warns = [];
      if (r.lowLiquidity) warns.push('⚠️ LOW LIQUIDITY');
      if (r.sizing.liquidityCapped) warns.push('(liq-capped)');
      if (r.totalDepth > 0 && r.sizing.contracts / r.totalDepth > 0.5) warns.push(`📊 DEPTH WARNING: ${r.sizing.contracts} vs ${r.totalDepth} available`);
      else if (r.totalDepth > 0 && r.sizing.contracts / r.totalDepth > 0.2) warns.push(`📊 ${((r.sizing.contracts / r.totalDepth) * 100).toFixed(0)}% of depth`);
      else if (r.volume < 100) warns.push(`📊 LOW VOLUME: ${r.volume}`);
      let line = `    Size: ${r.sizing.contracts} contracts ($${r.sizing.dollarRisk.toFixed(2)} risk)`;
      if (warns.length) line += ' ' + warns.join(' ');
      console.log(line);
      if (r.sizing.contracts > 10) console.log('    ⚠️ Large order — no depth data available, market impact unknown');
    }
  }

  const gasTrades = combined.filter(r => r.strategy === 'gas');
  if (gasTrades.length) {
    console.log('\n⛽ GAS\n' + '─'.repeat(50));
    for (const r of gasTrades) {
      console.log(`  ${r.side} ${r.ticker} @ $${(r.price ?? 0).toFixed(2)} (${r.seriesLabel || 'gas'})`);
      console.log(`    P(est): ${((r.pEst ?? 0) * 100).toFixed(1)}%  Edge: ${signed((r.edge ?? 0) * 100, 1)}%`);
      console.log(`    Size: ${r.sizing?.contracts ?? 0} contracts ($${(r.sizing?.dollarRisk ?? 0).toFixed(2)} risk)`);
    }
  }

  const precipTrades = combined.filter(r => r.strategy === 'precipitation');
  if (precipTrades.length) {
    console.log('\n🌧️  PRECIPITATION\n' + '─'.repeat(50));
    for (const r of precipTrades) {
      const typeLabel = r.marketType === 'daily_binary' ? 'Rain' : `>${r.threshold}"`;
      console.log(`  ${r.side} ${r.ticker} @ $${r.price.toFixed(2)} (${typeLabel})`);
      console.log(`    P(est): ${(r.pEst * 100).toFixed(1)}%  Edge: ${signed(r.edge * 100, 1)}%`);
      console.log(`    Size: ${r.sizing.contracts} contracts ($${r.sizing.dollarRisk.toFixed(2)} risk)`);
    }
  }

  if (cryptoTrades.length) {
    console.log('\n₿  CRYPTO\n' + '─'.repeat(50));
    for (const r of cryptoTrades) {
      console.log(`  ${r.side} ${r.ticker} @ $${(r.price ?? 0).toFixed(2)}`);
      console.log(`    P(est): ${((r.pEst ?? 0) * 100).toFixed(1)}%  Edge: ${signed((r.edge ?? 0) * 100, 1)}%`);
      console.log(`    Size: ${r.sizing?.contracts ?? 0} contracts ($${(r.sizing?.dollarRisk ?? 0).toFixed(2)} risk)`);
    }
  }

  console.log(`\n  📊 Showing top ${combined.length} trades by expected value.`);
}

function displayDryRun(combined) {
  console.log('\n🧪 [DRY RUN] MODE - What would be executed:\n' + '─'.repeat(60));
  const executable = combined.filter(r => (r.edge - TRANSACTION_COST) > 0 && r.sizing?.contracts > 0);
  if (!executable.length) {
    console.log('  [DRY RUN] No trades would execute (no positive net edge after costs)\n');
    return;
  }
  const trade = executable[0];
  const netEdge = trade.edge - TRANSACTION_COST;
  console.log(`  [DRY RUN] WOULD EXECUTE: ${trade.side} ${trade.sizing.contracts}x ${trade.ticker} @ $${trade.price.toFixed(2)}`);
  console.log(`  [DRY RUN] Strategy: ${trade.strategy} | Net edge: ${(netEdge * 100).toFixed(1)}% | Expected value: $${(netEdge * trade.sizing.contracts).toFixed(2)}`);
  if (trade.sizing.contracts > 10) console.log('  [DRY RUN] ⚠️ Large order — market impact unknown');
  console.log(`\n  [DRY RUN] Summary: 1 trade would execute, $${trade.sizing.dollarRisk.toFixed(2)} at risk\n  No trades placed (dry run mode)\n`);
}

function savePending(combined, date) {
  const pending = {
    generatedAt: new Date().toISOString(), date,
    trades: combined.map(r => ({
      strategy: r.strategy, ticker: r.ticker, station: r.station, side: r.side,
      price: r.price, pEst: r.pEst, edge: r.edge,
      contracts: r.sizing?.contracts, dollarRisk: r.sizing?.dollarRisk,
      guardPass: r.guardPass ?? true, guardReasons: r.guardReasons || [],
    })),
  };
  const pendingPath = new URL('../data/pending.json', import.meta.url).pathname;
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
  console.log(`  💾 Saved ${combined.length} recommendations to data/pending.json`);
}

function logDecision(rec, guardResult) {
  try {
    const action = guardResult.pass ? 'APPROVED' : 'BLOCKED';
    const netEdge = rec.edge - TRANSACTION_COST;
    const guardStates = {};
    if (guardResult.pass) {
      guardStates.sigmaGap = 'PASS'; guardStates.spread = 'PASS'; guardStates.climOutlier = 'PASS';
    } else {
      for (const reason of guardResult.reasons || []) {
        if (reason.includes('spread')) guardStates.spread = 'FAIL:' + reason;
        else if (reason.includes('sigma')) guardStates.sigmaGap = 'FAIL:' + reason;
        else if (reason.includes('outlier')) guardStates.climOutlier = 'FAIL:' + reason;
      }
    }
    appendDecision(rec.station, action, guardStates, netEdge);
  } catch {}
}

// Execution loop extracted to lib/core/executor.js → executeApprovedTrades()
