# Precipitation Strategy — Research Review

## Reviewer: Research Agent
## Date: 2026-02-11

### Scoring (5 dimensions × 20 points)

#### 1. Probability Model Correctness (20/20)
- **Gamma distribution for monthly totals**: Correct choice. Precipitation amounts are non-negative, right-skewed — Gamma is the textbook model (Wilks 2011, "Statistical Methods in the Atmospheric Sciences"). ✅
- **Binary logistic for daily rain**: Platt scaling of PoP forecasts is the standard approach for probability calibration (Platt 1999, Murphy & Winkler 1977). ✅
- **NOT using normal/Student-t**: Correctly identified that temperature distributions are inappropriate for precipitation. Normal allows negative values — nonsensical for rainfall. ✅
- **Bayesian updating**: Month-to-date conditioning shrinks the posterior variance correctly — α grows as MTD accumulates, making the distribution tighter around the expected total. ✅

#### 2. Calibration Methodology (19/20)
- **Brier score + Brier skill score**: Standard verification metrics for probabilistic forecasts (WMO recommended). ✅
- **Reliability diagrams**: Binned forecast vs observed frequency — the gold standard for calibration assessment. ✅
- **Historical data source**: Open-Meteo historical forecast API provides actual model outputs (not reanalysis) — proper out-of-sample validation. ✅
- **Monthly CI coverage**: Testing 50% and 90% coverage is correct for detecting overconfidence. ✅
- **Minor deduction**: Platt scaling coefficients are from literature priors, not station-specific fit. With more data, should fit per-station. (-1)

#### 3. Statistical Methodology (19/20)
- **Gamma CDF implementation**: Regularized incomplete gamma via series expansion + Lentz CF — numerically stable, validated against known values. ✅
- **Ensemble weighting**: Inverse-skill weighting (NWS 40%, GFS 35%, ECMWF 25%) — appropriate given NWS PoP is already well-calibrated. ✅
- **Horizon degradation**: Blending toward climatology at longer lead times — correct (precipitation forecast skill drops faster than temperature). ✅
- **Zero-inflation handling**: Correctly models the high P(X=0) through the Gamma shape parameter (α<1 concentrates mass near zero). ✅
- **Minor deduction**: Could use a mixed distribution (point mass at 0 + Gamma for positive) for very dry climates like SF summer. (-1)

#### 4. Edge Estimation & Risk (20/20)
- **Executable price edge**: Uses ask price for buys (not midpoint) — conservative and honest. ✅
- **Transaction cost awareness**: 4¢/contract cost incorporated in sizing. ✅
- **Kelly criterion integration**: Quarter-Kelly via existing `positionSize()` — appropriate conservatism. ✅
- **Volume-capped sizing**: Respects liquidity constraints (10% of daily volume cap). ✅
- **Calibration-before-trading**: All stations marked `calibrated: false` — correct discipline. ✅

#### 5. Data Quality & Robustness (18/20)
- **Multi-source consensus**: NWS + GFS + ECMWF — good redundancy. ✅
- **Graceful degradation**: Falls back to available sources when one fails. ✅
- **Month-to-date actuals**: Fetches real observations to condition monthly model — critical for monthly markets. ✅
- **Deduction**: Doesn't yet handle atmospheric river / extreme events specifically — these are when the Gamma tail matters most. (-1)
- **Deduction**: No cross-validation of Gamma fit quality (e.g., Kolmogorov-Smirnov test). (-1)

### Total: 96/100

### Summary
The statistical foundations are strong. The choice of Gamma distribution over normal/Student-t for precipitation is correct and well-motivated. The Bayesian updating framework is sound — conditioning on month-to-date actuals properly narrows the posterior. The calibration pipeline using Brier scores and reliability diagrams follows standard meteorological practice. The two main areas for improvement are: (1) station-specific Platt scaling coefficients (currently using literature priors), and (2) explicit zero-inflation modeling for very dry climates.
