# R15 Research Review — Kalshi Multi-Strategy Trading System

**Reviewer**: Fresh skeptical review (no prior context)  
**Date**: 2026-02-10  
**Codebase**: ~6,700 lines JS across lib/, commands/, bin/  
**Live status**: Paper trading, $1,077.55 balance (+7.8%), 9 settled trades (88.9% win rate)

---

## Executive Summary

A well-engineered weather prediction market trading system with genuine statistical edge on select stations. The core thesis — that NWS/GFS/ECMWF ensemble forecasts have sub-1°F MAE while Kalshi markets price 3-5°F σ — is sound and validated. The system has appropriate guard rails, honest self-assessment (KMDW removal), and conservative sizing. Crypto strategy is bolted on but realistically assessed as marginal.

**Overall Score: 78/100** — Production-quality for paper trading; needs more observations and live market validation before real capital.

---

## Dimension 1: Strategy Rigor (16/20)

### Strengths
- **Kelly criterion properly implemented**: Quarter-Kelly with 5% bankroll cap per trade. `positionSize()` correctly computes `(pTrue - pMarket) / (1 - pMarket)` then divides by 4.
- **Edge calculation uses executable prices (R15 change)**: `scoreContract()` in matcher.js uses ask price for YES buys and `1 - yesBid` for NO buys, not midpoint. This is a critical improvement — midpoint edge is illusory.
- **Transaction cost awareness**: 4¢/contract hard-coded as `TRANSACTION_COST`, subtracted from edge calculations before trade decisions.
- **Multi-model consensus**: Inverse-MAE weighted ensemble (NWS 15%, ECMWF ~45%, GFS ~40%) with station-specific weights.

### Weaknesses
- **Kelly denominator uses market price, not 1-price**: In `positionSize()`, `kellyFraction = (pTrue - pMarket) / (1 - pMarket)` — this is correct for binary YES contracts but the function is also called for NO side where pMarket = noAsk. Need to verify NO-side Kelly is symmetric. *(Checked: it is — pEst and pMarket are both flipped before calling.)*
- **No Bayesian updating**: System doesn't update σ estimates based on accumulating observations. Station baseSigma is static configuration.
- **Crypto strategy Kelly uses same framework**: But crypto vol estimates (GARCH) have much wider confidence intervals than weather σ. The 5% minimum edge partially compensates but quarter-Kelly may still oversize crypto.

### Score Justification
Solid foundations. Kelly, edge after costs, executable prices — the big mistakes are avoided. Loses points for static σ and no formal Bayesian framework.

---

## Dimension 2: Statistical Validity (15/20)

### Strengths
- **Student-t fat tails (R15 change)**: `probAboveThreshold()` in utils.js uses ν=5 Student-t CDF via regularized incomplete beta function. This is mathematically correct — `studentTCDF(z, nu)` using Lentz continued fraction for `regBetaI()`. ν=5 gives ~5% heavier tails than Gaussian, appropriate for weather forecast errors.
- **Proper CDF implementation**: Both `normalCDF()` (Abramowitz & Stegun) and `studentTCDF()` (regularized incomplete beta) are numerically sound. Tested the Student-t: at z=0, returns 0.5; tails are heavier than normal.
- **Honest KMDW calibration failure**: Discovered MAE=2.56°F vs assumed 0.75°F → 3.4× calibration error. Correctly removed from trading. This demonstrates intellectual honesty.
- **Walk-forward backtesting**: `engine.js` implements expanding-window validation with train/test splits, sigma sweeps, and proper Sharpe calculation using ALL calendar days (not just trading days).
- **Proper scoring rules**: Brier score, log loss, calibration curves, ECE — all correctly implemented in scoring.js.

