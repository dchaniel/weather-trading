/**
 * kalshi calibrate — Compute realized forecast accuracy vs assumed σ.
 * Validates our σ assumptions against actual forecast performance.
 */

import { STATIONS, getEffectiveSigma, TRADEABLE_STATIONS } from '../lib/weather/stations.js';
import { getLedger } from '../lib/core/trade.js';
import { forecast } from '../lib/weather/forecast.js';
import { fetchJSON, today, round2 } from '../lib/core/utils.js';
import { fetchHistoricalActuals } from '../lib/weather/historical.js';

/**
 * Fetch historical weather observations from Open-Meteo (wrapper around shared function)
 */
async function fetchHistoricalObservations(station, startDate, endDate) {
  const actualsMap = await fetchHistoricalActuals(station, startDate, endDate);
  // Convert Map<string, {high_f}> to Object<string, number> for backwards compat
  const observations = {};
  for (const [date, data] of actualsMap) {
    observations[date] = data.high_f;
  }
  return observations;
}

/**
 * Get historical forecasts and compute forecast errors with seasonal breakdown
 */
async function computeForecastErrors(station, days = 30) {
  const endDate = today();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  console.log(`   📊 Analyzing ${days} days: ${startDate} to ${endDate}`);
  
  try {
    // Get historical observations
    const observations = await fetchHistoricalObservations(station, startDate, endDate);
    
    // For each historical date, fetch what the forecast would have been
    const errors = [];
    const dates = Object.keys(observations).slice(0, -1); // Exclude today (no observation yet)
    
    for (const date of dates) {
      try {
        // Get forecast as it would have been that day
        const fc = await forecast(station, date);
        const forecastHigh = fc.consensus?.adjustedMean;
        const actualHigh = observations[date];
        
        if (forecastHigh != null && actualHigh != null) {
          const error = Math.abs(forecastHigh - actualHigh);
          const month = parseInt(date.slice(5, 7));
          
          errors.push({
            date,
            forecast: forecastHigh,
            actual: actualHigh,
            error,
            month,
            season: getSeason(month),
          });
        }
        
        // Throttle API calls
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        // Skip dates with forecast errors
        continue;
      }
    }
    
    return errors;
  } catch (error) {
    throw new Error(`Failed to compute forecast errors: ${error.message}`);
  }
}

/**
 * Get season from month number
 */
function getSeason(month) {
  if ([12, 1, 2].includes(month)) return 'winter';
  if ([3, 4, 5].includes(month)) return 'spring';
  if ([6, 7, 8].includes(month)) return 'summer';
  if ([9, 10, 11].includes(month)) return 'fall';
  return 'unknown';
}

/**
 * Analyze settled trades from the ledger
 */
function analyzeSettledTrades(station) {
  const ledger = getLedger();
  const settledTrades = ledger.trades.filter(t => 
    t.settled && 
    t.station === station && 
    t.actualOutcome != null &&
    t.forecastValue != null
  );
  
  if (settledTrades.length === 0) {
    return { errors: [], message: 'No settled trades with forecast data' };
  }
  
  const errors = settledTrades.map(t => {
    const error = Math.abs(t.forecastValue - t.actualOutcome);
    return {
      date: t.settlementDate || t.timestamp.slice(0, 10),
      forecast: t.forecastValue,
      actual: t.actualOutcome,
      error,
      tradeId: t.id,
    };
  });
  
  return { errors, message: `${settledTrades.length} settled trades analyzed` };
}

/**
 * Compute statistics from error data with confidence intervals
 */
