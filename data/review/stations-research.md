# New Stations Expansion Review

**Date**: 2026-02-11  
**Reviewer**: Research Subagent  
**Scope**: Expansion from 3 → 12 tradeable stations (15 total, 12 tradeable, 2 failed, 1 low-only)

---

## Executive Summary

The station expansion is **well-executed**. Calibration uses 60-day Open-Meteo historical forecasts (N=61 per station), proper MAE computation with model-specific breakdowns, and conservative σ derivation (MAE × 1.1). The tiering system correctly identifies and excludes problem stations (KLAX, KMDW). Live `kalshi iv` confirms the pipeline works end-to-end: 3 stations cleared for trading today (KATL, KDFW, KMSP) with strong edges.

**Overall Score: 78/100**

---

## Dimension Scores

### 1. Strategy Rigor — 16/20

**Strengths:**
- Core strategy (forecast σ vs market implied σ) is sound and unchanged from validated original
- Proper σ gap threshold (≥1.5°F) filters marginal opportunities
- Bayesian σ updating (`bayesianSigmaUpdate()`) allows calibration to evolve with live data
- Inverse-MAE model weighting gives ECMWF appropriate dominance (consistently lower MAE)
- Winter seasonal bump (+0.5°F) applied uniformly
- Horizon-dependent σ multipliers for multi-day forecasts

**Weaknesses:**
- baseSigma = MAE × 1.1 is a simple heuristic; the 10% buffer lacks theoretical justification. Should be based on CI upper bound or tail quantile
- No cross-validation or out-of-sample testing — calibration window = evaluation window
- Tier B stations (KOKC, KDCA) included as tradeable despite marginal edges; KDCA has MAE=1.52°F with +1.32°F bias — systematic, not random
- KPHL excluded from `TRADEABLE_STATIONS` but flagged as tradeable by IV pipeline (guard catches it, but messy)

### 2. Statistical Validity — 14/20

**Strengths:**
- N=61 observations per station (60-day window) exceeds minimum N=30 threshold
- Confidence intervals computed via bootstrap approximation in calibrate command
- Reliability tiers (EXCELLENT/GOOD/ADEQUATE/POOR/INSUFFICIENT) based on sample size
- Seasonal breakdown attempted (winter/spring/summer/fall)
- Both GFS and ECMWF MAE computed separately for model weighting

**Weaknesses:**
- **60 days is winter-only** (Dec 12 – Feb 10). Summer MAE unknown. Stations calibrated only in winter conditions — seasonal generalization is untested
- **No out-of-sample split**: MAE computed on same data used to set σ → optimistic bias
- P95 tail risk not incorporated into σ (KOKC P95=3.55°F but baseSigma=1.28°F — 2.8× ratio)
- Bias correction not applied to forecasts despite significant bias at some stations (KDCA +1.32°F, KLAX +2.13°F). The `bias` field in stations.js is set but unclear if `forecast.js` actually uses it for debiasing
- Normal distribution assumption for temperature errors is convenient but unvalidated — tail behavior matters for Kelly sizing
- No autocorrelation analysis — consecutive forecast errors may be correlated (weather regimes), affecting effective sample size

### 3. Market Microstructure — 16/20

**Strengths:**
- Implied σ computed from live Kalshi mid-prices across multiple strike thresholds
- `analyzeImpliedVol()` uses median + mean implied σ for robustness
- Deep ITM/OTM contracts filtered (price ≤0.02 or ≥0.98)
- Spread tracking per contract (bid-ask captured)
- Transaction cost (4¢) explicitly modeled in net edge calculation
- Edge computed at nearest-to-forecast threshold (not arbitrary fixed threshold)

**Weaknesses:**
- Mid-price used for σ estimation but edge sizing should use executable (ask) price — documented but unclear if `recommend` command actually does this
- No liquidity/volume filter — thin markets may have unreliable implied σ
- No bid-ask spread guard (the 3°F model spread check is different from market spread)
- SERIES_MAP is hardcoded — if Kalshi changes ticker format, silent failure

### 4. Risk Management — 17/20

**Strengths:**
- Quarter-Kelly sizing (kellyFraction=0.25) — conservative
- Multi-layered guard system: σ gap, model spread (≤3°F), climatological outlier (±15°F), daily trade limit, station whitelist
- Failed stations (KLAX, KMDW) properly excluded with `enabled: false` + removed from `TRADEABLE_STATIONS`
- GO/NO-GO decision matrix provides clear, auditable trade authorization
- Tier system (A/B/F) with differentiated treatment
- Low-temp markets analyzed separately with `baseSigmaLow` for stations where lows are harder

