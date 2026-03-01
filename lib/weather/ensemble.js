/**
 * Ensemble-based uncertainty quantification for weather forecasts.
 * Uses actual model spread (GFS vs ECMWF) as dynamic σ estimate instead of fixed values.
 * Also tracks systematic forecast biases for better probability estimates.
 */

import { STATIONS } from './stations.js';
import { round2 } from '../core/utils.js';

/**
 * Get weighted model consensus (no bias correction until validated)
 * @param {Object} forecast - Forecast object
 * @param {string} station - Station code  
 * @returns {number|null} Weighted consensus temperature
 */
export function getModelConsensus(forecast, station) {
  const { nws, ecmwf, gfs } = forecast;
  
  // Use inverse-MAE weighting for consensus
  const weights = STATIONS[station] ? 
    { nws: 0.15, ecmwf: 0.45, gfs: 0.4 } : 
    { nws: 0.2, ecmwf: 0.4, gfs: 0.4 };
  
  let weightedSum = 0;
  let totalWeight = 0;
  
  if (nws?.high) { weightedSum += nws.high * weights.nws; totalWeight += weights.nws; }
  if (ecmwf?.high) { weightedSum += ecmwf.high * weights.ecmwf; totalWeight += weights.ecmwf; }
  if (gfs?.high) { weightedSum += gfs.high * weights.gfs; totalWeight += weights.gfs; }
  
  return totalWeight > 0 ? round2(weightedSum / totalWeight) : null;
}

/**
 * Calculate dynamic sigma based on model ensemble spread
 * @param {Object} forecast - Forecast object with GFS and ECMWF predictions
 * @param {string} station - Station code
 * @returns {number} Dynamic sigma in °F
 */
export function calculateEnsembleSigma(forecast, station) {
  const { gfs, ecmwf, nws } = forecast;
  
  // Use high_f (not high) — that's the property name from forecast API
  const gfsHigh = gfs?.high_f ?? gfs?.high;
  const ecmwfHigh = ecmwf?.high_f ?? ecmwf?.high;
  const nwsHigh = nws?.high_f ?? nws?.high;
  
  // If we don't have both models, fall back to station base sigma
  if (gfsHigh == null || ecmwfHigh == null) {
    const stationData = STATIONS[station];
    return stationData?.baseSigma || 1.0;
  }
  
  // Calculate model spread
  const modelSpread = Math.abs(gfsHigh - ecmwfHigh);
  
  // Dynamic sigma based on model agreement:
  // - When models agree (spread < 1°F), use tight sigma (high confidence)
  // - When models disagree (spread > 3°F), use wider sigma (low confidence)
  // - Scale between base sigma and 2x base sigma
  
  const stationData = STATIONS[station];
  const baseSigma = stationData?.baseSigma || 1.0;
  
  let dynamicSigma;
  
  if (modelSpread < 1.0) {
    // High model agreement = high confidence, but never go below calibrated σ
    dynamicSigma = baseSigma; // Floor at calibrated value — ensemble can only INCREASE σ
  } else if (modelSpread > 3.0) {
    // High model disagreement = low confidence = wider sigma
    dynamicSigma = Math.min(baseSigma * 2.0, 2.5); // Cap at reasonable level
  } else {
    // Interpolate between tight and wide based on spread
    const spreadRatio = (modelSpread - 1.0) / 2.0; // 0 to 1 as spread goes 1-3°F
    dynamicSigma = baseSigma * (1.0 + spreadRatio * 1.0); // Scale 1.0x to 2.0x (never below calibrated)
  }
  
  // Add NWS as tie-breaker if available
  if (nwsHigh != null) {
    const nwsGfsSpread = Math.abs(nwsHigh - gfsHigh);
    const nwsEcmwfSpread = Math.abs(nwsHigh - ecmwfHigh);
    const minSpread = Math.min(nwsGfsSpread, nwsEcmwfSpread);
    
    // If NWS agrees strongly with one model, reduce uncertainty
    if (minSpread < 0.5) {
      dynamicSigma *= 0.9;
    }
  }
  
  // Absolute floor: never go below calibrated baseSigma
  dynamicSigma = Math.max(baseSigma, dynamicSigma);
  
  return round2(dynamicSigma);
}

