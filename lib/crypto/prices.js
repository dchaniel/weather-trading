/**
 * Crypto price fetching via CoinGecko free API (no key needed).
 * Includes file-based caching with 5-minute TTL to avoid 429s.
 */

import { fetchJSON, sleep } from '../core/utils.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../data/cache');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function getCached(key) {
  const path = join(CACHE_DIR, `coingecko-${key}.json`);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (Date.now() - cached._cachedAt < CACHE_TTL_MS) return cached.data;
  } catch (e) {
    console.error(`Warning: Failed to read cache for ${key}: ${e.message}`);
  }
  return null;
}

function setCache(key, data) {
  ensureCacheDir();
  const path = join(CACHE_DIR, `coingecko-${key}.json`);
  writeFileSync(path, JSON.stringify({ _cachedAt: Date.now(), data }, null, 2));
}


const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Supported coins and their CoinGecko IDs */
export const COINS = {
  BTC: { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
  ETH: { id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
};

/**
 * Fetch current prices for BTC and ETH.
 */
export async function getCurrentPrices() {
  const cacheKey = 'current-prices';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const ids = Object.values(COINS).map(c => c.id).join(',');
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const data = await fetchJSON(url, {}, { retries: 3 });

  const result = { timestamp: new Date().toISOString() };
  for (const [symbol, coin] of Object.entries(COINS)) {
    const d = data[coin.id];
    if (d) {
      result[symbol] = {
        price: d.usd,
        change24h: d.usd_24h_change,
        volume24h: d.usd_24h_vol,
      };
    }
  }
  setCache(cacheKey, result);
  return result;
}

/**
 * Fetch historical prices for a coin (hourly granularity for ≤90 days).
 * Returns hourly data points for better intraday vol estimation.
 */
export async function getHistoricalPrices(coinId, days = 30) {
  const cacheKey = `historical-${coinId}-${days}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const data = await fetchJSON(url, {}, { retries: 3 });
  const result = (data.prices || []).map(([ts, price]) => ({
    timestamp: ts,
    date: new Date(ts).toISOString().slice(0, 10),
    price,
  }));
  setCache(cacheKey, result);
  return result;
}

/**
 * Get daily OHLC data (better for vol estimation).
 */
export async function getOHLC(coinId, days = 30) {
  const cacheKey = `ohlc-${coinId}-${days}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  try {
    const data = await fetchJSON(url, {}, { retries: 3 });
    const result = data.map(([ts, open, high, low, close]) => ({
      timestamp: ts,
      date: new Date(ts).toISOString().slice(0, 10),
      open, high, low, close,
      price: close, // compatibility with vol functions
    }));
    setCache(cacheKey, result);
    return result;
  } catch {
    // Fallback to regular prices
    return getHistoricalPrices(coinId, days);
  }
}

/**
 * Fetch historical prices for all tracked coins.
 */
export async function getAllHistoricalPrices(days = 30) {
  const result = {};
  for (const [symbol, coin] of Object.entries(COINS)) {
    result[symbol] = await getOHLC(coin.id, days);
    await sleep(2000); // Rate limit
  }
  return result;
}
