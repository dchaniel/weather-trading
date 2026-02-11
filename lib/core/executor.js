/**
 * Live order executor + automated trade execution loop.
 * Takes an approved trade recommendation and places it on Kalshi.
 * DRY RUN mode by default — set LIVE_TRADING=1 to place real orders.
 */

import * as kalshi from '../kalshi/client.js';
import { findById, markExecuted, updateStatus } from './pending.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Load config.json overrides ───────────────────────────────────────────────
const __dirname2 = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname2, '..', '..', 'config.json');
function loadExecConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).execution || {}; }
  catch { return {}; }
}
const gcfg = loadExecConfig();

const EXECUTION_LOG_PATH = new URL('../../data/executions.json', import.meta.url).pathname;

function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }

function loadLog() {
  if (!existsSync(EXECUTION_LOG_PATH)) return [];
  return JSON.parse(readFileSync(EXECUTION_LOG_PATH, 'utf8'));
}

function appendLog(entry) {
  const log = loadLog();
  log.push(entry);
  ensureDir(EXECUTION_LOG_PATH);
  writeFileSync(EXECUTION_LOG_PATH, JSON.stringify(log, null, 2));
}

function isDryRun() {
  return process.env.LIVE_TRADING !== '1';
}

/**
 * Execute an approved trade.
 * @param {string} tradeId — pending trade ID
 * @returns {Object} execution result
 */
export async function execute(tradeId) {
  const rec = findById(tradeId);
  if (!rec) throw new Error(`Trade ${tradeId} not found`);
  if (rec.status !== 'approved') throw new Error(`Trade ${tradeId} is ${rec.status}, must be approved`);

  // Check expiry
  if (new Date(rec.expiresAt).getTime() <= Date.now()) {
    updateStatus(tradeId, 'expired');
    throw new Error(`Trade ${tradeId} has expired`);
  }

  const dryRun = isDryRun();
  const priceInCents = Math.round(rec.price * 100);

  const order = {
    ticker: rec.contract,
    side: rec.side.toLowerCase(),
    action: 'buy',
    count: rec.qty,
    type: 'limit',
    yes_price: rec.side.toLowerCase() === 'yes' ? priceInCents : undefined,
    no_price: rec.side.toLowerCase() === 'no' ? priceInCents : undefined,
  };

  const logEntry = {
    tradeId,
    order,
    dryRun,
    timestamp: new Date().toISOString(),
  };

  if (dryRun) {
    console.log(`🔸 DRY RUN — would place order:`);
    console.log(`   ${order.side.toUpperCase()} ${order.count}x ${order.ticker} @ ${priceInCents}¢`);
    logEntry.result = 'dry_run';
    appendLog(logEntry);
    markExecuted(tradeId, { dryRun: true, order });
    return { dryRun: true, order, rec };
  }

  // LIVE execution
  try {
    // Pre-flight: check balance
    const balResp = await kalshi.getBalance();
    const balance = (balResp.balance || 0) / 100; // cents to dollars
    const cost = rec.qty * rec.price;
    if (balance < cost) {
      const msg = `Insufficient funds: need $${cost.toFixed(2)}, have $${balance.toFixed(2)}`;
      logEntry.result = 'insufficient_funds';
      logEntry.error = msg;
      appendLog(logEntry);
      throw new Error(msg);
    }

    // Pre-flight: check market is open
    try {
      const market = await kalshi.getMarket(rec.contract);
      if (market.status && market.status !== 'open') {
        const msg = `Market ${rec.contract} is ${market.status}, not open`;
        logEntry.result = 'market_closed';
        logEntry.error = msg;
        appendLog(logEntry);
        throw new Error(msg);
      }
    } catch (e) {
      if (e.message.includes('not open') || e.message.includes('Market')) throw e;
      // If market lookup fails, proceed cautiously — order will fail if invalid
    }

    // Place order
    console.log(`🔴 LIVE ORDER: ${order.side.toUpperCase()} ${order.count}x ${order.ticker} @ ${priceInCents}¢`);
    const result = await kalshi.placeOrder(order);
    console.log(`✅ Order placed: ${JSON.stringify(result)}`);

    logEntry.result = 'placed';
    logEntry.orderResponse = result;
    appendLog(logEntry);
    markExecuted(tradeId, { dryRun: false, order, response: result });

    return { dryRun: false, order, result, rec };
  } catch (e) {
    if (!logEntry.result) {
      logEntry.result = 'error';
      logEntry.error = e.message;
      appendLog(logEntry);
    }
    // Don't mark as executed on error — leave as approved so it can be retried
    throw e;
  }
}

