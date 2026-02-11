#!/usr/bin/env node
/**
 * kalshi — Kalshi Multi-Strategy Trading CLI
 * Algorithmic trading across Kalshi prediction markets: weather, crypto, and more.
 */

const [,, command, ...args] = process.argv;

const COMMANDS = {
  // ── Core Strategy Commands ──
  iv:         () => import('../commands/implied_vol.js').then(m => m.default(args)),
  recommend:  () => import('../commands/recommend.js').then(m => m.default(args)),
  daily:      () => import('../commands/daily.js').then(m => m.default(args)),
  crypto:     () => import('../commands/crypto.js').then(m => m.default(args)),
  precip:     () => import('../commands/precip.js').then(m => m.default(args)),
  gas:        () => import('../commands/gas.js').then(m => m.default(args)),
  flights:    () => import('../commands/flights.js').then(m => m.default(args)),
  calibrate:  () => import('../commands/calibrate.js').then(m => m.default(args)),
  health:     () => import('../commands/health.js').then(m => m.default(args)),

  // ── Unified Command Groups ──
  trade:      () => import('../commands/trade.js').then(m => m.default(args)),
  data:       () => import('../commands/data.js').then(m => m.default(args)),
  perf:       () => import('../commands/perf.js').then(m => m.default(args)),

  // ── Config ──
  config:     () => import('../commands/config.js').then(m => m.default(args)),

  // ── Legacy Aliases (for backward compatibility) ──
  'implied-vol': () => import('../commands/implied_vol.js').then(m => m.default(args)),
  'crypto-backtest': () => import('../lib/crypto/backtest.js').then(m => m.runCryptoBacktest(30)),
};

if (!command || command === 'help' || command === '--help') {
  console.log(`
kalshi — Kalshi Multi-Strategy Trading CLI

━━━ Core Strategy Commands ━━━
  iv            [date] [station] [-v]         Weather implied volatility analysis ⭐
  recommend     [date]                        AI trade recommendations (all strategies) ⭐  
  daily         [date] [--json]               Daily briefing (weather + crypto + risk) ⭐
  crypto                                      Crypto market analysis & signals ⭐
  gas                                         Gas price analysis & signals ⭐
  flights     [date] [--faa] [--detail]       O'Hare flight delay strategy ✈️
  precip        [subcommand]                  Precipitation (rain/snow) market analysis 🌧️
  calibrate     [days] [station]              Weather forecast accuracy stats
  health        [-v]                          System health diagnostics

━━━ Unified Trading Operations ━━━
  trade         <subcommand>                  Trade management hub
    • trade <station> <contract> <yes|no> <qty> [--price X] — Execute trade
    • trade approve <id>                      — Approve pending recommendation
    • trade reject <id>                       — Reject pending recommendation  
    • trade positions                         — Show open positions & P&L
    • trade ledger                            — Show paper trading ledger
    • trade risk                              — Show risk status
    • trade settle <date>                     — Settle positions for date

  data          <subcommand>                  Data management hub
    • data collect [--silent]                — Collect IV snapshot (for cron)
    • data snapshot [--silent]               — Full data snapshot to JSONL files
    • data history [options]                 — Query historical data
    • data observe [station] [date]           — Fetch actual weather observations
    • data settle <date>                     — Auto-settlement with verification

  perf          <subcommand>                  Performance analysis hub
    • perf                                    — Paper trading performance tracker
    • perf track                              — Paper trading performance tracker  
    • perf backtest <start> <end> [station]   — Weather strategy backtesting

━━━ Quick Examples ━━━
  kalshi iv                                   Check volatility gaps (key command!) 
  kalshi recommend                            Get trade recommendations
  kalshi trade positions                      Show all positions
  kalshi data collect                         Collect current IV data
  kalshi perf                                 Show performance stats

━━━ Supported Markets ━━━
  Weather Stations: KNYC (NYC), KMIA (Miami), KDEN (Denver) — KMDW excluded (high error)
  Crypto Assets:    BTC, ETH
  Gas Prices:       US weekly & monthly (KXAAAGASW, KXAAAGASM)

Run 'kalshi <command> help' for detailed subcommand options.
  `);
  process.exit(0);
}

if (!COMMANDS[command]) {
  console.error(`Unknown command: ${command}\nRun 'kalshi help' for usage.`);
  process.exit(1);
}

COMMANDS[command]().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});