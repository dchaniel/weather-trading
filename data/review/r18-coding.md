# R18 Coding Changes

**Date**: 2026-02-10  
**Goal**: Close gaps from R17 reviews (Research 91, Product 90, Simplicity 90) → 95+

## Changes Made

### Research Fixes
1. **Bayesian σ updating** — Added `bayesianSigmaUpdate()` to stations.js. Uses Normal-Inverse-Gamma conjugate prior: posterior mean weighted between calibration prior (N=30) and running observations. `getEffectiveSigma()` now applies this when `runningMAE`/`runningN` data available.

2. **Data freshness detection** — Added `checkDataFreshness()` to forecast.js. NWS responses checked for `updateTime`/`generatedAt`. Stale data (>12h) generates warnings propagated through consensus.

3. **GARCH parameter estimation** — Replaced hardcoded α=0.05, β=0.90 with method-of-moments estimation from autocorrelation of squared residuals (Bollerslev 1986 approximation). Falls back to conservative defaults for N<50.

4. **Proportional risk limits** — `risk.js` now uses `getEffectiveRiskLimits(balance)`: drawdown floor = 20% from peak (not fixed $800), daily loss = 5% of bankroll (not fixed $50). Scales properly as account grows/shrinks.

### Product Fixes
1. **Sharpe & Sortino ratios** — Added to `perf` output with N≥2 threshold (was 10). Includes downside deviation for Sortino. Labels as "preliminary" when N<30.

2. **Duplicate import in perf.js** — Merged `table` import into single statement.

### Simplicity Fixes
1. **Removed iv-history.json legacy** — Deleted `HISTORY_PATH` const, `loadHistory()`, `saveHistory()`, legacy JSON write in `collectCmd`, and display line. Removed unused `readFileSync`, `existsSync`, `mkdirSync`, `join`, `dirname`, `fileURLToPath` imports. Net -30 lines from data.js.

2. **KMDW `enabled: false`** — Added explicit `enabled: false` to KMDW config in stations.js. Self-documenting: code and config agree it's disabled without cross-referencing AGENTS.md/guard.js.

3. **Merged duplicate import in trade.js** — Combined `{table, today}` and `{signed}` from utils.js into single import.

4. **Crypto maturity labels** — Added `Strategy maturity: PAPER-ONLY — pending live validation` to all 3 crypto files (strategy.js, forecast.js, backtest.js).

## Verification
- `node bin/kalshi.js health` — 100% (6/6)
- `node bin/kalshi.js perf` — Sharpe/Sortino displaying correctly
- `node bin/kalshi.js iv` — Working, freshness checks active
- `node bin/kalshi.js recommend` — Guards and risk limits working with proportional limits
- `node bin/kalshi.js data --help` — No legacy references
- Total lines: 6724 (was 6682, net +42 for significant feature additions)

### Additional Fixes (post-initial review)
5. **Removed all duplicate imports** — Also fixed crypto/strategy.js (positionSize+TRANSACTION_COST) and crypto/backtest.js (round2+sleep). Zero duplicates remain.
6. **Removed KMDW dead code from guard.js** — Correlation map entries for disabled station removed.
7. **Added settlement docs to README** — Full settlement workflow documented.
8. **Crontab examples in health output** — Ready-to-use cron entries with `--silent` flag.
