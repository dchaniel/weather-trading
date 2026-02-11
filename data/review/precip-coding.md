# Precipitation Strategy — Coding Report

## Overview
Built a complete precipitation trading strategy for Kalshi rain/snow markets, integrated into the existing multi-strategy trading platform.

## Architecture

### New Files
- `lib/precipitation/stations.js` — Station configs with climatological normals, Gamma priors, market type metadata
- `lib/precipitation/forecast.js` — Multi-model precip forecasts (NWS PoP + GFS + ECMWF), consensus builder, month-to-date actuals
- `lib/precipitation/ensemble.js` — Two probability models:
  - **Daily binary**: Platt-scaled logistic calibration of PoP forecasts (NWS/GFS/ECMWF)
  - **Monthly total**: Bayesian Gamma distribution with MTD conditioning + forecast updating
- `lib/precipitation/matcher.js` — Market scanner: ticker parsing, contract scoring, position sizing via existing Kelly pipeline
- `lib/precipitation/calibration.js` — Historical calibration: Brier scores, reliability diagrams, Gamma fit validation
- `commands/precip.js` — CLI with 4 subcommands: scan, markets, forecast, calibrate

### Modified Files
- `bin/kalshi.js` — Added `precip` command routing
- `commands/recommend.js` — Integrated precipitation into unified recommendation engine
- `config.json` — Added `precipitation` config section

## Statistical Model

### Daily Binary Rain (KXRAINNYC)
- **Input**: NWS PoP (already well-calibrated), GFS/ECMWF precipitation amounts
- **Calibration**: Platt scaling (logistic regression) per source, with horizon decay blending toward climatology
- **Weighting**: NWS 40%, GFS 35%, ECMWF 25% (inverse-Brier-score motivated)
- **Output**: Calibrated P(rain ≥ 0.01") with uncertainty bounds
- **Validation**: Brier skill score = 0.71 on 60-day SFO sample (excellent)

### Monthly Total Rain (KXRAIN*M)
- **Distribution**: Gamma(α, β) — the standard for monthly precipitation
  - Non-negative, right-skewed, handles zero-inflation at distribution level
  - NOT normal/Student-t (those allow negative rainfall — nonsensical)
- **Bayesian updating**: Prior from NOAA climatological normals → condition on MTD actual + NWP forecast for remaining days
- **P(total > threshold)**: Via regularized incomplete gamma function (Lentz continued fraction)
- **Parameters**: α = mean²/variance, β = mean/variance — shrink variance as month progresses

### Key Statistical Differences from Temperature Strategy
1. **Zero-inflation**: Precipitation is 0 on many days — normal distribution inappropriate
2. **Right skew**: Heavy rainfall events create long right tail — Gamma captures this
3. **Binary nature**: Daily markets are inherently binary — use calibrated probability directly
4. **MTD conditioning**: Monthly markets require Bayesian updating as actual data accumulates
5. **Forecast skill**: Precipitation forecasts degrade faster with lead time than temperature

## Numerical Implementation
- Gamma CDF via regularized incomplete gamma function
  - Series expansion for x < a+1
  - Lentz continued fraction for x ≥ a+1
  - Validated against known values
- Platt scaling for PoP calibration
- Logistic mapping for amount→probability conversion
- Log-gamma via Lanczos approximation (shared with core/utils.js)

## Integration
- Reuses existing: `positionSize()`, `TRANSACTION_COST`, `getLedger()`, `getSeriesMarkets()`
- Follows same patterns: consensus building, model weighting, edge-at-executable-price
- Config-driven: tradeable stations, min edge in config.json
- Wired into `kalshi recommend` for unified recommendations

## Testing Results
- `kalshi precip markets` — lists all 6 stations with live bid/ask/volume ✅
- `kalshi precip forecast NYC_DAILY` — 3-day calibrated PoP forecast ✅
- `kalshi precip forecast SFO_MONTHLY` — Gamma model with threshold probabilities ✅
- `kalshi precip` — found 7 opportunities with edges up to 35% ✅
- `kalshi precip calibrate 60 SFO` — BSS=0.71, reliability diagram ✅
- `kalshi recommend` — precipitation integrated into unified output ✅

## Risk Notes
- All stations marked `calibrated: false` — need N≥30 live observations before real trading
- Monthly threshold markets have low liquidity (especially DEN, CHI) — volume caps apply
- Gamma model assumes stationarity within month — may fail during atmospheric river events
- Daily binary model relies on NWS PoP quality — degrade gracefully to GFS if NWS unavailable
