# R16 — Independent Research Review of Kalshi Weather Trading System

**Reviewer**: Fresh subagent (no prior context)  
**Date**: 2026-02-10  
**Codebase**: ~6,645 lines across 36 JS files  
**Methodology**: Full code audit + live system execution

---

## Executive Summary

This is a well-architected algorithmic trading system for Kalshi weather prediction markets. The core thesis — that NWP model consensus forecasts (NWS/GFS/ECMWF) have tighter σ than Kalshi market implied σ, creating systematically mispriced contracts — is sound and well-implemented. The system demonstrates genuine engineering maturity with layered defenses, honest self-assessment (KMDW removal), and conservative sizing.

**Overall Score: 91/100**

I cannot give 95+ because of real methodological gaps that would need resolution before I'd stake my reputation, detailed below.

---

## Dimension Scores

### 1. Strategy Rigor — 19/20

**Strengths:**
- Core thesis is economically coherent: weather NWP models at day+0/+1 horizons have MAE ~0.7-0.85°F for stable stations, while Kalshi markets price implied σ of 3-4°F. This is a genuine, exploitable information asymmetry.
- Multi-model consensus with inverse-MAE weighting (ECMWF weighted higher where it has lower error). Not equal-weight naive.
- Student-t distribution (ν=5) for probability computation — appropriate fat-tail correction for weather forecast errors, which are empirically leptokurtic.
- Executable price usage (ask, not mid) for edge calculation — honest about what you'd actually pay. This alone puts the system ahead of most amateur quant projects.
- Horizon-dependent σ multipliers (1.0x for day+0/+1, 1.29x for day+2, 1.57x for day+3) — correctly models increasing forecast uncertainty.
- Seasonal σ adjustment (+0.5°F winter bump) — reflects genuine meteorological difficulty.
- Bias correction per station (KNYC -1°F) — appropriate calibration.

**Weaknesses:**
- The implied volatility extraction uses a **normal distribution** model (`normalInvCDF`) while the probability calculations use **Student-t**. This is an internal inconsistency. The IV extracted from markets assumes Gaussian tails, but edge calculations use fatter tails. The mismatch slightly inflates apparent edge when the market is actually pricing heavier tails. (-1 point)

### 2. Statistical Validity — 16/20

**Strengths:**
- N=30 calibration sample per station for MAE estimation — small but meets minimum viable for point estimates.
- Honest about KMDW failure (MAE=2.56°F vs expected 0.75°F — 3.4x calibration error caught and station removed).
- `baseSigma` derived from `MAE × 1.1` safety multiplier — conservative.
- Ensemble σ floor: dynamic sigma from model spread can only INCREASE, never decrease below calibrated baseSigma. This is correct — more models agreeing shouldn't make you overconfident beyond calibration.

**Weaknesses:**
- **N=30 is marginal** for σ estimation. The standard error of MAE at N=30 is roughly MAE/√(2N) ≈ 0.1°F. A confidence interval on the 0.84°F baseSigma for KNYC would be roughly [0.74, 0.94]. The edge calculation is sensitive to this — if true σ is 0.94 instead of 0.84, the probability gap narrows meaningfully. (-1)
- **No out-of-sample validation period**. The same 30 observations that calibrated σ are the only performance evidence. There's no train/test split. (-1)
- **Only 2 non-duplicate settled trades** (1W/1L). Win rate of 50% with N=2 is statistically meaningless — you literally cannot distinguish this from random with any confidence level. The system KNOWS this (noted in AGENTS.md), but it's still a real limitation. (-1)
- **No calibration of the Student-t ν parameter**. ν=5 is assumed, not fitted. Different ν values (3 vs 5 vs 10) change tail probabilities meaningfully for contracts 3+ standard deviations from forecast mean. (-1)

### 3. Market Microstructure — 18/20

**Strengths:**
- Uses **ask prices for buys** (not midpoint) — correctly models executable edge.
- 4¢ transaction cost constant — conservative and realistic for Kalshi.
- Bid-ask spread filter: skip contracts with spread > 10¢ (illiquid).
- Volume filter: skip zero-volume contracts.
- Liquidity cap: position size ≤ min(Kelly, 10% daily volume, 20 contracts hard cap).
- The `scoreContract` function correctly handles both threshold and bracket market types.
- IV extraction from multiple strike prices via `analyzeImpliedVol` — uses mean across strikes rather than single-point estimate.

**Weaknesses:**
- **No market impact model**. The system caps at 20 contracts but doesn't estimate how a 20-contract order might move the book. For thin Kalshi weather markets, this could be material. (-1)
- **No historical Kalshi price data** for backtesting. The system can only forward-test. This is acknowledged as a data limitation, not a code deficiency. (-1)

