# STATIONS Expansion R2 — Review

**Date**: 2026-02-11  
**Reviewer**: Research subagent  
**Score**: 88 / 100

---

## 1. Architecture & Data Flow (18/20)

### stations.json → stations.js → guard.js pipeline
- **stations.json**: Single source of truth for all 15 stations. Each entry carries `baseSigma`, `baseSigmaLow`, `tier`, `enabled`, `correlationGroup`, `climNormalHigh/Low`, model MAEs. Clean, well-structured.
- **stations.js**: Derives `TRADEABLE_STATIONS` (tier A/B + enabled≠false → 13 stations), `VALIDATED_STATIONS` (has baseSigma), and `CORRELATION_GROUPS` from JSON. Exports `getEffectiveSigma()` with winter bump, horizon scaling, Bayesian update.
- **guard.js**: Imports all from stations.js. Builds `CORRELATED_STATIONS` reverse-lookup map from `CORRELATION_GROUPS`. 10 guard rules enforced.

**Strengths**: Clean separation of config (JSON) from logic (JS). Adding a station = edit one JSON file. Correlation groups auto-propagate to guard.

**Issues**:
- (-1) `CORRELATED_STATIONS` built at import time — if stations.json is hot-reloaded, the map goes stale. Acceptable for CLI usage but note for future daemon mode.
- (-1) `KIAH` has no `kalshiTickerLow` field, unlike most other stations. May cause silent failures in low-temp scanning.

---

## 2. Correlation Groups (17/20)

### Groups defined
| Group | Members | Rationale |
|-------|---------|-----------|
| texas_oklahoma | KDFW, KAUS, KOKC, KIAH | Shared frontal systems |
| northeast | KNYC, KPHL, KDCA | Coastal NE corridor |
| west_coast | KSFO, KLAX, KSEA | Pacific pattern driven |

### Guard enforcement (rule 7)
- Guard checks today's unsettled trades for correlated stations. If KDFW has an open trade, KAUS/KOKC/KIAH are blocked same day. ✅ Correct.
- `isCorrelatedStation()` uses the reverse-lookup map. Tested conceptually: KDFW↔KAUS, KNYC↔KPHL, KSFO↔KSEA all return true.

**Issues**:
- (-1) KMIA, KDEN, KATL, KMSP have no `correlationGroup`. They can be traded simultaneously without constraint. KATL and KDCA arguably share synoptic patterns (both SE/mid-Atlantic) but are in different groups. Acceptable conservatism — better to miss a correlation than fabricate one.
- (-1) KLAX is in `west_coast` group but `enabled: false`, so it's excluded from trading. The group still loads it into `CORRELATION_GROUPS` — harmless but slightly noisy.
- (-1) No position-level correlation penalty in Kelly sizing. Guard blocks same-day trades but doesn't reduce size when multiple correlated positions exist across days. The stations.js comment mentions "Kelly sizing should treat correlated stations as partially the same bet" but this isn't implemented yet.

---

## 3. baseSigmaLow Calibration (18/20)

### All 15 stations now have baseSigmaLow
| Station | baseSigma (high) | baseSigmaLow | Ratio Low/High |
|---------|-----------------|--------------|----------------|
| KNYC | 0.84 | 0.90 | 1.07 |
| KMDW | 3.05 | 3.20 | 1.05 |
| KMIA | 0.78 | 0.82 | 1.05 |
| KDEN | 0.92 | 1.05 | 1.14 |
| KIAH | 1.03 | 1.15 | 1.12 |
| KATL | 1.01 | 1.12 | 1.11 |
| KDFW | 0.84 | 0.95 | 1.13 |
| KLAX | 2.44 | 2.55 | 1.05 |
| KSFO | 1.16 | 1.28 | 1.10 |
| KSEA | 1.07 | 1.18 | 1.10 |
| KOKC | 1.28 | 1.42 | 1.11 |
| KDCA | 1.67 | 1.85 | 1.11 |
| KAUS | 1.16 | 1.28 | 1.10 |
| KMSP | 1.06 | 1.18 | 1.11 |
| KPHL | 1.38 | 1.52 | 1.10 |

- Ratios range 1.05–1.14×. Physically reasonable: low temps have wider error bars (nighttime radiative cooling harder to predict). Continental stations (KDEN 1.14, KDFW 1.13, KIAH 1.12) show larger low/high gaps — consistent with stronger nocturnal inversions.
- `getEffectiveSigma()` correctly branches on `tempType` parameter: `tempType === 'low'` → `baseSigmaLow`. ✅

