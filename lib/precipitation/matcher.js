/**
 * Match precipitation forecasts to Kalshi contracts and score opportunities.
 * 
 * Handles two market types:
 * 1. Daily binary (KXRAINNYC): single YES/NO contract → use calibrated PoP
 * 2. Monthly threshold (KXRAIN*M): "total > X inches" → use Gamma CDF
 */

import { PRECIP_STATIONS, PRECIP_TRADEABLE, getClimMonthly } from './stations.js';
import { precipForecast, precipForecastRange, fetchMonthToDateActual } from './forecast.js';
import { ensembleDailyRainProb, fitGammaParams, gammaSurvival } from './ensemble.js';
import { getSeriesMarkets } from '../kalshi/client.js';
import { positionSize, TRANSACTION_COST } from '../core/sizing.js';
import { round2 } from '../core/utils.js';

/** Maximum bid-ask spread to consider (same as weather) */
const MAX_SPREAD = 0.10;
/** Minimum edge to recommend a trade */
const DEFAULT_MIN_EDGE = 0.05;

// ── Ticker Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a precipitation market ticker.
 * 
 * Daily binary: KXRAINNYC-26FEB11-T0 → { type: 'daily_binary', date: '2026-02-11' }
 * Monthly threshold: KXRAINDENM-26FEB-5 → { type: 'monthly_threshold', month: '2026-02', threshold: 5 }
 */
export function parsePrecipTicker(ticker) {
  if (!ticker) return null;
  
  // Daily binary: KXRAIN<CITY>-<YY><MON><DD>-T0
  const dailyMatch = ticker.match(/^(KXRAIN\w+)-(\d{2})([A-Z]{3})(\d{2})-T0$/);
  if (dailyMatch) {
    const [, series, yy, mon, dd] = dailyMatch;
    const MONTHS = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    return {
      type: 'daily_binary',
      series,
      date: `20${yy}-${monthNum}-${dd}`,
      month: parseInt(monthNum),
    };
  }
  
  // Monthly threshold: KXRAIN<CITY>M-<YY><MON>-<threshold>
  const monthlyMatch = ticker.match(/^(KXRAIN\w+M)-(\d{2})([A-Z]{3})-(\d+)$/);
  if (monthlyMatch) {
    const [, series, yy, mon, threshStr] = monthlyMatch;
    const MONTHS = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    return {
      type: 'monthly_threshold',
      series,
      yearMonth: `20${yy}-${monthNum}`,
      month: parseInt(monthNum),
      year: 2000 + parseInt(yy),
      threshold: parseInt(threshStr),
    };
  }
  
  return null;
}

// ── Daily Binary Scoring ─────────────────────────────────────────────────────

/**
 * Score a daily binary rain contract (YES = it will rain).
 */
function scoreDailyBinaryContract(mkt, forecast, stationKey, balance, minEdge) {
  const parsed = parsePrecipTicker(mkt.ticker);
  if (!parsed || parsed.type !== 'daily_binary') return null;
  
  // Get calibrated rain probability
  const ensemble = ensembleDailyRainProb(forecast.consensus, stationKey);
  if (!ensemble.prob) return null;
  
  const pRain = ensemble.prob;
  
  // Market prices (converted to 0-1 in client.js)
  const yesBid = mkt.yesBid || 0;
  const yesAsk = mkt.yesAsk || 0;
  if (yesBid <= 0 && yesAsk <= 0) return null;
  
  const spread = yesAsk - yesBid;
  if (spread > MAX_SPREAD) return null;
  
  // Edge calculation using executable prices
  const yesEdge = pRain - yesAsk;          // edge from buying YES (betting on rain)
  const noEdge = (1 - pRain) - (1 - yesBid); // edge from buying NO (betting on no rain)
  
  let side, pEst, pMarket, edge;
  if (yesEdge >= minEdge && yesEdge >= noEdge) {
    side = 'YES'; pEst = pRain; pMarket = yesAsk; edge = yesEdge;
  } else if (noEdge >= minEdge) {
    side = 'NO'; pEst = 1 - pRain; pMarket = 1 - yesBid; edge = noEdge;
  } else return null;
  
  // Cap at 99% to avoid degenerate sizing
  const cappedPEst = Math.min(pEst, 0.99);
  const cappedEdge = cappedPEst - pMarket;
  if (cappedEdge < minEdge) return null;
  
  const volume = mkt.volume || 0;
  const sizing = positionSize(balance, cappedPEst, pMarket, 0.05, { volume });
  if (sizing.contracts <= 0) return null;
  
  return {
    strategy: 'precipitation',
    marketType: 'daily_binary',
    ticker: mkt.ticker,
    stationKey,
    stationName: PRECIP_STATIONS[stationKey]?.name,
    date: parsed.date,
    horizonDays: forecast.horizonDays,
    side,
    price: pMarket,
    pEst: round2(cappedPEst),
    edge: round2(cappedEdge),
    ev: round2(cappedEdge * sizing.contracts),
    sizing,
    rainProb: round2(pRain),
    confidence: ensemble.confidence,
    uncertainty: ensemble.uncertainty,
    volume,
    lowLiquidity: volume < 100,
    spread: round2(spread),
  };
}

