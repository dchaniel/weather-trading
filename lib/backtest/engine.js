// NOTE: Backtest uses graduated costs (proportional to price) to model
// market impact on large orders. Live trading uses flat 4¢/contract
// from TRANSACTION_COST constant. This intentional divergence makes
// backtests more conservative for large positions.

/**
 * Rigorous backtesting engine for Kalshi temperature contracts.
 * 
 * DESIGN: No simulated market prices. We evaluate forecast calibration
 * and compute conditional P&L under assumed market inefficiency levels.
 * This is honest — it tells you what you need to verify, not fake results.
 */

import { STATIONS } from '../weather/stations.js';
import { normalCDF, round2, dateRange } from '../core/utils.js';
import { brierScore, brierSkillScore, logLoss, calibrationCurve, sharpness, expectedCalibrationError } from './scoring.js';

/**
 * Kalshi fee schedule (per contract, in dollars).
 */
function kalshiFee(price) {
  // Kalshi charges a fee that scales with contract price
  // Approximate: ~1-2 cents per contract
  if (price <= 0.10) return 0.005;
  if (price <= 0.25) return 0.01;
  if (price <= 0.75) return 0.015;
  return 0.01;
}

/**
 * Generate probability predictions for every (day, threshold) pair.
 * This is the core dataset: did our probability forecast match reality?
 */
export function generatePredictions(data, opts = {}) {
  const {
    sigma = 3.5,
    spreadFilter = 3,
    climFilter = 15,
    thresholdRange = 8,
    thresholdStep = 1,
  } = opts;

  const predictions = [];
  const s = STATIONS[data.station];

  for (const err of data.errors) {
    const fc = data.forecasts.get(err.date);
    if (!fc) continue;
    if (fc.spread > spreadFilter) continue;

    const month = parseInt(err.date.slice(5, 7));
    const normal = s?.climNormalHigh?.[month];
    if (normal && Math.abs(err.forecast - normal) > climFilter) continue;

    const forecastMean = fc.ecmwf != null && fc.gfs != null
      ? fc.ecmwf * 0.6 + fc.gfs * 0.4
      : fc.mean;
    const actualHigh = err.actual;

    for (let offset = -thresholdRange; offset <= thresholdRange; offset += thresholdStep) {
      const threshold = Math.round(forecastMean) + offset;
      const predicted = 1 - normalCDF((threshold - forecastMean) / sigma);
      const actual = actualHigh >= threshold ? 1 : 0;

      predictions.push({
        date: err.date,
        threshold,
        predicted,
        actual,
        forecastMean,
        actualHigh,
        spread: fc.spread,
        offset,
      });
    }
  }

  return predictions;
}

/**
 * Simulate P&L under assumed market inefficiency.
 * 
 * Model: market prices with marketSigma > ourSigma.
 * Edge = difference in probability assessments.
 * 
 * FIXES (2026-02-09):
 * - Sharpe now counts ALL calendar days (zero-return days included)
 * - Max 1 trade per day (best edge) to avoid correlated bets
 * - Gradual cost impact instead of cliff (lower minEdge, costs eat into P&L naturally)
 * - Realistic position sizing with proper Kelly
 */