**Issues**:
- (-1) Low-temp IV scan only covers KNYC, KMDW, KMIA (3 stations). The other 12 stations with `baseSigmaLow` aren't being scanned for low-temp markets — likely because Kalshi doesn't offer low-temp contracts for those cities, but the `kalshiTickerLow` field is missing from most station entries (only KNYC, KMDW, KMIA, KDEN, KPHL have it).
- (-1) No independent validation of baseSigmaLow values. The calibration note says "60-day winter window" but doesn't specify whether low-temp calibration used the same window or a separate analysis. Low and high errors can decorrelate.

---

## 4. Winter Calibration Warnings (18/20)

### Implementation
- **guard.js rule 10**: Non-blocking warning when trading outside Nov–Feb (`CALIBRATION_MONTHS`). Correctly placed in `warnings[]` not `reasons[]` — doesn't block trades. ✅
- **stations.js**: `WINTER_MONTHS = {11, 12, 1, 2, 3}` adds +0.5°F sigma bump. March included in sigma bump but NOT in guard's calibration warning months.
- **stations.js header comment**: Clear documentation that baseSigma calibrated on Dec 13 2025 → Feb 10 2026 window. Calls out KOKC, KDFW, KIAH, KDEN as convective stations needing summer re-calibration.

**Strengths**: Conservative approach — sigma bump makes us less aggressive when forecast errors are expected to be higher. Warning is informational, not blocking.

**Issues**:
- (-1) Month set mismatch: `WINTER_MONTHS` in stations.js = {11,12,1,2,**3**} but `CALIBRATION_MONTHS` in guard.js = {11,12,1,2}. March gets the sigma bump but NOT the "outside calibration window" warning. Should be consistent — either March is in both or neither.
- (-1) Warning text says "summer forecast errors may be higher" but fires for ANY month outside Nov–Feb, including March, April, October. Wording could be more precise.

---

## 5. Live System Validation (17/20)

### `kalshi iv` output (2026-02-11)
- 13 tradeable stations scanned. 4 GO: KATL, KDFW, KMSP, KPHL.
- Correlation groups working: KDFW GO + KOKC NO-GO means if KDFW trades first, guard would block KOKC (same group). Today KOKC is NO-GO on its own merits (gap < 1.5°F), so the correlation guard isn't visibly tested.
- Low-temp scan: 3 stations (KNYC, KMDW, KMIA). KNYC LOW shows +4.2°F gap, 4.31¢ edge — a real opportunity the system surfaces. ✅
- KLAX correctly flagged in guard warnings as not in tradeable whitelist. ✅

### `kalshi health` output
- 100% health (6/6). 15 stations available, 13 tradeable. Balance $1048.20.
- All APIs (NWS, Open-Meteo GFS/ECMWF, Kalshi) responding. ✅

**Issues**:
- (-1) KAUS is tier A, tradeable, but absent from the IV scan output entirely. Either no Kalshi market exists for Austin today or there's a ticker resolution bug. Should be investigated.
- (-1) KMIA high shows gap +0.75°F but status "✅ STRONG" with 3.05¢ edge, while KOKC shows gap +1.29°F with "✅ STRONG" and 2.11¢. Yet the GO/NO-GO matrix marks both NO-GO (gap < 1.5°F). The status column and GO/NO-GO disagree — the "STRONG" label in the scan table appears to be based on net edge, not the 1.5°F gap threshold. Confusing UX but correct gating.
- (-1) No test of correlation guard in anger — would need two GO stations in the same group with one already traded. Edge case: KDFW + KAUS both GO simultaneously would be the real test.

---

## Summary

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture & Data Flow | 18/20 | Clean pipeline, minor hot-reload and missing field issues |
| Correlation Groups | 17/20 | Well-designed, Kelly correlation sizing not yet implemented |
| baseSigmaLow | 18/20 | Physically reasonable ratios, limited low-temp market coverage |
| Winter Calibration | 18/20 | Month set mismatch (March), good conservative approach |
| Live Validation | 17/20 | System healthy, minor UX confusion in status labels |
| **Total** | **88/100** | |

## Recommended Follow-ups

1. **P1**: Fix March month-set mismatch between `WINTER_MONTHS` and `CALIBRATION_MONTHS`
2. **P1**: Investigate missing KAUS from IV scan output
3. **P2**: Add `kalshiTickerLow` for stations with Kalshi low-temp markets (KDEN, KPHL have the field but check others)
4. **P2**: Implement correlated-position Kelly discount (referenced in stations.js comment but not coded)
5. **P3**: Add seasonal re-calibration script (summer window) as noted in TODO
6. **P3**: Validate baseSigmaLow independently from baseSigma calibration
