/**
 * Universal settlement — handles weather, crypto, and precipitation trades.
 * Primary source of truth: Kalshi API market resolution.
 * Fallback: actual observation data (weather only).
 */

import { fetchObservation } from '../weather/observe.js';
import { STATIONS } from '../weather/stations.js';
import { parseTicker } from '../kalshi/markets.js';
import { getLedger, getOpenPositions, settleDate, updateTrade } from './trade.js';
import * as kalshi from '../kalshi/client.js';
import { logSettlement } from './logger.js';

/**
 * Fetch actual observations for all weather stations for a given date.
 */
export async function fetchActuals(date) {
  const actuals = {};
  for (const st of Object.keys(STATIONS)) {
    try {
      const obs = await fetchObservation(st, date);
      if (obs) actuals[st] = obs;
    } catch (e) {
      console.error(`Warning: Failed to fetch observation for ${st}: ${e.message}`);
    }
  }
  return actuals;
}

/**
 * Determine contract settlement: did the high exceed the threshold?
 */
export function determineOutcome(actualHigh, threshold) {
  const outcome = actualHigh >= threshold ? 'YES' : 'NO';
  return { outcome, actualHigh, threshold };
}

/**
 * Check Kalshi API for market resolution.
 * Returns { resolved: true, result: 'yes'|'no' } or { resolved: false }.
 */
async function checkKalshiResolution(ticker) {
  try {
    const market = await kalshi.getMarket(ticker);
    if (market.status === 'finalized' && market.result) {
      return { resolved: true, result: market.result.toLowerCase() };
    }
    return { resolved: false };
  } catch (e) {
    return { resolved: false, error: e.message };
  }
}

/**
 * Settle a single trade using Kalshi API resolution.
 * Returns settlement result or null if can't settle.
 */
async function settleTradeViaKalshi(trade) {
  const resolution = await checkKalshiResolution(trade.contract);
  if (!resolution.resolved) return null;

  const marketResult = resolution.result; // 'yes' or 'no'
  const won = trade.side === marketResult;
  const payout = won ? trade.qty * 1.00 : 0;
  const pnl = Math.round((payout - trade.cost) * 100) / 100;

  return {
    tradeId: trade.id,
    contract: trade.contract,
    station: trade.station,
    side: trade.side,
    qty: trade.qty,
    price: trade.price,
    cost: trade.cost,
    strategy: trade.strategy || 'unknown',
    kalshiResult: marketResult,
    won,
    payout,
    pnl,
    source: 'kalshi_api',
  };
}

/**
 * Classify a trade's type based on contract ticker or strategy field.
 */
function classifyTrade(trade) {
  if (trade.strategy === 'crypto' || /^KX(BTC|ETH)/.test(trade.contract)) return 'crypto';
  if (trade.strategy === 'precipitation' || /^KXRAIN/.test(trade.contract)) return 'precipitation';
  return 'weather';
}

/**
 * Universal settlement — settles ALL trade types.
 * 1. First tries Kalshi API resolution for each open trade
 * 2. Falls back to weather observation data for weather trades
 */
