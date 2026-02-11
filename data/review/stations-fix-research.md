# Stations Expansion Review — Research Report
**Date**: 2026-02-11 | **Agent**: review-stations-fix-research

## Executive Summary

The system expanded from 4 to 15 stations (13 active, 2 disabled). Calibration methodology is sound but has **5 significant gaps** that need fixing. Net assessment: the expansion is viable but needs tightening before scaling positions.

---

## 1. Calibration Methodology (20 pts)

### What's Done Right
- **60-day rolling window** via Open-Meteo historical forecast API vs archive actuals
- **baseSigma = MAE × 1.1** (10% safety margin) — reasonable
- **Tiering**: A (MAE<1.5), B (MAE<2.5), F (MAE≥2.5) — correctly bins KMDW/KLAX as failed
- **Bayesian updating** via `bayesianSigmaUpdate()` — shrinks prior toward observed MAE as N grows (Normal-Inverse-Gamma conjugate)
- **Seasonal adjustment**: +0.5°F winter bump (Nov–Mar)
- **Horizon scaling**: day-0=1.0×, day-2=1.29×, day-3=1.57×

### Issues Found

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1.1 | **Open-Meteo vs NWS ASOS mismatch** — calibration uses gridded Open-Meteo data but settlement is ASOS point observations. Systematic offset possible. TODO in code but not implemented. | 🔴 HIGH | Add monthly ASOS validation script |
| 1.2 | **Winter-only calibration window** — all baseSigma values calibrated Dec 13–Feb 10. Summer convective stations (KOKC, KDFW, KIAH, KDEN) will have higher errors in summer. Code comment acknowledges this. | 🟡 MEDIUM | Re-calibrate each season; add summer σ field |
| 1.3 | **`kalshi calibrate KNYC` returned N=13** — the 30-day rolling calibration window yielded only 13 usable days (likely missing forecast data). Below the N≥30 reliability threshold. | 🟡 MEDIUM | Investigate data gaps; extend window |
| 1.4 | **baseSigma formula inconsistency** — `calibrate-new-stations.js` uses `MAE × 1.1`, but AGENTS.md says KNYC baseSigma=0.84 with MAE=0.93 (ratio=0.90, not 1.1). stations.json shows baseSigma=0.84 for KNYC with ecmwfMAE=0.75. Multiple calibration runs with different results? | 🟡 MEDIUM | Document which calibration run produced final values |
| 1.5 | **No cross-validation** — single 60-day window, no train/test split, no out-of-sample testing | 🟢 LOW | Add rolling backtest validation |

### Score: 14/20

---

## 2. Data Quality (20 pts)

### Station Data Completeness (stations.json)

| Field | Coverage | Notes |
|-------|----------|-------|
| lat/lon | 15/15 ✅ | All present |
| climNormalHigh/Low | 15/15 ✅ | Monthly normals for all |
| baseSigma | 15/15 ✅ | All calibrated |
| ecmwfMAE / gfsMAE | 15/15 ✅ | Model-specific MAE for all |
| bias | 15/15 ✅ | Range: -1 to +2°F |
| kalshiTicker | 15/15 ✅ | Mapped to Kalshi markets |
| correlationGroup | 11/15 | KMIA, KDEN, KATL, KMSP ungrouped |
| baseSigmaLow | 6/15 ⚠️ | Only KNYC, KMDW, KMIA, KDEN, KLAX, KSFO — needed for low-temp trading |

### Issues Found

| # | Issue | Severity |
|---|-------|----------|
| 2.1 | **KIAH GFS MAE=1.8 vs ECMWF=0.78** — 2.3× divergence suggests GFS has known bias at this station. Model weighting partially handles this but the blended MAE is sensitive to weight choice. | 🟡 |
| 2.2 | **KDCA baseSigma=1.67** — highest of tradeable stations but tier B. With winter bump → σ=2.17, reducing edge substantially. Live `iv` shows only 0.21¢ net edge. | 🟢 |
| 2.3 | **Missing baseSigmaLow** for 9 stations — low-temp IV analysis only runs for KNYC/KMDW/KMIA. Lost opportunity. | 🟡 |
| 2.4 | **KPHL ticker is KXLOWTPHIL** (low only) but has no baseSigmaLow field — inconsistent | 🔴 |

### Score: 15/20

---

## 3. Correlation Management (20 pts)

### Defined Groups (stations.json)
- **texas_oklahoma**: KDFW, KAUS, KOKC, KIAH — 4 stations, shared frontal systems
- **northeast**: KNYC, KPHL, KDCA — 3 stations, winter NE corridor
- **west_coast**: KSFO, KLAX, KSEA — 3 stations (KLAX disabled)

### Ungrouped Stations
- KMIA (subtropical, genuinely independent)
- KDEN (Front Range, somewhat independent)
- KATL (SE, some texas_oklahoma correlation in spring)
- KMSP (upper Midwest, somewhat independent)

### Critical Gap: Correlation Groups NOT Used in Sizing

**The `CORRELATED_STATIONS` map in `guard.js` is EMPTY.** The correlation groups defined in stations.json and derived in stations.js (`CORRELATION_GROUPS`) are **never imported into guard.js**. The guard check at line 107 uses a hardcoded empty Map.

