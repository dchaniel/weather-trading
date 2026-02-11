#!/usr/bin/env node
/**
 * Rigorous backtest — produces a quant-grade strategy report.
 * 
 * v2 (2026-02-09): Fixed Sharpe calculation, realistic position sizing,
 * tests both calibrated σ=1.5 and wide σ=3.5 against real market σ range.
 */

import { fetchHistoricalData } from './lib/weather/historical.js';
import { STATIONS } from './lib/weather/stations.js';
import { analyzeStation, generatePredictions, simulatePnL } from './lib/backtest/engine.js';
import { requiredMarketSigma } from './lib/backtest/implied_vol.js';
import { writeFileSync, mkdirSync } from 'fs';
import { round2 } from './lib/core/utils.js';

const STATION_LIST = ['KNYC', 'KMDW', 'KMIA', 'KDEN'];
const START = '2025-07-01';
const END = '2025-12-31';
const SPLIT_DATE = '2025-10-01';

// Test station-specific calibrated σ values (corrected Feb 9, 2026)
const SIGMA_CONFIGS = [
  { 
    label: 'Station-Specific σ (corrected)', 
    perStation: {
      KNYC: 0.85,  // Validated: MAE=0.77°F
      KMDW: 2.8,   // Corrected: actual MAE=2.56°F (NO EDGE)  
      KMIA: 0.77,  // Validated: MAE=0.7°F
      KDEN: 0.9    // Validated: MAE=0.83°F
    }
  },
  { 
    label: 'Previous (WRONG) σ=1.5', 
    sigma: 1.5  // For comparison - shows how wrong estimates affect backtest
  },
];

// Real observed market σ range from live Kalshi data (Feb 9 2026)
const MARKET_SIGMAS = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0];

// Realistic transaction costs
const COST_LEVELS = [
  { label: '3¢ (tight)', cost: 0.03 },
  { label: '4¢ (typical)', cost: 0.04 },
  { label: '5¢ (wide)', cost: 0.05 },
];

