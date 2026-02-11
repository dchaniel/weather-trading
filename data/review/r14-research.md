# R14 Research Review — Kalshi Weather Trading System

**Reviewer**: Fresh skeptical research agent  
**Date**: 2026-02-10  
**Codebase**: ~6,700 lines JS across lib/, commands/, bin/  
**Live status**: Paper trading, $1077.55 balance (+8.4% from $1000), 9 settled trades (88.9% win rate)

---

## Overall Score: 82/100

| Dimension | Score | Grade |
|-----------|-------|-------|
| 1. Strategy Rigor | 17/20 | A- |
| 2. Statistical Validity | 15/20 | B+ |
| 3. Market Microstructure | 16/20 | A- |
| 4. Risk Management | 18/20 | A |
| 5. Data Quality | 16/20 | A- |

---

## 1. Strategy Rigor — 17/20

### Strengths
- **Kelly sizing is textbook correct**: `kellyFraction(pTrue, pMarket) = (pTrue - pMarket) / (1 - pMarket)` — this is the exact binary Kelly formula. Quarter-Kelly (`/4`) is appropriately conservative.
- **Edge calculation is honest**: The system computes P(temp ≥ threshold) using normal CDF with calibrated σ, then compares against market-implied probability. The σ gap framework (our σ vs market σ) is a valid way to identify structural mispricing.
- **Transaction cost integration is correct**: 4¢/contract is subtracted from gross edge throughout (sizing, guards, IV display). The `netEdge` concept flows properly from IV analysis through to execution.
- **KMDW removal was the right call**: MAE=2.56°F vs market σ~3.0°F means no edge. The system correctly identifies and excludes this.

