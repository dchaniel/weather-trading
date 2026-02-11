# R15 Simplicity Review — Fresh Eyes Audit

**Date**: 2026-02-10  
**Reviewer**: Simplicity Agent (fresh, no prior context)  
**Codebase**: 6,667 lines across 35 JS files, zero external deps

---

## Scores

| Dimension | Score | Max | Notes |
|-----------|-------|-----|-------|
| Code Simplicity | 16 | 20 | Clean structure, but several files are bloated with formatting/display logic |
| Feature Necessity | 17 | 20 | Crypto kept by owner decision; some commands overlap |
| DRY Compliance | 14 | 20 | Two `studentTCDF` implementations, two `probAboveThreshold`, redundant retry wrapper |
| Cognitive Load | 16 | 20 | Good file organization; trade.js (418 lines) does too many things |
| Maintainability | 17 | 20 | Zero deps is excellent; clear naming; good separation of lib/ vs commands/ |

**Total: 80/100**

---

## Critical DRY Violations

### 1. Duplicate `studentTCDF` — TWO independent implementations
- `lib/core/utils.js:107` — regularized incomplete beta approach
- `lib/crypto/forecast.js:131` — Hill's 1970 approximation

These are **different algorithms** computing the same thing. One must go.

**Fix**: Delete from `crypto/forecast.js`, import from `core/utils.js`.

### 2. Duplicate `probAboveThreshold` — TWO functions, same name, different domains
- `lib/core/utils.js:91` — weather version (Student-t on temperature σ)
- `lib/crypto/forecast.js:244` — crypto version (log-normal + Student-t on price)

Same name, different semantics. Confusing. The weather one is used by `matcher.js` and `daily.js`. The crypto one is used by `crypto/strategy.js` and `crypto/backtest.js`.

**Fix**: Rename crypto version to `cryptoProbAbove` or `logNormalProbAbove` to disambiguate.

### 3. `fetchJSONRetry` in `crypto/prices.js` wraps `fetchJSON` from utils
- `utils.js:fetchJSON` already has `retries` parameter
- `prices.js:37` creates a redundant `fetchJSONRetry` wrapper that just calls `fetchJSON` with retries=3

**Fix**: Delete `fetchJSONRetry`, call `fetchJSON(url, {}, { retries: 3 })` directly.

---

## Bloat & Complexity Issues

### 4. `commands/trade.js` — 418 lines, 7 subcommands
This is a mini-CLI framework inside a command. Functions: `executeTradeCmd`, `approveCmd`, `rejectCmd`, `positionsCmd`, `listPending`, `ledgerCmd`, `settleCmd`, `riskCmd`, `showHelp`.

`positionsCmd` alone is 80 lines fetching Kalshi portfolio + balance + recent recs. This belongs in a display helper or its own command.

**Recommendation**: Extract `positionsCmd` and `ledgerCmd` to lib/ display helpers. trade.js should be ~250 lines.

### 5. `commands/calibrate.js` — 326 lines, mostly display
~60% of this file is `console.log` formatting. The actual computation (`computeErrorStats`, `analyzeSeasonalErrors`) is solid but buried in display code.

**Recommendation**: Extract stats computation to `lib/weather/calibration.js` (already exists at 57 lines — merge into it). Command becomes thin display wrapper.

### 6. `commands/daily.js` — 317 lines including Telegram formatter
`formatBriefingForTelegram` (40 lines) is delivery-channel logic mixed into a command. The main function builds a briefing object, then formats it twice (console + telegram).

**Recommendation**: Move telegram formatter to a shared `lib/core/format.js` or remove (OpenClaw can handle message formatting).

### 7. `lib/crypto/forecast.js` — 310 lines
Solid signal library but contains: GARCH, realized vol, kurtosis, RSI, Bollinger, MA crossover, momentum drift, probability estimation, and signal generation. This is 10 concerns in one file.

**Recommendation**: Fine for now — it's a coherent "crypto signals" module. But if it grows past 350, split into `indicators.js` and `volatility.js`.