### Weaknesses
- **N=9 settled trades is far too few**: 88.9% win rate on 9 trades has a 95% CI of roughly [52%, 100%] by Wilson interval. Cannot distinguish skill from luck. Need N≥50 to have confidence.
- **Implied vol uses midpoint, not executable price**: In `implied_vol.js`, `analyzeImpliedVol()` takes `marketPrice` which in `implied_vol.js` (IV command) is `(yesBid + yesAsk) / 2`. But the actual edge calculation in matcher.js uses ask. This inconsistency means the displayed σ gap may overstate the tradeable gap.
- **Station σ calibration window unclear**: baseSigma values claim "30 obs" validation but the calibrate command fetches live forecasts for historical dates — this is lookahead-contaminated since models improve over time.
- **No bootstrap confidence intervals on backtest P&L**: The walk-forward shows point estimates only.

### Score Justification
Student-t upgrade is real and well-implemented. The statistical machinery is sound. But the sample size (N=9) makes all performance claims statistically meaningless. The IV midpoint vs ask inconsistency is a subtle but important gap.

---

## Dimension 3: Market Microstructure (14/20)

### Strengths
- **Executable price edge calc (R15)**: matcher.js `scoreContract()` uses `yesAsk` for YES buys and `1 - yesBid` for NO buys. This is the single most important microstructure fix.
- **Bid-ask spread filter**: 10¢ max spread on weather contracts, 20¢ on crypto. Contracts failing this are skipped.
- **Volume filter**: Zero-volume contracts skipped. Liquidity cap at 10% of daily volume or 20 contracts hard max.
- **Price range filter**: Skips contracts with bid < 10¢ or > 90¢ (deep ITM/OTM where models add no value).

### Weaknesses
- **No market impact model**: System logs `📊 DEPTH WARNING` and `⚠️ Large order — market impact unknown` but has no actual impact estimate. With 20-contract orders on thin Kalshi markets, you could easily move the market 3-5¢.
- **No order book depth data**: `yesDepth` and `noDepth` are always 0 in the code (`mkt.yesBidSize || 0`). The Kalshi API may not expose this, but the system pretends to check it.
- **Stale price risk**: No check for quote age. Kalshi contract prices can be hours old on low-volume markets. A 10¢ spread might actually be a 30¢ effective spread if the last trade was hours ago.
- **Limit orders only, no fill probability**: System places limit orders at the ask, but there's no modeling of fill probability or partial fills. On thin markets, this matters.

### Score Justification
The executable price fix is the most important microstructure consideration and it's done. Spread filters are reasonable. But no impact model, no depth data, and no stale-quote handling leave real execution risk unquantified.

---

## Dimension 4: Risk Management (17/20)

### Strengths
- **9 independent pre-trade guards in guard.js**:
  1. Station whitelist (TRADEABLE_STATIONS)
  2. Model spread < 3°F
  3. Market σ gap ≥ 1.5°F
  4. Max 1 trade/day/station
  5. Hard max 20 contracts
  6. Climatological outlier ±15°F
  7. Cross-station correlation (KNYC↔KMDW)
  8. Cumulative station exposure ≤ 5% bankroll
  9. Bid-ask spread ≤ 10¢
- **Circuit breaker**: $800 drawdown floor (20% of initial $1,000). Trading halts if balance drops below.
- **Position sizing caps**: min(quarter-Kelly, 5% bankroll, 10% daily volume, 20 contracts).
- **Risk status dashboard**: `getRiskStatus()` tracks balance, drawdown, P&L, violations.
- **Execution loop caps**: `executeApprovedTrades()` enforces max 1 trade execution per run, re-checks guards and risk limits before each trade.

### Weaknesses
- **maxOpenPositions = 5 but only 3 tradeable stations**: With max 1/day/station, the 5-position limit is rarely binding. But crypto trades could fill the remaining 2 slots with highly uncertain bets.
- **No portfolio-level correlation**: Guards check pairwise KNYC↔KMDW correlation, but there's no overall portfolio heat metric. If you have KNYC, KMIA, and KDEN positions all on weather, they're all correlated to national weather patterns.
- **DRY RUN by default is good**: `LIVE_TRADING=1` required for real orders. But the paper ledger doesn't simulate slippage, partial fills, or market impact.
- **Settlement is manual/delayed**: `kalshi trade settle <date>` requires explicit invocation. No automated settlement → open positions could accumulate without P&L recognition.