/**
 * Get uncertainty metrics for a forecast
 * @param {Object} forecast - Forecast object
 * @param {string} station - Station code
 * @returns {Object} Uncertainty analysis
 */
export function analyzeUncertainty(forecast, station) {
  const { gfs, ecmwf, nws } = forecast;
  
  // Use high_f (not high) — that's the property name from forecast API
  const gfsHigh = gfs?.high_f ?? gfs?.high;
  const ecmwfHigh = ecmwf?.high_f ?? ecmwf?.high;
  
  const modelSpread = gfsHigh != null && ecmwfHigh != null
    ? Math.abs(gfsHigh - ecmwfHigh) 
    : null;
  
  const dynamicSigma = calculateEnsembleSigma(forecast, station);
  const stationData = STATIONS[station];
  const baseSigma = stationData?.baseSigma || 1.0;
  
  // Classify uncertainty level
  let uncertaintyLevel;
  let description;
  
  if (modelSpread === null) {
    uncertaintyLevel = 'UNKNOWN';
    description = 'Missing model data';
  } else if (modelSpread < 1.0) {
    uncertaintyLevel = 'LOW';
    description = `Models agree (${round2(modelSpread)}°F spread) → High confidence`;
  } else if (modelSpread > 3.0) {
    uncertaintyLevel = 'HIGH';
    description = `Models disagree (${round2(modelSpread)}°F spread) → Low confidence`;
  } else {
    uncertaintyLevel = 'MODERATE';
    description = `Moderate disagreement (${round2(modelSpread)}°F spread)`;
  }
  
  return {
    modelSpread: round2(modelSpread),
    baseSigma: round2(baseSigma),
    dynamicSigma: round2(dynamicSigma),
    uncertaintyLevel,
    description,
    confidenceAdjustment: round2(dynamicSigma / baseSigma),
  };
}

/**
 * Check if trading is advisable based on ensemble uncertainty
 * @param {Object} forecast - Forecast object
 * @param {string} station - Station code
 * @returns {Object} Trading recommendation
 */
export function checkEnsembleTradeability(forecast, station) {
  const uncertainty = analyzeUncertainty(forecast, station);
  
  // Don't trade when model spread > 3°F (existing guard)
  if (uncertainty.modelSpread > 3.0) {
    return {
      tradeable: false,
      reason: `Model spread ${uncertainty.modelSpread}°F > 3°F limit`,
      effectiveSigma: uncertainty.dynamicSigma,
    };
  }
  
  // Enhanced edge when models agree strongly
  if (uncertainty.modelSpread < 1.0) {
    return {
      tradeable: true,
      reason: `High confidence - models agree (σ=${uncertainty.dynamicSigma}°F vs base ${uncertainty.baseSigma}°F)`,
      effectiveSigma: uncertainty.dynamicSigma,
      enhancement: 'TIGHT_SIGMA',
    };
  }
  
  return {
    tradeable: true,
    reason: `Standard uncertainty (σ=${uncertainty.dynamicSigma}°F)`,
    effectiveSigma: uncertainty.dynamicSigma,
  };
}

/**
 * Format ensemble analysis for display
 * @param {Object} forecast - Forecast object
 * @param {string} station - Station code
 * @returns {string} Formatted analysis
 */
export function formatEnsembleAnalysis(forecast, station) {
  const uncertainty = analyzeUncertainty(forecast, station);
  
  let output = '';
  output += `📊 Ensemble Uncertainty Analysis\n`;
  output += `   Model spread: ${uncertainty.modelSpread}°F\n`;
  output += `   Base σ: ${uncertainty.baseSigma}°F → Dynamic σ: ${uncertainty.dynamicSigma}°F\n`;
  output += `   Confidence: ${uncertainty.uncertaintyLevel} (${uncertainty.description})\n`;
  
  if (uncertainty.confidenceAdjustment !== 1.0) {
    const direction = uncertainty.confidenceAdjustment < 1.0 ? 'TIGHTER' : 'WIDER';
    output += `   σ adjustment: ${(uncertainty.confidenceAdjustment * 100).toFixed(0)}% (${direction})\n`;
  }
  
  const tradeability = checkEnsembleTradeability(forecast, station);
  if (tradeability.enhancement === 'TIGHT_SIGMA') {
    output += `   🎯 ENHANCED EDGE: Tight uncertainty = larger probability gaps\n`;
  }
  
  return output;
}