/**
 * Settlement verification — fetches actuals, determines contract outcomes,
 * flags discrepancies, and updates the ledger.
 */

import { fetchObservation } from '../weather/observe.js';
import { STATIONS } from '../weather/stations.js';
import { parseTicker } from '../kalshi/markets.js';
import { getLedger, getOpenPositions, settleDate } from './trade.js';

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
 * Verify settlements for a date.
 */
export async function verifySettlements(date) {
  const actuals = await fetchActuals(date);
  const open = getOpenPositions();

  if (!Object.keys(actuals).length) {
    return { error: 'No observations available', actuals: {}, results: [] };
  }

  const results = [];
  for (const trade of open) {
    const actual = actuals[trade.station];
    if (!actual) continue;

    const parsed = parseTicker(trade.contract);
    const thresholdMatch = trade.contract.match(/-T(\d+)$/);
    const threshold = parsed?.threshold ?? (thresholdMatch ? parseInt(thresholdMatch[1]) : null);
    if (threshold == null) continue;

    const { outcome, actualHigh } = determineOutcome(actual.high_f, threshold);
    const won = (trade.side === 'yes' && outcome === 'YES') ||
                (trade.side === 'no' && outcome === 'NO');
    const payout = won ? trade.qty * 1.00 : 0;
    const pnl = payout - trade.cost;

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
      pnl: Math.round(pnl * 100) / 100,
      observations: actual.observations,
    });
  }

  return { actuals, results, date };
}

/**
 * Execute settlement — verify and update ledger.
 */
export async function executeSettlement(date) {
  const verification = await verifySettlements(date);
  if (verification.error) return verification;

  const settled = settleDate(date, verification.actuals);
  return {
    ...verification,
    settled,
    ledger: getLedger(),
  };
}
