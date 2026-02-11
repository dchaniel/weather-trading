/**
 * Crypto trading strategy for Kalshi crypto markets.
 * Uses GARCH vol, Student-t tails, executable prices, and liquidity filtering.
 * 
 * Strategy maturity: PAPER-ONLY — pending live validation.
 */

import { getCurrentPrices, getAllHistoricalPrices, COINS } from './prices.js';
import { generateSignals, cryptoProbAbove } from './forecast.js';
import { getCryptoMarketsWithThresholds } from './markets.js';
import { positionSize, TRANSACTION_COST } from '../core/sizing.js';
import { getLedger } from '../core/trade.js';
import { round2 } from '../core/utils.js';

/** Maximum bid/ask spread to consider a market tradeable */
const MAX_SPREAD = 0.20; // 20 cents = 20%

/** Minimum edge after using executable price AND transaction costs */
const MIN_EDGE = 0.05; // 5%

/** Transaction costs (same as weather: subtract 4¢) */

/** Price range filter - avoid deep ITM/OTM contracts */
const MIN_BID_PRICE = 0.10; // 10 cents
const MAX_BID_PRICE = 0.90; // 90 cents

/** Minimum volume or open interest to consider */
const MIN_LIQUIDITY = 0; // Set to 0 for now since Kalshi crypto is thin

/**
 * Check if a market is liquid enough to trade.
 */
function isLiquid(mkt) {
  const spread = mkt.yesAsk - mkt.yesBid;
  
  // Skip if no bid or no ask (one-sided market)
  if (mkt.yesBid <= 0 && mkt.yesAsk <= 0) return false;
  if (mkt.yesAsk <= 0 || mkt.yesBid <= 0) return false;
  
  // Price filtering - only contracts with bid between 0.10-0.90 (not deep ITM/OTM)
  if (mkt.yesBid < MIN_BID_PRICE || mkt.yesBid > MAX_BID_PRICE) return false;
  
  // Skip if spread > 20%
  if (spread > MAX_SPREAD) return false;
  
  // Skip if no volume (when available)
  if ((mkt.volume || 0) === 0 && (mkt.openInterest || 0) === 0) return false;
  
  return true;
}

/**
 * Get the executable price for a side.
 * For buying YES: we pay the ask.
 * For buying NO: we pay the noAsk (= 1 - yesBid).
 */
function executablePrice(mkt, side) {
  if (side === 'YES') return mkt.yesAsk;
  return mkt.noAsk; // = 1 - yesBid
}

/**
 * Run the full crypto strategy pipeline.
 */
export async function runCryptoStrategy() {
  const [current, history] = await Promise.all([
    getCurrentPrices(),
    getAllHistoricalPrices(30),
  ]);

  const coins = {};
  for (const [symbol, coin] of Object.entries(COINS)) {
    const prices = history[symbol] || [];
    const signals = generateSignals(prices);
    coins[symbol] = { ...coin, current: current[symbol], signals };
  }

  let kalshiMarkets = [];
  try {
    kalshiMarkets = await getCryptoMarketsWithThresholds();
  } catch (e) { /* markets may not be available */ }

  const recommendations = [];
  const skipped = { illiquid: 0, noEdge: 0, tooSmall: 0 };
  const ledger = getLedger();

  for (const km of kalshiMarkets) {
    const coin = coins[km.symbol];
    if (!coin?.signals) continue;

    for (const event of km.events) {
      for (const mkt of event.markets) {
        if (!mkt.threshold || mkt.threshold <= 0) continue;

        // Liquidity filter
        if (!isLiquid(mkt)) {
          skipped.illiquid++;
          continue;
        }

        const closeDate = mkt.closeTime ? new Date(mkt.closeTime) : null;
        const rawDays = closeDate
          ? (closeDate - Date.now()) / (1000 * 60 * 60 * 24)
          : 1;

        // Skip contracts expiring in less than 2 hours — too close to settlement,
        // prices are stale, and our model can't add value
        if (rawDays < 2 / 24) {
          skipped.illiquid++; // count as illiquid
          continue;
        }
        const daysToExpiry = rawDays;

        // Use GARCH vol, picking the more conservative estimate
        const vol = Math.max(coin.signals.vol7d, coin.signals.vol30d) || 0.5;
        const drift = coin.signals.drift || 0;
        const exKurt = coin.signals.excessKurtosis || 3;

        const pTrue = cryptoProbAbove(
          coin.signals.currentPrice,
          mkt.threshold,
          vol,
          daysToExpiry,
          drift,
          exKurt,
        );

        // Check both sides against EXECUTABLE prices (not mid)
        const sides = [
          { side: 'YES', pEst: pTrue, execPrice: mkt.yesAsk },
          { side: 'NO', pEst: 1 - pTrue, execPrice: mkt.noAsk },
        ];

        for (const { side, pEst, execPrice } of sides) {
          if (execPrice <= 0 || execPrice >= 1) continue;

          // Calculate net edge after transaction costs (same as weather strategy)
          const grossEdge = pEst - execPrice;
          const netEdge = grossEdge - TRANSACTION_COST;
          
          if (netEdge < MIN_EDGE) {
            if (grossEdge > 0) skipped.noEdge++;
            continue;
          }

          const sizing = positionSize(ledger.balance, pEst, execPrice);
          if (sizing.contracts <= 0) {
            skipped.tooSmall++;
            continue;
          }

          const spread = mkt.yesAsk - mkt.yesBid;

          recommendations.push({
            symbol: km.symbol,
            ticker: mkt.ticker,
            eventTitle: event.title,
            threshold: mkt.threshold,
            currentPrice: coin.signals.currentPrice,
            daysToExpiry: round2(daysToExpiry),
            vol: round2(vol),
            exKurtosis: round2(exKurt),
            side,
            pEst: round2(pEst),
            execPrice: round2(execPrice),
            midPrice: round2((mkt.yesBid + mkt.yesAsk) / 2),
            spread: round2(spread),
            edge: round2(netEdge), // Use net edge after transaction costs
            grossEdge: round2(grossEdge),
            contracts: sizing.contracts,
            dollarRisk: sizing.dollarRisk,
            signals: coin.signals.signals,
            sentiment: coin.signals.sentiment,
            drift: round2(drift),
          });
          
          // Log crypto decision to history
          try {
            const { appendDecision } = await import('../core/history.js');
            const guardStates = {
              priceFilter: 'PASS',
              liquidityFilter: 'PASS',
              edgeFilter: 'PASS',
            };
            appendDecision(km.symbol, 'CRYPTO_EDGE', guardStates, netEdge);
          } catch (e) {
            // Don't fail strategy if history logging fails
          }
        }
      }
    }
  }

  // Sort by edge descending
  recommendations.sort((a, b) => b.edge - a.edge);

  // Cap at top 5 — if we have more than 5 "edges", we're probably miscalibrated
  const topRecs = recommendations.slice(0, 5);

  return {
    coins,
    kalshiMarkets,
    recommendations: topRecs,
    allRecommendations: recommendations,
    skipped,
    summary: {
      coinsTracked: Object.keys(coins).length,
      marketsFound: kalshiMarkets.reduce((s, m) => s + m.events.reduce((s2, e) => s2 + e.markets.length, 0), 0),
      marketsLiquid: kalshiMarkets.reduce((s, m) => s + m.events.reduce((s2, e) => s2 + e.markets.filter(isLiquid).length, 0), 0),
      recommendations: topRecs.length,
      totalEdges: recommendations.length,
      skipped,
    },
  };
}
