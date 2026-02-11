/**
 * Crypto strategy backtester.
 * Uses historical CoinGecko data to simulate daily predictions and score them.
 * 
 * Strategy maturity: PAPER-ONLY — pending live validation.
 */

import { getHistoricalPrices, getOHLC, COINS } from './prices.js';
import { garchVolatility, realizedVolatility, excessKurtosis, cryptoProbAbove, generateSignals } from './forecast.js';
import { round2, sleep } from '../core/utils.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', 'data');

/**
 * Run a backtest over the last N days.
 * For each day, uses data up to that day to predict whether price
 * will be above various thresholds 1 day later.
 */
export async function runCryptoBacktest(days = 30) {
  mkdirSync(DATA_DIR, { recursive: true });

  const results = {};
  const overall = { predictions: 0, correct: 0, brierSum: 0 };

  for (const [symbol, coin] of Object.entries(COINS)) {
    console.log(`  Fetching ${symbol} history...`);
    // Use market_chart (hourly data for ≤90 days) for more data points
    const history = await getHistoricalPrices(coin.id, Math.min(days + 60, 90));
    await sleep(3000);

    if (history.length < 60) {
      console.log(`  ⚠ Insufficient data for ${symbol}`);
      continue;
    }

    // Deduplicate to daily (take last price per day)
    const dailyMap = new Map();
    for (const p of history) {
      dailyMap.set(p.date, p);
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.timestamp - b.timestamp);

    if (daily.length < 35) {
      console.log(`  ⚠ Insufficient daily data for ${symbol}: ${daily.length} days`);
      continue;
    }

    const symbolResults = [];
    const currentPrice = daily[daily.length - 1].price;

    // Generate thresholds as round numbers near current price
    const thresholds = symbol === 'BTC'
      ? generateThresholds(currentPrice, 5000, 0.3)
      : generateThresholds(currentPrice, 250, 0.3);

    // For each day (starting from day 31 so we have lookback)
    const startIdx = Math.min(30, daily.length - days);
    for (let i = startIdx; i < daily.length - 1; i++) {
      const lookback = daily.slice(0, i + 1);
      const actualNext = daily[i + 1].price;
      const todayPrice = daily[i].price;

      // Compute vol and signals using data up to this day
      const vol = garchVolatility(lookback, 30);
      const exKurt = excessKurtosis(lookback, 30);

      for (const threshold of thresholds) {
        const pAbove = cryptoProbAbove(todayPrice, threshold, vol, 1, 0, exKurt);
        const actualAbove = actualNext >= threshold ? 1 : 0;

        // Brier score: (p - actual)²
        const brier = (pAbove - actualAbove) ** 2;

        symbolResults.push({
          date: daily[i].date,
          price: round2(todayPrice),
          threshold,
          pAbove: round2(pAbove),
          actual: actualAbove,
          brier: round2(brier),
        });

        overall.predictions++;
        overall.brierSum += brier;
        // "Correct" = predicted >50% and happened, or predicted <50% and didn't
        if ((pAbove >= 0.5 && actualAbove === 1) || (pAbove < 0.5 && actualAbove === 0)) {
          overall.correct++;
        }
      }
    }

    // Compute calibration buckets
    const calibration = computeCalibration(symbolResults);

    results[symbol] = {
      totalPredictions: symbolResults.length,
      accuracy: symbolResults.length > 0
        ? round2(symbolResults.filter(r => (r.pAbove >= 0.5) === (r.actual === 1)).length / symbolResults.length)
        : 0,
      avgBrier: symbolResults.length > 0 ? round2(overall.brierSum / symbolResults.length) : 0,
      calibration,
      sampleResults: symbolResults.slice(-10),
    };
  }

  // Overall stats
  const overallAccuracy = overall.predictions > 0 ? round2(overall.correct / overall.predictions) : 0;
  const overallBrier = overall.predictions > 0 ? round2(overall.brierSum / overall.predictions) : 0;

  // Generate report
  const report = generateReport(results, overallAccuracy, overallBrier, overall.predictions);
  const reportPath = join(DATA_DIR, 'crypto-backtest.md');
  writeFileSync(reportPath, report);
  console.log(`\n  Report written to ${reportPath}`);

  return { results, overallAccuracy, overallBrier, totalPredictions: overall.predictions };
}

function generateThresholds(price, step, range) {
  const thresholds = [];
  const low = price * (1 - range);
  const high = price * (1 + range);
  let t = Math.ceil(low / step) * step;
  while (t <= high) {
    thresholds.push(t);
    t += step;
  }
  return thresholds;
}

function computeCalibration(results) {
  const buckets = {};
  for (let b = 0; b < 10; b++) {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const inBucket = results.filter(r => r.pAbove >= lo && r.pAbove < hi);
    if (inBucket.length > 0) {
      const avgPred = inBucket.reduce((s, r) => s + r.pAbove, 0) / inBucket.length;
      const avgActual = inBucket.reduce((s, r) => s + r.actual, 0) / inBucket.length;
      buckets[`${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`] = {
        count: inBucket.length,
        avgPredicted: round2(avgPred),
        avgActual: round2(avgActual),
        gap: round2(Math.abs(avgPred - avgActual)),
      };
    }
  }
  return buckets;
}

function generateReport(results, accuracy, brier, total) {
  let md = `# Crypto Strategy Backtest Results\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total predictions | ${total} |\n`;
  md += `| Overall accuracy | ${(accuracy * 100).toFixed(1)}% |\n`;
  md += `| Brier score | ${brier.toFixed(4)} (lower=better, 0.25=random) |\n`;
  md += `| Model | GARCH vol + Student-t tails + momentum drift |\n\n`;

  for (const [symbol, r] of Object.entries(results)) {
    md += `## ${symbol}\n\n`;
    md += `- Predictions: ${r.totalPredictions}\n`;
    md += `- Accuracy: ${(r.accuracy * 100).toFixed(1)}%\n`;
    md += `- Avg Brier: ${r.avgBrier.toFixed(4)}\n\n`;

    md += `### Calibration\n\n`;
    md += `| Bucket | Count | Avg Predicted | Avg Actual | Gap |\n`;
    md += `|--------|-------|--------------|------------|-----|\n`;
    for (const [bucket, cal] of Object.entries(r.calibration)) {
      md += `| ${bucket} | ${cal.count} | ${(cal.avgPredicted * 100).toFixed(1)}% | ${(cal.avgActual * 100).toFixed(1)}% | ${(cal.gap * 100).toFixed(1)}% |\n`;
    }
    md += `\n`;
  }

  md += `## Interpretation\n\n`;
  md += `- **Brier score < 0.20**: Model adds value over random\n`;
  md += `- **Brier score 0.20-0.25**: Marginal, barely better than guessing\n`;
  md += `- **Brier score > 0.25**: Model is worse than random\n`;
  md += `- **Calibration gap < 5%**: Well-calibrated bucket\n`;
  md += `- **Calibration gap > 10%**: Poorly calibrated, don't trust edges in that range\n\n`;
  md += `## Notes\n\n`;
  md += `- Backtest uses 1-day forward predictions only\n`;
  md += `- Does NOT account for spread/execution costs\n`;
  md += `- Real trading needs edge > spread to profit\n`;
  md += `- Crypto markets on Kalshi have 20-80% spreads — very few actionable trades\n`;

  return md;
}