export async function executeSettlement(date) {
  const openTrades = getOpenPositions();

  if (openTrades.length === 0) {
    return { results: [], date };
  }

  const results = [];
  const weatherFallbackTrades = [];

  // Phase 1: Try Kalshi API for all trades
  for (const trade of openTrades) {
    const type = classifyTrade(trade);
    const kalshiResult = await settleTradeViaKalshi(trade);

    if (kalshiResult) {
      results.push(kalshiResult);
    } else if (type === 'weather') {
      // Weather trades can fall back to observation data
      weatherFallbackTrades.push(trade);
    } else {
      console.log(`  ⏳ ${trade.contract} — not yet resolved on Kalshi`);
    }
  }

  // Phase 2: Weather fallback via observations
  if (weatherFallbackTrades.length > 0) {
    const actuals = await fetchActuals(date);
    for (const trade of weatherFallbackTrades) {
      const actual = actuals[trade.station];
      if (!actual) continue;

      const parsed = parseTicker(trade.contract);
      const tMatch = trade.contract.match(/-T([\d.]+)$/);
      const threshold = parsed?.threshold ?? (tMatch ? parseFloat(tMatch[1]) : null);
      if (threshold == null) continue;

      const { outcome, actualHigh } = determineOutcome(actual.high_f, threshold);
      const won = (trade.side === 'yes' && outcome === 'YES') ||
                  (trade.side === 'no' && outcome === 'NO');
      const payout = won ? trade.qty * 1.00 : 0;
      const pnl = Math.round((payout - trade.cost) * 100) / 100;

      results.push({
        tradeId: trade.id,
        contract: trade.contract,
        station: trade.station,
        side: trade.side,
        qty: trade.qty,
        price: trade.price,
        cost: trade.cost,
        threshold,
        actualHigh: actual.high_f,
        ourSettlement: outcome,
        won,
        payout,
        pnl,
        source: 'observation',
      });
    }
  }

  // Phase 3: Apply settlements to ledger
  if (results.length > 0) {
    const ledger = getLedger();
    for (const r of results) {
      const trade = ledger.trades.find(t => t.id === r.tradeId);
      if (trade && !trade.settled) {
        trade.settled = true;
        trade.pnl = r.pnl;
        trade.settledAt = new Date().toISOString();
        trade.settlementSource = r.source;
        if (r.kalshiResult) trade.kalshiResult = r.kalshiResult;
        if (r.actualHigh != null) trade.actualHigh = r.actualHigh;

        // Credit payout to balance
        if (r.payout > 0) {
          ledger.balance += r.payout;
          ledger.balance = Math.round(ledger.balance * 100) / 100;
        }
      }
    }
    ledger.settlements.push({ date, settledAt: new Date().toISOString(), count: results.length });

    // Save ledger
    const { writeFileSync } = await import('fs');
    const LEDGER_PATH = new URL('../../data/ledger.json', import.meta.url).pathname;
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));

    logSettlement(date, results);
  }

  return { results, date };
}

// Keep for backwards compatibility
export async function verifySettlements(date) {
  return executeSettlement(date);
}

/**
 * Verify all settled trades against Kalshi API resolution.
 * Returns array of verification results with match/mismatch status.
 */
export async function verifyAllSettledTrades() {
  const ledger = getLedger();
  const settled = ledger.trades.filter(t => t.settled);
  const results = [];

  for (const trade of settled) {
    const resolution = await checkKalshiResolution(trade.contract);

    if (!resolution.resolved) {
      results.push({
        tradeId: trade.id,
        contract: trade.contract,
        status: 'unresolved',
        details: resolution.error || 'Market not yet resolved on Kalshi',
      });
      continue;
    }

    const kalshiWon = trade.side === resolution.result;
    const kalshiPnl = kalshiWon
      ? Math.round((trade.qty * 1.00 - trade.cost) * 100) / 100
      : Math.round(-trade.cost * 100) / 100;
    const ourWon = trade.pnl > 0;
    const match = kalshiWon === ourWon;

    results.push({
      tradeId: trade.id,
      contract: trade.contract,
      side: trade.side,
      status: match ? 'match' : 'MISMATCH',
      kalshiResult: resolution.result,
      kalshiWon,
      kalshiPnl,
      ourPnl: trade.pnl,
      ourActualHigh: trade.actualHigh,
      match,
      duplicate: trade.duplicate || false,
    });
  }

  return results;
}

/**
 * Verify all previously settled trades against Kalshi API.
 * Added for DAN-174 compatibility.
 */
export async function verifyAllSettledTrades() {
  const ledger = getLedger();
  const settled = ledger.trades.filter(t => t.settled);
  const discrepancies = [];

  for (const trade of settled) {
    const resolution = await checkKalshiResolution(trade.contract);
    if (!resolution.resolved) continue;

    const kalshiResult = resolution.result;
    const expectedWon = trade.side === kalshiResult;
    const expectedPnl = expectedWon ? Math.round((trade.qty * 1.00 - trade.cost) * 100) / 100 : Math.round(-trade.cost * 100) / 100;

    if (Math.abs(expectedPnl - (trade.pnl || 0)) > 0.01) {
      discrepancies.push({
        tradeId: trade.id,
        contract: trade.contract,
        side: trade.side,
        kalshiResult,
        expectedPnl,
        actualPnl: trade.pnl,
      });
    }
  }

  return { verified: settled.length, discrepancies };
}
