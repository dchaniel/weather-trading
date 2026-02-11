/**
 * Gas price direction model.
 *
 * Edge thesis: gas prices are sticky and seasonal. They:
 *   1. Follow crude oil with a 1-2 week LAG (pump prices adjust slowly)
 *   2. Have strong SEASONALITY (summer driving season, spring refinery maintenance)
 *   3. Mean-revert to crude-implied fair value
 *   4. Rise slowly, drop fast (asymmetric adjustment)
 *
 * The model estimates the probability distribution of future gas prices
 * by combining: crude oil pass-through, seasonal adjustment, mean-reversion,
 * and recent trend momentum.
 *
 * Calibrated from 2+ years of EIA weekly data.
 */

import { round2 } from '../core/utils.js';

// ── Seasonal factors ─────────────────────────────────────────────────────────
// Monthly seasonal adjustment (cents/gallon above/below annual mean)
// Source: EIA 5-year average seasonal pattern
const SEASONAL_CENTS = {
  1: -15, 2: -12, 3: -5, 4: 5, 5: 15, 6: 20,
  7: 18, 8: 12, 9: 5, 10: -5, 11: -10, 12: -15,
};

/**
 * Get seasonal adjustment for a given month ($/gallon).
 */
export function seasonalAdj(month) {
  return (SEASONAL_CENTS[month] || 0) / 100;
}

// ── Crude oil pass-through ───────────────────────────────────────────────────
// 1 barrel = 42 gallons, ~19.5 gallons of gasoline per barrel
// But retail includes taxes, distribution, refining margin
// Empirical: $1 change in crude ≈ $0.024/gal change in retail gas (with lag)
const CRUDE_PASSTHROUGH = 0.024; // $/gal per $/barrel
const CRUDE_LAG_WEEKS = 2; // weeks for crude changes to hit pump

/**
 * Estimate the crude-oil-implied fair value of gas.
 * Uses a simple linear model: gas = base + crude * passthrough + seasonal
 *
 * @param {number} crudePrice — current WTI $/barrel
 * @param {number} month — 1-12
 * @param {number} baseGas — baseline gas price at $70/barrel crude (calibrated)
 * @returns {number} fair value $/gallon
 */
export function crudeFairValue(crudePrice, month, baseGas = 3.00) {
  const baseCrude = 70; // reference crude price
  const crudeDelta = (crudePrice - baseCrude) * CRUDE_PASSTHROUGH;
  return baseGas + crudeDelta + seasonalAdj(month);
}

// ── Weekly change statistics (calibrated from EIA data) ──────────────────────

/**
 * Calibrate model parameters from historical gas + crude data.
 * Returns statistics needed for probability estimation.
 *
 * @param {Array<{date, price}>} gasHistory — weekly gas prices
 * @param {Array<{date, price}>} crudeHistory — daily crude prices
 * @returns {Object} calibration parameters
 */
