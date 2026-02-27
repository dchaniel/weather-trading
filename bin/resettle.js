#!/usr/bin/env node
/**
 * Re-settle all trades using Kalshi API as source of truth.
 * Corrects the ledger P&L and balance.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as kalshi from '../lib/kalshi/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(__dirname, '..', 'data', 'ledger.json');

async function main() {
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  
  // Back up
  writeFileSync(LEDGER_PATH + '.bak', JSON.stringify(ledger, null, 2));
  console.log(`Backed up ledger to ${LEDGER_PATH}.bak`);

  // Calculate starting balance: current balance - all payouts + all costs that were credited
  // Easier: reconstruct from initial deposit
  // Find initial balance by reversing all settlements
  let startingBalance = ledger.balance;
  for (const t of ledger.trades) {
    if (t.settled) {
      // Reverse: subtract payout that was added
      const oldWon = t.pnl > 0;
      if (oldWon) {
        startingBalance -= (t.pnl + t.cost); // payout = pnl + cost
      }
      // Cost was already deducted at trade time, balance only gets payout credits
    }
  }
  // Actually, let's just compute: startBalance = balance - sum(payouts_credited)
  // payout = pnl + cost when won, 0 when lost
  // But balance tracks: initial - sum(costs) + sum(payouts)
  // So initial = balance + sum(costs) - sum(payouts)
  let sumCosts = 0, sumPayouts = 0;
  for (const t of ledger.trades) {
    sumCosts += t.cost;
    if (t.settled && t.pnl > 0) {
      sumPayouts += (t.pnl + t.cost);
    }
  }
  const initialBalance = Math.round((ledger.balance + sumCosts - sumPayouts) * 100) / 100;
  console.log(`Inferred initial balance: $${initialBalance}`);
  console.log(`Total costs: $${sumCosts}`);
  console.log(`Old payouts: $${sumPayouts}\n`);

  // Re-settle each trade via Kalshi
  let newPayouts = 0;
  let corrections = 0;

  for (const trade of ledger.trades) {
    try {
      const market = await kalshi.getMarket(trade.contract);
      if (!['settled', 'finalized'].includes(market.status) || !market.result) {
        console.log(`  ⏳ #${trade.id} ${trade.contract} — not resolved`);
        continue;
      }

      const kalshiResult = market.result.toLowerCase();
      const won = trade.side === kalshiResult;
      const payout = won ? trade.qty * 1.00 : 0;
      const pnl = Math.round((payout - trade.cost) * 100) / 100;

      if (trade.pnl !== pnl) {
        console.log(`  🔧 #${trade.id} ${trade.contract} ${trade.side}: pnl ${trade.pnl} → ${pnl} (kalshi=${kalshiResult}, expVal=${market.expiration_value})`);
        corrections++;
      } else {
        console.log(`  ✅ #${trade.id} ${trade.contract}: pnl ${pnl} (correct)`);
      }

      trade.settled = true;
      trade.pnl = pnl;
      trade.kalshiResult = kalshiResult;
      trade.settlementSource = 'kalshi_api';
      trade.settledAt = trade.settledAt || new Date().toISOString();
      if (market.expiration_value) {
        trade.kalshiExpirationValue = parseFloat(market.expiration_value);
      }

      newPayouts += payout;
    } catch (e) {
      console.error(`  ❌ #${trade.id} ${trade.contract}: ${e.message}`);
    }
  }

  // Recompute balance
  const newBalance = Math.round((initialBalance - sumCosts + newPayouts) * 100) / 100;
  console.log(`\n═══ Summary ═══`);
  console.log(`Corrections: ${corrections}`);
  console.log(`Old balance: $${ledger.balance}`);
  console.log(`New balance: $${newBalance}`);
  console.log(`New payouts total: $${newPayouts}`);

  ledger.balance = newBalance;
  ledger.resettledAt = new Date().toISOString();

  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`\nLedger saved.`);
}

main().catch(e => { console.error(e); process.exit(1); });