### Weaknesses
- **Normal distribution assumption**: Weather forecast errors may not be Gaussian, especially in winter with frontal passages. No skew/kurtosis adjustment for weather (crypto has Student-t, weather doesn't).
- **probAboveThreshold uses `normalCDF(z)` where z = (forecast - threshold)/σ**: This gives P(forecast > threshold), but the sign convention means P(actual > threshold) only if errors are symmetric. The -1°F bias on KNYC partially addresses this, but asymmetric error distributions would break the model.
- **Kelly on binary options assumes independent bets**: Multiple contracts on the same station/day are correlated (weather outcome is shared), but Kelly treats each independently. The 1-trade-per-day-per-station guard mitigates but doesn't fully solve for multi-day exposure to same weather pattern.

### Deductions
- -1 for no fat-tail adjustment on weather probabilities
- -2 for correlation between sequential day forecasts not modeled in sizing

---

## 2. Statistical Validity — 15/20

### Strengths
- **Calibration infrastructure exists**: `calibrate` command computes MAE, RMSE, P90, P95 with CI, seasonal breakdown, and sample-size reliability grading.
- **Winter σ bump (+0.5°F)** is a reasonable seasonal adjustment. The base σ values (KNYC=0.84, KMIA=0.78, KDEN=0.92) are stated as derived from N≥30 winter observations.
- **Ensemble σ absolute floor**: `calculateEnsembleSigma()` correctly enforces `Math.max(baseSigma, dynamicSigma)` — ensemble can only widen σ, never tighten below calibrated floor. This prevents overconfidence.
- **Backtest engine uses proper scoring rules**: Brier score, log loss, ECE, calibration curves, walk-forward validation with expanding window.
- **Sharpe calculation fixed**: Uses ALL calendar days (zero-return days included), not just trading days. This is correct and avoids inflated Sharpe.

### Weaknesses
- **N=30 is marginal for σ calibration**: With 30 observations, the 95% CI on MAE is wide (±0.3-0.5°F typically). A 0.3°F error in σ propagates quadratically through Kelly (σ² in denominator). The system acknowledges this (`reliability = 'ADEQUATE'` for N≥30) but still trades on it.
- **Backtest P&L simulation uses synthetic market prices**: `simulatePnL()` assumes market prices follow `1 - Φ((T-μ)/marketSigma)` with a configurable marketSigma. Real Kalshi prices may deviate from this model. The system is honest about this ("No simulated market prices... tells you what you need to verify") but the walk-forward results are still conditional on this assumption.
- **No out-of-sample validation against actual Kalshi prices**: The backtest doesn't use historical Kalshi orderbook data. All P&L estimates are model-on-model.
- **IV history file missing** (`⚠️ No IV history file found`): Despite having the infrastructure, the system hasn't accumulated enough historical IV snapshots to validate the σ gap persistence claim.

### Deductions
- -2 for marginal sample size (N=30) driving production σ values
- -2 for no historical Kalshi price data in backtests
- -1 for missing IV history despite infrastructure being built

---

## 3. Market Microstructure — 16/20

### Strengths
- **Bid-ask spread filter (10¢)**: `scoreContract()` skips contracts where `yesAsk - yesBid > 0.10`. This is the R14 fix and it's correctly placed — filters before any edge calculation.
- **Executable price awareness**: Crypto strategy correctly uses ask price for YES buys, noAsk for NO buys. Weather strategy uses mid-price which is reasonable for limit orders.
- **Volume filter**: `(mkt.volume || 0) === 0` contracts are skipped. Liquidity cap at 10% of daily volume prevents market impact.
- **Hard max 20 contracts per trade + execution cap of 5**: `HARD_MAX_CONTRACTS = 20` in sizing, but `executeTradesLoop` caps at 5 "since no depth data available." This is conservatively correct.
- **Deep ITM/OTM filtered**: Contracts with mid-price <3¢ or >97¢ are excluded.

### Weaknesses
- **No depth/orderbook data**: The system acknowledges "no depth data available" but still sizes up to 20 contracts. Even with 10% volume cap, placing 20 contracts on a market with volume=200 would be 10% of daily flow — potentially moving the market.
- **Weather mid-price assumption**: Using `(yesBid + yesAsk) / 2` for edge calculation but execution would be at ask. For a 10¢ spread, this overestimates edge by 5¢ — significant relative to the 4¢ transaction cost. The crypto strategy correctly uses executable price; weather should too.
- **No slippage model**: Limit orders may not fill, market orders would face worse prices. No adjustment for this.
- **Implied σ calculation uses mid-price**: `analyzeImpliedVol` computes market σ from mid-prices. If the spread is 10¢, the "true" market σ has a range, not a point estimate.

### Deductions  
- -2 for weather edge calculation using mid-price instead of executable price
- -1 for no slippage model
- -1 for implied σ point estimate ignoring spread uncertainty

---

## 4. Risk Management — 18/20

### Strengths
- **Multi-layer defense**: Guards → Risk limits → Execution checks. Three independent layers, all must pass.
- **Cumulative station exposure guard (R14 fix)**: `guard.js` checks total unsettled exposure per station at 5% of bankroll. `risk.js` checks at 10%. Double protection is good.
- **Correlation guard**: KNYC-KMDW bidirectional correlation prevents same-day trading of correlated stations.
- **Circuit breaker**: `drawdownFloor = $800` (20% drawdown) halts all trading. This is a hard stop, not advisory.
- **Daily loss limit**: -$50/day max. Checked per trade timestamp (not settlement date), preventing overnight settlements from blocking today's trading.
- **Position limits**: Max 5 open positions, max 3 per station, max 5% bankroll per trade.
- **Climatological outlier guard**: ±15°F from seasonal normal blocks trading (extreme weather events).
- **Model spread guard**: >3°F GFS/ECMWF disagreement blocks trading.
- **Pending trade expiry**: 30-minute TTL prevents stale recommendations.

### Weaknesses
- **No correlation modeling across days**: A 3-day cold snap hitting KNYC creates correlated exposure across day+0, day+1, day+2 contracts. The system limits to 1 trade/day/station but doesn't account for multi-day weather regime persistence.
- **No tail risk / VaR calculation**: Max loss scenarios aren't computed. With 4 open positions (current state), correlated loss could be $20-40, but this isn't quantified.

### Deductions
- -1 for no multi-day correlation modeling
- -1 for no tail risk / VaR quantification

---

## 5. Data Quality — 16/20

### Strengths
- **Three independent forecast sources**: NWS (human forecaster), GFS (NOAA), ECMWF (European) via Open-Meteo. Multi-source redundancy with inverse-MAE weighting.
- **Minimum 2 sources required**: `buildConsensus()` requires `valid.length >= 2` to produce a tradeable forecast.
- **JSONL append-only history pipeline**: `lib/core/history.js` logs forecasts, observations, markets, decisions, and trades. Versioned records (`v: 1`). Good audit trail.
- **Observation verification**: NWS station observations used for settlement, with error handling for missing data.
- **Retry logic with exponential backoff**: `fetchJSON` handles 429s, timeouts, with configurable retries.
- **File-based caching for crypto**: 5-minute TTL prevents rate limiting from CoinGecko.
- **Horizon-adjusted σ**: Day+2 gets 1.29× multiplier, day+3 gets 1.57×. Forecasts degrade with horizon.

### Weaknesses
- **No observation cross-validation**: Settlement uses NWS observations only. If NWS station data is missing or wrong (sensor malfunction), there's no fallback. Could cross-check against Open-Meteo archive.
- **Historical forecast validation is live-API dependent**: `calibrate` command fetches live forecasts for historical dates, but these may differ from what was actually available at decision time. True out-of-sample validation would require stored forecasts.
- **IV history not accumulated**: Despite having the infrastructure (`data collect`, JSONL logging), the actual IV history file is empty. This means the claimed σ gaps can't be verified historically.
- **Cron not configured**: No automated data collection running. The system depends on manual invocation.

### Deductions
- -2 for no observation cross-validation and no accumulated IV history
- -1 for no automated data collection (cron missing)
- -1 for forecast validation depending on live API rather than stored predictions

---

## Critical Findings

### 🟢 Things Done Right
1. **KMDW exclusion** — Correctly identified 3.4× calibration error and removed
2. **Quarter-Kelly** — Appropriately conservative; full Kelly would be reckless in this market
3. **Guard system** — 9 independent guards with no override mechanism; hard blocks only
4. **Cumulative exposure guard** — Prevents runaway station concentration (R14 fix)
5. **Bid-ask spread filter** — 10¢ max spread prevents trading illiquid contracts (R14 fix)
6. **Dynamic IV threshold** — Uses nearest-to-forecast threshold instead of hardcoded 75°F (R14 fix)
7. **Ensemble σ floor** — Can only widen, never narrow below calibrated base (R14 fix)

### 🟡 Areas for Improvement
1. **Weather edge should use executable (ask) price, not mid** — Currently overestimates edge by half the spread
2. **N=30 σ calibration is thin** — Recommend accumulating to N≥100 before increasing position sizes
3. **No historical Kalshi price data** — Backtest is model-on-model; need actual market data
4. **Start the cron** — Infrastructure exists but isn't running
5. **Add weather fat-tail correction** — Crypto has Student-t; weather should too

### 🔴 Risks
1. **Paper trading win rate (88.9%) is likely unsustainable** — 9 trades is far too small for statistical significance. Could easily be 50-70% true win rate.
2. **σ calibration drift** — Winter σ values may not hold into spring. Need ongoing recalibration.
3. **Market structure risk** — If Kalshi narrows spreads or adds sophisticated market makers, the σ gap could disappear. The edge is structural (retail market inefficiency), not fundamental.

---

## Verdict

This is a **well-engineered system with genuine intellectual honesty**. The KMDW removal, the guard system, and the multi-layer risk management show mature thinking. The R14 fixes (cumulative exposure, bid-ask filter, dynamic IV threshold, ensemble σ floor) address real vulnerabilities.

The main gap is **validation depth**: N=30 calibration, no historical market data, no accumulated IV history. The system knows what it should verify but hasn't yet accumulated the data to verify it. The 82/100 score reflects a system that's architecturally sound but needs more operational seasoning before high confidence.

**Would I stake my reputation on this at 95+?** No — the sample sizes are too small and the backtest relies on synthetic market prices. At 82, I'm saying: the architecture is right, the math is right, the risk management is right, but the empirical validation needs 3-6 more months of data accumulation.

**Recommendation**: Continue paper trading. Start the cron. Accumulate IV history. Fix the mid-price → executable price issue in weather scoring. Revisit when N≥100 per station per season.
