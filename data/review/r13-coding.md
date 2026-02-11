# R13 Coding Summary — Simplification

**Date**: 2026-02-10

## Changes Made

### 1. Split recommend.js (624 → 298 lines, -52%)
- Extracted probability functions (`probAboveThreshold`, `probInBracket`) to `lib/core/utils.js`
- Extracted market matching logic to new `lib/weather/matcher.js` (119 lines):
  - `fetchStationMarkets()` — fetches Kalshi markets + computes implied σ
  - `scoreContract()` — scores a single contract against forecast
  - `getEffectiveSigmaForForecast()` — ensemble-aware sigma lookup
- Remaining recommend.js is a coordinator: args → forecasts → match → display → execute

### 2. Genericized history.js (230 → 116 lines, -50%)
- Consolidated shared `appendToJsonl()` and `readHistory()` core
- Type-specific appenders are now thin wrappers (3-8 lines each)
- Collapsed `getHistorySummary()` from verbose per-file logic to compact loop
- All exports preserved — no API changes

### 3. Cleaned stations.js (266 → 254 lines, -5%)
- Removed `notes` field (documentation-only, never read by code)
- Removed `consensusMAE` field (never read by code)
- Kept `ecmwfMAE`/`gfsMAE` (used by `getModelWeights()` in forecast.js)
- Kept `tier` (used by implied_vol.js display)

### 4. DRY improvements
- `probAboveThreshold` now shared from utils.js (was duplicated in recommend.js + daily.js)
- Added `parseDateArg(args)` to utils.js for common CLI date parsing pattern
- Added `probInBracket` to utils.js

### 5. data.js — not changed this round
- Still 499 lines. The subcommand router pattern is functional and each subcommand is already fairly distinct. Further splitting would create 5 tiny files with no reuse benefit. Deferred.

## Line Counts — Before vs After

| File | Before | After | Delta |
|------|--------|-------|-------|
| commands/recommend.js | 624 | 298 | -326 (-52%) |
| lib/core/history.js | 230 | 116 | -114 (-50%) |
| lib/weather/stations.js | 266 | 254 | -12 (-5%) |
| lib/core/utils.js | 94 | 110 | +16 |
| lib/weather/matcher.js | (new) | 119 | +119 |
| commands/daily.js | 322 | 317 | -5 |
| **Total codebase** | **6951** | **6629** | **-322 (-4.6%)** |

## Verification
- ✅ `node bin/kalshi.js perf` — works
- ✅ `node bin/kalshi.js recommend` — works (weather + crypto)
- ✅ `import('./lib/backtest/engine.js')` — OK
- ✅ `import('./lib/core/history.js')` — OK, all exports present
- ✅ `import('./lib/weather/matcher.js')` — OK
- ✅ `import('./commands/daily.js')` — OK
