# R18 — Research Review of Kalshi Trading System

**Reviewer**: Fresh research reviewer  
**Date**: 2026-02-10  
**Codebase**: ~6,725 lines across lib/, commands/, bin/  
**System Health**: 100% (6/6 checks pass)

---

## Scoring Summary

| Dimension | Score | Max | Notes |
|-----------|-------|-----|-------|
| 1. Strategy Rigor | 19 | 20 | Excellent methodology, Bayesian updating now in place |
| 2. Statistical Validity | 19 | 20 | Student-t, walk-forward, Bayesian σ, calibration pipeline |
| 3. Market Microstructure | 19 | 20 | Executable prices, 9 guards, liquidity filters |
| 4. Risk Management | 19 | 20 | Quarter-Kelly, proportional limits, circuit breakers |
| 5. Data Quality | 19 | 20 | Multi-source, freshness detection, JSONL history |
| **TOTAL** | **95** | **100** | |

---

## 1. Strategy Rigor (19/20)

### Strengths
- **Multi-model consensus**: NWS + GFS + ECMWF with inverse-MAE weighting. ECMWF gets higher weight where validated.
- **Student-t(ν=5) probability model**: Proper implementation via regularized incomplete beta function. Heavier tails than Gaussian — appropriate for weather forecast errors.
- **Bayesian σ updating** (NEW R18): `bayesianSigmaUpdate()` uses Normal-Inverse-Gamma conjugate prior. Prior from N=30 calibration shrinks toward observed MAE as data accumulates. `getEffectiveSigma()` applies this automatically.
- **Ensemble σ with calibrated floor**: Model agreement tightens, disagreement widens, but floor prevents overconfidence.
- **KMDW exclusion**: Data-driven removal after MAE=2.56°F discovery. Now with `enabled: false` in config.

### Issues
- **Crypto strategy signals are standard momentum factors** (RSI, Bollinger, MA) with no demonstrated edge on Kalshi crypto specifically. Correctly labeled PAPER-ONLY and sized conservatively. (-1)

---

## 2. Statistical Validity (19/20)

### Strengths
- **Walk-forward validation**: Expanding window, best-σ on train, evaluate on test.
- **Full scoring suite**: Brier, log loss, ECE, calibration curves, sharpness.
- **GARCH parameter estimation** (NEW R18): Method-of-moments from autocorrelation of squared residuals. Falls back to conservative defaults for N<50. No longer hardcoded.
- **Bayesian σ posterior** (NEW R18): CI [0.74, 0.94] for KNYC narrows as observations accumulate.
- **Cost sensitivity analysis**: Sweeps spread from 0 to 10¢.

### Issues
- **No out-of-sample Kalshi P&L verification**: Can't backtest against actual historical market prices. System is transparent about this and uses sensitivity analysis. (-1)

---

## 3. Market Microstructure (19/20)

### Strengths
- **Executable prices for sizing**: `scoreContract` uses yesAsk for YES, 1-yesBid for NO. Mid-price only for diagnostic IV display — clearly documented.
- **9-guard system**: Station whitelist, model spread, σ gap, daily limit, position size, clim outlier, cross-station correlation, cumulative exposure, bid-ask spread.
- **Liquidity awareness**: Volume filter, 10% volume cap, depth warnings.
- **Transaction cost modeling**: 4¢ flat + graduated Kalshi fees in backtest.

### Issues
- **No order book depth data from Kalshi API**: 10% volume cap and 20-contract hard limit mitigate, but can't compute actual market impact. (-1)

---

## 4. Risk Management (19/20)

### Strengths
- **Quarter-Kelly sizing**: Conservative fractional Kelly with strategy-specific calibration.
- **Proportional risk limits** (NEW R18): Drawdown floor = 20% from peak (not fixed $800), daily loss = 5% of bankroll (not fixed $50). Scales with account size.
- **Multi-layer position limits**: Per-trade, per-station, per-day, cumulative, hard caps.
- **Circuit breaker**: Proportional drawdown floor.
- **Cross-station correlation guard**: NYC/Chicago same-day blocking.

### Issues
- **No dynamic Kelly adjustment based on σ confidence interval**: Quarter-Kelly is static. Could reduce to 1/8 Kelly when CI is wide (early observations). Not a flaw, just an enhancement. (-1)

---

## 5. Data Quality (19/20)

### Strengths
- **Triple-source weather**: NWS, GFS, ECMWF independently fetched.
- **Data freshness detection** (NEW R18): `checkDataFreshness()` checks NWS update timestamps. Stale data (>12h) generates warnings through consensus pipeline.
- **JSONL append-only history**: Versioned records, no data loss.
- **KMDW cleanup**: `enabled: false` makes disabled status self-documenting in code.

### Issues
- **NWS observation parsing still depends on single source**: No cross-validation against Open-Meteo archive for settlement. (-1)

---

## Verdict

**Score: 95/100**

R18 addressed the key R17 gaps: Bayesian σ updating replaces static calibration, GARCH parameters are estimated from data, data freshness is detected, and risk limits scale proportionally. The system now has formal statistical foundations where R17 had methodological shortcuts. The remaining deductions are for genuine architectural limitations (no depth data, single observation source) that would require external data sources to resolve.
