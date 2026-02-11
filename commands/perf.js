/**
 * kalshi perf — Consolidated performance command with subcommands
 * 
 * kalshi perf               - Paper trading performance tracker (default)
 * kalshi perf track         - Same as default  
 * kalshi perf backtest <start> <end> [station] - Run forecast backtest
 */

import { getLedger } from '../lib/core/trade.js';
import { signed, round2, dateRange, table } from '../lib/core/utils.js';
import { STATIONS, resolveStation } from '../lib/weather/stations.js';
import { fetchHistoricalActuals, simulateForecast } from '../lib/weather/historical.js';
import { writeFileSync, mkdirSync } from 'fs';

export default async function(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'track' || subcommand === 'help') {
    if (subcommand === 'help') {
      showHelp();
      return;
    }
    return trackCmd();
  }

  switch (subcommand) {
    case 'backtest':
      return backtestCmd(args.slice(1));
    default:
      console.error(`Unknown perf command: ${subcommand}`);
      showHelp();
      process.exit(1);
  }
}

async function trackCmd(args) {
  const ledger = getLedger();
  const settled = ledger.trades.filter(t => t.settled && t.pnl != null && !t.duplicate);
  const open = ledger.trades.filter(t => !t.settled && !t.duplicate);

  console.log('\n📈 Paper Trading Performance Tracker');
  console.log('═'.repeat(60));

  if (settled.length === 0 && open.length === 0) {
    console.log('\n  No trades recorded yet.\n');
    return;
  }

  // ── Summary ──
  const totalPnL = settled.reduce((s, t) => s + t.pnl, 0);
  const wins = settled.filter(t => t.pnl > 0);
  const losses = settled.filter(t => t.pnl <= 0);
  const winRate = settled.length > 0 ? (wins.length / settled.length * 100) : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  console.log(`\n  Balance:     $${ledger.balance.toFixed(2)}`);
  console.log(`  Total P&L:   ${signed(totalPnL)}$ (${signed(totalPnL / 10, 1)}%)`);
  console.log(`  Settled:     ${settled.length} trades`);
  console.log(`  Open:        ${open.length} trades`);
  console.log(`  Win Rate:    ${winRate.toFixed(1)}% (${wins.length}W / ${losses.length}L)`);
  console.log(`  Avg Win:     ${signed(avgWin)}$`);
  console.log(`  Avg Loss:    ${signed(avgLoss)}$`);

  // ── Drawdown ──
  let peak = 1000;
  let maxDD = 0;
  let running = 1000;
  for (const t of settled) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  console.log(`  Max Drawdown: ${maxDD.toFixed(1)}%`);

  // ── Performance by Station ──
  if (settled.length > 0) {
    console.log(`\n  Performance by Station:`);
    const byStation = {};
    for (const t of settled) {
      const st = (t.contract || t.ticker || '').slice(0, 4);
      if (!byStation[st]) byStation[st] = { trades: 0, pnl: 0 };
      byStation[st].trades++;
      byStation[st].pnl += t.pnl;
    }
    for (const [st, data] of Object.entries(byStation)) {
      const avgPnL = data.pnl / data.trades;
      console.log(`    ${st}: ${signed(data.pnl, 2)}$ (${data.trades} trades, ${signed(avgPnL, 2)}$ avg)`);
    }
  }

  // ── Recent Trades ──
  if (settled.length > 0) {
    console.log(`\n  Recent Settled Trades:`);
    const recent = settled.slice(-5);
    for (const t of recent) {
      const result = t.pnl > 0 ? '✅' : '❌';
      console.log(`    ${result} ${(t.timestamp || t.date || '').slice(0, 10)} ${t.side.toUpperCase()} ${t.qty}x ${t.contract || t.ticker} — ${signed(t.pnl, 2)}$`);
    }
  }

  // ── Open Positions (grouped by contract) ──
  if (open.length > 0) {
    console.log(`\n  Open Positions:`);
    // Group by contract+side+date to collapse duplicates
    const grouped = new Map();
    for (const t of open) {
      const key = `${(t.timestamp || t.date || '').slice(0, 10)}|${t.side}|${t.contract || t.ticker}`;
      if (!grouped.has(key)) {
        grouped.set(key, { ...t, count: 1, totalQty: t.qty });
      } else {
        const g = grouped.get(key);
        g.count++;
        g.totalQty += t.qty;
      }
    }
    for (const [, g] of grouped) {
      const countLabel = g.count > 1 ? ` (${g.count} trades)` : '';
      console.log(`    ⏳ ${(g.timestamp || g.date || '').slice(0, 10)} ${g.side.toUpperCase()} ${g.totalQty}x ${g.contract || g.ticker} @ $${(g.price ?? g.entryPrice ?? 0).toFixed(2)}${countLabel}`);
      console.log(`       Expected: ${signed((g.pEst || g.probWin || 0.5) * 100, 1)}% win prob, ${signed((g.expectedEdge || g.expectedValue || 0) * g.totalQty, 2)}$ EV`);
    }
  }

  // ── Strategy Performance ──
  if (settled.length > 0) {
    console.log(`\n  Strategy Breakdown:`);
    const byStrategy = {};
    for (const t of settled) {
      const strategy = t.strategy || 'Weather';
      if (!byStrategy[strategy]) byStrategy[strategy] = { trades: 0, pnl: 0, wins: 0 };
      byStrategy[strategy].trades++;
      byStrategy[strategy].pnl += t.pnl;
      if (t.pnl > 0) byStrategy[strategy].wins++;
    }
    for (const [strategy, data] of Object.entries(byStrategy)) {
      const winRate = (data.wins / data.trades * 100).toFixed(1);
      console.log(`    ${strategy}: ${signed(data.pnl, 2)}$ (${data.trades} trades, ${winRate}% win rate)`);
    }
  }

  // ── Forecast Accuracy (if we have settled high temp contracts) ──
  const tempTrades = settled.filter(t => (t.contract || t.ticker || '').includes('HIGH') && (t.actualHigh ?? t.actualOutcome) != null && t.forecastHigh != null);
  if (tempTrades.length > 0) {
    console.log(`\n  Temperature Forecast Quality:`);
    let totalAbsError = 0;
    let totalBias = 0;
    
    for (const t of tempTrades) {
      const actual = t.actualHigh ?? t.actualOutcome;
      const error = t.forecastHigh - actual;
      totalAbsError += Math.abs(error);
      totalBias += error;
    }
    
    const mae = tempTrades.length > 0 ? (totalAbsError / tempTrades.length).toFixed(2) : 'N/A';
    const bias = tempTrades.length > 0 ? (totalBias / tempTrades.length).toFixed(2) : 'N/A';
    console.log(`    MAE: ${mae === 'N/A' ? 'N/A' : mae + '°F'} (n=${tempTrades.length})`);
    console.log(`    Bias: ${bias === 'N/A' ? 'N/A' : signed(parseFloat(bias)) + '°F'}`);
  }

  // ── Risk-Adjusted Metrics ──
  if (settled.length >= 2) {
    const returns = settled.map(t => t.pnl);
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (avgReturn / stdDev).toFixed(2) : 'N/A';

    // Sortino: downside deviation only (returns < 0)
    const downsideVar = returns.reduce((s, r) => s + (r < 0 ? r ** 2 : 0), 0) / returns.length;
    const downsideDev = Math.sqrt(downsideVar);
    const sortino = downsideDev > 0 ? (avgReturn / downsideDev).toFixed(2) : 'N/A';

    console.log(`\n  Risk-Adjusted Metrics${settled.length < 30 ? ` (n=${settled.length}, preliminary)` : ''}:`);
    console.log(`    Sharpe:  ${sharpe}`);
    console.log(`    Sortino: ${sortino}`);
  }

  console.log();
}

