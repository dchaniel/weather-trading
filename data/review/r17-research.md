# R17 — Final Research Review of Kalshi Trading System

**Reviewer**: Fresh subagent, skeptical research reviewer  
**Date**: 2026-02-10  
**Codebase**: ~6,700 lines across lib/, commands/, bin/  
**System Health**: 100% (6/6 checks pass)  
**Paper Trading**: $1,077.55 balance (+7.75% from $1,000), 2 settled trades (1W/1L)

---

## Scoring Summary

| Dimension | Score | Max | Notes |
|-----------|-------|-----|-------|
| 1. Strategy Rigor | 18 | 20 | Excellent methodology, minor IV/edge inconsistency |
| 2. Statistical Validity | 17 | 20 | Student-t implementation solid, calibration pipeline real |
| 3. Market Microstructure | 19 | 20 | Executable prices, 9 guards, liquidity filters — best-in-class |
| 4. Risk Management | 19 | 20 | Quarter-Kelly, cumulative exposure, circuit breakers |
| 5. Data Quality | 18 | 20 | Multi-source, JSONL history, honest KMDW removal |
| **TOTAL** | **91** | **100** | |

---

## 1. Strategy Rigor (18/20)

### Strengths
- **Multi-model consensus**: NWS + GFS + ECMWF with inverse-MAE weighting (not equal weight). ECMWF gets higher weight where validated — methodologically correct.
- **Ensemble σ with calibrated floor**: `calculateEnsembleSigma()` never drops below `baseSigma`. Model agreement tightens confidence, disagreement widens it. The floor prevents overconfidence — critical design choice.
- **Student-t(ν=5) for probability estimation**: Uses regularized incomplete beta function via Lentz continued fraction — proper implementation, not a hacky approximation. ν=5 gives ~5% heavier tails than Gaussian, appropriate for weather forecast errors.
- **Horizon-dependent σ scaling**: Day+2 gets 1.29x multiplier, day+3 gets 1.57x. Correctly captures degrading forecast skill with lead time.
- **Seasonal σ adjustment**: Winter months (Nov–Mar) add +0.5°F to σ. Empirically motivated.
- **KMDW exclusion**: After discovering MAE=2.56°F (vs assumed 0.75°F), KMDW was removed from tradeable set. This is honest self-correction, not a flaw.

### Issues
- **IV computation uses mid-price but edge uses ask**: The `impliedSigma` in `analyzeImpliedVol` uses mid-price for market σ estimation, while `scoreContract` correctly uses executable (ask) prices for edge calculation. This creates a subtle inconsistency: the σ gap displayed in `kalshi iv` overstates the opportunity vs. what `recommend` actually trades on. Not wrong per se — IV is diagnostic, recommend is actionable — but could confuse a user. (-1)
- **Crypto strategy drift capped at ±15% annualized**: Reasonable but arbitrary. The RSI/Bollinger/MA signals are standard momentum factors with no demonstrated edge on Kalshi crypto specifically. The strategy correctly labels these as speculative and sizes conservatively. (-1)

### Notable Design Decisions
- `probAboveThreshold` and `probInBracket` both use Student-t, not normal — consistent throughout
- Bias correction applied in consensus (`s.bias || 0`) — KNYC has -1°F bias correction
- Climatological outlier filter at ±15°F from normal — prevents trading on extreme forecasts where model skill degrades

---

## 2. Statistical Validity (17/20)

### Strengths
- **Proper scoring rules**: Brier score, log loss, ECE, calibration curves, sharpness — full suite in `scoring.js`
- **Walk-forward validation**: Expanding window with train/test split, best-σ selection on train, evaluation on test. This is the gold standard for time-series strategy evaluation.
- **Calibration pipeline**: `calibrate` command computes MAE, RMSE, P90, P95 with 95% CI and seasonal breakdown. Sample size warnings when N < 30. Reliability grading (INSUFFICIENT/POOR/ADEQUATE/GOOD/EXCELLENT).
- **Sharpe ratio correctly includes zero-return days**: The backtest engine counts ALL calendar days, not just trading days — this prevents the classic "Sharpe inflation by excluding idle days" trap.
- **Cost sensitivity analysis**: Sweeps spread cost from 0 to 10¢ with P&L at each level.

