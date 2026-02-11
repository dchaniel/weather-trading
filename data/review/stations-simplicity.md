# Stations Config Simplicity Review

**File**: `lib/weather/stations.js` (391 lines)
**Date**: 2026-02-11
**Scope**: Expansion from 3 → 12 tradeable stations (15 total defined)

---

## Scoring Summary

| # | Dimension | Score | Max |
|---|-----------|-------|-----|
| 1 | Code Simplicity | 13 | 20 |
| 2 | Feature Necessity | 18 | 20 |
| 3 | DRY Compliance | 10 | 20 |
| 4 | Cognitive Load | 12 | 20 |
| 5 | Maintainability | 14 | 20 |
| **Total** | | **67** | **100** |

---

## 1. Code Simplicity — 13/20

**Good**: Helper functions (`getEffectiveSigma`, `bayesianSigmaUpdate`, `getModelWeights`) are clean and focused. `resolveStation` and `stationByCity` are simple lookups.

**Problems**:
- 391 lines for what is essentially a config file with 5 small functions. The inline `climNormalHigh`/`climNormalLow` 12-month objects account for ~180 lines alone.
- Synchronous `readFileSync` for config.json at module top-level is fragile. Should be a lazy getter or passed in.
- Mix of config data and business logic in one file.

## 2. Feature Necessity — 18/20

**Nearly everything earns its keep**:
- Each station field maps to a real API requirement (NWS grid coords, Kalshi tickers, lat/lon for Open-Meteo).
- `baseSigma`, `tier`, `enabled`, `bias` — all directly used in trading decisions.
- `climNormalHigh`/`climNormalLow` — used for outlier detection (CLIM_OUTLIER_THRESHOLD_F).
- Bayesian updating, horizon scaling, seasonal bumps — all grounded in validated calibration work.

**Minor waste**: `baseSigmaLow` only defined on 3 of 15 stations (KNYC, KMDW, KDEN). Others silently fall back to `baseSigma`. Either add it everywhere or remove the concept.

## 3. DRY Compliance — 10/20

**Significant violations**:
- **climNormal objects**: 15 stations × 2 temp types × 12 months = 360 hardcoded values inline. Should be extracted to a JSON data file or generated from NOAA API, loaded at runtime.
- **Station schema not enforced**: Each station is a freeform object. Some have `kalshiTickerLow`, some don't. Some have `enabled: false`, most rely on absence. No schema validation = silent bugs when adding stations.
- **Tier assignment is a magic string** repeated in every station + in AGENTS.md + in TRADEABLE_STATIONS. Tier should derive from baseSigma thresholds, not be hand-labeled.
- **TRADEABLE_STATIONS duplicates tier logic**: If `tier` is on the object, the set should be computed: `Object.keys(STATIONS).filter(k => STATIONS[k].tier <= 'B' && STATIONS[k].enabled !== false)`.

## 4. Cognitive Load — 12/20

**Challenges**:
- A new contributor must read 250+ lines of station objects to understand the config shape. No JSDoc/TypeScript type definition for the station schema.
- Inline comments are helpful but inconsistent — original 4 stations have rich commentary (calibration history), new stations have terse one-liners.
- Three overlapping concepts for "can we trade this?": `enabled` field, `tier` field, and `TRADEABLE_STATIONS` set. Which is authoritative?
- `VALIDATED_STATIONS` includes KMDW and KLAX (tier F), which is correct (validated ≠ tradeable) but confusing without explicit documentation of the distinction.

**Good**: Function signatures are clear. Named exports make dependencies obvious.

## 5. Maintainability — 14/20

**Good**:
- Adding a new station is copy-paste with clear pattern.
- Bayesian updating means sigma self-corrects over time.
- `resolveStation` handles multiple input formats gracefully.

**Risks**:
- Adding station #16 means another 25-line object block. At 20+ stations this file hits 500+ lines of mostly data.
- No tests visible for `bayesianSigmaUpdate` or `getEffectiveSigma` edge cases.
- Sync `readFileSync` at import time will throw if config.json is missing (try/catch silently defaults — could mask real config errors).
- No migration path: if Kalshi changes ticker format, every station needs manual update.

---

## Top 3 Actionable Recommendations

1. **Extract station data to JSON** (`data/stations.json`), load in `stations.js`. Cuts file to ~120 lines of pure logic. Enables tooling to validate/generate station configs.

2. **Derive TRADEABLE_STATIONS from tier + enabled**: Replace the hand-maintained Set with `Object.entries(STATIONS).filter(([k,v]) => v.enabled !== false && ['A','B'].includes(v.tier)).map(([k]) => k)`. Single source of truth.

3. **Define a station schema** (JSDoc typedef or JSON Schema). Validate at startup. Catch missing fields before they become silent runtime bugs.
