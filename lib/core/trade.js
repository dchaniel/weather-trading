/**
 * Paper trade execution and ledger management.
 * Unified ledger for all strategies (weather, crypto, etc.).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logTrade, logSettlement, logError } from './logger.js';

const LEDGER_PATH = new URL('../../data/ledger.json', import.meta.url).pathname;
const INITIAL_BALANCE = 1000;

function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return { balance: INITIAL_BALANCE, trades: [], settlements: [] };
  }
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
}

function saveLedger(ledger) {
  ensureDir(LEDGER_PATH);
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

/**
 * Execute a paper trade.
 * @param {string} station — e.g. KNYC or 'crypto'
 * @param {string} contract — e.g. KXHIGHNY-26FEB10-T52 or KXBTCD-26FEB09-T100000
 * @param {'yes'|'no'} side
 * @param {number} qty — number of contracts
 * @param {number} price — price per contract (0-1 in dollars)
 * @param {string} [strategy='weather'] — strategy that generated this trade
 * @param {Object} [metadata={}] — additional trade metadata (expectedEdge, pEst, etc.)
 */
export function executeTrade(station, contract, side, qty, price, strategy = 'weather', metadata = {}) {
  const ledger = loadLedger();
  const cost = qty * price;

  if (cost > ledger.balance) {
    throw new Error(`Insufficient balance: need $${cost.toFixed(2)}, have $${ledger.balance.toFixed(2)}`);
  }

  const trade = {
    id: ledger.trades.length + 1,
    timestamp: new Date().toISOString(),
    strategy,
    station,
    contract,
    side,
    qty,
    price,
    cost,
    settled: false,
    pnl: null,
    ...metadata, // Add expectedEdge, pEst, etc.
  };

  ledger.balance -= cost;
  // Use cents internally to avoid floating point issues
  ledger.balance = Math.round(ledger.balance * 100) / 100;
  ledger.trades.push(trade);
  saveLedger(ledger);
  logTrade('OPEN', trade);
  return trade;
}

/**
 * Settle all open trades for a given date against actual observation.
 * @param {string} date — YYYY-MM-DD
 * @param {Object} actuals — Map of station → { high_f } (weather) or similar
 */
export function settleDate(date, actuals) {
  const ledger = loadLedger();
  const results = [];

  for (const trade of ledger.trades) {
    if (trade.settled) continue;

    // Parse threshold/bracket from contract ticker
    const tMatch = trade.contract.match(/-T([\d.]+)$/);
    const bMatch = trade.contract.match(/-B([\d.]+)$/);
    if (!tMatch && !bMatch) continue;
    const isThreshold = !!tMatch;
    const threshold = isThreshold ? parseFloat(tMatch[1]) : null;
    const bracket = !isThreshold ? parseFloat(bMatch[1]) : null;

    const actual = actuals[trade.station];
    if (!actual) continue;

    let won;
    if (isThreshold) {
      const highAbove = actual.high_f >= threshold;
      won = (trade.side === 'yes' && highAbove) || (trade.side === 'no' && !highAbove);
    } else {
      // Bracket: YES wins if high is in [floor(bracket), ceil(bracket)+1)
      const lo = Math.floor(bracket);
      const hi = Math.ceil(bracket) + (bracket === Math.floor(bracket) ? 1 : 0);
      const inBracket = actual.high_f >= lo && actual.high_f < hi;
      won = (trade.side === 'yes' && inBracket) || (trade.side === 'no' && !inBracket);
    }
    const payout = won ? trade.qty * 1.00 : 0;
    const pnl = payout - trade.cost;

    trade.settled = true;
    trade.pnl = Math.round(pnl * 100) / 100;
    trade.settledAt = new Date().toISOString();
    trade.actualHigh = actual.high_f;

    ledger.balance += payout;
    ledger.balance = Math.round(ledger.balance * 100) / 100;
    results.push({ ...trade, payout, won });
  }

  ledger.settlements.push({ date, settledAt: new Date().toISOString(), count: results.length });
  saveLedger(ledger);
  logSettlement(date, results);
  return results;
}

/** Get current ledger state */
export function getLedger() { return loadLedger(); }

/** Get open (unsettled) positions */
export function getOpenPositions() {
  return loadLedger().trades.filter(t => !t.settled);
}

/** Get total P&L from settled trades */
export function getTotalPnL() {
  const ledger = loadLedger();
  return ledger.trades
    .filter(t => t.settled && t.pnl != null)
    .reduce((sum, t) => sum + t.pnl, 0);
}

/**
 * Update a trade with new properties (for settlement, etc.)
 * @param {number|string} tradeId - Trade ID to update
 * @param {Object} updates - Properties to update 
 */
export function updateTrade(tradeId, updates) {
  const ledger = loadLedger();
  const trade = ledger.trades.find(t => t.id == tradeId);
  
  if (!trade) {
    throw new Error(`Trade ${tradeId} not found`);
  }
  
  // Apply updates
  Object.assign(trade, updates);
  
  // If this is a settlement, update balance
  if (updates.status === 'settled' && updates.pnl !== undefined) {
    const payout = trade.pnl > 0 ? trade.qty * 1.00 : 0;
    ledger.balance += payout;
    ledger.balance = Math.round(ledger.balance * 100) / 100;
  }
  
  saveLedger(ledger);
  logTrade(updates.status || 'UPDATE', trade);
  return trade;
}