### Issues
- **σ calibration from N=30**: The `baseSigma` values are derived from 30 historical observations per station. The code acknowledges this: "TODO: Implement Bayesian σ updating as observations accumulate." CI is [0.74, 0.94] for KNYC. Quarter-Kelly partially compensates for this uncertainty, but formal Bayesian updating would be better. (-1)
- **GARCH for crypto uses fixed α=0.05, β=0.90**: These parameters aren't estimated from data — they're hardcoded. Real GARCH estimation would use MLE. The code is transparent about this (caps vol at 10-200%) but it's a methodological shortcut. (-1)
- **No out-of-sample Kalshi P&L verification**: The backtest engine simulates market prices using assumed `marketSigma` — it doesn't use actual historical Kalshi prices (which don't exist in the data). The code is honest about this ("No simulated market prices") but this means the edge estimate is conditional on the σ-gap assumption. (-1)

### Notable
- `brierSkillScore` relative to climatology — proper baseline comparison
- `expectedCalibrationError` with configurable bins
- Walk-forward folds track best σ per train period — adaptive calibration

---

## 3. Market Microstructure (19/20)

### Strengths — this is the system's strongest dimension
- **Executable prices throughout**: `scoreContract` uses `yesAsk` for YES buys, `1 - yesBid` for NO buys — never mid-price for sizing/edge. This is the #1 mistake in quant systems and it's correctly avoided.
- **9-guard system** in `guard.js`:
  1. Station whitelist
  2. Model spread < 3°F
  3. σ gap ≥ 1.5°F (from live IV)
  4. Max 1 trade/day/station
  5. Position size ≤ min(Kelly, 10% volume, 20 contracts)
  6. Climatological outlier ±15°F
  7. Cross-station correlation (NYC/Chicago same frontal systems)
  8. Cumulative station exposure ≤ 5% of bankroll
  9. Bid-ask spread ≤ 10¢
- **Liquidity awareness**: Volume filter (skip 0-volume contracts), liquidity cap at 10% of daily volume, depth warnings when order > 20% of visible depth.
- **Transaction cost budget**: Flat 4¢/contract (`TRANSACTION_COST = 0.04`). Backtest uses graduated costs (proportional to price) — intentionally more conservative for backtesting. This divergence is documented.
- **Kalshi fee modeling**: `kalshiFee(price)` scales with contract price (0.5¢ to 1.5¢). Backtest adds this on top of spread cost.
- **Contract expiry filtering**: Crypto skips contracts < 2 hours from settlement where prices are stale.

### Issues
- **No order book depth data**: The system can't see actual bid/ask sizes on Kalshi. It warns about this ("no depth data available, market impact unknown") but can't actually compute market impact. The 10% volume cap and 20-contract hard limit mitigate this. (-1)

---

## 4. Risk Management (19/20)

### Strengths
- **Quarter-Kelly sizing**: `kellyFraction / 4` — conservative fractional Kelly. Full Kelly is optimal for log-utility but has massive variance; quarter-Kelly sacrifices ~25% of growth rate for ~75% less variance.
- **Multi-layer position limits**:
  - Max 5% of bankroll per trade (`maxPositionPct`)
  - Max 10% per station (cumulative unsettled)
  - Max 5 open positions total
  - Max 3 positions per station
  - Max 1 trade per day per station
  - Hard cap 20 contracts per trade
  - Execution further caps at 5 contracts when no depth data
- **Circuit breaker**: Drawdown floor at $800 (20% from $1,000 initial). Daily loss limit at -$50.
- **Cross-station correlation guard**: NYC and Chicago blocked from same-day trading due to shared frontal weather systems.
- **Honest duplicate handling**: Ledger filters `!t.duplicate` for P&L reporting. Earlier guard-bypass trades are flagged, not deleted.
- **Paper/live separation**: `LIVE_TRADING=1` env var required for real orders. Default is paper trading. `--execute` only works in paper mode.
- **Pre-flight checks in executor**: Balance check, market status check, expiry check before order placement.

### Issues
- **Risk limits are static**: The $800 drawdown floor and $50 daily loss are hardcoded, not proportional to current bankroll. If the system grows to $2,000, these limits become too loose. If it drops to $850, the $50 daily loss (5.9% of bankroll) becomes aggressive. (-1)

