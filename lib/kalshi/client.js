/**
 * Kalshi authenticated API client.
 * Uses RSA-PSS key signing for authentication.
 */

import crypto from 'crypto';
import fs from 'fs';

const KEY_ID = 'd463b751-b553-4af3-b3f0-560bb5bc1a74';
const KEY_PATH = '/home/node/.openclaw/workspace/skills/kalshi/kalshi_key.pem';
const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

let _privateKey = null;
function getPrivateKey() {
  if (!_privateKey) _privateKey = fs.readFileSync(KEY_PATH, 'utf8');
  return _privateKey;
}

function getAuthHeaders(method, resourcePath) {
  const timestamp = Date.now();
  const fullPath = '/trade-api/v2' + resourcePath.split('?')[0];
  const payload = timestamp.toString() + method.toUpperCase() + fullPath;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(payload);
  sign.end();
  const signature = sign.sign({
    key: getPrivateKey(),
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, 'base64');

  return {
    'KALSHI-ACCESS-KEY': KEY_ID,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp.toString(),
    'Content-Type': 'application/json',
  };
}

async function request(method, resourcePath, body = null) {
  const headers = getAuthHeaders(method, resourcePath);
  const url = BASE_URL + resourcePath;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kalshi API ${method} ${resourcePath} → ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export async function getBalance() {
  return request('GET', '/portfolio/balance');
}

export async function getPositions() {
  return request('GET', '/portfolio/positions');
}

export async function getOrders(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('GET', '/portfolio/orders' + (qs ? '?' + qs : ''));
}

export async function getFills(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request('GET', '/portfolio/fills' + (qs ? '?' + qs : ''));
}

// ── Orders ───────────────────────────────────────────────────────────────────

export async function placeOrder(order) {
  const body = {
    ticker: order.ticker,
    side: order.side,
    action: order.action,
    count: order.count,
    type: order.type || 'limit',
  };
  if (order.yes_price != null) body.yes_price = order.yes_price;
  if (order.no_price != null) body.no_price = order.no_price;
  return request('POST', '/portfolio/orders', body);
}

export async function cancelOrder(orderId) {
  return request('DELETE', `/portfolio/orders/${orderId}`);
}

// ── Markets ──────────────────────────────────────────────────────────────────

export async function getMarket(ticker) {
  const data = await request('GET', `/markets/${ticker}`);
  return data.market || data;
}

export async function getMarkets(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const data = await request('GET', '/markets' + (qs ? '?' + qs : ''));
  return data.markets || [];
}

export async function getEvents(params = {}) {
  const defaults = { status: 'open', with_nested_markets: 'true' };
  const merged = { ...defaults, ...params };
  const qs = new URLSearchParams(merged).toString();
  const data = await request('GET', '/events?' + qs);
  return data.events || [];
}

// ── Temperature Markets ──────────────────────────────────────────────────────

/**
 * Fetch markets for a given series ticker.
 * Works for any series: KXHIGHCHI, KXBTCD, KXETH, etc.
 * Returns normalized market data with prices as decimals (0-1).
 */
export async function getSeriesMarkets(seriesTicker) {
  const events = await getEvents({ series_ticker: seriesTicker, limit: '5' });
  const results = [];

  for (const event of events) {
    const markets = (event.markets || []).map(m => {
      const isThreshold = m.ticker.includes('-T');
      const isBracket = m.ticker.includes('-B');
      const strike = m.floor_strike ?? m.cap_strike;
      let type = 'unknown';
      if (isThreshold && m.floor_strike != null) type = 'above';
      else if (isThreshold && m.cap_strike != null) type = 'below';
      else if (isBracket) type = 'bracket';

      return {
        ticker: m.ticker,
        eventTicker: m.event_ticker,
        title: m.subtitle || m.yes_sub_title || m.no_sub_title || m.title,
        type,
        strike,
        floorStrike: m.floor_strike,
        capStrike: m.cap_strike,
        yesBid: m.yes_bid / 100,
        yesAsk: m.yes_ask / 100,
        noBid: m.no_bid / 100,
        noAsk: m.no_ask / 100,
        lastPrice: m.last_price / 100,
        volume: m.volume,
        openInterest: m.open_interest,
        liquidity: m.liquidity,
        closeTime: m.close_time,
      };
    });

    markets.sort((a, b) => (a.floorStrike || 0) - (b.floorStrike || 0));

    results.push({
      eventTicker: event.event_ticker,
      title: event.title,
      markets,
    });
  }

  return results;
}

// Backward-compatible alias
export const getTemperatureMarkets = getSeriesMarkets;

export async function getAllTemperatureMarkets() {
  const series = ['KXHIGHCHI', 'KXHIGHNY'];
  const all = {};
  for (const s of series) {
    all[s] = await getSeriesMarkets(s);
  }
  return all;
}

export { request, getAuthHeaders };