export function calibrate(gasHistory, crudeHistory) {
  if (gasHistory.length < 10) throw new Error('Need ≥10 weeks of gas price history');

  // Weekly changes in gas prices
  const weeklyChanges = [];
  for (let i = 1; i < gasHistory.length; i++) {
    weeklyChanges.push({
      date: gasHistory[i].date,
      change: gasHistory[i].price - gasHistory[i - 1].price,
      price: gasHistory[i].price,
      prevPrice: gasHistory[i - 1].price,
    });
  }

  // Statistics on weekly changes
  const changes = weeklyChanges.map(w => w.change);
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((s, c) => s + (c - mean) ** 2, 0) / (changes.length - 1);
  const sigma = Math.sqrt(variance);

  // Asymmetry: separate up vs down moves
  const upMoves = changes.filter(c => c > 0);
  const downMoves = changes.filter(c => c < 0);
  const avgUp = upMoves.length ? upMoves.reduce((a, b) => a + b, 0) / upMoves.length : 0;
  const avgDown = downMoves.length ? downMoves.reduce((a, b) => a + b, 0) / downMoves.length : 0;
  const upSigma = upMoves.length > 1
    ? Math.sqrt(upMoves.reduce((s, c) => s + (c - avgUp) ** 2, 0) / (upMoves.length - 1))
    : sigma;
  const downSigma = downMoves.length > 1
    ? Math.sqrt(downMoves.reduce((s, c) => s + (c - avgDown) ** 2, 0) / (downMoves.length - 1))
    : sigma;

  // Mean-reversion strength: regress change on (price - trailing mean)
  // change_t = α + β * (price_{t-1} - MA20_t) + ε
  let mrBeta = 0;
  if (gasHistory.length >= 25) {
    const window = 20;
    let sumXY = 0, sumX2 = 0;
    for (let i = window; i < gasHistory.length; i++) {
      const ma = gasHistory.slice(i - window, i).reduce((s, g) => s + g.price, 0) / window;
      const dev = gasHistory[i - 1].price - ma;
      const chg = gasHistory[i].price - gasHistory[i - 1].price;
      sumXY += dev * chg;
      sumX2 += dev * dev;
    }
    mrBeta = sumX2 > 0 ? sumXY / sumX2 : 0;
  }

  // Crude-gas correlation with lag
  let crudeCorr = 0;
  if (crudeHistory.length > 20) {
    // Map crude prices to weekly (use Friday price for each gas week)
    const crudeByWeek = new Map();
    for (const c of crudeHistory) {
      const weekStart = getWeekStart(c.date);
      crudeByWeek.set(weekStart, c.price); // overwrites to latest in week
    }

    // Compute lagged correlation: gas_change_t vs crude_change_{t-lag}
    const pairs = [];
    for (let i = CRUDE_LAG_WEEKS + 1; i < gasHistory.length; i++) {
      const gasChg = gasHistory[i].price - gasHistory[i - 1].price;
      const laggedWeek = getWeekStart(gasHistory[i - CRUDE_LAG_WEEKS].date);
      const prevLaggedWeek = getWeekStart(gasHistory[i - CRUDE_LAG_WEEKS - 1]?.date);
      const c1 = crudeByWeek.get(laggedWeek);
      const c0 = crudeByWeek.get(prevLaggedWeek);
      if (c1 != null && c0 != null) {
        pairs.push({ gasChg, crudeChg: c1 - c0 });
      }
    }

    if (pairs.length > 5) {
      const gMean = pairs.reduce((s, p) => s + p.gasChg, 0) / pairs.length;
      const cMean = pairs.reduce((s, p) => s + p.crudeChg, 0) / pairs.length;
      let num = 0, denG = 0, denC = 0;
      for (const p of pairs) {
        num += (p.gasChg - gMean) * (p.crudeChg - cMean);
        denG += (p.gasChg - gMean) ** 2;
        denC += (p.crudeChg - cMean) ** 2;
      }
      crudeCorr = denG > 0 && denC > 0 ? num / Math.sqrt(denG * denC) : 0;
    }
  }

  // Base gas price (intercept for crude fair value model)
  // Solve: mean(gas) = baseGas + (mean(crude) - 70) * passthrough + mean(seasonal)
  const meanGas = gasHistory.reduce((s, g) => s + g.price, 0) / gasHistory.length;
  const meanSeasonal = Object.values(SEASONAL_CENTS).reduce((a, b) => a + b, 0) / 12 / 100;
  // Get mean crude over same period
  let meanCrude = 70;
  if (crudeHistory.length > 0) {
    meanCrude = crudeHistory.reduce((s, c) => s + c.price, 0) / crudeHistory.length;
  }
  const calibratedBase = meanGas - (meanCrude - 70) * CRUDE_PASSTHROUGH - meanSeasonal;

  return {
    weeklyMean: round2(mean),
    weeklySigma: round2(sigma),
    avgUp: round2(avgUp),
    avgDown: round2(avgDown),
    upSigma: round2(upSigma),
    downSigma: round2(downSigma),
    meanReversionBeta: round2(mrBeta),
    crudeCorrelation: round2(crudeCorr),
    crudePassthrough: CRUDE_PASSTHROUGH,
    crudeLagWeeks: CRUDE_LAG_WEEKS,
    calibratedBase: round2(calibratedBase),
    nWeeks: gasHistory.length,
    upPct: round2(upMoves.length / changes.length),
    downPct: round2(downMoves.length / changes.length),
  };
}

/**
 * Predict gas price distribution at a future date.
 *
 * @param {Object} params
 * @param {number} params.currentGas — current gas price $/gal
 * @param {number} params.currentCrude — current WTI crude $/barrel
 * @param {number} params.daysAhead — days until settlement
 * @param {number} params.month — settlement month (1-12)
 * @param {Object} params.cal — calibration parameters from calibrate()
 * @param {Array<{date, price}>} [params.recentGas] — last few weeks of gas prices (for trend)
 * @returns {{ mean, sigma, fairValue, meanRevAdj, trendAdj, crudeAdj }}
 */