// ── Monthly Threshold Scoring ────────────────────────────────────────────────

/**
 * Score a monthly threshold rain contract (YES = total > X inches).
 * @param {Object} mkt — Kalshi market data
 * @param {Object} gammaParams — fitted Gamma distribution parameters
 * @param {string} stationKey
 * @param {number} balance
 * @param {number} minEdge
 */
function scoreMonthlyThresholdContract(mkt, gammaParams, stationKey, balance, minEdge) {
  const parsed = parsePrecipTicker(mkt.ticker);
  if (!parsed || parsed.type !== 'monthly_threshold') return null;
  
  // P(total > threshold) from our Gamma model
  const pAbove = gammaSurvival(parsed.threshold, gammaParams.alpha, gammaParams.beta);
  
  const yesBid = mkt.yesBid || 0;
  const yesAsk = mkt.yesAsk || 0;
  if (yesBid <= 0 && yesAsk <= 0) return null;
  
  const spread = yesAsk - yesBid;
  if (spread > MAX_SPREAD) return null;
  
  const yesEdge = pAbove - yesAsk;
  const noEdge = (1 - pAbove) - (1 - yesBid);
  
  let side, pEst, pMarket, edge;
  if (yesEdge >= minEdge && yesEdge >= noEdge) {
    side = 'YES'; pEst = pAbove; pMarket = yesAsk; edge = yesEdge;
  } else if (noEdge >= minEdge) {
    side = 'NO'; pEst = 1 - pAbove; pMarket = 1 - yesBid; edge = noEdge;
  } else return null;
  
  const cappedPEst = Math.min(pEst, 0.99);
  const cappedEdge = cappedPEst - pMarket;
  if (cappedEdge < minEdge) return null;
  
  const volume = mkt.volume || 0;
  const sizing = positionSize(balance, cappedPEst, pMarket, 0.05, { volume });
  if (sizing.contracts <= 0) return null;
  
  return {
    strategy: 'precipitation',
    marketType: 'monthly_threshold',
    ticker: mkt.ticker,
    stationKey,
    stationName: PRECIP_STATIONS[stationKey]?.name,
    yearMonth: parsed.yearMonth,
    threshold: parsed.threshold,
    side,
    price: pMarket,
    pEst: round2(cappedPEst),
    edge: round2(cappedEdge),
    ev: round2(cappedEdge * sizing.contracts),
    sizing,
    pAbove: round2(pAbove),
    gammaAlpha: gammaParams.alpha,
    gammaMean: gammaParams.mean,
    mtdActual: gammaParams.mtdActual,
    expectedRemaining: gammaParams.expectedRemaining,
    volume,
    lowLiquidity: volume < 100,
    spread: round2(spread),
  };
}

// ── High-Level Market Scanner ────────────────────────────────────────────────

/**
 * Scan all precipitation markets and return scored recommendations.
 * @param {Object} opts
 * @param {number} opts.balance — current balance
 * @param {number} opts.minEdge — minimum edge (0-1, default 0.05)
 * @param {string} opts.stationFilter — optional station key filter
 * @returns {Promise<Array>} scored recommendations
 */
