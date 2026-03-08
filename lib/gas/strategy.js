/**
 * Gas price trading strategy — orchestrator.
 * Combines data fetching, model calibration, prediction, and market matching.
 *
 * Edge thesis: gas prices have strong mean-reversion and seasonality.
 * Retail gas markets may overreact to crude oil moves because pump prices
 * adjust with a 1-2 week lag. We model this lag + seasonal patterns.
 */

import { fetchAllGasData } from './data.js';
import { calibrate, predict, probAbove, backtest } from './model.js';
import { scoreGasMarkets } from './matcher.js';
import { getLedger } from '../core/trade.js';
import { round2 } from '../core/utils.js';

/**
 * Run the full gas price strategy pipeline.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.runBacktest=false] — include historical backtest
 * @returns {Object} strategy results
 */
export async function runGasStrategy(opts = {}) {
  // ── DISABLED: Gas strategy has no real edge ──────────────────────────────
  // 0/12 win rate in Feb 2026 paper trading. Root cause: we use EIA weekly
  // retail price data but Kalshi settles on AAA national average. The EIA→AAA
  // offset is unstable ($0.15-0.25+), making probability estimates unreliable.
  // The model predicted pEst ≈ 1.0 on every trade that settled NO.
  //
  // Re-enable only when:
  //   1. We have a direct AAA data source (no public API exists yet), OR
  //   2. We have ≥3 months of paired EIA+AAA data to calibrate the offset
  //
  // To re-enable: remove this block and set config.gas.enabled = true
  if (!opts.forceEnable) {
    return {
      data: { disabled: true },
      calibration: null,
      predictions: null,
      markets: { recommendations: [], summary: { marketsFound: 0, disabled: true } },
      backtest: null,
      summary: {
        disabled: true,
        reason: 'EIA→AAA data source mismatch causes systematic overconfidence (0/12 win rate)',
        recommendations: 0,
        marketsSurveyed: 0,
      },
    };
  }

  // 1. Fetch data
  const data = await fetchAllGasData();
  const { gasHistory, crudeHistory, currentGas, currentCrude } = data;

  // 2. Calibrate model from history
  const cal = calibrate(gasHistory, crudeHistory);

  // 3. Predict future gas prices (weekly + monthly horizons)
  const now = new Date();
  const month = now.getUTCMonth() + 1;

  const weeklyPred = predict({
    currentGas: currentGas.price,
    currentCrude: currentCrude.price,
    daysAhead: 7,
    month,
    cal,
    recentGas: gasHistory.slice(-4),
  });

  const monthlyPred = predict({
    currentGas: currentGas.price,
    currentCrude: currentCrude.price,
    daysAhead: 28,
    month,
    cal,
    recentGas: gasHistory.slice(-4),
  });

  // 4. Score Kalshi markets
  const ledger = getLedger();
  const marketResults = await scoreGasMarkets(probAbove, weeklyPred, cal, ledger.balance);

  // 5. Optional backtest
  let backtestResults = null;
  if (opts.runBacktest && gasHistory.length >= 62) {
    try {
      backtestResults = backtest(gasHistory, crudeHistory, 52);
    } catch (e) {
      backtestResults = { error: e.message };
    }
  }

  return {
    data: {
      currentGas,
      currentCrude,
      gasHistoryWeeks: gasHistory.length,
      crudeHistoryDays: crudeHistory.length,
    },
    calibration: cal,
    predictions: {
      weekly: weeklyPred,
      monthly: monthlyPred,
    },
    markets: marketResults,
    backtest: backtestResults,
    summary: {
      currentGas: currentGas.price,
      currentCrude: currentCrude.price,
      fairValue: weeklyPred.fairValue,
      deviation: weeklyPred.deviation,
      weeklyPrediction: weeklyPred.mean,
      weeklySigma: weeklyPred.sigma,
      monthlyPrediction: monthlyPred.mean,
      monthlySigma: monthlyPred.sigma,
      recommendations: marketResults.recommendations.length,
      marketsSurveyed: marketResults.summary.marketsFound,
    },
  };
}
