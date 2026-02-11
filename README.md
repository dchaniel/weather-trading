# Kalshi Multi-Strategy Trading System

Algorithmic trading system for [Kalshi](https://kalshi.com) prediction markets. Exploits the gap between calibrated weather forecast accuracy and market-implied volatility, plus crypto momentum/volatility signals.

## Quick Start

```bash
node bin/kalshi.js --help          # Show all commands
node bin/kalshi.js iv              # Weather implied volatility analysis
node bin/kalshi.js recommend       # Trade recommendations with sizing
node bin/kalshi.js crypto          # Crypto strategy analysis
node bin/kalshi.js daily           # Daily multi-strategy briefing
node bin/kalshi.js perf            # Performance dashboard
```

## Key Commands

| Command | Description |
|---------|-------------|
| `iv` | Compare forecast σ vs market implied σ — find mispriced contracts |
| `recommend` | Score opportunities, run guards, size with quarter-Kelly |
| `crypto` | GARCH + momentum analysis for BTC/ETH prediction markets |
| `trade` | Execute trades, manage positions, settle contracts |
| `daily` | Morning briefing: balance, positions, weather + crypto outlook |
| `perf` | Win rate, P&L, Sharpe ratio, station breakdown |
| `calibrate` | Validate forecast accuracy against historical observations |
| `health` | System health: API connectivity, data integrity, balance |
| `data` | Collect IV history, snapshots, observations for analysis |

## Architecture

```
bin/kalshi.js          CLI entry point
commands/              Command handlers (iv, recommend, trade, crypto, daily, perf, ...)
lib/
  weather/             Forecast pipeline, station config, market matching, ensemble
  crypto/              GARCH modeling, momentum signals, order book analysis
  core/                Sizing (Kelly), guards, risk limits, trade execution, history
  kalshi/              API client, market parsing
  backtest/            Walk-forward backtesting engine, implied vol computation
data/                  Paper ledger, IV history, JSONL audit trail
```

## Strategy

**Weather**: NWS/GFS/ECMWF forecasts have sub-1°F MAE for key stations, while Kalshi markets price 3-4°F σ. We estimate probabilities using Student-t (ν=5) for fat tails, then trade when net edge exceeds transaction costs (4¢/contract).

**Crypto**: GARCH volatility modeling + momentum signals on BTC/ETH prediction markets. Requires ≥5% edge at executable prices.

**Risk Management**: Quarter-Kelly sizing, 9 independent pre-trade guards (σ gap, spread filter, climatological outlier, daily limits, correlation), $800 drawdown circuit breaker.

## Status

📊 **Paper trading** — $1,000 starting balance, 88.9% win rate (9 settled trades)

Not yet live. Accumulating data and validating edge persistence before real capital deployment.

## Settlement

Trades settle automatically via `kalshi data settle <date>`:
1. Fetches actual observed high temperature from NWS for the settlement station
2. Compares against contract threshold to determine win/loss
3. Updates paper ledger with P&L and marks trades as settled
4. Records observation data to `data/history/observations.jsonl`

Manual settlement: `kalshi trade settle <date>` with NWS cross-verification.

## Dependencies

Zero external dependencies. Pure Node.js (v22+).

## Configuration

- Kalshi API key: `~/.openclaw/workspace/skills/kalshi/kalshi_key.pem`
- Paper ledger: `~/.openclaw/workspace/skills/kalshi/paper_ledger.json`
- Set `LIVE_TRADING=1` to enable real order placement (use with caution)
