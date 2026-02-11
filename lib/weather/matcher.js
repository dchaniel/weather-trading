/**
 * lib/weather/matcher.js — Match weather forecasts to Kalshi contracts
 * Extracted from commands/recommend.js for reusability.
 */

import { STATIONS, getEffectiveSigma } from './stations.js';
import { getSeriesMarkets, parseTicker } from '../kalshi/markets.js';
import { probAboveThreshold, probInBracket } from '../core/utils.js';
import { positionSize, TRANSACTION_COST } from '../core/sizing.js';
import { analyzeImpliedVol } from '../backtest/implied_vol.js';
import { checkEnsembleTradeability } from './ensemble.js';

/** Maximum bid-ask spread (10¢) — skip illiquid contracts */
const MAX_SPREAD = 0.10;

/**
 * Fetch Kalshi markets for a station on a specific date.
 * @returns {{ markets: Array, marketSigma: number|null }}
 */
export async function fetchStationMarkets(station, date, forecastMean, tempType = 'high') {
  const s = STATIONS[station];
  const ticker = tempType === 'low' ? s?.kalshiTickerLow : s?.kalshiTicker;
  if (!ticker) return { markets: [], marketSigma: null };

  const events = await getSeriesMarkets(ticker);
  const markets = [];
  for (const event of events) {
    for (const mkt of event.markets || []) {
      const parsed = parseTicker(mkt.ticker);
      if (parsed && parsed.date === date) markets.push(mkt);
    }
  }

  // Compute market implied sigma
  let marketSigma = null;
  const ivContracts = markets
    .map(mkt => {
      const parsed = parseTicker(mkt.ticker);
      if (!parsed || parsed.type !== 'threshold') return null;
      const mid = (mkt.yesBid + mkt.yesAsk) / 2;
      if (mid <= 0.02 || mid >= 0.98) return null;
      return { threshold: parsed.threshold, marketPrice: mid };
    })
    .filter(Boolean);
  if (ivContracts.length > 0) {
    const ivAnalysis = analyzeImpliedVol(forecastMean, ivContracts);
    if (ivAnalysis.meanImpliedSigma) marketSigma = ivAnalysis.meanImpliedSigma;
  }

  return { markets, marketSigma };
}

/**
 * Score a single market contract against a forecast.
 * @returns {Object|null} recommendation object, or null if no edge
 */
export function scoreContract(mkt, fc, station, date, sigma, marketSigma, balance, customMinEdge) {
  const parsed = parseTicker(mkt.ticker);
  if (!parsed) return null;

  const c = fc.consensus;
  let pTrue;
  if (parsed.type === 'threshold') {
    pTrue = probAboveThreshold(c.adjustedMean, parsed.threshold, sigma);
  } else if (parsed.type === 'bracket') {
    pTrue = probInBracket(c.adjustedMean, parsed.bracketLow, parsed.bracketHigh, sigma);
  } else return null;

  const midYes = (mkt.yesBid + mkt.yesAsk) / 2;
  if (midYes <= 0.03 || midYes >= 0.97) return null;
  if ((mkt.volume || 0) === 0) return null;
  
  // Bid-ask spread filter: skip illiquid contracts
  const spread = (mkt.yesAsk || 0) - (mkt.yesBid || 0);
  if (spread > MAX_SPREAD) return null;

  // Use executable prices (ask for buys), not midpoint, for honest edge calc
  const yesAsk = mkt.yesAsk || midYes;       // price to buy YES
  const noAsk = 1 - (mkt.yesBid || midYes);  // price to buy NO = 1 - yesBid
  const yesEdge = pTrue - yesAsk;
  const noEdge = (1 - pTrue) - noAsk;
  let side, pEst, pMarket, edge;

  if (yesEdge >= customMinEdge && yesEdge >= noEdge) {
    side = 'YES'; pEst = pTrue; pMarket = yesAsk; edge = yesEdge;
  } else if (noEdge >= customMinEdge) {
    side = 'NO'; pEst = 1 - pTrue; pMarket = noAsk; edge = noEdge;
  } else return null;

  const cappedPEst = Math.min(pEst, 0.99);
  const cappedEdge = cappedPEst - pMarket;
  if (cappedEdge < customMinEdge) return null;

  const volume = mkt.volume || 0;
  const sizing = positionSize(balance, cappedPEst, pMarket, 0.05, { volume });
  if (sizing.contracts <= 0) return null;

  const parsedTempType = parsed.tempType || 'high';
  return {
    strategy: 'weather',
    tempType: parsedTempType,
    ticker: mkt.ticker,
    station,
    stationName: STATIONS[station].name,
    date,
    horizonDays: fc.horizonDays,
    side,
    price: pMarket,
    pEst: cappedPEst,
    edge: cappedEdge,
    sigma,
    ev: cappedEdge * sizing.contracts,
    sizing,
    forecastTemp: c.adjustedMean,
    forecastHigh: c.adjustedMean,  // backward compat
    forecastSpread: c.spread || 0,
    marketSigma,
    threshold: parsed.threshold || parsed.bracket,
    type: parsed.type,
    volume,
    lowLiquidity: volume < 500,
    yesDepth: mkt.yesBidSize || 0,
    noDepth: mkt.yesAskSize || 0,
    totalDepth: (mkt.yesBidSize || 0) + (mkt.yesAskSize || 0),
  };
}

/**
 * Get effective sigma for a forecast, using ensemble when available.
 */
export function getEffectiveSigmaForForecast(fc, station, date, tempType = 'high') {
  const ensembleCheck = checkEnsembleTradeability(fc, station);
  return ensembleCheck.effectiveSigma || getEffectiveSigma(station, parseInt(date.slice(5, 7)), fc.horizonDays || 0, tempType);
}
