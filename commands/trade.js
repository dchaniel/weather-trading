/**
 * kalshi trade — Consolidated trading command with subcommands
 * 
 * kalshi trade <station> <contract> <side> <qty> [options]   - Execute trade
 * kalshi trade approve <trade-id>                            - Approve pending trade  
 * kalshi trade reject <trade-id>                             - Reject pending trade
 * kalshi trade positions                                     - Show positions & P&L
 */

import { resolveStation, TRADEABLE_STATIONS, STATIONS } from '../lib/weather/stations.js';
import { executeTrade, getLedger, getOpenPositions, getTotalPnL, settleDate } from '../lib/core/trade.js';
import { fetchObservation } from '../lib/weather/observe.js';
import { table, today, signed } from '../lib/core/utils.js';
import { checkRiskLimits } from '../lib/core/risk.js';
import { executeSettlement } from '../lib/core/settlement.js';
import { runGuards } from '../lib/core/guard.js';
import { findById, updateStatus, getPending, getAll } from '../lib/core/pending.js';
import { execute } from '../lib/core/executor.js';
import * as kalshi from '../lib/kalshi/client.js';
import { appendTrade, appendObservation } from '../lib/core/history.js';

export default async function(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHelp();
    return;
  }

  // Handle subcommands
  if (subcommand === 'approve') {
    return approveCmd(args.slice(1));
  }
  if (subcommand === 'reject') {
    return rejectCmd(args.slice(1));
  }
  if (subcommand === 'positions') {
    return positionsCmd(args.slice(1));
  }
  if (subcommand === 'ledger' || subcommand === 'list') {
    return ledgerCmd(args.slice(1));
  }
  if (subcommand === 'risk') {
    return riskCmd(args.slice(1));
  }
  if (subcommand === 'settle') {
    return settleCmd(args.slice(1));
  }

  // Default: execute trade
  return executeTradeCmd(args);
}

async function executeTradeCmd(args) {
  const station = resolveStation(args[0]);
  const contract = args[1];
  const side = args[2];
  const qty = parseInt(args[3]);
  const priceIdx = args.indexOf('--price');
  const price = priceIdx >= 0 ? parseFloat(args[priceIdx + 1]) : 0.50;

  // Parse optional guard data from flags
  const sigmaIdx = args.indexOf('--market-sigma');
  const marketSigma = sigmaIdx >= 0 ? parseFloat(args[sigmaIdx + 1]) : null;
  const spreadIdx = args.indexOf('--spread');
  const forecastSpread = spreadIdx >= 0 ? parseFloat(args[spreadIdx + 1]) : null;
  const fcIdx = args.indexOf('--forecast-high');
  const forecastHigh = fcIdx >= 0 ? parseFloat(args[fcIdx + 1]) : null;

  if (!station || !contract || !side || !qty) {
    console.log('Usage: kalshi trade <station> <contract> <yes|no> <qty> [--price X] [--market-sigma X] [--spread X] [--forecast-high X]');
    console.log('\n  All guards are enforced. You must provide --market-sigma (from `kalshi iv`).');
    console.log('  Use `kalshi recommend` for automated guard-checked recommendations.\n');
    process.exit(1);
  }

  // ── HARD GUARD CHECK — all rules enforced, no overrides ──
  const guardResult = runGuards({
    station,
    qty,
    forecastSpread,
    marketSigma,
    forecastHigh,
    date: today(),
  });

  if (!guardResult.pass) {
    console.log(`\n🚫 Trade BLOCKED by pre-trade guards:`);
    for (const r of guardResult.reasons) console.log(`   ✗ ${r}`);
    console.log(`\n   All guards must pass. No overrides.\n`);
    process.exit(1);
  }

  // Additional risk limits
  const riskCheck = checkRiskLimits(station, qty * price);
  if (!riskCheck.allowed) {
    console.log(`\n🚫 Trade blocked by risk limits:`);
    for (const r of riskCheck.violations) console.log(`   ✗ ${r}`);
    console.log();
    process.exit(1);
  }

  // GUARD DETAILS for transparency
  console.log(`\n🛡️  Pre-trade guard summary:`);
  console.log(`   ✓ Station ${station} in whitelist: ${TRADEABLE_STATIONS.includes(station)}`);
  if (forecastSpread !== null) console.log(`   ✓ Model spread: ${forecastSpread.toFixed(1)}°F ≤ 3°F`);
  if (marketSigma !== null) console.log(`   ✓ Market σ gap: ${(marketSigma - 1.5).toFixed(1)}°F ≥ 0°F`);
  console.log(`   ✓ Daily trade limit: OK`);
  console.log(`   ✓ Position sizing: ${qty} contracts within limits`);
  console.log(`   ✓ Risk limits: All checks passed`);

  // Execute trade
  try {
    const result = await executeTrade(station, contract, side, qty, price);
    if (result.dryRun) {
      console.log(`\n📝 DRY RUN: ${side.toUpperCase()} ${qty}x ${contract} @ $${price.toFixed(2)}`);
      console.log(`   Expected P&L: $${(result.expectedValue * qty).toFixed(2)} | Edge: ${(result.edge * 100).toFixed(1)}%`);
      console.log(`\n   Set LIVE_TRADING=1 to place real orders\n`);
    } else {
      console.log(`\n✅ ORDER PLACED: ${side.toUpperCase()} ${qty}x ${contract} @ $${price.toFixed(2)}`);
      console.log(`   Expected P&L: $${(result.expectedValue * qty).toFixed(2)} | Edge: ${(result.edge * 100).toFixed(1)}%\n`);
      
      // Log trade to history
      try {
        appendTrade({
          date: today(),
          station: station,
          contract: contract,
          side: side,
          qty: qty,
          price: price,
          expectedEdge: result.edge || 0,
          marketSigma: marketSigma,
          ourSigma: null, // Could be calculated here if needed
        });
      } catch (historyError) {
        console.error(`Warning: Failed to log trade to history: ${historyError.message}`);
      }
    }
  } catch (e) {
    console.error(`\n❌ Trade execution failed: ${e.message}\n`);
    process.exit(1);
  }
}

