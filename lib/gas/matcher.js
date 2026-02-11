/**
 * Match gas price model predictions to Kalshi gas contracts.
 * Finds tradeable markets across weekly (KXAAAGASW) and monthly (KXAAAGASM) series.
 */

import { getSeriesMarkets } from '../kalshi/client.js';
import { positionSize, TRANSACTION_COST } from '../core/sizing.js';
import { round2 } from '../core/utils.js';

/** Known Kalshi gas price series */
const GAS_SERIES = [
  { ticker: 'KXAAAGASW', type: 'weekly', label: 'Weekly' },
  { ticker: 'KXAAAGASM', type: 'monthly', label: 'Monthly' },
];

/** Minimum edge after transaction costs */
const MIN_EDGE = 0.05; // 5%

/** Maximum bid-ask spread to consider tradeable */
const MAX_SPREAD = 0.20; // 20¢

/** Price range filter — avoid deep ITM/OTM */
const MIN_PRICE = 0.08;
const MAX_PRICE = 0.92;

/**
 * Fetch all open gas markets from Kalshi.
 * @returns {Array<{ seriesTicker, type, label, events }>}
 */
export async function getGasMarkets() {
  const results = [];

  for (const series of GAS_SERIES) {
    try {
      const events = await getSeriesMarkets(series.ticker);
      if (events.length > 0) {
        results.push({ ...series, events });
      }
    } catch { /* series not available */ }
  }

  return results;
}

/**
 * Check if a market is liquid enough to trade.
 */
function isLiquid(mkt) {
  if (mkt.yesBid <= 0 || mkt.yesAsk <= 0) return false;
  const spread = mkt.yesAsk - mkt.yesBid;
  if (spread > MAX_SPREAD) return false;
  if (mkt.yesBid < MIN_PRICE || mkt.yesBid > MAX_PRICE) return false;
  if ((mkt.volume || 0) === 0 && (mkt.openInterest || 0) === 0) return false;
  return true;
}

/**
 * Parse settlement info from a gas market event/ticker.
 * @param {Object} event — Kalshi event
 * @returns {{ settleDate: string, daysToSettle: number }}
 */
function parseSettlement(event, mkt) {
  const closeTime = mkt.closeTime ? new Date(mkt.closeTime) : null;
  const daysToSettle = closeTime
    ? Math.max(0.1, (closeTime - Date.now()) / (1000 * 60 * 60 * 24))
    : 7; // default 1 week
  const settleDate = closeTime ? closeTime.toISOString().slice(0, 10) : null;
  return { settleDate, daysToSettle };
}

/**
 * Score gas markets against model predictions and return recommendations.
 *
 * @param {Function} probAboveFn — (mean, sigma, threshold, cal) => probability
 * @param {Object} prediction — from model.predict()
 * @param {Object} cal — calibration parameters
 * @param {number} balance — current bankroll
 * @returns {{ recommendations, markets, skipped }}
 */
export async function scoreGasMarkets(probAboveFn, prediction, cal, balance) {
  const allMarkets = await getGasMarkets();
  const recommendations = [];
  const skipped = { illiquid: 0, noEdge: 0, tooSmall: 0, expiringSoon: 0 };

  for (const series of allMarkets) {
    for (const event of series.events) {
      for (const mkt of event.markets) {
        if (!mkt.floorStrike) continue;

        // Liquidity filter
        if (!isLiquid(mkt)) {
          skipped.illiquid++;
          continue;
        }

        const { settleDate, daysToSettle } = parseSettlement(event, mkt);

        // Skip contracts expiring in < 4 hours
        if (daysToSettle < 4 / 24) {
          skipped.expiringSoon++;
          continue;
        }

        // Adjust prediction for time horizon if different from default
        // For now, use the pre-computed prediction (caller adjusts for time)
        const threshold = mkt.floorStrike;
        const pTrue = probAboveFn(prediction.mean, prediction.sigma, threshold, cal);

        // Check both sides using executable prices
        const sides = [
          { side: 'YES', pEst: pTrue, execPrice: mkt.yesAsk },
          { side: 'NO', pEst: 1 - pTrue, execPrice: mkt.noAsk || (1 - mkt.yesBid) },
        ];

        for (const { side, pEst, execPrice } of sides) {
          if (execPrice <= 0 || execPrice >= 1) continue;

          const grossEdge = pEst - execPrice;
          const netEdge = grossEdge - TRANSACTION_COST;

          if (netEdge < MIN_EDGE) {
            if (grossEdge > 0) skipped.noEdge++;
            continue;
          }

          const volume = mkt.volume || 0;
          const sizing = positionSize(balance, pEst, execPrice, 0.05, { volume });
          if (sizing.contracts <= 0) {
            skipped.tooSmall++;
            continue;
          }

          const spread = mkt.yesAsk - mkt.yesBid;

          recommendations.push({
            strategy: 'gas',
            seriesType: series.type,
            seriesLabel: series.label,
            ticker: mkt.ticker,
            eventTitle: event.title,
            threshold,
            currentGas: prediction.mean, // our predicted price
            side,
            pEst: round2(pEst),
            execPrice: round2(execPrice),
            midPrice: round2((mkt.yesBid + mkt.yesAsk) / 2),
            spread: round2(spread),
            edge: round2(netEdge),
            grossEdge: round2(grossEdge),
            contracts: sizing.contracts,
            dollarRisk: sizing.dollarRisk,
            daysToSettle: round2(daysToSettle),
            settleDate,
            volume,
            openInterest: mkt.openInterest || 0,
            prediction,
            ev: round2(netEdge * sizing.contracts),
          });
        }
      }
    }
  }

  // Sort by edge descending, cap at 5
  recommendations.sort((a, b) => b.edge - a.edge);
  const topRecs = recommendations.slice(0, 5);

  return {
    recommendations: topRecs,
    allRecommendations: recommendations,
    markets: allMarkets,
    skipped,
    summary: {
      seriesScanned: allMarkets.length,
      marketsFound: allMarkets.reduce((s, m) => s + m.events.reduce((s2, e) => s2 + e.markets.length, 0), 0),
      marketsLiquid: allMarkets.reduce((s, m) => s + m.events.reduce((s2, e) => s2 + e.markets.filter(isLiquid).length, 0), 0),
      recommendations: topRecs.length,
      totalEdges: recommendations.length,
      skipped,
    },
  };
}
