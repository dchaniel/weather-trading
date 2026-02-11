/**
 * Proper scoring rules for probability forecast evaluation.
 */

/**
 * Brier score: mean squared error of probability forecasts.
 * Lower is better. 0 = perfect, 0.25 = always predicting 50%.
 * @param {Array<{predicted: number, actual: 0|1}>} predictions
 * @returns {number}
 */
export function brierScore(predictions) {
  if (!predictions.length) return NaN;
  const sum = predictions.reduce((s, p) => s + (p.predicted - p.actual) ** 2, 0);
  return sum / predictions.length;
}

/**
 * Brier skill score relative to climatological baseline.
 * BSS = 1 - BS/BS_clim. Positive = better than climatology.
 */
export function brierSkillScore(predictions, climProb) {
  const bs = brierScore(predictions);
  const bsClim = climProb * (1 - climProb) ** 2 + (1 - climProb) * climProb ** 2;
  // Simplified: BS_clim = climProb * (1 - climProb)... actually:
  // BS_clim for constant predictor = mean((climProb - actual)^2)
  // If actual rate = climProb, then BS_clim = climProb*(1-climProb)^2 + (1-climProb)*climProb^2 = climProb*(1-climProb)
  const bsClimTrue = climProb * (1 - climProb);
  return 1 - bs / bsClimTrue;
}

/**
 * Log loss (cross-entropy). Lower is better.
 */
export function logLoss(predictions) {
  if (!predictions.length) return NaN;
  const eps = 1e-15;
  const sum = predictions.reduce((s, p) => {
    const pp = Math.max(eps, Math.min(1 - eps, p.predicted));
    return s - (p.actual * Math.log(pp) + (1 - p.actual) * Math.log(1 - pp));
  }, 0);
  return sum / predictions.length;
}

/**
 * Calibration curve: bin predictions into buckets and compare predicted vs actual frequency.
 * @param {Array<{predicted: number, actual: 0|1}>} predictions
 * @param {number} nBins - number of bins (default 10 = deciles)
 * @returns {Array<{binCenter: number, meanPredicted: number, actualFreq: number, count: number}>}
 */
export function calibrationCurve(predictions, nBins = 10) {
  const bins = Array.from({ length: nBins }, () => ({ sumPred: 0, sumActual: 0, count: 0 }));
  
  for (const p of predictions) {
    const idx = Math.min(Math.floor(p.predicted * nBins), nBins - 1);
    bins[idx].sumPred += p.predicted;
    bins[idx].sumActual += p.actual;
    bins[idx].count++;
  }
  
  return bins.map((b, i) => ({
    binCenter: (i + 0.5) / nBins,
    meanPredicted: b.count > 0 ? b.sumPred / b.count : (i + 0.5) / nBins,
    actualFreq: b.count > 0 ? b.sumActual / b.count : NaN,
    count: b.count,
  })).filter(b => b.count > 0);
}

/**
 * Sharpness: how decisive are the forecasts? Measured as mean absolute deviation from 0.5.
 * Higher = more decisive. Max = 0.5 (always 0 or 1).
 */
export function sharpness(predictions) {
  if (!predictions.length) return NaN;
  return predictions.reduce((s, p) => s + Math.abs(p.predicted - 0.5), 0) / predictions.length;
}

/**
 * Expected Calibration Error (ECE): weighted average of |predicted - actual| across bins.
 */
export function expectedCalibrationError(predictions, nBins = 10) {
  const curve = calibrationCurve(predictions, nBins);
  const n = predictions.length;
  return curve.reduce((s, b) => s + (b.count / n) * Math.abs(b.meanPredicted - b.actualFreq), 0);
}