### 4. Risk Management — 19/20

**Strengths:**
- **9-guard pre-trade system** — genuinely comprehensive:
  1. Station whitelist (TRADEABLE_STATIONS)
  2. Model spread < 3°F
  3. Market σ gap ≥ 1.5°F
  4. Max 1 trade/day/station
  5. Position size ≤ hard cap (20 contracts)
  6. Climatological outlier check (±15°F from normal)
  7. Correlated station blocking (KNYC/KMDW same day)
  8. Cumulative station exposure ≤ 5% of bankroll
  9. Bid-ask spread ≤ 10¢
- **Quarter-Kelly sizing** — industry-standard conservative fraction.
- **Risk module with circuit breakers**: max daily loss ($50), max open positions (5), drawdown floor ($800), max position as % of bankroll (5%).
- **Per-station exposure limits** (10% of balance).
- **Paper trading mode by default** — `LIVE_TRADING=1` required for real orders.
- Guards are **hard blocks with no overrides** — the `trade` command refuses execution if any guard fails.
- Ledger correctly marks duplicate trades from the historical guard bypass bug.

**Weaknesses:**
- **No correlation-adjusted portfolio risk**. The correlated station check (KNYC/KMDW) is binary — either blocked or not. There's no portfolio-level VaR or scenario analysis across simultaneous positions. With 5 max open positions, correlated weather events could hit multiple positions. (-1)

### 5. Data Quality — 19/20

**Strengths:**
- **Three independent data sources**: NWS (human forecaster), GFS (NOAA), ECMWF (European) — genuine model diversity.
- API client with retry logic, exponential backoff, rate limit handling, and timeouts.
- Health check command (`kalshi health`) verifies all data sources live.
- JSONL append-only history logging for forecasts, observations, markets, decisions, trades — full audit trail.
- Kalshi API authentication via RSA-PSS signing — properly implemented.
- Station metadata is comprehensive: lat/lon, NWS grid coordinates, climatological normals by month, bias corrections, MAE estimates.
- Settlement logic correctly handles both threshold and bracket contract types.

**Weaknesses:**
- **No IV history collection** (health check shows ⚠️). The system can compute IV but isn't systematically storing it for time-series analysis of market efficiency. (-1)

---

## Aggregate Score

| Dimension | Score | Max |
|-----------|-------|-----|
| Strategy Rigor | 19 | 20 |
| Statistical Validity | 16 | 20 |
| Market Microstructure | 18 | 20 |
| Risk Management | 19 | 20 |
| Data Quality | 19 | 20 |
| **Total** | **91** | **100** |

---

## Why Not 95+

Three issues prevent staking-my-reputation confidence:

1. **Normal/Student-t inconsistency in IV extraction vs edge calculation**. The system extracts market implied σ using Gaussian inverse CDF but computes trading probabilities using Student-t. This means the "edge" includes some phantom alpha from the distributional mismatch. It's likely small (maybe 0.5-1% on typical contracts) but it's a systematic bias in the direction of overestimating edge.

2. **N=30 calibration with no out-of-sample holdout**. The baseSigma values are point estimates from 30 winter observations. The confidence interval overlaps with values that would significantly reduce edge. A proper approach would be a rolling window or at minimum a temporal split.

3. **2 settled trades is not validation**. The code and methodology are excellent, but "does it make money" is unanswered. The 50% win rate (1W/1L) after filtering for non-duplicates provides zero statistical evidence of edge. The system needs 50-100+ settled trades before the track record means anything.

These are **data/time limitations**, not code quality issues. The code itself is production-grade. If forced to score code quality alone (ignoring track record), this would be 95-96.

---

## Notable Engineering Highlights

- Clean ES module architecture with proper separation of concerns
- The guard bypass bug was caught, documented, and fixed — duplicates marked in ledger rather than deleted (audit trail preserved)
- The `matcher.js` extraction from `recommend.js` shows good refactoring discipline
- Multi-strategy architecture (weather + crypto) with unified risk management
- The ensemble σ system that can only widen (never narrow below calibrated floor) is a genuinely clever design choice

## Recommendations for 95+

1. Fix the Normal↔Student-t inconsistency by extracting implied σ using the same Student-t distribution used for probability calculation
2. Accumulate 50+ settled trades before claiming validated edge
3. Fit the Student-t ν parameter from observed forecast error distribution rather than assuming ν=5
4. Add rolling calibration: update baseSigma as new observations arrive rather than fixed point estimates
5. Set up automated IV history collection (the `collect-iv` command exists but isn't cronned)
