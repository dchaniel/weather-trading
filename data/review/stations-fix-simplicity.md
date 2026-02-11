# Stations Config — Simplicity Review

**Date**: 2026-02-11  
**Score: 88 / 100** ✅ Already well-structured

## Dimensions

| Dimension | Score | Notes |
|-----------|-------|-------|
| Single source of truth | 20/20 | ✅ All station data in `data/stations.json`, loaded once in `stations.js` |
| Data/logic separation | 18/20 | ✅ JSON is pure data, JS is pure logic. Minor: `WINTER_MONTHS` and `HORIZON_SIGMA` constants live in JS (correct place, but could be config) |
| TRADEABLE derivation | 20/20 | ✅ Computed from `tier ∈ {A,B}` + `enabled !== false` — not manual |
| File size / complexity | 15/20 | stations.js = 159 lines (reasonable). stations.json = 696 lines (15 stations × ~46 lines each — bulk is climNormal tables, 24 values per station). Could compress but not urgent |
| Import hygiene | 15/20 | 18 importers all go through `lib/weather/stations.js` — clean single entry point. Minor: some import subsets, some import everything |

## What's Already Right

1. **Data lives in `data/stations.json`** — pure JSON, no logic
2. **`TRADEABLE_STATIONS` is derived**, not manually maintained:
   ```js
   Object.keys(STATIONS).filter(s =>
     STATIONS[s].enabled !== false && ['A', 'B'].includes(STATIONS[s].tier)
   )
   ```
3. **`VALIDATED_STATIONS`** derived from `baseSigma != null`
4. **`CORRELATION_GROUPS`** derived from `correlationGroup` field
5. **Single import path** — everything flows through `lib/weather/stations.js`

## Minor Issues (Low Priority)

### 1. climNormal bloat in stations.json
Each station has 24 climNormal values (12 high + 12 low) = 360 lines across 15 stations. This is the bulk of the 696-line file. Acceptable — it's pure data and rarely edited.

**No action needed** — moving to a separate file would add complexity for no real gain.

### 2. KDEN tier mismatch with AGENTS.md
- `stations.json`: KDEN tier = `"B"`
- `AGENTS.md` table: KDEN tier = `"A"` with MAE 0.80°F

KDEN's MAE (0.80°F) is better than several tier-A stations (KATL 0.92, KIAH 0.94, KMSP 0.97). Should probably be tier A.

**Fix**: Update `data/stations.json` KDEN tier to `"A"` (or update AGENTS.md to say B).

### 3. Missing `enabled: false` on KLAX
KLAX has `tier: "F"` and `enabled: false` ✅ — correct.  
KMDW has `tier: "F"` and `enabled: false` ✅ — correct.  
Both F-tier stations are properly excluded. Good.

## Verdict

**No structural changes needed.** The stations config already follows the target architecture:
- Data in JSON, logic in JS
- TRADEABLE_STATIONS computed from tier+enabled
- Single source of truth via one import path

Only actionable item: reconcile KDEN tier between stations.json (B) and AGENTS.md (A).