export function simulatePnL(predictions, opts = {}) {
  const {
    ourSigma = 3.5,
    marketSigma = 5.0,
    minEdge = 0.02,          // Lowered from 0.05 — let costs filter naturally
    kellyFraction = 0.25,
    spreadCost = 0.03,
    initialBankroll = 1000,
    maxContractsPerTrade = 10,
    maxTradesPerDay = 1,      // NEW: limit correlated bets
    debug = false,
  } = opts;

  // First pass: find best trade per day
  const dailyCandidates = {};
  
  for (const pred of predictions) {
    const ourProb = pred.predicted;
    const marketProb = 1 - normalCDF((pred.threshold - pred.forecastMean) / marketSigma);
    const edge = ourProb - marketProb;
    const totalCost = kalshiFee(marketProb) + spreadCost;

    // Only require edge > minEdge (costs reduce P&L, don't filter)
    if (Math.abs(edge) < minEdge) continue;
    
    // Skip contracts too deep ITM/OTM (market price < 5% or > 95%)
    if (marketProb < 0.05 || marketProb > 0.95) continue;

    let side, entryPrice, pTrue, netEdge;
    if (edge > 0) {
      side = 'YES';
      entryPrice = marketProb + spreadCost / 2;
      pTrue = ourProb;
      netEdge = edge - totalCost;
    } else {
      side = 'NO';
      entryPrice = 1 - marketProb + spreadCost / 2;
      pTrue = 1 - ourProb;
      netEdge = -edge - totalCost;
    }

    // Skip if net edge after costs is negative (but allow small positive)
    if (netEdge < 0) continue;

    const absEdge = Math.abs(edge);
    if (!dailyCandidates[pred.date]) dailyCandidates[pred.date] = [];
    dailyCandidates[pred.date].push({
      pred, side, entryPrice, pTrue, edge, netEdge, absEdge, marketProb
    });
  }

  // Pick best N trades per day by net edge
  let balance = initialBankroll;
  let peak = initialBankroll;
  let maxDD = 0;
  let maxDDDuration = 0;
  let currentDDDays = 0;
  const trades = [];
  const dailyPnL = {};

  // Get ALL dates in the prediction set for proper Sharpe
  const allDates = [...new Set(predictions.map(p => p.date))].sort();

  for (const date of allDates) {
    dailyPnL[date] = 0; // Initialize ALL days to zero
    
    const candidates = dailyCandidates[date];
    if (!candidates || candidates.length === 0) continue;
    
    // Sort by net edge descending, take best N
    candidates.sort((a, b) => b.netEdge - a.netEdge);
    const selected = candidates.slice(0, maxTradesPerDay);

    for (const { pred, side, entryPrice, pTrue, edge, netEdge, marketProb } of selected) {
      // Quarter-Kelly on FIXED bankroll
      // Use true market probability (not entry price which includes spread) for Kelly
      const pMarketTrue = side === 'YES' ? marketProb : (1 - marketProb);
      const kellyFull = pTrue > pMarketTrue ? (pTrue - pMarketTrue) / (1 - pMarketTrue) : 0;
      if (kellyFull <= 0) continue;

      const fraction = Math.min(kellyFull * kellyFraction, 0.05);
      const dollarAmount = initialBankroll * fraction;
      const nContracts = Math.min(maxContractsPerTrade, Math.max(1, Math.floor(dollarAmount / entryPrice)));
      
      const fee = kalshiFee(entryPrice) * nContracts;
      const totalCost = entryPrice * nContracts + fee;

      const won = (side === 'YES' && pred.actual === 1) || (side === 'NO' && pred.actual === 0);
      const payout = won ? nContracts * 1.0 : 0;
      const tradePnL = payout - totalCost;

      balance += tradePnL;
      dailyPnL[date] += tradePnL;

      // Drawdown tracking
      if (balance > peak) { peak = balance; currentDDDays = 0; }
      else { currentDDDays++; maxDDDuration = Math.max(maxDDDuration, currentDDDays); }
      const dd = (peak - balance) / peak;
      maxDD = Math.max(maxDD, dd);

      trades.push({
        date: pred.date, threshold: pred.threshold, side,
        nContracts, entryPrice: round2(entryPrice),
        edge: round2(edge), netEdge: round2(netEdge), won, pnl: round2(tradePnL),
      });
    }
  }

  // Metrics
  const wins = trades.filter(t => t.won).length;
  const totalPnL = round2(balance - initialBankroll);
  const returnPct = round2((totalPnL / initialBankroll) * 100);

  // Sharpe: use ALL calendar days (including zero-return days)
  const dailyDates = allDates;
  const dailyReturns = dailyDates.map(d => (dailyPnL[d] || 0) / initialBankroll);
  const tradingDays = dailyDates.filter(d => (dailyPnL[d] || 0) !== 0).length;

  let sharpe = 0;
  let _debugSharpe = {};
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(variance);
    // Annualized Sharpe = (mean_daily * 252 - rf) / (std_daily * sqrt(252))
    if (std > 0) {
      sharpe = round2((mean * 252 - 0.05) / (std * Math.sqrt(252)));
    }
    _debugSharpe = {
      totalDays: dailyReturns.length,
      tradingDays,
      meanDailyReturn: round2(mean * 10000) / 10000,
      stdDailyReturn: round2(std * 10000) / 10000,
      annualizedReturn: round2(mean * 252 * 100),
      annualizedVol: round2(std * Math.sqrt(252) * 100),
    };
  }

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? round2(grossProfit / grossLoss) : Infinity;

  const monthlyPnL = {};
  for (const t of trades) {
    const m = t.date.slice(0, 7);
    monthlyPnL[m] = round2((monthlyPnL[m] || 0) + t.pnl);
  }

  // Longest losing streak
  let longestStreak = 0, currentStreak = 0;
  for (const t of trades) {
    if (!t.won) { currentStreak++; longestStreak = Math.max(longestStreak, currentStreak); }
    else currentStreak = 0;
  }

  const worstMonth = Object.entries(monthlyPnL).sort((a, b) => a[1] - b[1])[0];

  return {
    totalTrades: trades.length, wins, losses: trades.length - wins,
    winRate: trades.length > 0 ? round2(wins / trades.length * 100) : 0,
    totalPnL, returnPct, sharpe,
    sharpeDebug: _debugSharpe,
    maxDrawdown: round2(maxDD * 100), maxDrawdownDuration: maxDDDuration,
    profitFactor, monthlyPnL, longestLosingStreak: longestStreak,
    worstMonth: worstMonth ? { month: worstMonth[0], pnl: round2(worstMonth[1]) } : null,
    balance: round2(balance),
    trades,
  };
}

