/**
 * lib/flights/model.js — Flight delay probability model for ORD.
 *
 * Predicts:
 * 1. P(avg delay ≥ 15 min) — for ORDDLY binary contracts
 * 2. Expected total delays+cancellations — for FLIGHTORD threshold contracts
 *
 * Features: weather (wind, snow, visibility, thunderstorms, freezing rain),
 * day-of-week, month/season, holiday proximity, FAA real-time status.
 *
 * The model combines a calibrated base rate with weather-conditional adjustments.
 * Weather is the dominant factor (~60% of variance in ORD delays).
 */

import { ORD_DELAY_BASE_RATES, getHolidayMultiplier } from './data.js';
import { normalCDF } from '../core/utils.js';

/**
 * Weather severity classification for ORD.
 * Maps weather features → delay severity category.
 *
 * @param {Object} wx — weather data from fetchORDWeather()
 * @returns {{ category, score, factors }}
 */
export function classifyWeatherSeverity(wx) {
  let score = 0;
  const factors = [];

  // Wind — ORD crosswind runways help, but > 35 mph causes delays
  if (wx.maxWindMph >= 50) { score += 40; factors.push(`extreme wind ${wx.maxWindMph} mph`); }
  else if (wx.maxWindMph >= 40) { score += 25; factors.push(`high wind ${wx.maxWindMph} mph`); }
  else if (wx.maxWindMph >= 30) { score += 12; factors.push(`moderate wind ${wx.maxWindMph} mph`); }
  else if (wx.maxWindMph >= 20) { score += 3; factors.push(`light wind ${wx.maxWindMph} mph`); }

  // Snow — most impactful at ORD. Even 1 cm causes significant issues.
  if (wx.totalSnowCm >= 15) { score += 50; factors.push(`heavy snow ${wx.totalSnowCm} cm`); }
  else if (wx.totalSnowCm >= 5) { score += 30; factors.push(`moderate snow ${wx.totalSnowCm} cm`); }
  else if (wx.totalSnowCm >= 1) { score += 15; factors.push(`light snow ${wx.totalSnowCm} cm`); }
  else if (wx.totalSnowCm > 0) { score += 5; factors.push(`trace snow`); }

  // Visibility — IFR conditions cause approach delays
  if (wx.minVisibilityM < 200) { score += 35; factors.push(`very low vis ${wx.minVisibilityM}m`); }
  else if (wx.minVisibilityM < 800) { score += 20; factors.push(`low vis ${wx.minVisibilityM}m`); }
  else if (wx.minVisibilityM < 1600) { score += 10; factors.push(`reduced vis ${wx.minVisibilityM}m`); }
  else if (wx.minVisibilityM < 5000) { score += 3; factors.push(`marginal vis`); }

  // Thunderstorms — ground stops, rerouting
  if (wx.hasThunderstorm) { score += 30; factors.push('thunderstorms'); }

  // Freezing rain — worst case for airports, causes extended closures
  if (wx.hasFreezingRain) { score += 45; factors.push('freezing rain'); }

  // Fog
  if (wx.hasFog) { score += 15; factors.push('fog'); }

  // Heavy rain (without thunderstorms)
  if (wx.totalPrecipMm >= 20 && !wx.hasThunderstorm) { score += 10; factors.push(`heavy rain ${wx.totalPrecipMm}mm`); }

  // Classify
  let category;
  if (score >= 60) category = 'extreme';
  else if (score >= 35) category = 'severe';
  else if (score >= 15) category = 'moderate';
  else category = 'clear';

  return { category, score, factors };
}

/**
 * Weather-conditioned delay probability adjustment.
 * Returns a multiplier on the base rate.
 *
 * Calibrated from BTS data: weather accounts for ~60% of delay variance at ORD.
 */
function weatherMultiplier(severity) {
  const multipliers = {
    clear: 0.55,     // Good weather → delays well below average
    moderate: 1.30,  // Some weather → above average
    severe: 2.20,    // Bad weather → more than double
    extreme: 3.00,   // Terrible weather → triple+
  };
  return multipliers[severity.category] || 1.0;
}

/**
 * Predict P(avg departure delay ≥ 15 min) for ORD on a given date.
 * This is the settlement criterion for ORDDLY contracts.
 *
 * @param {Object} wx — weather data from fetchORDWeather()
 * @param {string} date — YYYY-MM-DD
 * @param {Object} opts — { faaStatus } optional real-time FAA data
 * @returns {{ pDelay, confidence, breakdown }}
 */
