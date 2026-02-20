/**
 * kalshi data pipeline — Single-pass data collection pipeline
 * 
 * Combines IV analysis + data collect + snapshot into one pass to avoid
 * redundant API calls. The old cron approach ran iv → data collect → data snapshot,
 * but data collect calls iv internally = double API calls = timeouts.
 * 
 * Usage: kalshi data pipeline [--silent]
 * 
 * What it does in a single pass per station:
 * 1. Fetch forecast (one API call)
 * 2. Fetch markets (one API call) 
 * 3. Compute IV (pure math, no API)
 * 4. Save forecast to history JSONL
 * 5. Save market snapshot to history JSONL
 * 6. Save decision to history JSONL
 * 7. Print IV analysis table (unless --silent)
 */

import { TRADEABLE_STATIONS, getEffectiveSigma } from '../lib/weather/stations.js';
import { forecast } from '../lib/weather/forecast.js';
import { fetchStationMarkets } from '../lib/weather/matcher.js';
import { runGuards } from '../lib/core/guard.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';
import { today, round2 } from '../lib/core/utils.js';
import { 
  appendForecast, 
  appendMarketSnapshot, 
  appendDecision 
} from '../lib/core/history.js';

export default async function pipeline(args = []) {
  const silent = args.includes('--silent');
  const targetDate = today();
  
  const stats = { forecasts: 0, contracts: 0, decisions: 0, goStations: [], errors: [] };
  const results = [];

  if (!silent) {
    console.log(`\n📊 Data Pipeline — ${targetDate}`);
    console.log('═'.repeat(60));
    console.log('  Single-pass: forecast → markets → IV → history\n');
  }

  for (const station of TRADEABLE_STATIONS) {
    try {
      if (!silent) process.stdout.write(`  ${station}... `);
      
      // 1. Fetch forecast (single API call)
      const fc = await forecast(station, targetDate);
      if (!fc?.consensus) {
        if (!silent) console.log('❌ no forecast');
        continue;
      }
      const forecastValue = fc.consensus.adjustedMean;

      // 2. Save forecast to history
      appendForecast(station, {
        date: targetDate,
        forecast: forecastValue,
        models: {
          nws: fc.nws?.high_f || fc.nws?.temperature,
          gfs: fc.gfs?.high_f,
          ecmwf: fc.ecmwf?.high_f,
        },
        spread: fc.consensus.spread || 0,
        climNormal: fc.consensus?.climNormalHigh || null,
        climDev: fc.consensus?.climDeviation || null,
      });
      stats.forecasts++;

      // 3. Fetch markets (single API call)
      const { markets, marketSigma } = await fetchStationMarkets(
        station, targetDate, forecastValue
      ).catch(() => ({ markets: [], marketSigma: null }));

      if (markets.length === 0) {
        if (!silent) console.log(`✅ forecast ${round2(forecastValue)}°F (no markets)`);
        continue;
      }

      // 4. Compute IV (pure math)
      const month = parseInt(targetDate.slice(5, 7));
      const horizonDays = fc.horizonDays || 0;
      const ourSigma = getEffectiveSigma(station, month, horizonDays);
      const sigmaGap = marketSigma && ourSigma ? round2(marketSigma - ourSigma) : null;
      const netEdge = sigmaGap !== null ? round2(sigmaGap * 100 - TRANSACTION_COST * 100) / 100 : null;

      // 5. Save market snapshot
      const contracts = markets.map(m => ({
        ticker: m.ticker,
        yesBid: m.yesBid || 0,
        yesAsk: m.yesAsk || 0,
      }));
      appendMarketSnapshot(station, contracts, marketSigma, ourSigma);
      stats.contracts += contracts.length;

      // 6. Run guards and save decision
      const guardResult = runGuards({
        station,
        qty: 10,
        forecastSpread: fc.consensus.spread,
        marketSigma,
        forecastHigh: forecastValue,
        date: targetDate,
      });
      appendDecision(station, guardResult.pass ? 'APPROVED' : 'BLOCKED', guardResult.guardStates || {}, netEdge);
      stats.decisions++;

      if (guardResult.pass) stats.goStations.push(station);

      // 7. Print status
      const status = guardResult.pass ? '🟢 GO' : '🔴 NO-GO';
      const edgeStr = netEdge !== null ? `${netEdge > 0 ? '+' : ''}${round2(netEdge * 100)}¢` : '—';
      if (!silent) {
        console.log(`✅ ${round2(forecastValue)}°F | σ gap ${sigmaGap > 0 ? '+' : ''}${sigmaGap}°F | edge ${edgeStr} | ${status}`);
      }

      results.push({ station, forecastValue, ourSigma, marketSigma, sigmaGap, netEdge, go: guardResult.pass });
    } catch (e) {
      stats.errors.push(`${station}: ${e.message}`);
      if (!silent) console.log(`❌ ${e.message}`);
    }
  }

  if (!silent) {
    console.log('\n' + '═'.repeat(60));
    console.log(`  📦 ${stats.forecasts} forecasts, ${stats.contracts} contracts, ${stats.decisions} decisions`);
    console.log(`  🟢 ${stats.goStations.length} GO: ${stats.goStations.join(', ') || 'none'}`);
    if (stats.errors.length > 0) {
      console.log(`  ❌ ${stats.errors.length} errors: ${stats.errors.join('; ')}`);
    }
    console.log(`  → data/history/*.jsonl\n`);
  }

  return results;
}
