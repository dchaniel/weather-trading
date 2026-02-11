/**
 * Gas price data fetching from EIA API (free, no key required — uses DEMO_KEY).
 * Sources:
 *   - US retail gasoline prices (weekly, EIA)
 *   - WTI crude oil spot prices (daily, EIA)
 * Includes file-based caching with configurable TTL.
 */

import { fetchJSON, sleep } from '../core/utils.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../data/cache');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (EIA updates weekly on Mondays)

const EIA_BASE = 'https://api.eia.gov/v2';
const EIA_KEY = 'DEMO_KEY'; // Free tier, 1000 req/day

// ── Cache helpers ────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function getCached(key, ttl = CACHE_TTL_MS) {
  const path = join(CACHE_DIR, `eia-${key}.json`);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (Date.now() - cached._cachedAt < ttl) return cached.data;
  } catch { /* cache miss */ }
  return null;
}

function setCache(key, data) {
  ensureCacheDir();
  const path = join(CACHE_DIR, `eia-${key}.json`);
  writeFileSync(path, JSON.stringify({ _cachedAt: Date.now(), data }, null, 2));
}

// ── EIA API helpers ──────────────────────────────────────────────────────────

function buildEIAUrl(endpoint, params) {
  const url = new URL(`${EIA_BASE}${endpoint}`);
  url.searchParams.set('api_key', EIA_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => url.searchParams.set(`${k}[${i}]`, item));
    } else if (typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (Array.isArray(sv)) {
          sv.forEach((item, i) => url.searchParams.set(`${k}[${sk}][${i}]`, item));
        } else {
          url.searchParams.set(`${k}[${sk}]`, sv);
        }
      }
    } else {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function fetchEIA(endpoint, params) {
  const url = buildEIAUrl(endpoint, params);
  const data = await fetchJSON(url, {}, { retries: 2, timeoutMs: 20000 });
  if (data.response?.data) return data.response.data;
  throw new Error(`EIA API error: ${JSON.stringify(data).slice(0, 200)}`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch weekly US retail gasoline prices from EIA.
 * Returns array sorted oldest→newest: [{ date, price }]
 * @param {number} weeks — number of weeks of history (default 104 = 2 years)
 */
export async function getGasPriceHistory(weeks = 104) {
  const cacheKey = `gas-weekly-${weeks}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rows = await fetchEIA('/petroleum/pri/gnd/data/', {
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[product][]': 'EPM0',
    'facets[duoarea][]': 'NUS',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: String(weeks),
  });

  const result = rows
    .map(r => ({ date: r.period, price: parseFloat(r.value) }))
    .filter(r => !isNaN(r.price))
    .reverse(); // oldest first

  setCache(cacheKey, result);
  return result;
}

/**
 * Fetch the latest US retail gasoline price.
 * @returns {{ date: string, price: number }}
 */
export async function getCurrentGasPrice() {
  const history = await getGasPriceHistory(4);
  return history[history.length - 1];
}

/**
 * Fetch daily WTI crude oil spot prices from EIA.
 * Returns array sorted oldest→newest: [{ date, price }]
 * @param {number} days — number of days of history (default 365)
 */
export async function getCrudeOilHistory(days = 365) {
  const cacheKey = `crude-daily-${days}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rows = await fetchEIA('/petroleum/pri/spt/data/', {
    frequency: 'daily',
    'data[0]': 'value',
    'facets[product][]': 'EPCWTI',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: String(days),
  });

  const result = rows
    .map(r => ({ date: r.period, price: parseFloat(r.value) }))
    .filter(r => !isNaN(r.price))
    .reverse(); // oldest first

  setCache(cacheKey, result);
  return result;
}

/**
 * Get current WTI crude oil price.
 * @returns {{ date: string, price: number }}
 */
export async function getCurrentCrudePrice() {
  const history = await getCrudeOilHistory(10);
  return history[history.length - 1];
}

/**
 * Fetch all data needed for the gas price model.
 * @returns {{ gasHistory, crudeHistory, currentGas, currentCrude }}
 */
export async function fetchAllGasData() {
  const [gasHistory, crudeHistory] = await Promise.all([
    getGasPriceHistory(104),
    getCrudeOilHistory(365),
  ]);

  return {
    gasHistory,
    crudeHistory,
    currentGas: gasHistory[gasHistory.length - 1],
    currentCrude: crudeHistory[crudeHistory.length - 1],
  };
}