This means: **The system will happily take simultaneous positions on KDFW + KAUS + KOKC + KIAH** — 4 correlated Texas/Oklahoma stations — treating them as independent bets. This is the single most dangerous gap.

| # | Issue | Severity |
|---|-------|----------|
| 3.1 | **Guard correlation check uses empty map** — stations.json groups are defined but never wired into guard.js | 🔴 CRITICAL |
| 3.2 | **No portfolio-level correlation penalty in Kelly** — sizing treats each station independently. Comment in stations.js says "Kelly sizing should treat correlated stations as partially the same bet" but this is not implemented. | 🔴 HIGH |
| 3.3 | **KATL ungrouped** — correlates with texas_oklahoma in winter fronts and with northeast in Nor'easters. Should be in its own "southeast" group or tagged multi-group. | 🟡 |
| 3.4 | **No empirical correlation measurement** — groups are domain-knowledge based, not validated with forecast error correlation data | 🟡 |

### Score: 8/20

---

## 4. Live IV Analysis (20 pts)

### Current Market State (2026-02-11)

From `kalshi iv` output:

| Station | Our σ | Mkt σ | Gap | Net Edge | GO? |
|---------|-------|-------|-----|----------|-----|
| KNYC | 1.3 | 3.08 | +1.78 | -0.51¢ | NO |
| KDEN | 1.4 | 1.91 | +0.51 | -0.41¢ | NO |
| KMIA | 1.3 | 2.69 | +1.39 | 6.12¢ | **YES** (but σ gap < 1.5) |
| KATL | 1.5 | 4.69 | +3.19 | 6.35¢ | **YES** |
| KDFW | 1.3 | 4.77 | +3.47 | 20.98¢ | **YES** |
| KSFO | 1.7 | 2.67 | +0.97 | 1.58¢ | NO |
| KSEA | 1.6 | 5.26 | +3.66 | -2.28¢ | NO |
| KOKC | 1.8 | 3.09 | +1.29 | 2.11¢ | YES (but σ gap <1.5) |
| KDCA | 2.2 | 4.2 | +2.0 | 0.21¢ | NO |
| KMSP | 1.6 | 6.9 | +5.3 | 10.39¢ | **YES** |
| KPHL | 1.9 | 8.35 | +6.45 | 13.33¢ | **YES** |

### Observations
- **4 GO stations today**: KATL, KDFW, KMSP, KPHL
- KMIA has positive net edge but fails 1.5°F σ gap guard — **guard is too aggressive** for low-σ stations
- KSEA: huge σ gap (+3.66) but negative net edge — suggests market pricing is on wide strikes where our edge collapses
- KPHL 8.35°F market σ is suspicious — possibly illiquid market with wide spreads inflating implied vol
- **KDFW 20.98¢ edge** — extraordinarily high, verify this isn't a data artifact

### Score: 16/20

---

## 5. Architecture & Code Quality (20 pts)

### Strengths
- Clean separation: stations.json (data) → stations.js (runtime) → guard.js (rules)
- `TRADEABLE_STATIONS` derived from tier+enabled — single source of truth
- Bayesian σ updating with configurable prior strength (nPrior=30)
- Model weights via inverse-MAE — principled approach
- Horizon sigma multipliers for multi-day forecasts

### Issues

| # | Issue | Severity |
|---|-------|----------|
| 5.1 | **Two sigma sources**: stations.js derives from stations.json, but guard.js has its own hardcoded CORRELATED_STATIONS. Should import from stations.js. | 🟡 |
| 5.2 | **`getEffectiveSigma` returns 3.5 for unknown stations** — silent fallback, should throw or warn | 🟢 |
| 5.3 | **Calibration script is standalone** — not integrated into `kalshi calibrate` command (which does its own 30-day analysis). Two separate calibration paths. | 🟡 |
| 5.4 | **No automated recalibration** — manual script only. Should run weekly/monthly. | 🟡 |

### Score: 15/20

---

## Total Score: 68/100

| Dimension | Score | Weight |
|-----------|-------|--------|
| Calibration Methodology | 14/20 | Core |
| Data Quality | 15/20 | Core |
| Correlation Management | 8/20 | **Critical gap** |
| Live IV Analysis | 16/20 | Good |
| Architecture | 15/20 | Good |

---

## Priority Fixes

### P0 — Do Before Next Trade
1. **Wire correlation groups into guard.js** — import `CORRELATION_GROUPS` from stations.js, replace empty Map
2. **Add portfolio correlation penalty** — when multiple correlated stations are GO, reduce Kelly fraction by correlation factor (suggest 0.5× for same-group)

### P1 — This Week
3. **Add baseSigmaLow for all stations** — run calibration for daily lows
4. **Fix KPHL ticker** — either add high ticker or ensure baseSigmaLow exists for low trading
5. **Investigate KDFW 20.98¢ edge** — verify market data, check for stale quotes

### P2 — This Month
6. **ASOS validation script** — compare Open-Meteo archive to NWS ASOS observations
7. **Summer recalibration plan** — schedule re-run of calibrate-new-stations.js in May
8. **Empirical correlation measurement** — compute forecast error correlations between station pairs

### P3 — Backlog
9. **Unify calibration paths** — merge `scripts/calibrate-new-stations.js` into `kalshi calibrate` command
10. **Add KATL to a correlation group** (or create "southeast" group)