### Score Justification
Excellent guard system — 9 independent checks with no override mechanism. Circuit breaker, position caps, and correlation awareness are all present. Loses points for no portfolio-level heat metric and no automated settlement.

---

## Dimension 5: Data Quality (16/20)

### Strengths
- **Three independent forecast sources**: NWS (human forecasters), GFS (NOAA), ECMWF (European) via Open-Meteo API. All fetched with retry logic, timeouts, and rate limiting.
- **JSONL append-only audit trail**: `history.js` logs forecasts, observations, market snapshots, decisions, and trades to separate JSONL files. Versioned records (`v: 1`).
- **File-based caching with TTL**: Crypto prices cached 5 minutes, preventing API hammering.
- **Historical data pipeline**: `historical.js` can fetch historical forecasts and actuals for backtesting, with chunked 60-day requests.
- **Health check validates data integrity**: Duplicate trade IDs, incomplete records, API connectivity all checked.

### Weaknesses
- **No observation data validation**: `fetchObservation()` from NWS trusts the API completely. No sanity checks on returned temperatures (e.g., a 200°F reading would be accepted).
- **IV history file missing**: Health check shows `⚠️ No IV history file found`. The system can't track σ gap persistence over time without this.
- **Forecast cache could serve stale data**: GFS/ECMWF forecasts change throughout the day. The cache TTL isn't visible in forecast.js (no caching there), but if the agent runs `iv` then `recommend` in quick succession, the forecasts may differ from market conditions.
- **No data integrity checksums**: JSONL files could be corrupted (partial writes, disk full) with no detection mechanism.

### Score Justification
Good multi-source pipeline with audit trail and caching. Loses points for no observation validation, missing IV history, and no checksums on persistent data.

---

## Scoring Summary

| Dimension | Score | Max | Key Strength | Key Weakness |
|-----------|-------|-----|-------------|-------------|
| 1. Strategy Rigor | 16 | 20 | Kelly + executable prices + costs | Static σ, no Bayesian updating |
| 2. Statistical Validity | 15 | 20 | Student-t (ν=5), walk-forward backtest | N=9 trades (meaningless stats) |
| 3. Market Microstructure | 14 | 20 | Executable price edge calc | No impact model, no depth data |
| 4. Risk Management | 17 | 20 | 9 independent guards, circuit breaker | No portfolio-level heat metric |
| 5. Data Quality | 16 | 20 | 3-source ensemble + JSONL audit trail | Missing IV history, no observation validation |
| **TOTAL** | **78** | **100** | | |

---

## R15-Specific Assessment

| R15 Change | Impact | Grade |
|------------|--------|-------|
| Student-t fat tails (ν=5) | Real improvement. Weather errors have heavier tails than Gaussian. Implementation is mathematically correct (Lentz CF for regularized incomplete beta). | A |
| Executable price (ask) for edge | **Critical fix**. Mid-price edge is misleading on wide-spread markets. Now correctly uses ask for buys. | A+ |
| Executor extraction to executor.js | Clean separation of concerns. `executeApprovedTrades()` re-runs guards and risk checks. Max 1 trade per execution. | B+ |
| README.md | Honest, well-written. Correctly states 88.9% win rate on 9 trades, paper trading status. | A- |

---

## Critical Recommendations

1. **Accumulate N≥50 settled trades before any live capital** — Current N=9 is noise.
2. **Fix IV midpoint inconsistency** — `implied_vol.js` computes market σ from midpoint but matcher.js trades at ask. Use ask for both.
3. **Add automated settlement** — Don't rely on manual `kalshi trade settle`.
4. **Build IV history** — The σ gap is the entire thesis. Track it daily to detect if markets are tightening.
5. **Add observation sanity checks** — Reject temperatures outside ±30°F of climatological normal in `fetchObservation()`.

---

## Confidence Assessment

Would I stake my reputation on this system generating positive expected value? **Not yet.** The thesis (forecast accuracy >> market-implied uncertainty) is strong and the implementation is competent. But N=9 is not evidence. The system has the right architecture to eventually prove itself — it just hasn't yet.

At N=50 with continued >70% win rate and positive Sharpe, I'd upgrade to 85+.
