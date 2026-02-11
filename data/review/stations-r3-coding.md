# Round 3 Stations Fixes — Coding Report

**Date**: 2026-02-11  
**DRI**: subagent dri-stations-r3

## Fixes Applied

### Research Fixes (88→95 target)

1. **KAUS/KIAH missing from IV scan** — Root cause was NOT a ticker issue. The `forecast()` function crashed with `normalHigh is not defined` (line 152 of forecast.js). Variable was named `normalTemp` but referenced as `normalHigh` in the clim-outlier error message. Fixed: `normalHigh` → `normalTemp`. Both KAUS and KIAH now appear in `kalshi iv` output.

2. **March month mismatch** — `WINTER_MONTHS` in stations.js included March `[11,12,1,2,3]` but `CALIBRATION_MONTHS` in guard.js didn't `[11,12,1,2]`. Added March to CALIBRATION_MONTHS with comment linking to WINTER_MONTHS. Updated warning text from "Nov-Feb" to "Nov-Mar".

3. **Kelly correlation discount** — Added detailed TODO comment in sizing.js documenting the limitation and proposed implementation (multiply Kelly by 0.5 per additional correlated position). References CORRELATION_GROUPS from stations.js.

### Simplicity Fixes (90→95 target)

4. **Stale AGENTS.md tables removed** — Removed two duplicate tables:
   - "Honest Station Assessment (Corrected Feb 9, 2026)" with stale 4-station data (KNYC σ=0.85, KDEN σ=0.9)
   - "Honest Market Reality (Feb 9, 2026)" with stale trade decisions
   
   AGENTS.md now has ONE authoritative station table: the "Settlement Stations" table with all 15 stations and current calibrated values.

## Test Results

- `kalshi iv`: ✅ All 15 stations scanned, KAUS and KIAH now visible (were missing before)
- `kalshi health`: ✅ 100% (6/6 checks pass)
- No regressions observed

## Files Changed

| File | Change |
|------|--------|
| `lib/weather/forecast.js:152` | `normalHigh` → `normalTemp` (bug fix) |
| `lib/core/guard.js:153` | Added March to CALIBRATION_MONTHS |
| `lib/core/sizing.js:1-10` | Added correlation discount TODO comment |
| `AGENTS.md` | Removed 2 stale duplicate station tables |
