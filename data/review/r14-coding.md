# R14 Coding Review — All Fixes Applied

**Date**: 2026-02-10  
**Scope**: 10 fixes from R13 research/product/simplicity reviews

## Changes Made

### 1. ✅ Cumulative Station Exposure Guard (HIGHEST PRIORITY)
- **guard.js**: Added guard #8 — sums all unsettled trade costs per station, blocks if >5% of bankroll
- **risk.js**: Added `maxStationExposure = 0.10` (10%) to `RISK_LIMITS`, cumulative check in `checkRiskLimits()`
- This prevents the 8×20-contract KMIA scenario (6.9% exposure) from recurring

### 2. ✅ Fixed IV Net Edge Hardcoded 75°F
- **implied_vol.js**: Replaced hardcoded `75` threshold with nearest-to-forecast contract threshold
- Now uses `sortedByProximity[0].threshold` for edge calculation per station's actual contracts

### 3. ✅ Fixed Ensemble σ Floor (0.9x NWS Path)
- **ensemble.js**: Added `dynamicSigma = Math.max(baseSigma, dynamicSigma)` after all adjustments
- The 0.9x NWS agreement path can still fire, but result is clamped to baseSigma floor
- Absolute floor ensures calibrated σ is never violated

### 4. ✅ Updated AGENTS.md σ Values
- Shows winter-effective σ: KNYC=1.34, KMIA=1.27, KDEN=1.40, KMDW=2.8 (unchanged)
- Added footnote: "σ values include +0.5°F winter seasonal adjustment (Nov–Feb)"
- σ gaps recalculated against market σ

### 5. ✅ Bid-Ask Spread Filter (10¢)
- **guard.js**: Added `bidAskSpread` parameter to `runGuards()`, blocks if >$0.10
- **matcher.js**: Added spread check in `scoreContract()` — skips contracts with spread >10¢
- Prevents trading illiquid weather contracts

### 6. ✅ Fixed MAE: NaN in Perf
- **perf.js**: Added `t.forecastHigh != null` filter for temp trades
- MAE/bias display shows "N/A" instead of NaN when data missing
- Settlement in `data.js settleCmd` already calls `fetchObservation()` correctly

### 7. ✅ DRY: calibrate.js Duplicate Fetch
- **calibrate.js**: Replaced local `fetchHistoricalObservations` with import from `lib/weather/historical.js`
- Thin wrapper converts Map→Object for backward compatibility
- Deleted ~15 lines of duplicate Open-Meteo API code

### 8. ✅ data.js Snapshot Reuses matcher.js
- **data.js**: Replaced inline market-fetching + IV computation with `fetchStationMarkets()` from matcher.js
- Removed imports of `getSeriesMarkets`, `analyzeImpliedVol`
- ~30 lines of duplicate logic removed

### 9. ✅ Grouped Duplicate Trades in Perf Display
- **perf.js**: Open positions grouped by contract+side+date
- Duplicates show as "20x KMIA-HIGH-78 (4 trades)" instead of 4 identical lines
- Total qty aggregated per group

### 10. ✅ Cron Setup Note in Health
- **health.js**: When cron check fails, shows exact `openclaw cron add` commands
- Two commands: snapshot every 4h, daily briefing at 14:00 UTC

## Verification

```
✅ All 9 modified files pass syntax check (node -c)
✅ No hardcoded 75 remaining in implied_vol.js (only in comment)
✅ baseSigma floor applied after 0.9x path in ensemble.js
✅ calibrate.js imports from lib/weather/historical.js
✅ data.js imports fetchStationMarkets from matcher.js
```

## Files Modified
1. `lib/core/guard.js` — cumulative exposure + bid-ask spread guards
2. `lib/core/risk.js` — maxStationExposure limit
3. `commands/implied_vol.js` — dynamic threshold for edge calc
4. `lib/weather/ensemble.js` — baseSigma absolute floor
5. `AGENTS.md` — winter-effective σ values
6. `lib/weather/matcher.js` — bid-ask spread filter in scoreContract
7. `commands/perf.js` — MAE NaN fix + grouped open positions
8. `commands/calibrate.js` — DRY historical fetch
9. `commands/data.js` — reuse matcher.js for snapshots
10. `commands/health.js` — cron setup instructions
