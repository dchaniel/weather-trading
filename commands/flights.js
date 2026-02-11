/**
 * kalshi flights — O'Hare flight delay strategy command.
 *
 * Analyzes weather conditions at ORD, predicts delay probability,
 * matches to Kalshi ORDDLY/FLIGHTORD contracts, and generates
 * trade recommendations.
 *
 * Usage:
 *   kalshi flights              # Today's delay forecast + recommendations
 *   kalshi flights 2026-02-15   # Specific date forecast
 *   kalshi flights --faa        # Include real-time FAA status
 *   kalshi flights --detail     # Show hourly weather breakdown
 */

import { fetchORDWeather, fetchFAAStatus, ORD_DELAY_BASE_RATES } from '../lib/flights/data.js';
import { generateDelayForecast, classifyWeatherSeverity } from '../lib/flights/model.js';
import { runFlightStrategy } from '../lib/flights/matcher.js';
import { parseDateArg, signed, today } from '../lib/core/utils.js';
import { getLedger } from '../lib/core/trade.js';

export default async function(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: kalshi flights [date] [flags]

O'Hare flight delay forecast and trade recommendations.

Arguments:
  date              Target date (YYYY-MM-DD, default: today)

Flags:
  --faa             Include real-time FAA airport status
  --detail          Show hourly weather breakdown
  --min-edge <pct>  Minimum edge % to recommend (default: 5)
  -h, --help        Show this help

Market Series:
  ORDDLY / KXORDDLY   Binary: "Will ORD avg delays ≥ 15 min?"
  FLIGHTORD            Threshold: "Total delays+cancellations > X?"

Settlement Sources:
  ORDDLY:    FAA (fly.faa.gov)
  FLIGHTORD: FlightAware (flightaware.com/live/cancelled/yesterday/ORD)

Examples:
  kalshi flights                    # Today's ORD delay forecast
  kalshi flights 2026-02-15 --faa   # Feb 15 with FAA status
  kalshi flights --detail           # Detailed weather breakdown
`);
    return;
  }

  const date = parseDateArg(args);
  const showFAA = args.includes('--faa');
  const showDetail = args.includes('--detail');
  const minEdgeIndex = args.findIndex(a => a === '--min-edge');
  const minEdge = minEdgeIndex !== -1 && args[minEdgeIndex + 1]
    ? parseFloat(args[minEdgeIndex + 1]) / 100 : 0.05;

  console.log(`\n✈️  O'Hare Flight Delay Analysis — ${date}`);
  console.log('═'.repeat(60));

  // 1. Fetch weather
  let wx;
  try {
    wx = await fetchORDWeather(date);
  } catch (e) {
    console.log(`  ⚠️ Weather fetch failed: ${e.message}`);
    return;
  }

  // 2. FAA status (optional)
  let faaStatus = null;
  if (showFAA || date === today()) {
    try {
      faaStatus = await fetchFAAStatus();
    } catch (e) {
      console.log(`  ⚠️ FAA status unavailable: ${e.message}`);
    }
  }

  // 3. Generate forecast
  const forecast = generateDelayForecast(wx, date, { faaStatus });

  // 4. Display weather conditions
  console.log('\n📊 Weather Conditions at ORD:');
  console.log(`  Temperature: ${wx.lowF}°F – ${wx.highF}°F`);
  console.log(`  Wind: avg ${wx.avgWindMph} mph, gusts ${wx.maxWindMph} mph`);
  console.log(`  Precipitation: ${wx.totalPrecipMm} mm rain, ${wx.totalSnowCm} cm snow`);
  console.log(`  Visibility: min ${wx.minVisibilityM}m, avg ${wx.avgVisibilityM}m`);
  const flags = [];
  if (wx.hasThunderstorm) flags.push('⛈️ Thunderstorms');
  if (wx.hasFreezingRain) flags.push('🧊 Freezing Rain');
  if (wx.hasFog) flags.push('🌫️ Fog');
  if (wx.hasSnow) flags.push('❄️ Snow');
  if (flags.length) console.log(`  Alerts: ${flags.join(', ')}`);
  console.log(`  Severity: ${forecast.weather.category.toUpperCase()} (score: ${forecast.weather.score}/100)`);
  if (forecast.weather.factors.length) {
    console.log(`  Factors: ${forecast.weather.factors.join(', ')}`);
  }

  // 5. Display FAA status
  if (faaStatus) {
    console.log('\n🏛️ FAA Status:');
    if (faaStatus.hasDelay) {
      const gd = faaStatus.groundDelay;
      console.log(`  ⚠️ GROUND DELAY PROGRAM: ${gd.reason} — avg ${gd.avg}, max ${gd.max}`);
    } else if (faaStatus.isClosed) {
      console.log('  🚫 AIRPORT CLOSED');
    } else {
      console.log('  ✅ No active delays at ORD');
    }
    if (faaStatus.allDelays.length > 0) {
      console.log(`  Other airports with delays: ${faaStatus.allDelays.map(d => d.airport).join(', ')}`);
    }
  }

  // 6. Delay prediction
  const dp = forecast.delayProbability;
  console.log('\n🎯 Delay Prediction:');
  console.log(`  P(avg delay ≥ 15 min): ${(dp.pDelay * 100).toFixed(1)}% [confidence: ${(dp.confidence * 100).toFixed(0)}%]`);
  console.log(`  Signal: ${forecast.tradingSignal}`);
  console.log(`  Breakdown:`);
  console.log(`    Base rate (${monthName(dp.breakdown.month)}): ${(dp.breakdown.baseRate * 100).toFixed(0)}%`);
  console.log(`    Day-of-week (${dowName(dp.breakdown.dayOfWeek)}): ×${dp.breakdown.dowMultiplier.toFixed(2)}`);
  if (dp.breakdown.holidayMultiplier !== 1.0) {
    console.log(`    Holiday: ×${dp.breakdown.holidayMultiplier.toFixed(2)}`);
  }
  console.log(`    Weather (${dp.breakdown.weatherCategory}): ×${dp.breakdown.weatherMultiplier.toFixed(2)}`);
  if (dp.breakdown.faaMultiplier !== 1.0) {
    console.log(`    FAA live status: ×${dp.breakdown.faaMultiplier.toFixed(2)}`);
  }

  // 7. Total delay prediction (for FLIGHTORD)
  const td = forecast.totalDelays;
  console.log(`\n📈 Total Delays+Cancellations Estimate:`);
  console.log(`  Expected: ${td.mean} ± ${td.std}`);
  console.log(`  P(> 200): ${(td.pAbove(200) * 100).toFixed(1)}%`);
  console.log(`  P(> 400): ${(td.pAbove(400) * 100).toFixed(1)}%`);
  console.log(`  P(> 600): ${(td.pAbove(600) * 100).toFixed(1)}%`);
  console.log(`  P(> 800): ${(td.pAbove(800) * 100).toFixed(1)}%`);

  // 8. Market scan
  console.log('\n' + '─'.repeat(60));
  console.log('📡 Kalshi Market Scan:');

  try {
    const result = await runFlightStrategy({ date, minEdge, balance: getLedger().balance });

    if (result.marketsFound === 0) {
      console.log('  ⚠️ No active ORDDLY/FLIGHTORD markets found.');
      console.log('  These markets appear dormant. Strategy is ready for when they reactivate.');
      console.log('  Monitor: kalshi flights --faa');
    } else {
      console.log(`  Found ${result.marketsFound} markets (${result.marketsForDate} for ${date})`);
      if (result.recommendations.length === 0) {
        console.log(`  No trades with edge ≥ ${(minEdge * 100).toFixed(0)}%`);
      } else {
        for (const rec of result.recommendations) {
          console.log(`\n  ${rec.side} ${rec.ticker} @ $${rec.price.toFixed(2)}`);
          console.log(`    P(est): ${(rec.pEst * 100).toFixed(1)}%  Edge: ${signed(rec.edge * 100, 1)}%`);
          console.log(`    Size: ${rec.sizing.contracts} contracts ($${rec.sizing.dollarRisk.toFixed(2)} risk)`);
          console.log(`    Weather: ${rec.weatherCategory} | Signal: ${rec.tradingSignal}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠️ Market scan failed: ${e.message}`);
  }

  // 9. Hourly detail (optional)
  if (showDetail) {
    console.log('\n📋 Hourly Weather Detail:');
    const hours = wx.hourlyDetail;
    console.log('  Hour  Wind  Vis(m)   Precip  Snow  WxCode  Cloud');
    console.log('  ' + '─'.repeat(55));
    for (let i = 0; i < 24; i++) {
      const wind = (hours.windSpeeds[i] || 0).toFixed(0).padStart(4);
      const vis = (hours.visibility[i] || 0).toFixed(0).padStart(6);
      const precip = (hours.precip[i] || 0).toFixed(1).padStart(6);
      const snow = (hours.snowfall[i] || 0).toFixed(1).padStart(5);
      const code = String(hours.weatherCodes[i] || 0).padStart(6);
      const cloud = String(hours.cloudCover[i] || 0).padStart(5) + '%';
      console.log(`  ${String(i).padStart(4)}  ${wind}  ${vis}  ${precip}  ${snow}  ${code}  ${cloud}`);
    }
  }

  console.log();
}

function monthName(m) {
  return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
}

function dowName(d) {
  return ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d];
}
