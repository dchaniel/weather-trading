/**
 * lib/flights/matcher.js — Match delay predictions to Kalshi flight delay contracts.
 *
 * Supports two market types:
 * 1. ORDDLY / KXORDDLY — Binary: "Will ORD avg delays ≥ 15 min?"
 * 2. FLIGHTORD — Threshold: "Total delays+cancellations > X?"
 *
 * Uses the same scoring/sizing pipeline as weather strategy.
 */

import { getEvents, getMarkets, request } from '../kalshi/client.js';
import { positionSize, TRANSACTION_COST } from '../core/sizing.js';
import { getLedger } from '../core/trade.js';
import { generateDelayForecast } from './model.js';
import { fetchORDWeather, fetchFAAStatus } from './data.js';

// Series tickers for flight delay markets
const FLIGHT_SERIES = ['FLIGHTORD', 'ORDDLY', 'KXORDDLY'];

/**
 * Fetch all active flight delay markets for ORD.
 * Returns normalized market objects.
 */
export async function fetchFlightMarkets() {
  const markets = [];

  for (const series of FLIGHT_SERIES) {
    try {
      const events = await getEvents({ series_ticker: series, limit: '5' });
      for (const event of events) {
        for (const mkt of event.markets || []) {
          markets.push(normalizeFlightMarket(mkt, series));
        }
      }
    } catch { /* series may not exist or have no active markets */ }
  }

  return markets;
}

/**
 * Normalize a Kalshi flight market into our standard format.
 */
function normalizeFlightMarket(mkt, series) {
  const yesBid = (mkt.yes_bid || 0) / 100;
  const yesAsk = (mkt.yes_ask || 0) / 100;

  // Parse date from ticker: e.g., ORDDLY-21OCT17 → 2021-10-17
  const dateMatch = mkt.ticker?.match(/(\d{2})([A-Z]{3})(\d{2})/);
  let date = null;
  if (dateMatch) {
    const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
                     JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    date = `20${dateMatch[1]}-${months[dateMatch[2]]}-${dateMatch[3]}`;
  }

  // Determine market type
  let type = 'binary'; // ORDDLY is binary (delay yes/no)
  let threshold = null;
  const threshMatch = mkt.ticker?.match(/-T(\d+)/);
  if (threshMatch) {
    type = 'threshold';
    threshold = parseInt(threshMatch[1]);
  }

  return {
    ticker: mkt.ticker,
    eventTicker: mkt.event_ticker,
    series,
    type,
    threshold,
    date,
    title: mkt.title || mkt.subtitle || mkt.yes_sub_title,
    yesBid,
    yesAsk,
    midPrice: (yesBid + yesAsk) / 2,
    volume: mkt.volume || 0,
    openInterest: mkt.open_interest || 0,
    closeTime: mkt.close_time,
    result: mkt.result,
  };
}

/**
 * Score a flight delay market against our model prediction.
 * Returns a recommendation object compatible with the unified pipeline.
 *
 * @param {Object} market — normalized flight market
 * @param {Object} forecast — from generateDelayForecast()
 * @param {number} balance — current bankroll
 * @param {number} minEdge — minimum edge to recommend (default 5%)
 * @returns {Object|null} recommendation or null if no edge
 */
export function scoreFlightContract(market, forecast, balance, minEdge = 0.05) {
  if (market.volume === 0 && !market.result) return null; // Skip zero-volume active markets

  let pTrue;
  if (market.type === 'binary') {
    // ORDDLY: P(avg delay ≥ 15 min)
    pTrue = forecast.delayProbability.pDelay;
  } else if (market.type === 'threshold') {
    // FLIGHTORD: P(total > threshold)
    pTrue = forecast.totalDelays.pAbove(market.threshold);
  } else {
    return null;
  }

  // Use executable prices
  const yesAsk = market.yesAsk || market.midPrice;
  const noAsk = 1 - (market.yesBid || market.midPrice);

  const yesEdge = pTrue - yesAsk;
  const noEdge = (1 - pTrue) - noAsk;

  let side, pEst, pMarket, edge;
  if (yesEdge >= minEdge && yesEdge >= noEdge) {
    side = 'YES'; pEst = pTrue; pMarket = yesAsk; edge = yesEdge;
  } else if (noEdge >= minEdge) {
    side = 'NO'; pEst = 1 - pTrue; pMarket = noAsk; edge = noEdge;
  } else {
    return null;
  }

  // Cap at 99%
  const cappedPEst = Math.min(pEst, 0.99);
  const cappedEdge = cappedPEst - pMarket;
  if (cappedEdge < minEdge) return null;

  const sizing = positionSize(balance, cappedPEst, pMarket, 0.05, { volume: market.volume });
  if (sizing.contracts <= 0) return null;

  return {
    strategy: 'flights',
    ticker: market.ticker,
    station: 'KORD',
    stationName: "O'Hare International",
    date: market.date,
    side,
    price: pMarket,
    pEst: cappedPEst,
    edge: cappedEdge,
    ev: cappedEdge * sizing.contracts,
    sizing,
    type: market.type,
    threshold: market.threshold,
    volume: market.volume,
    lowLiquidity: market.volume < 100,
    weatherCategory: forecast.weather.category,
    weatherScore: forecast.weather.score,
    weatherFactors: forecast.weather.factors,
    tradingSignal: forecast.tradingSignal,
    confidence: forecast.delayProbability.confidence,
    breakdown: forecast.delayProbability.breakdown,
  };
}

/**
 * Run the full flight delay strategy.
 * Fetches markets, weather, FAA status, generates predictions, scores contracts.
 *
 * @returns {{ markets, forecast, recommendations, summary }}
 */
export async function runFlightStrategy(opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const minEdge = opts.minEdge || 0.05;
  const balance = opts.balance || getLedger().balance;

  // 1. Fetch active markets
  const markets = await fetchFlightMarkets();

  // 2. Fetch weather for ORD
  const wx = await fetchORDWeather(date);

  // 3. Fetch FAA status (only useful for today)
  let faaStatus = null;
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) {
    try { faaStatus = await fetchFAAStatus(); } catch { /* non-critical */ }
  }

  // 4. Generate forecast
  const forecast = generateDelayForecast(wx, date, { faaStatus });

  // 5. Score all markets
  const recommendations = [];
  for (const mkt of markets) {
    if (mkt.date !== date) continue;
    const rec = scoreFlightContract(mkt, forecast, balance, minEdge);
    if (rec) recommendations.push(rec);
  }

  // Sort by expected value
  recommendations.sort((a, b) => b.ev - a.ev);

  return {
    date,
    marketsFound: markets.length,
    marketsForDate: markets.filter(m => m.date === date).length,
    forecast,
    recommendations,
    faaStatus,
    summary: {
      pDelay: forecast.delayProbability.pDelay,
      weatherCategory: forecast.weather.category,
      tradingSignal: forecast.tradingSignal,
      totalDelaysMean: forecast.totalDelays.mean,
      recsCount: recommendations.length,
    },
  };
}
