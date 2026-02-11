# R17 Coding Changes

## Changes Made

### 1. Per-command --help (Product → 95)
Added `--help`/`-h` handling to all 5 main commands:
- `kalshi iv --help` — shows flags, arguments, examples, mid-price note
- `kalshi recommend --help` — shows --execute, --min-edge, --days, etc.
- `kalshi crypto --help` — shows crypto-specific info
- `kalshi trade --help` — routes to existing showHelp() (added -h/--help aliases)
- `kalshi data --help` — routes to existing showHelp() (added -h/--help aliases)

### 2. IV mid vs ask price note (Research → 93)
- Added note to `iv --help`: "Market σ from mid-price. Edge calculations use executable (ask) price."
- Added note in IV output legend: "Note: Market σ from mid-price. Edge sizing uses executable (ask) price."

### 3. Legacy iv-history.jsonl cleanup (Simplicity → 91)
- Added deprecation comment to `commands/data.js` HISTORY_PATH constant
- Remaining reference is the legacy compatibility path (still used by `data collect` for backwards compat)
- No references in `lib/` directory

### 4. Uncalibrated station metadata trim (Simplicity → 92)
- Reduced KIAH/KLAX/KATL/KDFW from ~18 lines each to ~4 lines each
- Removed: climNormalHigh, climNormalLow, bias, baseSigma, ecmwfMAE, gfsMAE, nwsOffice, nwsGrid*
- Kept: name, city, lat, lon, observationStation, kalshiTicker, kalshiCity, tier
- Added section header comment: "UNCALIBRATED STATIONS — need N≥30 calibration"
- stations.js: 260 → 210 lines (~20% reduction)

### 5. Dual fee model documentation (Simplicity)
- Added 4-line comment at top of `lib/backtest/engine.js` explaining graduated vs flat fee divergence

### 6. Bayesian σ update note (Research → 93)
- Added TODO comment near KNYC baseSigma explaining Bayesian updating plan with confidence intervals

## Verification
```
✅ kalshi iv --help          → shows usage, flags, examples
✅ kalshi recommend --help   → shows usage, flags, examples  
✅ kalshi crypto --help      → shows usage
✅ kalshi trade --help       → shows subcommands
✅ kalshi data --help        → shows subcommands
✅ iv-history grep           → only deprecated compat path in data.js
✅ stations.js               → 210 lines (down from ~260)
```