async function main() {
  mkdirSync('data', { recursive: true });

  const report = [];
  const r = (...lines) => lines.forEach(l => report.push(l));

  r('# Weather Trading Strategy Report v2');
  r(`*Generated: ${new Date().toISOString().slice(0, 16)}Z*`);
  r(`*Period: ${START} to ${END} | Split: Train < ${SPLIT_DATE}, Test ≥ ${SPLIT_DATE}*`);
  r(`*Initial bankroll: $1,000 | Fixed position sizing | Max 1 trade/day*`);
  r('');
  r('---');
  r('');

  // ── CORRECTED Live Market Data (Feb 9, 2026) ──────────────────────
  r('## CORRECTED Station Assessment (Feb 9, 2026)');
  r('');
  r('**CRITICAL**: Previous Round 6 σ values were catastrophically wrong for KMDW.');
  r('Calibration with N=30 winter observations reveals actual forecast errors:');
  r('');
  r('| Station | Validation Status | Our σ (Corrected) | Market σ | Gap | Tradeable? |');
  r('|---------|------------------|------------------|----------|-----|------------|');
  r('| KNYC | ✅ Validated (N=30) | 0.85°F | ~4.3°F | +3.45°F | ✅ YES |');
  r('| KMDW | ❌ NO EDGE (N=30) | 2.8°F | ~3.0°F | +0.2°F | ❌ NO |');
  r('| KMIA | ✅ Validated (N=30) | 0.77°F | ~3.8°F | +3.03°F | ✅ YES |');
  r('| KDEN | ✅ Validated (N=30) | 0.9°F | ~3.3°F | +2.4°F | ✅ YES |');
  r('');
  r('**KMDW Reality Check**: Actual MAE = 2.56°F vs previous assumption of 0.75°F.');
  r('This 3.4x error would cause catastrophic position sizing and probability miscalculation.');
  r('');
  r('**Edge Survival**: Only KNYC, KMIA, KDEN have sufficient σ gaps after 4¢ transaction costs.');
  r('');
  r('---');
  r('');

  // ── Honest Alpha Thesis ────────────────────────────────────────────────────
  r('## Honest Alpha Assessment');
  r('');
  r('**Previous Claim**: "Massive 3-4x edge from σ recalibration"');
  r('**Reality**: Only 3 of 4 stations have validated edge. One station (KMDW) was completely wrong.');
  r('');
  r('**Station-Specific Truth**:');
  r('- KNYC: Strong edge (σ gap = 3.45°F, well above transaction costs)');
  r('- KMDW: **No edge** (σ gap = 0.2°F, destroyed by transaction costs)');  
  r('- KMIA: Strong edge (σ gap = 3.03°F, tropical stability advantage)');
  r('- KDEN: Moderate edge (σ gap = 2.4°F, chinook tail risk)');
  r('');
  r('**Risk**: Previous Round 6 would have dramatically oversized KMDW positions (11x risk due to σ² in Kelly).');
  r('');
  r('**Conservative Approach**: Focus on KNYC only until live trading validates other stations.');
  r('');
  r('---');
  r('');

  // ── Station-by-Station Results ──────────────────────────────────────
  const allStationData = {};

  for (const station of STATION_LIST) {
    console.log(`\nFetching ${station}...`);
    let data;
    try {
      data = await fetchHistoricalData(station, START, END);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      continue;
    }
    allStationData[station] = data;
    console.log(`  ${data.stats.count} days, MAE=${data.stats.mae}°F, StdDev=${data.stats.stdDev}°F`);

    r(`## ${station} — ${STATIONS[station].name}`);
    r('');
    r(`### Forecast Accuracy`);
    r(`| Metric | Value |`);
    r(`|--------|-------|`);
    r(`| Days | ${data.stats.count} |`);
    r(`| MAE | ${data.stats.mae}°F |`);
    r(`| Bias | ${data.stats.bias}°F |`);
    r(`| Std Dev | ${data.stats.stdDev}°F |`);
    r(`| ECMWF MAE | ${data.stats.ecmwfMae}°F |`);
    r(`| GFS MAE | ${data.stats.gfsMae}°F |`);
    r('');

    // Test both corrected and old σ values against market σ range
    for (const config of SIGMA_CONFIGS) {
      r(`### P&L: ${config.label} vs Market σ`);
      r('');
      r('*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*');
      r('');
      r('| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |');
      r('|----------|-----|--------|--------|--------|------|-------|-------------|');

      const stationSigma = config.perStation ? config.perStation[station] : config.sigma;
      if (!stationSigma) {
        r('| — | No σ for this station | — | — | — | — | — | — |');
        r('');
        continue;
      }
      
      const predictions = generatePredictions(data, { sigma: stationSigma, spreadFilter: 3 });
      
      for (const ms of MARKET_SIGMAS) {
        const result = simulatePnL(predictions, {
          ourSigma: stationSigma,
          marketSigma: ms,
          minEdge: 0.02,
          kellyFraction: 0.25,
          spreadCost: 0.03,
        });
        const marker = ms >= 3.0 && ms <= 4.3 ? ' ⬅️' : '';
        r(`| ${ms}°F${marker} | $${result.totalPnL} | ${result.returnPct}% | ${result.sharpe} | ${result.totalTrades} | ${result.winRate}% | ${result.maxDrawdown}% | ${result.sharpeDebug.tradingDays || 0} |`);
      }
      r('');
    }

    // Cost sensitivity at market σ = 4.0 (mid-range of observed)
    const correctedSigma = SIGMA_CONFIGS[0].perStation[station];
    r(`### Cost Sensitivity (market σ = 4.0°F, our σ = ${correctedSigma}°F)`);
    r('');
    r('| Spread Cost | P&L | Sharpe | Trades | Win% |');
    r('|-------------|-----|--------|--------|------|');
    const calPreds = generatePredictions(data, { sigma: correctedSigma, spreadFilter: 3 });
    for (const sc of [0.01, 0.02, 0.03, 0.04, 0.05, 0.07, 0.10]) {
      const result = simulatePnL(calPreds, {
        ourSigma: correctedSigma, marketSigma: 4.0,
        minEdge: 0.02, kellyFraction: 0.25, spreadCost: sc,
      });
      r(`| $${sc.toFixed(2)} | $${result.totalPnL} | ${result.sharpe} | ${result.totalTrades} | ${result.winRate}% |`);
    }
    r('');

    // Sharpe debug for best case
    const bestCase = simulatePnL(calPreds, {
      ourSigma: correctedSigma, marketSigma: 4.0,
      minEdge: 0.02, kellyFraction: 0.25, spreadCost: 0.03,
    });
    if (bestCase.sharpeDebug) {
      r(`### Sharpe Ratio Debug (σ=${correctedSigma} vs market σ=4.0, 3¢ cost)`);
      r(`- Total calendar days: ${bestCase.sharpeDebug.totalDays}`);
      r(`- Days with trades: ${bestCase.sharpeDebug.tradingDays}`);
      r(`- Mean daily return: ${(bestCase.sharpeDebug.meanDailyReturn * 100).toFixed(4)}%`);
      r(`- Std daily return: ${(bestCase.sharpeDebug.stdDailyReturn * 100).toFixed(4)}%`);
      r(`- Annualized return: ${bestCase.sharpeDebug.annualizedReturn}%`);
      r(`- Annualized vol: ${bestCase.sharpeDebug.annualizedVol}%`);
      r(`- Sharpe: ${bestCase.sharpe}`);
      r('');
    }

    r('---');
    r('');
  }

  // ── Summary Matrix ──────────────────────────────────────────────────
  r('## Summary: Can We Make Money?');
  r('');
  r('Key scenario: **Our σ=1.5, Market σ=3.0-4.0, Cost=3-5¢**');
  r('');
  r('| Station | Mkt σ=3.0, 3¢ | Mkt σ=3.5, 3¢ | Mkt σ=4.0, 3¢ | Mkt σ=4.0, 5¢ |');
  r('|---------|---------------|---------------|---------------|---------------|');

  for (const station of STATION_LIST) {
    const data = allStationData[station];
    if (!data) continue;
    
    // Use corrected station-specific σ (from Feb 9, 2026 calibration)
    const stationSigma = SIGMA_CONFIGS[0].perStation[station];
    const preds = generatePredictions(data, { sigma: stationSigma, spreadFilter: 3 });
    
    const scenarios = [];
    for (const [ms, sc] of [[3.0, 0.03], [3.5, 0.03], [4.0, 0.03], [4.0, 0.05]]) {
      const r = simulatePnL(preds, { ourSigma: stationSigma, marketSigma: ms, minEdge: 0.02, kellyFraction: 0.25, spreadCost: sc });
      scenarios.push(`$${r.totalPnL} (S=${r.sharpe})`);
    }
    r(`| ${station} (σ=${stationSigma}) | ${scenarios.join(' | ')} |`);
  }
  r('');

  // ── Verdict ─────────────────────────────────────────────────────────
  r('## Verdict');
  r('');
  r('### What the data says:');
  r('1. **Forecasts are excellent**: MAE 0.9-1.2°F, well-calibrated at σ=1.5°F');
  r('2. **Market implied σ is 3.0-4.3°F** — wider than our forecast error');
  r('3. **The σ gap creates theoretical edge** of 1.5-2.8°F');
  r('4. **Transaction costs of 3-5¢ eat most of the edge** at market σ ≤ 3.5°F');
  r('5. **KNYC is most promising** with market σ=4.3°F (widest gap)');
  r('');
  r('### Recommendation:');
  r('- **KNYC**: ✅ Trade cautiously — market σ=4.3 provides enough edge at 3¢ cost');
  r('- **KMDW**: ⚠️ Marginal — market σ=3.0 barely covers costs');
  r('- **KDEN**: ⚠️ Marginal — market σ=3.3, similar to KMDW');
  r('- **KMIA**: ❌ No data on market σ; historically marginal');
  r('');
  r('### Critical next steps:');
  r('1. Run `wt iv` daily to track market implied σ over time');
  r('2. Paper trade KNYC with σ=1.5 when market σ > 3.5');
  r('3. DO NOT trade when market σ < 3.0 — no edge after costs');
  r('4. Collect 2+ weeks of implied vol data before going live');
  r('');

  const text = report.join('\n');
  writeFileSync('data/strategy-report.md', text);
  console.log('\nReport saved to data/strategy-report.md');
  console.log('='.repeat(60));
  console.log(text);
}

main().catch(e => { console.error(e); process.exit(1); });