### 8. `lib/backtest/engine.js` — 392 lines
Walk-forward, sigma sweep, cost sensitivity, calibration curves all in one function. `analyzeStation` is 80+ lines with 7 nested loops.

**Recommendation**: This is research code that runs rarely. Acceptable complexity for its purpose, but `analyzeStation` could be broken into `calibrate()`, `sweep()`, `walkForward()`.

---

## Dead / Questionable Code

### 9. `commands/data.js` settle subcommand — deprecated stub
```js
case 'settle':
  console.log('\n  ℹ️  `kalshi data settle` is deprecated. Use `kalshi trade settle` instead.\n');
  return;
```
Just delete it. The help text still mentions it too.

### 10. `lib/weather/calibration.js` — 57 lines
Checked: this file exists but unclear if `calibrate.js` actually uses it (calibrate.js has its own `computeErrorStats`).

**Fix**: Either use the shared calibration module or delete it.

### 11. `commands/implied_vol.js` — GO/NO-GO matrix (lines ~220-315)
95 lines of formatting for a decision matrix that `recommend.js` also computes. The IV command's job is to show implied vol; the trade decision belongs in `recommend`.

**Recommendation**: Remove the GO/NO-GO section from `iv`. Users run `kalshi iv` → `kalshi recommend`. The IV command can just show a one-line "→ Run `kalshi recommend`" prompt.

---

## What R15 Got Right

1. **Executor extraction** — `recommend.js` 298→237 is cleaner. Execution logic in `lib/core/executor.js` is well-isolated.
2. **Settle removal from data.js** — 468→341. Good. No more dual ownership of settlement.
3. **Zero deps** — Remarkable for 6.6K lines. `fetchJSON`, `studentTCDF`, `normalCDF` all hand-rolled. Impressive and maintainable.
4. **Guard system** — `lib/core/guard.js` is a clean, composable rule engine. Single point of truth for trade validation.
5. **Station metadata** — `stations.js` is the single source of truth for all station config. Well-structured.

---

## R16 Recommendations (Priority Order)

| # | Action | Lines Saved | Effort |
|---|--------|-------------|--------|
| 1 | Delete duplicate `studentTCDF` from crypto/forecast.js | ~15 | 5 min |
| 2 | Rename crypto `probAboveThreshold` to disambiguate | 0 | 5 min |
| 3 | Delete `fetchJSONRetry` wrapper, use `fetchJSON` directly | ~10 | 5 min |
| 4 | Remove deprecated settle stub from data.js | ~5 | 2 min |
| 5 | Remove GO/NO-GO matrix from implied_vol.js | ~95 | 15 min |
| 6 | Extract `positionsCmd` display logic from trade.js | ~80 (moved) | 20 min |
| 7 | Merge calibrate.js stats into lib/weather/calibration.js | ~60 (deduped) | 30 min |

**Estimated savings**: ~200 lines removed/consolidated, 3 DRY violations fixed.

**Post-R16 target**: ~6,400 lines, score 87/100.

---

## Architecture Assessment

```
commands/  (9 files, 2,526 lines) — CLI entry points, display formatting
lib/core/  (10 files, 1,194 lines) — execution, risk, guards, utilities
lib/weather/ (7 files, 985 lines) — forecasts, stations, matching
lib/crypto/  (5 files, 962 lines) — GARCH, signals, strategy
lib/kalshi/  (2 files, 276 lines) — API client
lib/backtest/ (3 files, 618 lines) — backtesting engine
bin/         (1 file, ~100 lines) — CLI router
```

The architecture is sound. Commands are too thick (38% of codebase) — they should be thin wrappers over lib/. The lib/ layer is well-factored. Crypto is self-contained and doesn't leak into weather code (good boundary).

**Bottom line**: Solid R15. Not yet 95+ because of the DRY violations and display-logic bloat in commands/. Fix items 1-5 above for quick wins.