async function approveCmd(args) {
  const tradeId = args[0];

  if (!tradeId || tradeId === '--list') {
    return listPending();
  }

  const rec = findById(tradeId);
  if (!rec) {
    console.error(`❌ Trade ${tradeId} not found`);
    process.exit(1);
  }
  if (rec.status !== 'pending') {
    console.error(`❌ Trade ${tradeId} is already ${rec.status}`);
    process.exit(1);
  }

  // Approve it
  updateStatus(tradeId, 'approved');
  console.log(`✅ Approved: ${rec.side.toUpperCase()} ${rec.qty}x ${rec.contract} @ $${rec.price.toFixed(2)}`);

  // Execute it
  try {
    const result = await execute(tradeId);
    if (result.dryRun) {
      console.log(`\n⚠️  DRY RUN mode — set LIVE_TRADING=1 to place real orders`);
    } else {
      console.log(`\n🎉 Order placed successfully!`);
    }
  } catch (e) {
    console.error(`\n❌ Execution failed: ${e.message}`);
  }
}

async function rejectCmd(args) {
  const tradeId = args[0];
  if (!tradeId) {
    console.error('Usage: kalshi trade reject <trade-id>');
    process.exit(1);
  }

  const rec = findById(tradeId);
  if (!rec) {
    console.error(`❌ Trade ${tradeId} not found`);
    process.exit(1);
  }

  updateStatus(tradeId, 'rejected');
  console.log(`❌ Rejected: ${rec.side.toUpperCase()} ${rec.qty}x ${rec.contract}`);
}

