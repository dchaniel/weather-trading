/**
 * kalshi gas — Gas price market analysis & trade recommendations.
 *
 * Fetches EIA gas/crude data, calibrates the mean-reversion + seasonality model,
 * and finds edge in Kalshi gas price contracts.
 */

import { runGasStrategy } from '../lib/gas/strategy.js';
import { signed, round2 } from '../lib/core/utils.js';
import { TRANSACTION_COST } from '../lib/core/sizing.js';

export default async function(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: kalshi gas [flags]

Analyze gas price markets using mean-reversion + seasonality model.

Flags:
  --backtest     Include historical backtest results
  -h, --help     Show this help

Shows:
  • Current gas & crude oil prices (EIA data)
  • Model calibration (weekly σ, mean-reversion β, crude correlation)
  • Price predictions (weekly + monthly)
  • Kalshi gas contract opportunities (≥5% edge)
  • Seasonal outlook

Data sources:
  • EIA Weekly Retail Gasoline Prices (all grades, US average)
  • EIA Daily WTI Crude Oil Spot (Cushing, OK)

Edge thesis:
  Gas prices are sticky and seasonal. They follow crude oil with a 1-2 week lag.
  Daily/weekly markets may overreact to oil moves. We model the lag + seasonality.

Examples:
  kalshi gas                # Full gas analysis
  kalshi gas --backtest     # Include historical validation
`);
    return;
  }

  const runBacktest = args.includes('--backtest');

  console.log('\n⛽ Gas Price Analysis');
  console.log('═'.repeat(60));

  let result;
  try {
    result = await runGasStrategy({ runBacktest });
  } catch (e) {
    console.log(`  ⚠ Error: ${e.message}\n`);
    return;
  }

  const { data, calibration: cal, predictions: pred, markets, backtest: bt, summary: sum } = result;

  // ── Current Prices ──────────────────────────────────────────────────
  console.log('\n  Current Prices:');
  console.log(`    Gas:    $${data.currentGas.price.toFixed(3)}/gal  (as of ${data.currentGas.date})`);
  console.log(`    Crude:  $${data.currentCrude.price.toFixed(2)}/bbl  (WTI, as of ${data.currentCrude.date})`);
  console.log(`    Data:   ${data.gasHistoryWeeks} weeks gas, ${data.crudeHistoryDays} days crude`);

  // ── Model Calibration ────────────────────────────────────────────────
  console.log('\n  Model Calibration:');
  console.log(`    Weekly σ:        $${cal.weeklySigma.toFixed(3)}/gal`);
  console.log(`    Avg up move:     ${signed(cal.avgUp * 100, 1)}¢  (${(cal.upPct * 100).toFixed(0)}% of weeks)`);
  console.log(`    Avg down move:   ${signed(cal.avgDown * 100, 1)}¢  (${(cal.downPct * 100).toFixed(0)}% of weeks)`);
  console.log(`    Mean-reversion:  β=${cal.meanReversionBeta.toFixed(3)} ${cal.meanReversionBeta < -0.05 ? '✅ (reverts)' : '⚠️ (weak)'}`);
  console.log(`    Crude corr:      ${cal.crudeCorrelation.toFixed(2)} (${cal.crudeLagWeeks}-week lag)`);
  console.log(`    Pass-through:    $${cal.crudePassthrough}/gal per $1/bbl crude`);

  // ── Predictions ──────────────────────────────────────────────────────
  console.log('\n  Predictions:');
  console.log(`    Fair value:      $${pred.weekly.fairValue.toFixed(3)}/gal (crude-implied + seasonal)`);
  console.log(`    Deviation:       ${signed(pred.weekly.deviation * 100, 1)}¢ from fair value`);

  console.log(`\n    Weekly:  $${pred.weekly.mean.toFixed(3)} ± $${pred.weekly.sigma.toFixed(3)}`);
  console.log(`      Mean-rev adj:  ${signed(pred.weekly.meanRevAdj * 100, 1)}¢`);
  console.log(`      Trend adj:     ${signed(pred.weekly.trendAdj * 100, 1)}¢`);

  console.log(`\n    Monthly: $${pred.monthly.mean.toFixed(3)} ± $${pred.monthly.sigma.toFixed(3)}`);

  // ── Seasonal Outlook ─────────────────────────────────────────────────
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonth = new Date().getUTCMonth();
  console.log('\n  Seasonal Outlook (next 3 months):');
  for (let i = 0; i < 3; i++) {
    const m = ((currentMonth + i) % 12);
    const adj = result.calibration.calibratedBase ? 0 : 0; // Already in fair value
    const { seasonalAdj } = await import('../lib/gas/model.js');
    const sadj = seasonalAdj(m + 1);
    const bar = sadj > 0 ? '▲'.repeat(Math.min(5, Math.round(sadj * 20))) : '▼'.repeat(Math.min(5, Math.round(-sadj * 20)));
    console.log(`    ${months[m]}: ${signed(sadj * 100, 0)}¢ ${bar}`);
  }

  // ── Market Opportunities ─────────────────────────────────────────────
  const { recommendations, summary: mktSum, skipped } = markets;

  console.log(`\n  Kalshi Markets: ${mktSum.marketsFound} found, ${mktSum.marketsLiquid} liquid`);
  if (skipped.illiquid) console.log(`    Skipped ${skipped.illiquid} illiquid`);
  if (skipped.noEdge) console.log(`    Skipped ${skipped.noEdge} with insufficient edge`);

  if (recommendations.length > 0) {
    console.log('\n  🎯 Actionable Trades (≥5% net edge):');
    for (const rec of recommendations) {
      console.log(`\n    ${rec.side} ${rec.ticker} (${rec.seriesLabel}, gas ${rec.threshold > 0 ? '>' : '<'}$${rec.threshold.toFixed(3)})`);
      console.log(`      Entry @ $${rec.execPrice.toFixed(2)} | mid: $${rec.midPrice.toFixed(2)} | spread: ${(rec.spread * 100).toFixed(0)}%`);
      console.log(`      P(model): ${(rec.pEst * 100).toFixed(1)}%  Net edge: ${signed(rec.edge * 100, 1)}%  (gross: ${signed(rec.grossEdge * 100, 1)}%)`);
      console.log(`      Settles: ${rec.settleDate || '?'} (${rec.daysToSettle.toFixed(1)}d) | Vol: ${rec.volume} | OI: ${rec.openInterest}`);
      console.log(`      Size: ${rec.contracts}x ($${rec.dollarRisk.toFixed(2)} risk)`);
    }
  } else {
    console.log('\n  ⛔ No actionable gas trades.');
    console.log('     Markets may lack sufficient edge at executable prices,');
    console.log('     or all contracts are too deep ITM/OTM. This is normal.');
  }

  // ── Backtest ──────────────────────────────────────────────────────────
  if (bt && !bt.error) {
    console.log('\n  📊 Historical Backtest:');
    console.log(`    Predictions:     ${bt.nPredictions} weeks`);
    console.log(`    MAE:             $${bt.mae.toFixed(3)}/gal`);
    console.log(`    RMSE:            $${bt.rmse.toFixed(3)}/gal`);
    console.log(`    Direction hit:   ${(bt.hitRate * 100).toFixed(1)}%`);
  } else if (bt?.error) {
    console.log(`\n  📊 Backtest: ${bt.error}`);
  }

  // ── Log decisions ──────────────────────────────────────────────────
  try {
    const { appendDecision } = await import('../lib/core/history.js');
    for (const rec of markets.allRecommendations) {
      appendDecision('GAS', rec.edge >= 0.05 ? 'GAS_RECOMMENDED' : 'GAS_FILTERED', {}, rec.edge);
    }
    if (markets.allRecommendations.length === 0) {
      appendDecision('GAS', 'NO_TRADE', { reason: 'no edges' }, 0);
    }
  } catch { /* don't fail command */ }

  console.log();
}