/**
 * Execute approved trades from recommendation engine.
 * Runs guards, risk checks, caps size, and places paper/live trades.
 * @param {Array} combined - Trades that passed initial filters
 * @param {Array} blockedWeather - Trades blocked by guards (for summary count)
 * @param {Array} dates - Date range being traded
 * @param {string} sessionId - Execution session identifier
 */
export async function executeApprovedTrades(combined, blockedWeather, dates, sessionId) {
  const { executeTrade } = await import('./trade.js');
  const { appendTrade } = await import('./history.js');
  const { checkRiskLimits } = await import('./risk.js');
  const { runGuards } = await import('./guard.js');
  const { TRANSACTION_COST } = await import('./sizing.js');

  console.log('\n🔄 AUTO-EXECUTION MODE\n' + '─'.repeat(60));

  const riskCheck = checkRiskLimits();
  if (!riskCheck.allowed) {
    console.log('❌ BLOCKED by risk limits:');
    for (const v of riskCheck.violations) console.log(`   • ${v}`);
    console.log(); return;
  }
  if (process.env.LIVE_TRADING === '1') {
    console.log('❌ BLOCKED: --execute only works in PAPER TRADING mode\n'); return;
  }
  if (!combined.length) { console.log('  No trades pass guards today. 🎯\n'); return; }

  let execCount = 0, blockedCount = blockedWeather.length, totalRisk = 0, failedCount = 0;
  const executable = combined
    .filter(r => (r.edge - TRANSACTION_COST) > 0 && r.sizing?.contracts > 0)
    .slice(0, 1);

  if (!executable.length) {
    console.log('  No trades with positive net edge after transaction costs. 💰');
    console.log(`\n  📊 Session summary: 0 trades placed, ${blockedCount} blocked by guards, $0.00 at risk\n`);
    return;
  }

  for (const trade of executable) {
    try {
      console.log(`  Executing: ${trade.side} ${trade.sizing.contracts}x ${trade.ticker} @ $${trade.price.toFixed(2)}`);

      const tradeRisk = checkRiskLimits(trade.station, trade.sizing?.dollarRisk || 0);
      if (!tradeRisk.allowed) { console.log(`    ❌ BLOCKED by risk limits: ${tradeRisk.violations[0]}`); blockedCount++; continue; }

      if (trade.strategy === 'weather') {
        if (!trade.marketSigma) { console.log(`    ❌ BLOCKED: No market data — run 'kalshi iv' first.`); blockedCount++; continue; }
        const finalGuard = runGuards({ station: trade.station, qty: trade.sizing.contracts, forecastSpread: trade.forecastSpread, marketSigma: trade.marketSigma, forecastHigh: trade.forecastHigh, date: trade.date });
        if (!finalGuard.pass) { console.log(`    ❌ BLOCKED: ${finalGuard.reasons[0]}`); blockedCount++; continue; }
      }

      const maxContracts = gcfg.autoMaxContracts ?? 5;
      const cappedContracts = Math.min(trade.sizing.contracts, maxContracts);
      if (cappedContracts < trade.sizing.contracts) console.log(`    📊 CAPPED: ${trade.sizing.contracts} → ${cappedContracts} contracts (no depth data)`);

      try {
        executeTrade(trade.station, trade.ticker, trade.side.toLowerCase(), cappedContracts, trade.price, trade.strategy, { expectedEdge: trade.edge, pEst: trade.pEst, marketSigma: trade.marketSigma, ourSigma: trade.sigma });
      } catch (apiError) {
        if (/network|timeout|50[23]/.test(apiError.message)) { console.log('    ⚠️ API unavailable, skipping'); failedCount++; continue; }
        throw apiError;
      }

      try { appendTrade({ date: dates[0], station: trade.station, contract: trade.ticker, side: trade.side.toLowerCase(), qty: cappedContracts, price: trade.price, expectedEdge: trade.edge, marketSigma: trade.marketSigma, ourSigma: trade.sigma }); } catch {}

      totalRisk += cappedContracts * trade.price;
      const netEdge = trade.edge - TRANSACTION_COST;
      console.log(`    ✅ Paper trade placed — Expected value: $${(netEdge * cappedContracts).toFixed(2)}`);
      execCount++;
    } catch (e) { console.log(`    ❌ Execution failed: ${e.message}`); failedCount++; }
  }

  console.log(`\n  📊 Session ${sessionId}: ${execCount} trade${execCount !== 1 ? 's' : ''} placed, ${blockedCount} blocked by guards, $${totalRisk.toFixed(2)} at risk`);
  if (failedCount > 0) console.log(`    ${failedCount} execution(s) failed or skipped due to API issues`);
}