function computeErrorStats(errors) {
  if (errors.length === 0) {
    return null;
  }
  
  errors.sort((a, b) => a.error - b.error);
  
  const mae = errors.reduce((sum, e) => sum + e.error, 0) / errors.length;
  const median = errors.length % 2 === 0 
    ? (errors[Math.floor(errors.length / 2) - 1].error + errors[Math.floor(errors.length / 2)].error) / 2
    : errors[Math.floor(errors.length / 2)].error;
  
  const mse = errors.reduce((sum, e) => sum + e.error * e.error, 0) / errors.length;
  const rmse = Math.sqrt(mse);
  
  const p90 = errors[Math.floor(errors.length * 0.9)].error;
  const p95 = errors[Math.floor(errors.length * 0.95)].error;
  const max = errors[errors.length - 1].error;
  
  // Compute 95% confidence interval for MAE using bootstrap approximation
  const n = errors.length;
  const sem = rmse / Math.sqrt(n);  // Standard error of the mean
  const t_critical = n >= 30 ? 1.96 : 2.262;  // t-distribution critical value
  const ci_lower = mae - t_critical * sem;
  const ci_upper = mae + t_critical * sem;
  
  // Determine reliability based on sample size
  let reliability = 'INSUFFICIENT';
  if (n >= 100) reliability = 'EXCELLENT';
  else if (n >= 50) reliability = 'GOOD';
  else if (n >= 30) reliability = 'ADEQUATE';
  else if (n >= 15) reliability = 'POOR';
  
  return {
    count: errors.length,
    mae: round2(mae),
    median: round2(median),
    rmse: round2(rmse),
    p90: round2(p90),
    p95: round2(p95),
    max: round2(max),
    ci_lower: round2(Math.max(0, ci_lower)),  // MAE can't be negative
    ci_upper: round2(ci_upper),
    reliability,
  };
}

/**
 * Analyze errors by season
 */
function analyzeSeasonalErrors(errors) {
  const seasonal = {};
  
  for (const error of errors) {
    if (!seasonal[error.season]) {
      seasonal[error.season] = [];
    }
    seasonal[error.season].push(error);
  }
  
  const seasonalStats = {};
  for (const [season, seasonErrors] of Object.entries(seasonal)) {
    seasonalStats[season] = computeErrorStats(seasonErrors);
  }
  
  return seasonalStats;
}

