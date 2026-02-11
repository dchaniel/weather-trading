# R13 Simplicity Review — 2026-02-10

**Reviewer**: Fresh subagent, no prior context  
**Codebase**: 6,714 lines across 37 JS files, zero dependencies  
**Time to understand**: ~25 minutes (passes 30-min cognitive load test)

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Code Simplicity | 14/20 | Some long functions; commands/data.js (499L) and commands/trade.js (419L) do too much |
| Feature Necessity | 16/20 | Everything earns its keep; crypto kept by owner choice (962L) |
| DRY Compliance | 13/20 | One clear violation; some near-duplication in display code |
| Cognitive Load | 16/20 | Clean module boundaries; CLI → command → lib layering is intuitive |
| Maintainability | 17/20 | Well-structured directories; easy to find things; good separation of concerns |

**Total: 76/100** — Solid for a solo trading system. Main issues are DRY and a few oversized commands.

## Critical Findings

### 1. DRY Violation: Duplicated Historical Fetch (HIGH)

`commands/calibrate.js:17` defines `fetchHistoricalObservations()` which hits the same Open-Meteo archive API as `lib/weather/historical.js:fetchHistoricalActuals()`. This is copy-paste duplication.

**Fix**: Delete the local function in calibrate.js, import from `lib/weather/historical.js`.

### 2. Oversized Command Files (MEDIUM)

| File | Lines | Issue |
|------|-------|-------|
| commands/data.js | 499 | 5 subcommands + `snapshotCmd` at 90 lines doing forecast+market+guard logic |
| commands/trade.js | 419 | 6 subcommands including full positions display with Kalshi API calls |
| commands/calibrate.js | 339 | Mixes data fetching, statistics, seasonal analysis, display |
| commands/daily.js | 317 | Telegram formatting + full briefing logic in one file |
| commands/implied_vol.js | 310 | Good content but the display section (GO/NO-GO matrix) is 80+ lines of formatting |

The `recommend.js` split (624→298) was a good move. `data.js` and `trade.js` deserve the same treatment.

### 3. `data.js` snapshotCmd is Doing Too Much (MEDIUM)

`snapshotCmd()` (lines ~200-310) reimplements forecast→market→IV→guard logic that already exists in `recommend.js` / `matcher.js`. It should call the shared functions rather than inline the pipeline.

### 4. Backtest Engine Complexity (LOW)

`lib/backtest/engine.js` (392L) is dense but justified — it's doing real financial modeling (GARCH, walk-forward, Kelly sizing). The `simulatePnL` function at ~120 lines is at the upper bound of acceptable. Could split `analyzeStation` into a separate file.

## What's Working Well

1. **Zero dependencies** — Impressive discipline. `fetchJSON` wraps native fetch, crypto uses Node built-ins. No bloat.

2. **matcher.js extraction** — Clean separation of market-matching logic from the recommend command. Good recent refactor.

3. **lib/ directory structure** — `core/`, `weather/`, `crypto/`, `kalshi/`, `backtest/` — clear domain boundaries. Easy to navigate.

4. **Small utility files** — `observe.js` (36L), `logger.js` (46L), `calibration.js` (57L), `sizing.js` (60L) — these are the right size.

5. **stations.js as config** — Station metadata + sigma logic in one place. `getEffectiveSigma()` with seasonal/horizon adjustments is clean.

6. **Guard system** — `lib/core/guard.js` centralizes all pre-trade checks. Commands just call `runGuards()`. No scattered safety logic.

## Crypto Assessment (962 lines, kept by owner choice)

The crypto module (`lib/crypto/` 665L + `commands/crypto.js` 130L + overlap in daily/recommend ~167L) is self-contained and well-structured:
- `forecast.js` (310L) — GARCH + Student-t + technicals. Mathematically dense but correct.
- `strategy.js` (214L) — Clean signal→recommendation pipeline.
- `prices.js` (141L) — CoinGecko fetcher with retry.
- `backtest.js` (193L) — Separate from weather backtest.

**Verdict**: It's a clean, isolated module. Not tangled with weather code. Keeping it adds optionality at modest maintenance cost. No action needed.

## Recommended Actions (Priority Order)

1. **Fix DRY violation** — calibrate.js should use `lib/weather/historical.js` (~15 min)
2. **Extract `data.js` snapshot logic** — reuse matcher.js pipeline instead of reimplementing (~30 min)
3. **Split `trade.js`** — `positionsCmd` (with Kalshi API calls) could be its own file or move display to a shared formatter (~20 min)
4. **Trim IV display** — The GO/NO-GO matrix in `implied_vol.js` is 80+ lines of `console.log`. Consider a table helper. (~15 min)

## Line Budget Assessment

| Category | Lines | % | Verdict |
|----------|-------|---|---------|
| Commands (CLI) | 2,539 | 38% | Slightly heavy — display code inflates |
| lib/weather | 918 | 14% | Right-sized |
| lib/crypto | 858 | 13% | Acceptable (owner choice) |
| lib/core | 648 | 10% | Lean and clean |
| lib/backtest | 618 | 9% | Dense but justified |
| lib/kalshi | 343 | 5% | Right-sized |
| Other | 790 | 11% | bin/, perf, health |

The commands layer is where most bloat lives. The lib layer is well-factored.

## Summary

This is a well-structured zero-dep trading system that a new developer can understand in under 30 minutes. The recent refactors (matcher.js extraction, history.js genericization) moved in the right direction. The main remaining issues are one DRY violation and a few command files that mix orchestration with display formatting. Fixing the top 2 items would push the score to ~82/100.
