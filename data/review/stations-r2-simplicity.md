# STATIONS R2 — Simplicity Review

**Date**: 2026-02-11  
**Reviewer**: Subagent (stations-r2-simplicity)  
**Scope**: Tier consistency, derivation hygiene, correlation groups, line counts

---

## Line Counts

| File | Lines |
|------|-------|
| `lib/weather/stations.js` | 159 |
| `lib/core/guard.js` | 163 |
| `data/stations.json` | 707 |
| **Total** | **1029** |

Budget: 5 dims × 20 pts = 100 pts. Actual ~1029 lines across 3 files. stations.json is pure data (707 lines for 15 stations with monthly normals — irreducible). Code files are lean at 322 lines combined. ✅ Acceptable.

---

## 1. KDEN Tier Consistency

| Source | KDEN Tier | baseSigma | MAE | Status |
|--------|-----------|-----------|-----|--------|
| `data/stations.json` | **A** | 0.92 | — | ✅ |
| `AGENTS.md` Settlement table | **A** | 0.92 | 0.80°F | ✅ |
| `AGENTS.md` "Honest Market Reality" table | — | 0.9 | 0.83°F | ⚠️ Stale |

**Finding**: KDEN is tier **A** in both stations.json and the AGENTS.md settlement table — **consistent**. The older "Honest Market Reality" section still shows baseSigma=0.9 and MAE=0.83 (pre-recalibration values). This is a documentation lag, not a code bug. The settlement table (Feb 11 recalibration) is authoritative.

**Recommendation**: Remove or mark the "Honest Market Reality" and "Honest Station Assessment" sections in AGENTS.md as superseded — they carry stale KDEN values (σ=0.9 vs 0.92) and only cover 4 stations.

---

## 2. TRADEABLE_STATIONS — Derived, Not Manual ✅

```js
export const TRADEABLE_STATIONS = new Set(
  Object.keys(STATIONS).filter(s =>
    STATIONS[s].enabled !== false && ['A', 'B'].includes(STATIONS[s].tier)
  )
);
```

Single source of truth is `data/stations.json` tier + enabled fields. No hardcoded station lists anywhere. Adding a station = adding it to JSON. ✅ Clean derivation.

`VALIDATED_STATIONS` similarly derived from `baseSigma != null`. ✅

---

## 3. Correlation Groups — Clean ✅

### stations.json groups:
| Group | Members |
|-------|---------|
| `northeast` | KNYC, KDCA, KPHL |
| `texas_oklahoma` | KDFW, KIAH, KOKC, KAUS |
| `west_coast` | KLAX, KSFO, KSEA |

### Ungrouped stations:
KMIA, KDEN, KMDW, KATL, KMSP — no `correlationGroup` tag.

**Observations**:
- Groups are geographically sensible. ✅
- KLAX is in `west_coast` group but tier F / disabled — harmless, no trades will fire.
- KDEN standalone is correct — mountain West weather is uncorrelated with plains/coast.
- KMSP standalone is correct — upper Midwest distinct regime.
- KATL standalone is debatable (could weakly correlate with northeast in winter), but conservative to leave independent.
- `CORRELATION_GROUPS` in stations.js is derived from JSON tags. ✅
- Guard rule 7 uses derived `CORRELATED_STATIONS` map. ✅

---

## 4. Guard Integration

Guard imports `TRADEABLE_STATIONS`, `CORRELATION_GROUPS`, `getEffectiveSigma` from stations.js. No duplicated station logic. Config overrides load from `config.json` with sane defaults. ✅

One minor note: guard.js calls `getLedger()` twice (lines ~75 and ~100). Harmless but slightly wasteful.

---

## 5. Scoring Summary

| Dimension | Score (/20) | Notes |
|-----------|-------------|-------|
| Tier consistency | 17 | JSON+code aligned; AGENTS.md has stale older sections |
| Derivation hygiene | 20 | All sets derived from single JSON source |
| Correlation groups | 19 | Clean, geographically sound, one disabled station in group |
| Code simplicity | 18 | 322 lines of code, clear separation data/logic |
| Documentation | 16 | Good inline comments; AGENTS.md has redundant legacy tables |

**Total: 90 / 100** ✅

---

## Action Items

1. **Low**: Clean up AGENTS.md — remove or label "Honest Station Assessment" and "Honest Market Reality" sections as superseded by the Feb 11 settlement table.
2. **Trivial**: Deduplicate `getLedger()` call in guard.js.