export default async function(args) {
  const verbose = args.includes('--verbose') || args.includes('-v');
  const days = parseInt(args.find(a => a.match(/^\d+$/))) || 30;
  const stationFilter = args.find(a => Object.keys(STATIONS).includes(a.toUpperCase()));
  const stations = stationFilter ? [stationFilter.toUpperCase()] : [...TRADEABLE_STATIONS];
  
  console.log(`\n📐 Forecast Calibration Analysis`);
  console.log('═'.repeat(60));
  console.log(`Target stations: ${stations.join(', ')}`);
  console.log(`Analysis period: Last ${days} days`);
  
  for (const station of stations) {
    console.log(`\n🎯 ${station} — ${STATIONS[station]?.name || station}`);
    console.log('─'.repeat(50));
    
    try {
      // Get current σ assumption
      const currentMonth = parseInt(today().slice(5, 7));
      const assumedSigma = getEffectiveSigma(station, currentMonth, 0);
      console.log(`   Assumed σ: ${assumedSigma}°F`);
      
      // First try settled trades
      const tradeAnalysis = analyzeSettledTrades(station);
      const tradeStats = computeErrorStats(tradeAnalysis.errors);
      
      console.log(`   📋 Settled trades: ${tradeAnalysis.message}`);
      if (tradeStats) {
        console.log(`      MAE: ${tradeStats.mae}°F | Median: ${tradeStats.median}°F | RMSE: ${tradeStats.rmse}°F`);
        console.log(`      P90: ${tradeStats.p90}°F | P95: ${tradeStats.p95}°F | Max: ${tradeStats.max}°F`);
        
        const calibrationRatio = tradeStats.mae / assumedSigma;
        const calibrationStatus = 
          calibrationRatio < 0.8 ? '🟢 Under-estimated' :
          calibrationRatio > 1.2 ? '🔴 Over-estimated' : '🟢 Well-calibrated';
        
        console.log(`      Calibration: ${calibrationStatus} (${calibrationRatio.toFixed(2)}x assumed σ)`);
      }
      
      // Then try historical analysis
      console.log(`   🔍 Historical analysis:`);
      try {
        const historicalErrors = await computeForecastErrors(station, days);
        const historicalStats = computeErrorStats(historicalErrors);
        const seasonalStats = analyzeSeasonalErrors(historicalErrors);
        
        if (historicalStats) {
          console.log(`      ${historicalStats.count} days analyzed (${historicalStats.reliability})`);
          console.log(`      MAE: ${historicalStats.mae}°F [95% CI: ${historicalStats.ci_lower}-${historicalStats.ci_upper}°F]`);
          console.log(`      Median: ${historicalStats.median}°F | RMSE: ${historicalStats.rmse}°F`);
          console.log(`      P90: ${historicalStats.p90}°F | P95: ${historicalStats.p95}°F | Max: ${historicalStats.max}°F`);
          
          const histCalibrationRatio = historicalStats.mae / assumedSigma;
          const histCalibrationStatus = 
            histCalibrationRatio < 0.8 ? '🟢 Under-estimated (conservative)' :
            histCalibrationRatio > 1.2 ? '🔴 Over-estimated (too optimistic)' : '🟢 Well-calibrated';
          
          console.log(`      Calibration: ${histCalibrationStatus} (${histCalibrationRatio.toFixed(2)}x assumed σ)`);
          
          // Sample size warnings
          if (historicalStats.count < 30) {
            console.log(`      ⚠️ WARNING: N=${historicalStats.count} < 30, reliability=${historicalStats.reliability}`);
          }
          
          // Seasonal breakdown
          console.log(`\n      📅 Seasonal Breakdown:`);
          for (const [season, stats] of Object.entries(seasonalStats)) {
            if (stats && stats.count > 0) {
              const seasonEmoji = season === 'winter' ? '❄️' : season === 'spring' ? '🌸' : season === 'summer' ? '☀️' : '🍂';
              console.log(`         ${seasonEmoji} ${season}: N=${stats.count}, MAE=${stats.mae}°F [${stats.ci_lower}-${stats.ci_upper}°F], ${stats.reliability}`);
              
              if (stats.count < 15) {
                console.log(`           ⚠️ Too few observations for reliable estimation`);
              }
            }
          }
          
          // Current season recommendation (we're in February = winter)
          const currentSeason = getSeason(parseInt(today().slice(5, 7)));
          const currentStats = seasonalStats[currentSeason];
          
          if (currentStats && currentStats.count >= 15) {
            console.log(`\n      🎯 ${currentSeason.toUpperCase()} (current season) Analysis:`);
            console.log(`         MAE: ${currentStats.mae}°F with N=${currentStats.count} (${currentStats.reliability})`);
            
            const seasonalRecSigma = round2(currentStats.mae * 1.1);
            console.log(`         💡 Recommended ${currentSeason} σ: ${seasonalRecSigma}°F`);
            
            // Check against current σ
            const seasonalRatio = currentStats.mae / assumedSigma;
            if (seasonalRatio > 1.3) {
              console.log(`         🚨 CRITICAL: Current σ too low by ${(seasonalRatio - 1).toFixed(1)}x for ${currentSeason} trading`);
            } else if (seasonalRatio < 0.7) {
              console.log(`         📈 OPPORTUNITY: Could tighten σ by ${(1 - seasonalRatio).toFixed(1)}x for ${currentSeason}`);
            } else {
              console.log(`         ✅ Current σ appropriate for ${currentSeason} trading`);
            }
          } else {
            console.log(`\n      ⚠️ Insufficient ${currentSeason} data (N=${currentStats?.count || 0}) for seasonal calibration`);
          }
          
          // Recommendation
          if (histCalibrationRatio > 1.3) {
            const recommendedSigma = round2(historicalStats.mae * 1.25); // Add 25% buffer
            console.log(`\n      💡 RECOMMENDATION: Increase σ to ${recommendedSigma}°F (from ${assumedSigma}°F)`);
          } else if (histCalibrationRatio < 0.7) {
            const recommendedSigma = round2(historicalStats.mae * 1.15);
            console.log(`\n      💡 OPPORTUNITY: Could decrease σ to ${recommendedSigma}°F for more aggressive trading`);
          } else {
            console.log(`\n      ✅ Current σ=${assumedSigma}°F is well-calibrated`);
          }
          
          if (verbose && historicalErrors.length > 0) {
            console.log(`\n      Recent errors:`);
            const recentErrors = historicalErrors.slice(-10);
            for (const e of recentErrors) {
              console.log(`        ${e.date}: ${e.forecast}°F → ${e.actual}°F (error: ${e.error}°F, ${e.season})`);
            }
          }
        } else {
          console.log(`      ⚠️ No historical data available`);
        }
      } catch (error) {
        console.log(`      ❌ Historical analysis failed: ${error.message}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Analysis failed: ${error.message}`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('📝 Calibration Summary:');
  console.log('• MAE (Mean Absolute Error) should be close to assumed σ');
  console.log('• Ratio < 0.8: We over-estimate error (too conservative)');
  console.log('• Ratio > 1.2: We under-estimate error (too aggressive)');
  console.log('• P90/P95 show tail risk — extreme forecast errors');
  console.log('\n💡 Use this data to adjust station σ values in stations.js');
  console.log();
}