async function positionsCmd(args) {
  console.log('\n📊 Open Positions');
  console.log('═'.repeat(60));

  // 1. Check Kalshi portfolio positions
  try {
    const posData = await kalshi.getPositions();
    const positions = posData.market_positions || posData.positions || [];

    if (positions.length === 0) {
      console.log('\n  No open positions on Kalshi.');
    } else {
      console.log(`\n  Kalshi Portfolio (${positions.length} positions):`);
      console.log('  ' + '─'.repeat(56));

      for (const pos of positions) {
        const ticker = pos.ticker || pos.market_ticker;
        let currentPrice = null;
        let closeTime = null;

        try {
          const mkt = await kalshi.getMarket(ticker);
          currentPrice = (mkt.yes_bid + mkt.yes_ask) / 200; // cents to decimal midpoint
          closeTime = mkt.close_time;
        } catch (e) { /* skip price fetch errors */ }

        const qty = pos.total_traded || pos.position || 0;
        const side = (pos.position > 0 || pos.total_traded > 0) ? 'YES' : 'NO';
        const avgPrice = pos.average_price ? pos.average_price / 100 : null;

        let line = `  ${side} ${Math.abs(qty)}x ${ticker}`;
        if (avgPrice != null) line += ` @ $${avgPrice.toFixed(2)}`;
        console.log(line);

        if (currentPrice != null && avgPrice != null) {
          const unrealizedPnl = (currentPrice - avgPrice) * Math.abs(qty);
          console.log(`    Current: $${currentPrice.toFixed(2)}  Unrealized P&L: ${signed(unrealizedPnl, 2)}`);

          // Suggest exit if moved favorably
          if (unrealizedPnl > 0 && currentPrice > 0.85) {
            console.log(`    💡 Consider taking profit — price near ceiling`);
          }
        }

        if (closeTime) {
          const hoursLeft = (new Date(closeTime) - Date.now()) / 3600000;
          if (hoursLeft > 0) {
            console.log(`    ⏰ Expires in ${hoursLeft < 1 ? Math.round(hoursLeft * 60) + 'm' : Math.round(hoursLeft) + 'h'}`);
          }
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠ Could not fetch Kalshi positions: ${e.message}`);
  }

  // 2. Show balance
  try {
    const bal = await kalshi.getBalance();
    const dollars = (bal.balance || 0) / 100;
    console.log(`\n  💰 Kalshi Balance: $${dollars.toFixed(2)}`);
  } catch (e) {
    console.log(`  ⚠ Could not fetch balance: ${e.message}`);
  }

  // 3. Show recent executed/pending from our system
  const all = getAll();
  const recent = all.filter(t => ['executed', 'pending'].includes(t.status)).slice(-10);
  if (recent.length) {
    console.log(`\n  📋 Recent Recommendations:`);
    for (const t of recent) {
      const icon = t.status === 'executed' ? '✅' : t.status === 'pending' ? '⏳' : '·';
      console.log(`  ${icon} [${t.id}] ${t.side.toUpperCase()} ${t.qty}x ${t.contract} — ${t.status}`);
    }
  }

  console.log();
}

function listPending() {
  const pending = getPending();
  if (!pending.length) {
    console.log('No pending trade recommendations.');
    return;
  }
  console.log(`\n📋 Pending Trades (${pending.length}):`);
  console.log('─'.repeat(60));
  for (const t of pending) {
    const expires = Math.round((new Date(t.expiresAt) - Date.now()) / 60000);
    console.log(`  [${t.id}] ${t.side.toUpperCase()} ${t.qty}x ${t.contract} @ $${t.price.toFixed(2)}`);
    console.log(`         Edge: ${signed(t.edge * 100, 1)}%  Strategy: ${t.strategy}  Expires: ${expires}m`);
    if (t.reasoning) console.log(`         ${t.reasoning}`);
  }
}

function showHelp() {
  console.log(`
kalshi trade — Unified trade management

Commands:
  kalshi trade <station> <contract> <yes|no> <qty> [--price X]   Execute trade
  kalshi trade approve <id>                                      Approve pending recommendation  
  kalshi trade reject <id>                                       Reject pending recommendation
  kalshi trade positions                                         Show open positions & P&L
  kalshi trade ledger                                            Show paper trading ledger
  kalshi trade risk                                              Show risk status
  kalshi trade settle <date>                                     Settle positions for date

Examples:
  kalshi trade KNYC KXHIGHNY-26-FEB-09-68 yes 10 --price 0.65   Execute trade
  kalshi trade approve T123                                      Approve trade T123
  kalshi trade positions                                         Show all positions
  kalshi trade settle 2026-02-08                               Settle for date
`);
}

// Export functions for backwards compatibility with existing CLI structure
export async function tradeCmd(args) {
  return executeTradeCmd(args);
}

export async function ledgerCmd() {
  // This was just calling trade.js functions - now consolidate here
  const ledger = getLedger();
  const trades = ledger.trades || [];
  console.log('\n💰 Trading Ledger');
  console.log('═'.repeat(50));
  
  if (trades.length === 0) {
    console.log('  No trades yet.\n');
    return;
  }

  let totalPnl = 0;
  const validTrades = trades.filter(t => !t.duplicate);
  if (validTrades.length < trades.length) {
    console.log(`  (${trades.length - validTrades.length} duplicate trades from guard bypass hidden)\n`);
  }
  for (const entry of validTrades) {
    const tradeDate = entry.timestamp ? entry.timestamp.slice(0, 10) : 'Unknown';
    console.log(`  ${tradeDate} ${entry.side.toUpperCase()} ${entry.qty}x ${entry.contract}`);
    console.log(`    Entry: $${entry.price?.toFixed(2) || 'N/A'}  Exit: $${entry.exitPrice?.toFixed(2) || 'Open'}`);
    if (entry.pnl) {
      console.log(`    P&L: ${signed(entry.pnl, 2)}`);
      totalPnl += entry.pnl;
    }
    console.log();
  }
  
  console.log(`  Total P&L: ${signed(totalPnl, 2)}\n`);
}

export async function settleCmd(args) {
  const date = args[0] || today();
  console.log(`\n📊 Settlement Report — ${date}`);
  console.log('═'.repeat(50));
  
  try {
    const result = await executeSettlement(date);
    
    if (result.error) {
      console.log(`\n  ❌ ${result.error}`);
      console.log();
      return;
    }
    
    if (!result.results || result.results.length === 0) {
      console.log(`\n  No trades to settle for ${date}.\n`);
      return;
    }
    
    console.log(`\n  Settled ${result.results.length} trade(s):`);
    
    let totalPnl = 0;
    for (const trade of result.results) {
      const outcome = trade.won ? '✅ WON' : '❌ LOST';
      console.log(`\n    ${trade.station}: ${trade.side.toUpperCase()} ${trade.qty}x ${trade.contract}`);
      console.log(`      Actual High: ${trade.actualHigh}°F (threshold: ${trade.threshold}°F)`);
      console.log(`      ${outcome} — P&L: ${signed(trade.pnl, 2)}`);
      totalPnl += trade.pnl;
      
      // Log observation to history
      try {
        if (trade.forecastHigh) {
          const forecastError = trade.actualHigh - trade.forecastHigh;
          appendObservation(trade.station, trade.actualHigh, forecastError);
        }
      } catch (historyError) {
        console.error(`Warning: Failed to log observation for ${trade.station}: ${historyError.message}`);
      }
    }
    
    if (totalPnl !== 0) {
      console.log(`\n  Total P&L Impact: ${signed(totalPnl, 2)}`);
    }
    
  } catch (e) {
    console.log(`\n  ❌ Settlement failed: ${e.message}`);
  }
  console.log();
}

export async function riskCmd() {
  // Import getRiskStatus instead of checkRiskLimits
  const { getRiskStatus } = await import('../lib/core/risk.js');
  const risk = getRiskStatus();
  
  console.log('\n⚠️ Risk Dashboard');
  console.log('═'.repeat(40));
  console.log(`  Portfolio Value: $${risk.balance.toFixed(2)}`);
  console.log(`  Total P&L: ${signed(risk.totalPnL, 2)}`);
  console.log(`  Daily P&L: ${signed(risk.dailyPnL, 2)}`);
  console.log(`  Open Positions: ${risk.openPositions} / ${risk.maxOpenPositions}`);
  console.log(`  Peak Bankroll: $${risk.peakBankroll.toFixed(2)}`);
  console.log(`  Drawdown: ${risk.drawdown}%`);
  console.log(`  Trading Status: ${risk.tradingAllowed ? '✅ ACTIVE' : '🚫 BLOCKED'}`);
  
  if (risk.violations.length > 0) {
    console.log(`\n  ⚠️ Active Risk Violations:`);
    for (const violation of risk.violations) {
      console.log(`    ✗ ${violation}`);
    }
  }
  
  console.log();
}