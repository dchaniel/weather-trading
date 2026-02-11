# Round 12 — Coding Fixes Summary

**Date**: 2026-02-10  
**Status**: ✅ All priority 1 & 2 fixes applied, priority 3 partially done

## PRIORITY 1 — Critical Bugs (ALL FIXED)

### 1. ✅ Backtest engine duplicate import
- **File**: `lib/backtest/engine.js`
- **Fix**: Removed duplicate `import { normalCDF }` (line 9), kept merged import on line 10
- **Verify**: `node -e "import('./lib/backtest/engine.js')..."` → OK

### 2. ✅ Perf command showing undefined
- **File**: `commands/perf.js`
- **Fix**: Aligned field names to match ledger schema:
  - `t.ticker` → `t.contract || t.ticker`
  - `t.date` → `(t.timestamp || t.date || '').slice(0, 10)`
  - `t.entryPrice` → `t.price ?? t.entryPrice`
  - `t.probWin` → `t.pEst || t.probWin`
  - `t.expectedValue` → `t.expectedEdge || t.expectedValue`
  - `t.actualOutcome` → `t.actualHigh ?? t.actualOutcome`
- **Verify**: `node bin/kalshi.js perf` shows real data (88.9% win rate, +$83.50 P&L)

### 3. ✅ Risk limits wired into execution
- **File**: `commands/recommend.js`
- **Fix**: 
  - Imported `checkRiskLimits` from `lib/core/risk.js`
  - Added pre-execution global risk check (blocks entire session if limits exceeded)
  - Added per-trade risk check with station parameter (blocks individual trades)
- **Verify**: With ≥5 open positions, `recommend --execute` will refuse to trade

### 4. ✅ AGENTS.md KMDW contradiction
- **Fix**: Changed "⭐⭐ best calibration (σ=1.2)" → "❌ FAILED (MAE=2.56°F, no edge after costs)"

## PRIORITY 2 — DRY Violations (ALL FIXED)

### 5. ✅ Consolidated CDF in daily.js
- **File**: `commands/daily.js`
- **Fix**: Replaced inline Abramowitz & Stegun CDF with `normalCDF` from utils.js
- Note: crypto's `probAboveThreshold` is intentionally different (log-normal for prices) — NOT consolidated

### 6. ✅ Fixed two CDF implementations
- **File**: `commands/implied_vol.js`  
- **Fix**: Replaced inline `0.5 * (1 + sign(z) * sqrt(...))` approximation with `normalCDF` from utils.js
- Now ONE CDF implementation used everywhere (Abramowitz & Stegun in utils.js)

### 7. ✅ Consolidated observation fetching
- **File**: `commands/data.js`
- **Fix**: Removed 70-line `fetchActualObservation()` duplicate, now uses `fetchObservation` from `lib/weather/observe.js` (already imported)

### 8. ⏭️ Shared pattern extraction (DEFERRED)
- Date arg parsing and TRADEABLE_STATIONS pre-computation are minor. Skipped for this round.

## PRIORITY 3 — Simplification (PARTIAL)

### 9. ✅ Fixed ensemble σ floor
- **File**: `lib/weather/ensemble.js`
- **Fix**: 
  - `baseSigma * 0.8` → `baseSigma` (floor at calibrated value)
  - Interpolation: `0.8 + spreadRatio * 1.2` → `1.0 + spreadRatio * 1.0`
  - Ensemble can now only INCREASE σ, never decrease below calibration

### 10-11. ⏭️ History genericization & dead field cleanup (DEFERRED)
- Lower priority refactors, no functional impact

## Verification Results
```
✅ engine.js imports: OK
✅ perf command: Shows real data ($1078.45 balance, 9 settled trades)
✅ risk limits: checkRiskLimits() called before and during execution
✅ CDF: Single implementation (normalCDF in utils.js) used by daily.js, implied_vol.js, recommend.js
✅ Observation fetch: Single implementation in lib/weather/observe.js
✅ Ensemble σ: Floor at baseSigma, never below calibration
```
