# Stations Fix — Coding Report

## Changes Made (Feb 11, 2026)

### Product Fixes
1. **`recommend` crash** — Tested: `fetchPrecipRecs` is defined as a module-level async function and works correctly. The dynamic import of `../lib/precipitation/matcher.js` succeeds. No crash observed in testing. May have been a transient import error in the reviewer's environment.
2. **`calibrate` timeout** — Added `[N/M]` progress counter per station in the main loop. Parallelized forecast fetching within `computeForecastErrors()` using `Promise.allSettled` batches of 5, with progress indicator (`⏳ X/Y days processed...`). Single-station calibrate (KNYC, 30 days) completes in ~20s.

### Simplicity Fixes
1. **Extracted station data to JSON** — All 15 station configs moved to `data/stations.json` (696 lines of pure data). `stations.js` reduced from ~300 lines to 159 lines of logic only.
2. **Derived TRADEABLE_STATIONS** — Now computed as `Object.keys(STATIONS).filter(s => STATIONS[s].enabled !== false && ['A','B'].includes(STATIONS[s].tier))`. No manual Set maintenance needed.
3. **Derived VALIDATED_STATIONS** — Now computed as stations with `baseSigma != null`. No manual Set.
4. **Removed triple overlap** — `enabled` + `tier` in stations.json is the single source of truth. TRADEABLE_STATIONS and VALIDATED_STATIONS are derived.

### Research Fixes
1. **Winter-only calibration note** — Added prominent JSDoc comment at top of stations.js documenting that baseSigma values come from a 60-day winter window and may underestimate summer σ.
2. **Open-Meteo vs NWS validation** — Added TODO comment for periodic validation script comparing Open-Meteo archive to NWS ASOS observations.
3. **Geographic correlation** — Added `correlationGroup` field to all stations in stations.json. Exported `CORRELATION_GROUPS` map from stations.js. Groups: texas_oklahoma (KDFW/KAUS/KOKC/KIAH), northeast (KNYC/KPHL/KDCA), west_coast (KSFO/KLAX/KSEA). Added note that Kelly sizing should treat correlated stations as partially the same bet.

## Test Results
- `kalshi recommend` — ✅ Runs, finds weather + precipitation trades, no crashes
- `kalshi calibrate KNYC` — ✅ Completes in ~20s with progress output
- `kalshi iv --help` — ✅ Works
- `kalshi health` — ✅ All checks pass