export function predict(params) {
  const { currentGas, currentCrude, daysAhead, month, cal, recentGas } = params;
  const weeksAhead = Math.max(1, daysAhead / 7);

  // 1. Crude-implied fair value
  const fairValue = crudeFairValue(currentCrude, month, cal.calibratedBase);

  // 2. Mean-reversion pull toward fair value
  // If current price is above fair value, expect downward pressure
  const deviation = currentGas - fairValue;
  const meanRevAdj = cal.meanReversionBeta * deviation * weeksAhead;

  // 3. Recent trend (momentum from last 4 weeks)
  let trendAdj = 0;
  if (recentGas && recentGas.length >= 4) {
    const recent4 = recentGas.slice(-4);
    const recentTrend = (recent4[recent4.length - 1].price - recent4[0].price) / recent4.length;
    // Damped extrapolation: carry 30% of recent weekly trend forward
    trendAdj = recentTrend * 0.30 * weeksAhead;
  }

  // 4. Crude oil pass-through (already priced into fair value, but adjust for lag)
  // If crude moved recently, gas hasn't fully adjusted yet
  let crudeAdj = 0;
  // The fair value already accounts for current crude, so crudeAdj captures
  // the expected catch-up from lagged pass-through

  // 5. Combine adjustments
  const predictedChange = meanRevAdj + trendAdj + crudeAdj;
  const predictedMean = currentGas + predictedChange;

  // 6. Uncertainty: sigma scales with sqrt(weeks), asymmetric
  const baseSigma = cal.weeklySigma * Math.sqrt(weeksAhead);

  return {
    mean: round2(predictedMean),
    sigma: round2(baseSigma),
    fairValue: round2(fairValue),
    meanRevAdj: round2(meanRevAdj),
    trendAdj: round2(trendAdj),
    crudeAdj: round2(crudeAdj),
    deviation: round2(deviation),
    weeksAhead: round2(weeksAhead),
  };
}

/**
 * Probability that gas price will be above a threshold at settlement.
 * Uses normal distribution with asymmetric sigma adjustment.
 *
 * @param {number} predictedMean — predicted gas price
 * @param {number} sigma — predicted standard deviation
 * @param {number} threshold — contract strike price
 * @param {Object} cal — calibration parameters (for asymmetry)
 * @returns {number} probability 0-1
 */
export function probAbove(predictedMean, sigma, threshold, cal) {
  if (sigma <= 0) return predictedMean >= threshold ? 1 : 0;

  // Asymmetric adjustment: gas rises slowly, drops fast
  // If threshold > mean (asking about upside), use upSigma
  // If threshold < mean (asking about downside), use downSigma
  const effectiveSigma = threshold > predictedMean
    ? sigma * (cal.upSigma / cal.weeklySigma || 1)
    : sigma * (cal.downSigma / cal.weeklySigma || 1);

  const z = (predictedMean - threshold) / effectiveSigma;
  return normalCDF(z);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day); // Sunday
  return d.toISOString().slice(0, 10);
}

/** Standard normal CDF */
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Run a simple historical backtest of the model.
 * Walks forward through gas history, predicting each week from prior data.
 *
 * @param {Array<{date, price}>} gasHistory
 * @param {Array<{date, price}>} crudeHistory
 * @param {number} trainWeeks — weeks to use for initial calibration
 * @returns {{ predictions, mae, rmse, hitRate, nPredictions }}
 */
export function backtest(gasHistory, crudeHistory, trainWeeks = 52) {
  if (gasHistory.length < trainWeeks + 10) {
    throw new Error(`Need ≥${trainWeeks + 10} weeks, have ${gasHistory.length}`);
  }

  const predictions = [];
  let sumAbsErr = 0, sumSqErr = 0, hits = 0;

  for (let i = trainWeeks; i < gasHistory.length - 1; i++) {
    const trainGas = gasHistory.slice(0, i + 1);
    const cal = calibrate(trainGas, crudeHistory);
    const current = gasHistory[i];
    const actual = gasHistory[i + 1];
    const month = parseInt(actual.date.slice(5, 7));

    // Find crude price closest to this date
    const crudePrice = findClosestCrude(crudeHistory, current.date);

    const pred = predict({
      currentGas: current.price,
      currentCrude: crudePrice,
      daysAhead: 7,
      month,
      cal,
      recentGas: trainGas.slice(-4),
    });

    const error = actual.price - pred.mean;
    const directionCorrect = (pred.mean > current.price && actual.price > current.price) ||
                              (pred.mean <= current.price && actual.price <= current.price);

    predictions.push({
      date: actual.date,
      predicted: pred.mean,
      actual: actual.price,
      error: round2(error),
      directionCorrect,
    });

    sumAbsErr += Math.abs(error);
    sumSqErr += error ** 2;
    if (directionCorrect) hits++;
  }

  const n = predictions.length;
  return {
    predictions,
    mae: round2(sumAbsErr / n),
    rmse: round2(Math.sqrt(sumSqErr / n)),
    hitRate: round2(hits / n),
    nPredictions: n,
  };
}

function findClosestCrude(crudeHistory, date) {
  // Find crude price on or before date
  for (let i = crudeHistory.length - 1; i >= 0; i--) {
    if (crudeHistory[i].date <= date) return crudeHistory[i].price;
  }
  return crudeHistory[0]?.price || 70;
}