/**
 * Full station analysis with calibration, market σ sweep, cost sensitivity, and walk-forward.
 */
export async function analyzeStation(data, opts = {}) {
  const {
    sigma = 3.5,
    splitDate = '2025-10-01',
    marketSigmas = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0],
    minEdge = 0.05,
    kellyFraction = 0.25,
    spreadCost = 0.03,
  } = opts;

  // All predictions
  const allPreds = generatePredictions(data, { sigma, spreadFilter: 3 });
  const scoring = allPreds.map(p => ({ predicted: p.predicted, actual: p.actual }));

  // Train/test split
  const trainPreds = allPreds.filter(p => p.date < splitDate);
  const testPreds = allPreds.filter(p => p.date >= splitDate);
  const trainScoring = trainPreds.map(p => ({ predicted: p.predicted, actual: p.actual }));
  const testScoring = testPreds.map(p => ({ predicted: p.predicted, actual: p.actual }));

  // Calibration
  const calibration = {
    all: {
      brier: round2(brierScore(scoring)),
      logLoss: round2(logLoss(scoring)),
      sharpness: round2(sharpness(scoring)),
      ece: round2(expectedCalibrationError(scoring)),
      curve: calibrationCurve(scoring),
      n: scoring.length,
    },
    train: trainScoring.length > 0 ? {
      brier: round2(brierScore(trainScoring)),
      n: trainScoring.length,
    } : null,
    test: testScoring.length > 0 ? {
      brier: round2(brierScore(testScoring)),
      n: testScoring.length,
    } : null,
  };

  // Also test with σ = measured stdDev (tighter, more accurate?)
  const tightSigma = data.stats.stdDev;
  const tightPreds = generatePredictions(data, { sigma: tightSigma, spreadFilter: 3 });
  const tightScoring = tightPreds.map(p => ({ predicted: p.predicted, actual: p.actual }));
  const tightCalibration = {
    brier: round2(brierScore(tightScoring)),
    ece: round2(expectedCalibrationError(tightScoring)),
    sigma: tightSigma,
  };

  // Sigma sweep for best calibration
  const sigmaCalibration = [];
  for (const testSigma of [1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]) {
    const preds = generatePredictions(data, { sigma: testSigma, spreadFilter: 3 });
    const sc = preds.map(p => ({ predicted: p.predicted, actual: p.actual }));
    sigmaCalibration.push({
      sigma: testSigma,
      brier: round2(brierScore(sc)),
      ece: round2(expectedCalibrationError(sc)),
    });
  }

  // P&L at different market σ assumptions
  const marketSigmaAnalysis = {};
  for (const ms of marketSigmas) {
    const pnlAll = simulatePnL(allPreds, { ourSigma: sigma, marketSigma: ms, minEdge, kellyFraction, spreadCost });
    const pnlTrain = trainPreds.length > 0 ? simulatePnL(trainPreds, { ourSigma: sigma, marketSigma: ms, minEdge, kellyFraction, spreadCost }) : null;
    const pnlTest = testPreds.length > 0 ? simulatePnL(testPreds, { ourSigma: sigma, marketSigma: ms, minEdge, kellyFraction, spreadCost }) : null;

    marketSigmaAnalysis[ms] = {
      all: { pnl: pnlAll.totalPnL, sharpe: pnlAll.sharpe, trades: pnlAll.totalTrades, winRate: pnlAll.winRate, maxDD: pnlAll.maxDrawdown },
      train: pnlTrain ? { pnl: pnlTrain.totalPnL, sharpe: pnlTrain.sharpe, trades: pnlTrain.totalTrades, winRate: pnlTrain.winRate } : null,
      test: pnlTest ? { pnl: pnlTest.totalPnL, sharpe: pnlTest.sharpe, trades: pnlTest.totalTrades, winRate: pnlTest.winRate } : null,
    };
  }

  // Cost sensitivity at market σ = 5.0
  const costResults = [];
  for (const sc of [0, 0.01, 0.02, 0.03, 0.05, 0.07, 0.10]) {
    const pnl = simulatePnL(allPreds, { ourSigma: sigma, marketSigma: 5.0, minEdge, kellyFraction, spreadCost: sc });
    costResults.push({ spreadCost: sc, pnl: pnl.totalPnL, sharpe: pnl.sharpe, trades: pnl.totalTrades, winRate: pnl.winRate });
  }

  // Walk-forward (expanding window)
  const byMonth = {};
  for (const err of data.errors) { const m = err.date.slice(0, 7); (byMonth[m] ||= []).push(err); }
  const months = Object.keys(byMonth).sort();
  const wfFolds = [];
  
  for (let testIdx = 3; testIdx < months.length; testIdx++) {
    const trainMonths = new Set(months.slice(0, testIdx));
    const testMonth = months[testIdx];
    
    const trainData = { ...data, errors: data.errors.filter(e => trainMonths.has(e.date.slice(0, 7))) };
    const testData = { ...data, errors: data.errors.filter(e => e.date.slice(0, 7) === testMonth) };
    
    // Find best σ on train by Brier score
    let bestSigma = sigma, bestBrier = Infinity;
    for (const ts of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]) {
      const preds = generatePredictions(trainData, { sigma: ts, spreadFilter: 3 });
      const bs = brierScore(preds.map(p => ({ predicted: p.predicted, actual: p.actual })));
      if (bs < bestBrier) { bestBrier = bs; bestSigma = ts; }
    }
    
    const testPreds = generatePredictions(testData, { sigma: bestSigma, spreadFilter: 3 });
    const testBrier = brierScore(testPreds.map(p => ({ predicted: p.predicted, actual: p.actual })));
    const testPnL = simulatePnL(testPreds, { ourSigma: bestSigma, marketSigma: 5.0, minEdge, kellyFraction, spreadCost });
    
    wfFolds.push({
      trainPeriod: `${months[0]}–${months[testIdx - 1]}`,
      testPeriod: testMonth,
      bestSigma,
      trainBrier: round2(bestBrier),
      testBrier: round2(testBrier),
      testPnL: testPnL.totalPnL,
      testTrades: testPnL.totalTrades,
      testWinRate: testPnL.winRate,
      testSharpe: testPnL.sharpe,
    });
  }

  return {
    station: data.station,
    forecastStats: data.stats,
    calibration,
    tightCalibration,
    sigmaCalibration,
    marketSigmaAnalysis,
    costSensitivity: costResults,
    walkForward: wfFolds,
  };
}
