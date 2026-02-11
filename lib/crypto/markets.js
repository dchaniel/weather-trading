/**
 * Find Kalshi crypto price markets (KXBTC, KXETH, etc.).
 */

import { getSeriesMarkets, getEvents } from '../kalshi/client.js';
import { sleep } from '../core/utils.js';

/** Known Kalshi crypto series tickers */
const CRYPTO_SERIES = [
  { symbol: 'BTC', tickers: ['KXBTCD', 'KXBTCW', 'KXBTC'] },
  { symbol: 'ETH', tickers: ['KXETHD', 'KXETHW', 'KXETH'] },
];

/**
 * Search for crypto markets on Kalshi.
 * Tries known series tickers, then falls back to event search.
 * @returns {Array<{ symbol, seriesTicker, events }>}
 */
export async function getCryptoMarkets() {
  const results = [];

  // Try known series tickers
  for (const series of CRYPTO_SERIES) {
    for (const ticker of series.tickers) {
      try {
        const events = await getSeriesMarkets(ticker);
        if (events.length > 0) {
          results.push({
            symbol: series.symbol,
            seriesTicker: ticker,
            events,
          });
          break; // Found markets for this coin, skip other ticker variants
        }
      } catch {
        // Ticker doesn't exist, try next
      }
      await sleep(200);
    }
  }

  // Fallback: search events for crypto-related keywords
  if (results.length === 0) {
    try {
      const events = await getEvents({ status: 'open' });
      const cryptoEvents = events.filter(e => {
        const t = (e.title || '').toLowerCase();
        return t.includes('bitcoin') || t.includes('btc') ||
               t.includes('ethereum') || t.includes('eth') ||
               t.includes('crypto');
      });

      for (const event of cryptoEvents) {
        const symbol = (event.title || '').toLowerCase().includes('bitcoin') ? 'BTC' : 'ETH';
        results.push({
          symbol,
          seriesTicker: event.series_ticker || event.event_ticker,
          events: [{
            eventTicker: event.event_ticker,
            title: event.title,
            markets: (event.markets || []).map(m => ({
              ticker: m.ticker,
              eventTicker: m.event_ticker,
              title: m.subtitle || m.title,
              type: m.floor_strike != null ? 'above' : 'unknown',
              strike: m.floor_strike ?? m.cap_strike,
              floorStrike: m.floor_strike,
              capStrike: m.cap_strike,
              yesBid: m.yes_bid / 100,
              yesAsk: m.yes_ask / 100,
              noBid: m.no_bid / 100,
              noAsk: m.no_ask / 100,
              lastPrice: m.last_price / 100,
              volume: m.volume,
              openInterest: m.open_interest,
              closeTime: m.close_time,
            })),
          }],
        });
      }
    } catch (e) {
      console.error(`Warning: Failed to process event ${event.title}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Get all crypto markets with threshold parsing.
 * Returns markets enriched with threshold values.
 */
export async function getCryptoMarketsWithThresholds() {
  const markets = await getCryptoMarkets();
  for (const m of markets) {
    for (const event of m.events) {
      for (const mkt of event.markets) {
        // Parse threshold from ticker or strike
        mkt.threshold = mkt.floorStrike || mkt.capStrike || null;
      }
    }
  }
  return markets;
}
