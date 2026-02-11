# Stations R3 — Simplicity Review

**Date**: 2026-02-11  
**Previous Score**: 90  
**Current Score**: 88/100

## Dimension Scores

### 1. ONE station table, no duplicates with stale values — 15/20
AGENTS.md has exactly one station table (good, no duplicates). However, two stations have **stale baseSigma values** that disagree with `stations.json`:

| Station | AGENTS.md σ | stations.json σ | Delta |
|---------|-------------|-----------------|-------|
| KNYC | 1.03 | 0.84 | -0.19 |
| KMIA | 0.63 | 0.78 | +0.15 |

The MAE column in AGENTS.md also doesn't correspond to any field in stations.json (which has separate `ecmwfMAE` and `gfsMAE`). For KNYC: AGENTS.md says MAE=0.93, but ecmwfMAE=0.75, gfsMAE=0.80. For KMIA: AGENTS.md says MAE=0.57, but ecmwfMAE=0.65, gfsMAE=0.75.

**Fix**: Regenerate the AGENTS.md table from stations.json to eliminate drift.

### 2. KDEN tier consistent everywhere — 20/20
- AGENTS.md: Tier A ✅
- stations.json: `"tier": "A"` ✅
- stations.js: derived from JSON, no hardcoded override ✅

Perfect consistency.

### 3. stations.json is single source of truth — 16/20
`lib/weather/stations.js` correctly loads all data from `data/stations.json` at runtime. No hardcoded station data in the JS module. However, AGENTS.md has drifted for 2 of 15 stations (KNYC, KMIA), meaning a human reading the docs gets different numbers than the code uses. The *code* path is clean; the *documentation* path leaks stale values.

### 4. TRADEABLE_STATIONS derived — 20/20
Perfectly derived:
```js
export const TRADEABLE_STATIONS = new Set(
  Object.keys(STATIONS).filter(s =>
    STATIONS[s].enabled !== false && ['A', 'B'].includes(STATIONS[s].tier)
  )
);
```
No hardcoded station lists. Changing tier or enabled in stations.json automatically updates the tradeable set. `VALIDATED_STATIONS` and `CORRELATION_GROUPS` are also properly derived.

### 5. Overall architecture simplicity — 17/20
Strong design:
- Single JSON config → JS loader → derived sets pattern is clean
- Bayesian sigma updating, horizon scaling, seasonal bumps all parameterized from the JSON source
- Correlation groups derived from JSON tags
- `resolveStation()` provides flexible lookup

Minor complexity: AGENTS.md table serves as both human documentation and implicit contract. When it drifts from stations.json (as it has for KNYC/KMIA), it creates confusion about which values are authoritative. Consider either auto-generating the AGENTS.md table or adding a note that stations.json is canonical.

## Summary

| # | Dimension | Score |
|---|-----------|-------|
| 1 | One table, no stale duplicates | 15/20 |
| 2 | KDEN tier consistent | 20/20 |
| 3 | stations.json as source of truth | 16/20 |
| 4 | TRADEABLE_STATIONS derived | 20/20 |
| 5 | Architecture simplicity | 17/20 |
| | **Total** | **88/100** |

## Recommended Fixes
1. **Sync AGENTS.md table with stations.json** — Update KNYC baseSigma from 1.03→0.84, KMIA from 0.63→0.78, and align MAE column (clarify whether it's ecmwfMAE, gfsMAE, or blended)
2. **Add "canonical source" note** — Add a line above the AGENTS.md table: *"Values below are summaries; `data/stations.json` is the single source of truth."*

Score dropped 90→88 due to newly detected KNYC/KMIA baseSigma drift between AGENTS.md and stations.json.
