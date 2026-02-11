# R16 Simplicity Review — Kalshi Trading System

**Date**: 2026-02-10  
**Reviewer**: Fresh subagent (no prior context)  
**Codebase**: ~6,645 lines across 37 JS files, zero external dependencies  

## Overall Score: 89/100

| Dimension | Score | Notes |
|-----------|-------|-------|
| Code Simplicity | 17/20 | Clean but some commands are verbose (trade.js 422L, data.js 341L with lots of console formatting) |
| Feature Necessity | 18/20 | Every module serves a purpose. Crypto kept by owner decision. New stations (KIAH, KLAX, KATL, KDFW) untested but low cost |
| DRY Compliance | 17/20 | `kalshiFee()` in backtest/engine.js duplicates concept of `TRANSACTION_COST` in sizing.js; `formatBriefingForTelegram` in daily.js partially duplicates the text briefing below it |
| Cognitive Load | 18/20 | Good module boundaries. Utils.js is a clean shared foundation. Import chains are shallow |
| Maintainability | 19/20 | Zero deps is excellent. Clear file naming. Station metadata centralized. Single source of truth for σ values |

## R16 Changes Assessment

All three R16 cleanups were correct:
- ✅ Duplicate `studentTCDF` removed from crypto/forecast.js → imports from utils.js
- ✅ `fetchJSONRetry` removed → `fetchJSON` has built-in retries
- ✅ `probAboveThreshold` → `cryptoProbAbove` in crypto module — naming clarity

## Top 20 Files by Size

| Lines | File | Verdict |
|-------|------|---------|
| 422 | commands/trade.js | ⚠️ Could trim ~50L of verbose console formatting |
| 392 | lib/backtest/engine.js | ✅ Dense but necessary — core backtest logic |
| 341 | commands/data.js | ⚠️ `collectCmd` saves to both legacy JSON and JSONL — legacy path could go |
| 326 | commands/calibrate.js | ⚠️ ~40L of seasonal breakdown formatting is verbose |
| 317 | commands/daily.js | ⚠️ `formatBriefingForTelegram` + text briefing = two formats of same data |
| 315 | commands/implied_vol.js | ✅ Core command, well-structured |
| 297 | lib/crypto/forecast.js | ✅ Clean after R16 cleanup |
| 259 | commands/perf.js | ✅ Reporting, format-heavy by nature |
| 254 | lib/weather/stations.js | ✅ Data-heavy, appropriate |
| 237 | commands/recommend.js | ✅ |

## Specific Issues Found

### 1. Dual fee models (Minor DRY violation)
- `lib/backtest/engine.js:16` — `kalshiFee(price)` returns variable fee by price tier
- `lib/core/sizing.js:7` — `TRANSACTION_COST = 0.04` flat constant
- These model the same concept differently. Backtest uses graduated fees, live uses flat 4¢. Intentional but undocumented.

### 2. Legacy history format in data.js
- `collectCmd()` saves to both `iv-history.json` (old) and JSONL (new)
- Comment says "backwards compatibility" but no code reads the old format except `loadHistory()` in the same file
- ~30 lines of dead weight

### 3. Console formatting overhead
- Commands are ~30-40% console.log formatting (box-drawing chars, emoji, padding)
- This is a CLI tool so some is expected, but `trade.js` positions display (~60L) and `calibrate.js` seasonal breakdown (~40L) are verbose

### 4. Unused exports
- `lib/weather/stations.js` exports `CLIM_OUTLIER_THRESHOLD_F` and `MAX_MODEL_SPREAD_F` — these constants are only used by guard.js which imports them. Fine.
- `tradeCmd` exported from trade.js but only `default` export is used by CLI router

### 5. stations.js new stations have placeholder σ
- KIAH, KLAX, KATL, KDFW all have `baseSigma: 3.5` — the default fallback value
- Not in TRADEABLE_STATIONS so no risk, but 60 lines of uncalibrated metadata

## What's Working Well

1. **Zero dependencies** — remarkable for a system this capable
2. **Single σ source of truth** — `getEffectiveSigma()` centralizes all adjustments (base + season + horizon)
3. **Shared math** — `studentTCDF`, `normalCDF`, `fetchJSON` all in utils.js, imported everywhere
4. **Guard system** — clean separation of concerns in guard.js, called from trade.js and implied_vol.js
5. **Module boundaries** — weather/, crypto/, core/, kalshi/, backtest/ are well-separated

## Actionable Recommendations (effort → impact)

| Priority | Action | Lines Saved | Effort |
|----------|--------|-------------|--------|
| 1 | Remove legacy iv-history.json path in data.js | ~30 | Low |
| 2 | Remove `tradeCmd` named export (only default used) | ~3 | Trivial |
| 3 | Unify fee model or document the intentional divergence | 0 | Low |
| 4 | Remove placeholder new stations until calibrated | ~60 | Low |

## Conclusion

At 6,645 lines with zero deps, this is a lean system. The R16 changes were all correct and moved the needle. The remaining issues are minor — mostly legacy compatibility code and verbose formatting. The architecture is clean: shared math in utils, station data centralized, clear module boundaries. 

**To reach 95+**: Remove legacy history format, trim console formatting by ~15%, document the dual fee model, and drop uncalibrated station placeholders.