export async function scanPrecipMarkets({ balance = 1000, minEdge = DEFAULT_MIN_EDGE, stationFilter = null } = {}) {
  const recs = [];
  
  for (const [stationKey, station] of Object.entries(PRECIP_STATIONS)) {
    if (stationFilter && stationKey !== stationFilter) continue;
    if (!PRECIP_TRADEABLE.has(stationKey)) continue;
    
    try {
      // Fetch markets from Kalshi
      const events = await getSeriesMarkets(station.kalshiSeries);
      if (!events.length) continue;
      
      if (station.marketType === 'daily_binary') {
        // Daily binary markets
        for (const event of events) {
          for (const mkt of event.markets || []) {
            const parsed = parsePrecipTicker(mkt.ticker);
            if (!parsed) continue;
            
            // Get forecast for this date
            try {
              const fc = await precipForecast(stationKey, parsed.date);
              if (!fc.consensus?.tradeable) continue;
              
              const rec = scoreDailyBinaryContract(mkt, fc, stationKey, balance, minEdge);
              if (rec) recs.push(rec);
            } catch { /* skip */ }
          }
        }
      } else if (station.marketType === 'monthly_threshold') {
        // Monthly threshold markets
        for (const event of events) {
          const markets = event.markets || [];
          if (!markets.length) continue;
          
          // Parse first market to get year/month
          const firstParsed = parsePrecipTicker(markets[0]?.ticker);
          if (!firstParsed) continue;
          
          const { year, month } = firstParsed;
          const totalDays = new Date(year, month, 0).getDate();
          
          // Get month-to-date actual
          let mtdActual, mtdDays;
          try {
            const mtd = await fetchMonthToDateActual(stationKey, year, month);
            mtdActual = mtd.totalInches;
            mtdDays = mtd.daysWithData;
          } catch {
            mtdActual = 0;
            mtdDays = 0;
          }
          
          // Get forecast for remaining days
          const todayDate = new Date();
          const monthStart = new Date(year, month - 1, 1);
          const monthEnd = new Date(year, month, 0);
          const forecastStart = new Date(Math.max(todayDate, monthStart));
          const forecastStartStr = forecastStart.toISOString().slice(0, 10);
          const forecastEndStr = monthEnd.toISOString().slice(0, 10);
          
          let forecastRemaining = null;
          let forecastUncertainty = null;
          
          if (forecastStartStr <= forecastEndStr) {
            try {
              const forecasts = await precipForecastRange(stationKey, forecastStartStr, forecastEndStr);
              const amounts = forecasts
                .filter(f => f.consensus?.precipAmount != null)
                .map(f => f.consensus.precipAmount);
              if (amounts.length > 0) {
                forecastRemaining = amounts.reduce((a, b) => a + b, 0);
                // Uncertainty grows with sqrt of number of days (independent daily errors)
                const dailyUncertainty = 0.15; // ~0.15" per day uncertainty
                forecastUncertainty = dailyUncertainty * Math.sqrt(amounts.length);
              }
            } catch { /* use climatology fallback */ }
          }
          
          // Fit Gamma distribution
          const clim = getClimMonthly(stationKey, month);
          const gammaParams = fitGammaParams({
            climMean: clim.mean,
            climStd: clim.std,
            mtdActual,
            mtdDays,
            totalDays,
            forecastRemaining,
            forecastUncertainty,
          });
          
          // Score each threshold contract
          for (const mkt of markets) {
            const rec = scoreMonthlyThresholdContract(mkt, gammaParams, stationKey, balance, minEdge);
            if (rec) recs.push(rec);
          }
        }
      }
    } catch (e) {
      // Skip failing stations
    }
  }
  
  // Sort by expected value
  recs.sort((a, b) => b.ev - a.ev);
  return recs;
}

/**
 * Format a precipitation recommendation for display.
 */
export function formatPrecipRec(rec) {
  const lines = [];
  if (rec.marketType === 'daily_binary') {
    lines.push(`  ${rec.side} ${rec.ticker} @ $${rec.price.toFixed(2)}`);
    lines.push(`    Rain prob: ${(rec.rainProb * 100).toFixed(1)}% (${rec.confidence} confidence)`);
    lines.push(`    Edge: ${(rec.edge * 100).toFixed(1)}% | EV: $${rec.ev.toFixed(2)}`);
    lines.push(`    Size: ${rec.sizing.contracts} contracts ($${rec.sizing.dollarRisk.toFixed(2)} risk)`);
  } else {
    lines.push(`  ${rec.side} ${rec.ticker} @ $${rec.price.toFixed(2)}`);
    lines.push(`    P(>${rec.threshold}"): ${(rec.pAbove * 100).toFixed(1)}% | MTD: ${rec.mtdActual}" | Exp remaining: ${rec.expectedRemaining}"`);
    lines.push(`    Gamma: α=${rec.gammaAlpha} μ=${rec.gammaMean}" | Edge: ${(rec.edge * 100).toFixed(1)}%`);
    lines.push(`    Size: ${rec.sizing.contracts} contracts ($${rec.sizing.dollarRisk.toFixed(2)} risk)`);
  }
  if (rec.lowLiquidity) lines.push('    ⚠️ LOW LIQUIDITY');
  return lines.join('\n');
}