async function backtestCmd(args) {
  const startDate = args[0];
  const endDate = args[1];
  if (!startDate || !endDate) {
    console.log('Usage: kalshi perf backtest <start-date> <end-date> [station]');
    process.exit(1);
  }

  const station = resolveStation(args[2]) || 'KNYC';
  console.log(`\n📊 Backtest — ${station} — ${startDate} to ${endDate}`);
  console.log('═'.repeat(60));

  console.log('  Fetching historical data...');
  const actuals = await fetchHistoricalActuals(station, startDate, endDate);
  console.log(`  Got ${actuals.size} days of data\n`);

  const days = [];
  let totalError = 0, totalAbsError = 0, hits = 0;

  for (const date of dateRange(startDate, endDate)) {
    const actual = actuals.get(date);
    if (!actual) continue;

    const month = parseInt(date.slice(5, 7));
    const sim = simulateForecast(actual.high_f, station, month);

    const error = sim.adjustedMean - actual.high_f;
    totalError += error;
    totalAbsError += Math.abs(error);
    if (Math.abs(error) <= 2) hits++;

    days.push({
      date,
      actual: actual.high_f,
      forecast: sim.adjustedMean,
      error: Math.round(error * 10) / 10,
      spread: sim.spread,
    });
  }

  const n = days.length;
  const mae = (totalAbsError / n).toFixed(2);
  const bias = (totalError / n).toFixed(2);
  const hitRate = (hits / n * 100).toFixed(1);

  const show = days.length > 20 ? days.slice(-20) : days;
  if (days.length > 20) console.log(`  (showing last 20 of ${days.length} days)\n`);

  console.log(table(show, [
    { label: 'Date', key: 'date', width: 12 },
    { label: 'Actual', width: 8, align: 'right', fn: r => r.actual + '°F' },
    { label: 'Fcst', width: 8, align: 'right', fn: r => r.forecast + '°F' },
    { label: 'Error', width: 8, align: 'right', fn: r => signed(r.error) + '°F' },
    { label: 'Spread', width: 8, align: 'right', fn: r => r.spread + '°F' },
  ]));

  console.log(`\n  Summary (${n} days):`);
  console.log(`    MAE:      ${mae}°F`);
  console.log(`    Bias:     ${signed(parseFloat(bias))}°F`);
  console.log(`    Hit ≤2°F: ${hitRate}%`);
  console.log();

  const outDir = new URL('../data/backtests/', import.meta.url).pathname;
  mkdirSync(outDir, { recursive: true });
  const result = { station, startDate, endDate, days, stats: { mae: parseFloat(mae), bias: parseFloat(bias), hitRate: parseFloat(hitRate), n } };
  const outFile = `${outDir}${station}-${startDate}-to-${endDate}.json`;
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`  💾 Saved to data/backtests/${station}-${startDate}-to-${endDate}.json`);
}

function showHelp() {
  console.log(`
kalshi perf — Unified performance analysis

Commands:
  kalshi perf                               Paper trading performance tracker
  kalshi perf track                         Paper trading performance tracker  
  kalshi perf backtest <start> <end> [station] — Weather strategy backtesting

Examples:
  kalshi perf                               Show current performance
  kalshi perf track                         Show current performance
  kalshi perf backtest 2026-01-01 2026-01-31 KNYC — Backtest KNYC for January
`);
}