export function predictDelayProbability(wx, date, opts = {}) {
  const d = new Date(date + 'T12:00:00Z');
  const month = d.getMonth() + 1;
  const dow = d.getDay() || 7; // 1=Mon..7=Sun

  // 1. Base rate from historical data
  const baseRate = ORD_DELAY_BASE_RATES.monthly[month] || 0.22;

  // 2. Day-of-week adjustment
  const dowMult = ORD_DELAY_BASE_RATES.dayOfWeek[dow] || 1.0;

  // 3. Holiday adjustment
  const holidayMult = getHolidayMultiplier(date);

  // 4. Weather adjustment (dominant factor)
  const severity = classifyWeatherSeverity(wx);
  const wxMult = weatherMultiplier(severity);

  // 5. FAA real-time adjustment (if available, for same-day trading)
  let faaMult = 1.0;
  if (opts.faaStatus?.hasDelay) {
    faaMult = 1.8; // Active GDP → high probability of continued delays
  }
  if (opts.faaStatus?.isClosed) {
    faaMult = 3.0; // Airport closed → near-certain delay day
  }

  // Combine: multiplicative model with floor/ceiling
  let pDelay = baseRate * dowMult * holidayMult * wxMult * faaMult;

  // Clamp to [0.03, 0.97] — never fully certain
  pDelay = Math.max(0.03, Math.min(0.97, pDelay));

  // Confidence: higher when weather signal is strong, lower for far-out forecasts
  const horizonDays = Math.max(0, Math.round((d - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z')) / 86400000));
  const weatherConfidence = severity.score >= 30 ? 0.85 : severity.score >= 10 ? 0.70 : 0.60;
  const horizonPenalty = Math.max(0.5, 1 - horizonDays * 0.08);
  const confidence = weatherConfidence * horizonPenalty;

  return {
    pDelay: Math.round(pDelay * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    severity,
    breakdown: {
      baseRate,
      dowMultiplier: dowMult,
      holidayMultiplier: holidayMult,
      weatherMultiplier: wxMult,
      faaMultiplier: faaMult,
      weatherCategory: severity.category,
      weatherScore: severity.score,
      weatherFactors: severity.factors,
      horizonDays,
      month,
      dayOfWeek: dow,
    },
  };
}

/**
 * Predict total delays + cancellations for ORD on a given date.
 * For FLIGHTORD threshold contracts (e.g., "total > 400?").
 *
 * Uses a log-normal distribution conditioned on weather severity.
 *
 * @param {Object} wx — weather data
 * @param {string} date — YYYY-MM-DD
 * @returns {{ mean, std, pAbove: function(threshold) }}
 */
export function predictTotalDelays(wx, date) {
  const severity = classifyWeatherSeverity(wx);
  const dist = ORD_DELAY_BASE_RATES.delayCountDistribution[severity.category];

  const d = new Date(date + 'T12:00:00Z');
  const dow = d.getDay() || 7;
  const dowMult = ORD_DELAY_BASE_RATES.dayOfWeek[dow] || 1.0;
  const holidayMult = getHolidayMultiplier(date);

  const mean = dist.mean * dowMult * holidayMult;
  const std = dist.std * Math.sqrt(dowMult * holidayMult); // Scale std less aggressively

  return {
    mean: Math.round(mean),
    std: Math.round(std),
    severity,
    /**
     * P(total delays+cancellations > threshold)
     * Uses normal CDF approximation.
     */
    pAbove(threshold) {
      const z = (threshold - mean) / std;
      return Math.round((1 - normalCDF(z)) * 1000) / 1000;
    },
  };
}

/**
 * Generate a full delay forecast for ORD.
 * Combines weather fetch + model prediction.
 *
 * @param {Object} wx — weather data from fetchORDWeather()
 * @param {string} date — YYYY-MM-DD
 * @param {Object} opts — { faaStatus }
 * @returns {Object} full forecast
 */
export function generateDelayForecast(wx, date, opts = {}) {
  const delay = predictDelayProbability(wx, date, opts);
  const total = predictTotalDelays(wx, date);

  return {
    date,
    airport: 'ORD',
    delayProbability: delay,
    totalDelays: total,
    weather: {
      category: delay.severity.category,
      score: delay.severity.score,
      factors: delay.severity.factors,
      maxWind: wx.maxWindMph,
      snow: wx.totalSnowCm,
      minVisibility: wx.minVisibilityM,
      thunderstorm: wx.hasThunderstorm,
      freezingRain: wx.hasFreezingRain,
    },
    tradingSignal: delay.pDelay >= 0.50 ? 'HIGH_DELAY' :
                   delay.pDelay >= 0.30 ? 'ELEVATED' :
                   delay.pDelay >= 0.15 ? 'NORMAL' : 'LOW_DELAY',
  };
}
