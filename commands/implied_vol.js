/**
 * kalshi iv — Compare our forecast σ to market implied σ.
 * This is the key command for deciding whether to trade.
 * 
 * For each station with active Kalshi markets:
 * 1. Fetch our multi-model forecast
 * 2. Fetch live Kalshi contract prices
 * 3. Compute implied σ from threshold contract prices
 * 4. Show: our σ, market σ, the gap, whether edge exists
 */

import { STATIONS, getEffectiveSigma, VALIDATED_STATIONS, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { forecast } from '../lib/weather/forecast.js';
import { getSeriesMarkets } from '../lib/kalshi/client.js';
import { impliedSigma, analyzeImpliedVol } from '../lib/backtest/implied_vol.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';
import { runGuards } from '../lib/core/guard.js';
import { today, round2, sleep, normalCDF } from '../lib/core/utils.js';

// Station → Kalshi series ticker mapping
const SERIES_MAP = {
  KNYC: 'KXHIGHNY',
  KMDW: 'KXHIGHCHI',
  KDEN: 'KXHIGHDEN',
  KMIA: 'KXHIGHMIA',
  KIAH: 'KXHIGHTHOU',
  KLAX: 'KXHIGHLAX',
  KATL: 'KXHIGHTATL',
  KDFW: 'KXHIGHTDAL',
  KSFO: 'KXHIGHTSFO',
  KSEA: 'KXHIGHTSEA',
  KOKC: 'KXHIGHTOKC',
  KDCA: 'KXHIGHTDC',
  KAUS: 'KXHIGHAUS',
  KMSP: 'KXHIGHTMIN',
  KPHL: 'KXLOWTPHIL',
};

// Low-temp series — derived from stations with kalshiTickerLow
const LOW_SERIES_MAP = (() => {
  const map = {};
  for (const [k, v] of Object.entries(STATIONS)) {
    if (v.kalshiTickerLow) map[k] = v.kalshiTickerLow;
  }
  return map;
})();

/**
 * Parse a threshold from a Kalshi temperature market.
 * Markets have floor_strike (for "above X") type contracts.
 */
function extractThreshold(market) {
  if (market.floorStrike != null) return market.floorStrike;
  if (market.capStrike != null) return market.capStrike;
  // Try parsing from title
  const m = (market.title || '').match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Calculate probability difference between our σ and market σ for edge analysis
 */
function calculateProbabilityDifference(forecast, threshold, ourSigma, marketSigma) {
  // P(temp > threshold) using normal distribution
  const zOur = (threshold - forecast) / ourSigma;
  const zMarket = (threshold - forecast) / marketSigma;
  
  const pOur = 1 - normalCDF(zOur);
  const pMarket = 1 - normalCDF(zMarket);
  
  return pOur - pMarket;
}

export default async function(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: kalshi iv [date] [station] [flags]

Compare forecast σ to market implied σ for weather contracts.

Arguments:
  date       Target date (YYYY-MM-DD, default: today)
  station    Filter to single station (e.g. KNYC, KMIA)

Flags:
  -v, --verbose   Show skipped stations and debug info
  -h, --help      Show this help

Examples:
  kalshi iv                    # All stations, today
  kalshi iv 2026-02-15         # All stations, specific date
  kalshi iv 2026-02-15 KNYC    # NYC only
  kalshi iv --verbose           # Include debug output

Note: Market σ computed from mid-price. Edge calculations in
\`kalshi recommend\` use executable (ask) price for conservative sizing.
`);
    return;
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const positional = args.filter(a => !a.startsWith('-'));
  const targetDate = positional[0] || today();
  const stationFilter = positional[1]?.toUpperCase();

  console.log(`\n📊 Implied Volatility Analysis — ${targetDate}`);
  console.log('═'.repeat(60));

  const results = [];

  for (const [station, series] of Object.entries(SERIES_MAP)) {
    if (stationFilter && station !== stationFilter) continue;

    try {
      // Get our forecast
      let fc;
      try {
        fc = await forecast(station, targetDate);
      } catch {
        if (verbose) console.log(`  ⚠ ${station}: No forecast available`);
        continue;
      }
      const forecastHigh = fc.consensus?.adjustedMean ?? fc.consensus?.mean;
      if (!forecastHigh) continue;

      const month = parseInt(targetDate.slice(5, 7));
      const ourSigma = round2(getEffectiveSigma(station, month, 0));

      // Get Kalshi markets
      let events;
      try {
        events = await getSeriesMarkets(series);
      } catch (e) {
        if (verbose) console.log(`  ⚠ ${station}: Kalshi API error: ${e.message}`);
        continue;
      }

      // Find markets for target date
      const contracts = [];
      for (const event of events) {
        for (const mkt of event.markets || []) {
          // Check if this market matches our target date
          const eventDate = event.eventTicker?.match(/(\d{2})([A-Z]{3})(\d{2})$/);
          // Use close_time or event ticker to match date
          
          const threshold = extractThreshold(mkt);
          if (threshold == null) continue;
          
          // Use mid price (average of bid and ask)
          const midPrice = (mkt.yesBid + mkt.yesAsk) / 2;
          if (midPrice <= 0.02 || midPrice >= 0.98) continue; // Skip deep ITM/OTM
          if (mkt.yesBid <= 0 && mkt.yesAsk <= 0) continue; // No quotes

          contracts.push({
            ticker: mkt.ticker,
            threshold,
            marketPrice: midPrice,
            yesBid: mkt.yesBid,
            yesAsk: mkt.yesAsk,
            volume: mkt.volume,
            spread: round2(mkt.yesAsk - mkt.yesBid),
          });
        }
      }

      if (contracts.length === 0) {
        if (verbose) console.log(`  ⚠ ${station}: No active contracts found`);
        continue;
      }

      // Compute implied σ
      const analysis = analyzeImpliedVol(forecastHigh, contracts);
      
      if (!analysis.meanImpliedSigma) {
        if (verbose) console.log(`  ⚠ ${station}: Could not compute implied σ`);
        continue;
      }

      const gap = round2(analysis.meanImpliedSigma - ourSigma);
      
      // Edge-after-costs analysis (transaction cost ≈ 3-5¢ per contract)
      const transactionCost = TRANSACTION_COST; // Round-trip cost per contract
      // Use nearest-to-forecast threshold for edge calculation (not hardcoded 75°F)
      const sortedByProximity = [...contracts].sort((a, b) => 
        Math.abs(a.threshold - forecastHigh) - Math.abs(b.threshold - forecastHigh)
      );
      const edgeThreshold = sortedByProximity[0]?.threshold ?? forecastHigh;
      const probDiff = calculateProbabilityDifference(forecastHigh, edgeThreshold, ourSigma, analysis.meanImpliedSigma);
      const grossEdge = Math.abs(probDiff) * 0.99; // Max payout $0.99 per contract
      const netEdge = grossEdge - transactionCost;
      
      // Validation status
      const isValidated = VALIDATED_STATIONS.has(station);
      const isTradeable = TRADEABLE_STATIONS.has(station);
      
      const noEdge = gap < 0.5; // Market σ ≤ our σ (or barely above) — NO edge
      const edgeExists = gap > 1.5; // Need meaningful σ gap
      const profitableAfterCosts = netEdge > 0.01; // At least 1¢ net edge
      const tradeable = edgeExists && analysis.meanImpliedSigma > 3.0 && profitableAfterCosts && isTradeable;

      // Run guard checks to see if trading would be blocked
      const guardResult = runGuards({
        station,
        qty: 10, // dummy qty for guard check
        forecastSpread: fc.models ? Math.abs((fc.models.gfs?.high || 0) - (fc.models.ecmwf?.high || 0)) : null,
        marketSigma: analysis.meanImpliedSigma,
        forecastHigh,
        date: targetDate,
      });

      results.push({
        station,
        name: STATIONS[station]?.name || station,
        forecastHigh: round2(forecastHigh),
        ourSigma,
        marketSigma: analysis.meanImpliedSigma,
        medianSigma: analysis.medianSigma,
        gap,
        grossEdge: round2(grossEdge * 100), // in cents
        netEdge: round2(netEdge * 100), // in cents 
        isValidated,
        isTradeable,
        tier: STATIONS[station]?.tier || 'U',
        noEdge,
        edgeExists,
        profitableAfterCosts,
        tradeable,
        contracts: contracts.length,
        samples: analysis.samples,
        guardPass: guardResult.pass,
        guardReasons: guardResult.reasons,
        forecastSpread: fc.models ? round2(Math.abs((fc.models.gfs?.high || 0) - (fc.models.ecmwf?.high || 0))) : null,
      });

    } catch (e) {
      if (verbose) console.log(`  ⚠ ${station}: ${e.message}`);
      // Log errors but continue to next station
    }
    await sleep(200);
  }

  // ── Low-temp IV analysis ────────────────────────────────────────────
  const lowResults = [];
  for (const [station, series] of Object.entries(LOW_SERIES_MAP)) {
    if (stationFilter && station !== stationFilter) continue;

    try {
      let fc;
      try { fc = await forecast(station, targetDate); } catch { continue; }
      const forecastLow = fc.consensusLow?.adjustedMean ?? fc.consensusLow?.mean;
      if (!forecastLow) continue;

      const month = parseInt(targetDate.slice(5, 7));
      const ourSigma = round2(getEffectiveSigma(station, month, 0, 'low'));

      let events;
      try { events = await getSeriesMarkets(series); } catch (e) {
        if (verbose) console.log(`  ⚠ ${station} LOW: Kalshi API error: ${e.message}`);
        continue;
      }

      const contracts = [];
      for (const event of events) {
        for (const mkt of event.markets || []) {
          const threshold = extractThreshold(mkt);
          if (threshold == null) continue;
          const midPrice = (mkt.yesBid + mkt.yesAsk) / 2;
          if (midPrice <= 0.02 || midPrice >= 0.98) continue;
          if (mkt.yesBid <= 0 && mkt.yesAsk <= 0) continue;
          contracts.push({
            ticker: mkt.ticker, threshold, marketPrice: midPrice,
            yesBid: mkt.yesBid, yesAsk: mkt.yesAsk, volume: mkt.volume,
            spread: round2(mkt.yesAsk - mkt.yesBid),
          });
        }
      }

      if (contracts.length === 0) { if (verbose) console.log(`  ⚠ ${station} LOW: No active contracts`); continue; }

      const analysis = analyzeImpliedVol(forecastLow, contracts);
      if (!analysis.meanImpliedSigma) continue;

      const gap = round2(analysis.meanImpliedSigma - ourSigma);
      const sortedByProximity = [...contracts].sort((a, b) =>
        Math.abs(a.threshold - forecastLow) - Math.abs(b.threshold - forecastLow)
      );
      const edgeThreshold = sortedByProximity[0]?.threshold ?? forecastLow;
      const probDiff = calculateProbabilityDifference(forecastLow, edgeThreshold, ourSigma, analysis.meanImpliedSigma);
      const grossEdge = Math.abs(probDiff) * 0.99;
      const netEdge = grossEdge - TRANSACTION_COST;
      const isTradeable = TRADEABLE_STATIONS.has(station);

      lowResults.push({
        station, name: STATIONS[station]?.name || station,
        forecastLow: round2(forecastLow), ourSigma,
        marketSigma: analysis.meanImpliedSigma, gap,
        netEdge: round2(netEdge * 100), isTradeable,
        tier: STATIONS[station]?.tier || 'U',
        edgeExists: gap > 1.5, profitableAfterCosts: netEdge > 0.01,
        contracts: contracts.length,
      });
    } catch (e) {
      if (verbose) console.log(`  ⚠ ${station} LOW: ${e.message}`);
    }
    await sleep(200);
  }

  if (results.length === 0 && lowResults.length === 0) {
    console.log('\n  No stations with active markets found.\n');
    return;
  }

  // Summary header
  const totalScanned = results.length + lowResults.length;
  const tradeableCount = results.filter(r => r.isTradeable).length + lowResults.filter(r => r.isTradeable).length;
  const withEdge = results.filter(r => r.isTradeable && r.netEdge > 0).length + lowResults.filter(r => r.isTradeable && r.netEdge > 0).length;
  const goCount = results.filter(r => r.guardPass && r.tradeable).length;
  const bestStation = [...results].filter(r => r.tradeable).sort((a, b) => b.gap - a.gap)[0];
  console.log(`\n📈 ${totalScanned} stations scanned • ${tradeableCount} tradeable • ${withEdge} with edge • ${goCount} GO`);
  if (bestStation) console.log(`   Best: ${bestStation.station} +${bestStation.gap.toFixed(1)}°F gap, ${bestStation.netEdge}¢ net edge`);

  // Display results with validation status and edge-after-costs
  console.log('\n  Station    Val? Forecast  Our σ   Mkt σ   Gap    Net Edge   Status');
  console.log('  ' + '─'.repeat(85));

  for (const r of results) {
    const validationStatus = r.isValidated ? (r.isTradeable ? '✅' : '⚠️') : '❌';
    const validationLabel = r.isValidated ? (r.isTradeable ? 'VAL' : 'VAL*') : 'NO';
    
    let edgeStatus, edgeDisplay;
    if (!r.isValidated) {
      edgeStatus = '❌ UNVALIDATED';
      edgeDisplay = '—';
    } else if (!r.isTradeable) {
      edgeStatus = '❌ UNTRADEABLE';
      edgeDisplay = '—';
    } else if (r.netEdge <= 0) {
      edgeStatus = '❌ NO PROFIT';
      edgeDisplay = r.netEdge + '¢';
    } else if (r.netEdge >= 2) {
      edgeStatus = '✅ STRONG';
      edgeDisplay = r.netEdge + '¢';
    } else {
      edgeStatus = '⚠️ MARGINAL';
      edgeDisplay = r.netEdge + '¢';
    }

    console.log(
      `  ${r.station.padEnd(10)} ${validationLabel.padEnd(4)} ${String(r.forecastHigh + '°F').padEnd(9)} ` +
      `${String(r.ourSigma + '°F').padEnd(7)} ` +
      `${String(r.marketSigma + '°F').padEnd(7)} ` +
      `${String((r.gap >= 0 ? '+' : '') + r.gap + '°F').padEnd(7)} ` +
      `${String(edgeDisplay).padEnd(9)} ${edgeStatus}`
    );
  }
  
  // Validation legend
  console.log('\n  📋 Validation Status:');
  console.log('     ✅ VAL = Validated with N≥30 observations + tradeable');
  console.log('     ⚠️ VAL* = Validated but removed from trading (e.g., KMDW)');
  console.log('     ❌ NO = Insufficient calibration data');
  console.log('     Net Edge = Gross edge minus 4¢ transaction cost per contract');

  // ── Low-temp results ──────────────────────────────────────────────
  if (lowResults.length > 0) {
    console.log('\n❄️  LOW TEMPERATURE IMPLIED VOLATILITY');
    console.log('═'.repeat(60));
    console.log('\n  Station    Forecast  Our σ   Mkt σ   Gap    Net Edge   Status');
    console.log('  ' + '─'.repeat(75));

    for (const r of lowResults) {
      let edgeStatus, edgeDisplay;
      if (!r.isTradeable) {
        edgeStatus = '❌ UNTRADEABLE';
        edgeDisplay = '—';
      } else if (r.netEdge <= 0) {
        edgeStatus = '❌ NO PROFIT';
        edgeDisplay = r.netEdge + '¢';
      } else if (r.netEdge >= 2) {
        edgeStatus = '✅ STRONG';
        edgeDisplay = r.netEdge + '¢';
      } else {
        edgeStatus = '⚠️ MARGINAL';
        edgeDisplay = r.netEdge + '¢';
      }

      console.log(
        `  ${r.station.padEnd(10)} ${String(r.forecastLow + '°F').padEnd(9)} ` +
        `${String(r.ourSigma + '°F').padEnd(7)} ` +
        `${String(r.marketSigma + '°F').padEnd(7)} ` +
        `${String((r.gap >= 0 ? '+' : '') + r.gap + '°F').padEnd(7)} ` +
        `${String(edgeDisplay).padEnd(9)} ${edgeStatus}`
      );
    }
  }

  // Detailed breakdown if verbose
  if (verbose) {
    for (const r of results) {
      console.log(`\n  📍 ${r.station} — ${r.name}`);
      console.log(`     Forecast: ${r.forecastHigh}°F | Our σ: ${r.ourSigma}°F | Market σ: ${r.marketSigma}°F (median: ${r.medianSigma}°F)`);
      console.log('     Threshold  MktPrice  Implied σ');
      console.log('     ' + '─'.repeat(35));
      for (const s of r.samples.slice(0, 10)) {
        console.log(`     ${String(s.threshold + '°F').padEnd(11)} ${String('$' + s.marketPrice.toFixed(2)).padEnd(10)} ${s.impliedSigma}°F`);
      }
    }
  }

  // Guard warnings for stations with edge but blocked trades
  const edgeButBlocked = results.filter(r => (r.tradeable || r.edgeExists) && !r.guardPass);
  if (edgeButBlocked.length > 0) {
    console.log('\n  ⚠️  GUARD WARNINGS — Edge exists but trades would be BLOCKED:');
    for (const r of edgeButBlocked) {
      console.log(`     ${r.station}: ${r.guardReasons.join(' | ')}`);
    }
  }

  // GO/NO-GO Decision Matrix
  console.log('\n🚦 GO/NO-GO DECISION MATRIX');
  console.log('─'.repeat(80));
  console.log('  Station    σ Gap    Spread   Clim     Daily    Overall');
  console.log('  ' + '─'.repeat(70));
  
  for (const r of results) {
    const sigmaGapOK = r.gap >= 1.5 ? '✅' : '❌';
    const spreadOK = r.forecastSpread == null || r.forecastSpread <= 3.0 ? '✅' : '❌';
    const climOK = !r.guardReasons.some(reason => reason.includes('normal')) ? '✅' : '❌';
    const dailyLimitOK = !r.guardReasons.some(reason => reason.includes('open trade')) ? '✅' : '❌';
    const correlationOK = !r.guardReasons.some(reason => reason.includes('correlated')) ? '✅' : '❌';
    const overall = r.guardPass && r.tradeable ? '🟢 GO' : '🔴 NO-GO';
    
    console.log(
      `  ${r.station.padEnd(10)} ` +
      `${sigmaGapOK.padEnd(8)} ` +
      `${spreadOK.padEnd(8)} ` +
      `${climOK.padEnd(8)} ` +
      `${dailyLimitOK.padEnd(8)} ` +
      `${overall}`
    );
  }
  
  // Summary counts
  const goStations = results.filter(r => r.guardPass && r.tradeable);
  const nogoStations = results.filter(r => !r.guardPass || !r.tradeable);
  
  console.log('\n' + '═'.repeat(80));
  console.log(`🎯 TRADING DECISION: ${goStations.length} GO stations, ${nogoStations.length} NO-GO stations`);
  
  if (goStations.length > 0) {
    console.log('\n  🟢 CLEARED FOR TRADING:');
    for (const r of goStations) {
      console.log(`     ${r.station}: ${r.gap.toFixed(1)}°F σ gap at ${r.marketSigma}°F market volatility`);
    }
    console.log('\n  → Run `kalshi recommend` for position sizing and specific contracts');
  } else {
    console.log('\n  🔴 NO TRADES AUTHORIZED TODAY');
    console.log('     All stations either lack sufficient edge or fail guard checks');
  }
  
  // Legend for decision matrix
  console.log('\n  📋 Decision Criteria:');
  console.log('     σ Gap: Market σ - Our σ ≥ 1.5°F (edge after costs)');
  console.log('     Spread: Model disagreement ≤ 3.0°F (forecast confidence)');
  console.log('     Clim: Forecast within ±15°F of seasonal normal');
  console.log('     Daily: No existing open position for this station today');
  console.log('     Note: Market σ from mid-price. Edge sizing uses executable (ask) price.');
  console.log();

  return results;
}