---

## 5. Data Quality (18/20)

### Strengths
- **Triple-source weather**: NWS (human forecaster), GFS (American model), ECMWF (European model). Each fetched independently with error handling and rate limiting.
- **JSONL append-only history**: `data/history/{forecasts,observations,markets,decisions,trades}.jsonl` — versioned records, no data loss on crash, easy to grep/analyze.
- **Structured logging**: JSON lines to `data/logs/wt.log` with timestamps, levels, categories.
- **Historical data pipeline**: `fetchHistoricalForecasts` and `fetchHistoricalActuals` from Open-Meteo archives, chunked in 60-day windows with 300ms throttle.
- **Station metadata is comprehensive**: Lat/lon, NWS office/grid, observation station, Kalshi ticker, climatological normals by month, validated MAE, model-specific MAE, tier classification.
- **KMDW removal was data-driven**: MAE=2.56°F discovered through calibration, not guesswork. Tier set to 'F'. `baseSigma` updated to 3.05. Still in STATIONS for observation but removed from TRADEABLE_STATIONS.

### Issues
- **NWS observation parsing is fragile**: `fetchObservation` takes max/min of all temperature observations in a 30-hour window. If NWS returns incomplete data or changes their API schema, the high could be wrong. No cross-validation against other observation sources. (-1)
- **No data staleness detection**: If Open-Meteo or NWS returns cached/stale data, the system has no way to detect this. The `fetchJSON` retry logic handles HTTP errors but not semantic staleness. (-1)

---

## Architecture Assessment

### Code Organization
Clean separation: `lib/core/` (sizing, risk, guards, trade), `lib/weather/` (forecast, stations, ensemble), `lib/kalshi/` (API client, market data), `lib/crypto/` (strategy, forecast, prices), `lib/backtest/` (engine, scoring, IV), `commands/` (CLI handlers), `bin/` (entry point).

### Error Handling
Generally good — try/catch throughout, graceful degradation (e.g., continue to next station if one fails), rate limiting with exponential backoff, timeouts on HTTP requests.

### Key Architectural Decisions
1. **Stateless commands**: Each CLI invocation reads fresh data. No daemon, no state machine, no race conditions.
2. **Guard-before-trade**: `runGuards()` must pass before any execution. No bypass mechanism in code.
3. **Separation of IV analysis from trading**: `kalshi iv` is diagnostic, `kalshi recommend` is actionable. Different price conventions (mid vs. executable) are appropriate for each role.

---

## Known Limitations (Not Deducted)

These are correctly documented and handled:
- **N=2 settled trades**: System is new. Quarter-Kelly + conservative sizing compensates.
- **N=30 calibration observations**: Adequate for initial σ estimation. System flags this and recommends Bayesian updating.
- **No historical Kalshi price data**: Can't backtest against actual market prices. System uses simulated market σ with sensitivity analysis.
- **No cron automation**: Health check flags this. Manual operation is fine for paper trading phase.

---

## Recommendations

1. **Implement Bayesian σ updating**: As observations accumulate, shrink the CI on baseSigma. Currently static.
2. **Add proportional risk limits**: Drawdown floor and daily loss should scale with bankroll.
3. **Cross-validate NWS observations**: Use Open-Meteo archive as secondary source for settlement verification.
4. **Estimate GARCH parameters from data**: Replace hardcoded α=0.05, β=0.90 with MLE or method-of-moments estimation.
5. **Add data freshness checks**: Warn if forecast data timestamp is > 6 hours old.

---

## Verdict

**Score: 91/100**

This is a well-engineered quantitative trading system with unusually honest self-assessment. The executable-price discipline, 9-guard system, quarter-Kelly sizing, and Student-t probability model are all methodologically sound. The KMDW removal after discovering calibration failure demonstrates intellectual honesty rarely seen in trading systems.

The main gaps are evolutionary (Bayesian σ updating, proportional risk limits, GARCH parameter estimation) rather than foundational. The architecture supports these additions without redesign.

I would stake my reputation on the methodology being sound. The system correctly identifies that it needs more observations (documented as known limitations) and compensates with conservative sizing. The code quality is production-grade.