**Weaknesses:**
- `maxTradesPerDay = 1` may be too restrictive when 12 stations offer independent signals (though weather correlation is real)
- No portfolio-level correlation management — KDFW/KAUS/KOKC are geographically proximate (all central TX/OK) and likely correlated
- Tier B stations (KOKC, KDCA) are tradeable but have no tighter sizing constraint vs Tier A

### 5. Data Quality — 15/20

**Strengths:**
- Open-Meteo historical forecast API provides actual model outputs (not just observations) — correct approach for evaluating forecast skill
- Both GFS and ECMWF model tracks fetched independently
- Archive API for ground truth actuals
- Station metadata (lat/lon, NWS office, grid coords) properly configured for each station
- Climatological normals by month provide sanity checking

**Weaknesses:**
- **Open-Meteo vs Kalshi settlement source**: Kalshi settles on NWS ASOS observations at specific airport stations. Open-Meteo uses gridded reanalysis which may differ from point observations, especially for coastal/microclimate stations (exactly the KLAX failure mode)
- No validation that Open-Meteo actuals match Kalshi settlement values — a systematic offset would corrupt all calibration
- 60-day window is short; no multi-year historical backtest to assess regime dependence
- `fetchHistoricalObservations` in calibrate.js uses same API as forecast evaluation — potential data leakage if Open-Meteo's historical forecast API includes late-initialization runs

---

## Live IV Results (2026-02-11)

| Station | Our σ | Mkt σ | Gap | Net Edge | Decision |
|---------|-------|-------|-----|----------|----------|
| KNYC | 1.3 | 3.13 | +1.83 | -0.47¢ | NO-GO |
| KMIA | 1.3 | 2.69 | +1.39 | 6.12¢ | NO-GO (gap<1.5) |
| KATL | 1.5 | 4.69 | +3.19 | 6.35¢ | **GO** |
| KDFW | 1.3 | 4.77 | +3.47 | 20.98¢ | **GO** |
| KMSP | 1.6 | 6.90 | +5.30 | 10.39¢ | **GO** |
| KSEA | 1.6 | 5.24 | +3.64 | -2.29¢ | NO-GO |
| KOKC | 1.8 | 3.09 | +1.29 | 2.11¢ | NO-GO |
| KDCA | 2.2 | 4.07 | +1.87 | 0.06¢ | NO-GO |

**Observation**: Expansion from 3→12 stations increases daily opportunity set from ~1 GO to ~3 GO stations. This is the primary value — diversification of trading opportunities across uncorrelated weather regimes.

**Anomaly**: KNYC shows +1.83°F gap but negative net edge — the edge computation seems inconsistent with the gap size. May indicate the nearest-threshold edge calculation behaves differently than the aggregate σ gap.

---

## Recommendations

1. **Validate Open-Meteo actuals vs Kalshi settlement** — fetch 30 days of NWS ASOS observations and compare to Open-Meteo archive values. Any systematic offset invalidates calibration.
2. **Add out-of-sample holdout** — use 45 days for calibration, 15 for validation. Current approach overfits.
3. **Apply bias correction** — stations with |bias| > 0.5°F (KDCA, KLAX, KOKC, KIAH) should have forecasts debiased before probability calculation.
4. **Geographic correlation guard** — DFW/AUS/OKC should count as partially correlated for portfolio exposure limits.
5. **Summer recalibration required** — current σ values are winter-only. Schedule recalibration in June with warm-season data.
6. **Incorporate P95 into risk** — baseSigma from MAE ignores tail risk. Consider baseSigma = max(MAE×1.1, P95×0.5) for stations with fat tails (KOKC).

---

## Score Summary

| Dimension | Score | Notes |
|-----------|-------|-------|
| Strategy Rigor | 16/20 | Sound core strategy, heuristic σ buffer |
| Statistical Validity | 14/20 | Winter-only calibration, no OOS split |
| Market Microstructure | 16/20 | Good implied σ pipeline, needs liquidity filter |
| Risk Management | 17/20 | Strong guards, missing correlation management |
| Data Quality | 15/20 | Unvalidated settlement source match |
| **TOTAL** | **78/100** | **Solid expansion, needs summer recalibration** |
