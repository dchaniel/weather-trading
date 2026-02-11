# R12 Research Review — Kalshi Multi-Strategy Trading System

**Reviewer**: Fresh research agent (no prior context)  
**Date**: 2026-02-10  
**Codebase**: 7,095 lines across lib/ commands/ bin/  
**Previous scores**: Research 89, Product 78

---

## Dimension Scores

### 1. Strategy Rigor — 16/20

**Positives:**
- Kelly criterion implementation is textbook correct: `f = (p - q) / (1 - q)` with quarter-Kelly conservatism (`lib/core/sizing.js:12-14`)
- Edge calculation properly subtracts transaction costs before sizing
- Station-specific σ calibration with honest KMDW removal (tier F, baseSigma=3.05)
- Probability cap at 99% in `commands/recommend.js` prevents overconfident trades
- Crypto strategy uses Student-t fat tails via kurtosis-adjusted degrees of freedom (`lib/crypto/forecast.js:116-121`)

**Issues:**
- **Kelly denominator uses market price, not (1-p)**: In `lib/core/sizing.js:36`, `costPerContract = pMarket` — this is the cost basis, not the Kelly-optimal fraction denominator. Kelly for binary contracts should have `dollarAmount / costPerContract` only if you're computing contracts from dollar risk. The actual fraction `f` caps at `maxPct=5%` which masks this, but the math pathway is muddled.
- **CDF approximation in `commands/implied_vol.js:45`** uses `0.5 * (1 + sign(z) * sqrt(1 - exp(-2z²/π)))` — this is an approximation with ~1% error in the tails. Fine for display but the *same* function is used for probability estimation in trades. The `lib/core/utils.js` normalCDF uses a different (better) Abramowitz & Stegun approximation. **Two different CDF implementations** are in use.
- **AGENTS.md σ values don't match code**: AGENTS.md says "our σ=0.85°F" for KNYC but code uses `baseSigma=0.84 + WINTER_SIGMA_BUMP=0.5 = 1.34°F` in February (`lib/weather/stations.js:206,220`). This is a **60% discrepancy** between documented and actual σ.

### 2. Statistical Validity — 14/20

**Positives:**
- Proper scoring rules implemented: Brier, log loss, ECE, calibration curves (`lib/backtest/scoring.js`)
- Walk-forward validation with expanding window (`lib/backtest/engine.js:210-246`)
- Sharpe ratio correctly uses ALL calendar days including zero-return days (`lib/backtest/engine.js:166`)
- σ sweep for optimal calibration (`lib/backtest/engine.js:197-205`)
- Transaction costs modeled consistently at 4¢/contract across both strategies

**Issues:**
- **CRITICAL BUG: `lib/backtest/engine.js` has duplicate import on lines 9 and 11** — `import { normalCDF } from '../core/utils.js'` then `import { normalCDF, round2, dateRange } from '../core/utils.js'`. This causes `Identifier 'normalCDF' has already been declared` error. **The entire backtest engine is non-functional.** Verified: `node -e "import('./lib/backtest/engine.js')"` → ERROR.
- **Winter σ bump of +0.5°F is additive, not multiplicative** (`lib/weather/stations.js:220`): For KNYC (baseSigma=0.84), this is a +60% increase. For KMDW (baseSigma=3.05), it's +16%. The seasonal adjustment should arguably scale proportionally, not apply a flat bump to all stations equally.
- **No out-of-sample validation possible** since backtest engine doesn't load. The calibration numbers in AGENTS.md (MAE=0.77°F for KNYC) cannot be independently verified from the current codebase.
- **Ensemble σ calculation** (`lib/weather/ensemble.js:48-65`) creates a dynamic σ that can go to `baseSigma * 0.8` when models agree — this **reduces** σ below the calibrated value, potentially overfitting to model agreement and creating overconfident positions.

### 3. Market Microstructure — 15/20

**Positives:**
- Bid/ask spread awareness: uses mid-price for IV computation, executable prices (ask) for crypto trades (`lib/crypto/strategy.js:72-74`)
- Liquidity filtering: volume cap at 10% of daily volume, hard cap at 20 contracts (`lib/core/sizing.js:42-44`)
- Crypto spread filter: MAX_SPREAD=0.20 (20%), MIN_BID_PRICE=0.10 (`lib/crypto/strategy.js:15-19`)
- Order book depth warnings when size > 20% or 50% of book (`commands/recommend.js:172-182`)
- Contracts expiring < 2 hours are skipped (`lib/crypto/strategy.js:82-86`)

**Issues:**
- **No order book depth data actually available**: The depth warnings reference `mkt.yesBidSize` and `mkt.yesAskSize` but the Kalshi API client (`lib/kalshi/client.js:114-115`) doesn't populate these fields. The `totalDepth` will always be 0, making depth warnings non-functional.
- **No slippage model**: For 20-contract orders on thin Kalshi markets (typical volume 50-500), price impact could be significant. The system assumes fill at mid or last price.
- **IV computation uses mean of implied σ across all strikes** (`lib/backtest/implied_vol.js:82-88`) — this equally weights deep ITM and near-ATM contracts. Near-ATM contracts should receive higher weight as their implied vol is more informative.

### 4. Risk Management — 13/20

**Positives:**
- 7-point guard system with station whitelist, model spread filter, σ gap check, daily trade limit, position size cap, climatological outlier filter, and cross-station correlation check (`lib/core/guard.js`)
- Circuit breaker at $800 drawdown floor (`lib/core/risk.js:12`)
- Max daily loss at -$50, max 5 open positions, max 3 per station (`lib/core/risk.js:9-14`)
- Execution-time 5-contract cap without depth data (`commands/recommend.js:266`)
- Live trading blocked by environment variable check (`commands/recommend.js:237-240`)

**Issues:**
- **CRITICAL: Guard system was demonstrably bypassed.** Ledger shows **8 trades of 20 contracts each** on KMIA on 2026-02-09, same contract (`KXHIGHMIA-26FEB10-B76.5`). Guard rule #4 limits to 1 trade/day/station, rule #5 caps at 20 contracts. Total: 160 contracts on one station when max should be 20. This means $74.40 at risk on one position (8% of bankroll), violating the 5% max position rule.
- **Guard checks use `!t.settled` filter** (`lib/core/guard.js:52-55`) — this means previously placed trades on the same day are only detected if they haven't settled yet. But the check counts `todayTrades.length >= MAX_TRADES_PER_DAY_PER_STATION` (which is 1), meaning any second trade should be blocked. The guard was either not called or its result was ignored.
- **`checkRiskLimits` is never called in the execution path**: `commands/recommend.js` calls `runGuards()` but never calls `checkRiskLimits()` from `lib/core/risk.js`. The daily loss limit, drawdown floor, and max open positions checks are **dead code** during trade execution.
- **Correlation map is minimal**: Only KNYC↔KMDW listed (`lib/core/guard.js:20-22`). KDEN weather is correlated with KMDW (Rocky Mountain influence on Midwest), but this isn't modeled.

### 5. Data Quality — 15/20

**Positives:**
- Multi-source forecasts: NWS, GFS (Open-Meteo), ECMWF with inverse-MAE weighting (`lib/weather/forecast.js:65-76`)
- History pipeline with append-only JSONL logging for forecasts, observations, markets, decisions, trades (`lib/core/history.js`)
- Retry logic with exponential backoff for API calls (`lib/core/utils.js:18-34`)
- Schema versioning on all history records (`lib/core/history.js:31`)
- Calibration data from 30 winter observations per validated station

**Issues:**
- **No observation verification**: The system settles against `actuals` passed to `settleDate()` (`lib/core/trade.js:82`) but there's no code to automatically fetch actual observed temperatures. Settlement depends on manual input.
- **Forecast staleness not checked**: If API returns cached/stale data (e.g., yesterday's GFS run), the system has no mechanism to detect this. No comparison of model run time vs current time.
- **History files exist but are sparse**: `data/history/` contains JSONL files but the system has only been running since Feb 9 — insufficient data for any meaningful backtesting.
- **New stations (KIAH, KLAX, KATL, KDFW) have placeholder σ values** (`baseSigma: 3.5` for all, `lib/weather/stations.js:102,118,134,150`) — these are not calibrated and would give misleading edge calculations if ever traded. They're not in TRADEABLE_STATIONS, but the code path in `commands/implied_vol.js` still analyzes them.

---

## Total Score: 73/100

| Dimension | Score | Max |
|-----------|-------|-----|
| Strategy Rigor | 16 | 20 |
| Statistical Validity | 14 | 20 |
| Market Microstructure | 15 | 20 |
| Risk Management | 13 | 20 |
| Data Quality | 15 | 20 |
| **Total** | **73** | **100** |

---

## Top 3 Issues Preventing 95+

### 1. Backtest Engine is Broken (lib/backtest/engine.js:9,11)
Duplicate `normalCDF` import causes a module load error. The entire backtesting, walk-forward validation, and calibration verification pipeline is **non-functional**. Without working backtests, every statistical claim in AGENTS.md is unverifiable from the codebase. This alone disqualifies any score above 80.

### 2. Guard System Bypass — 160 Contracts on One Position (data/ledger.json)
The ledger contains 8 × 20-contract trades on KMIA on the same day, same contract. Guards claim to enforce 1 trade/day/station and 20-contract max, yet 160 contracts were placed. Either: (a) guards weren't called, (b) results were ignored, or (c) the 5-contract cap added later wasn't in place. Either way, the risk management layer has a **proven failure mode**. Additionally, `checkRiskLimits()` is never called in the execution path — it's dead code.

### 3. Documentation/Code σ Mismatch (lib/weather/stations.js:206,220 vs AGENTS.md)
AGENTS.md documents KNYC σ=0.85°F, but the code computes 1.34°F in winter (0.84 base + 0.5 winter bump). This 60% discrepancy means the edge calculations presented to the operator are misleading. The σ gap displayed by `kalshi iv` may not match the σ actually used in probability calculations by `recommend`.

---

## What Would Need to Change to Reach 95

1. **Fix the duplicate import** in `lib/backtest/engine.js` and run full backtests with current parameters. Publish verifiable results.

2. **Make guards transactional**: The guard check and trade execution must be atomic. Add a `guardId` to each trade that references the specific guard check that approved it. Reject any `executeTrade()` call without a valid, recent guardId.

3. **Wire `checkRiskLimits()` into the execution path**: Currently dead code. Must be called alongside `runGuards()` before every trade.

4. **Reconcile σ documentation with code**: Either update AGENTS.md to show winter-adjusted values, or change the display layer to show effective σ (including seasonal adjustments).

5. **Add automated observation fetching and settlement**: Currently manual. Should auto-fetch NWS observations at settlement time and verify against forecast.

6. **Weight IV samples by proximity to ATM**: Near-ATM implied vol is more informative than deep wing contracts. Use inverse-distance-from-ATM weighting in `analyzeImpliedVol()`.

7. **Add real order book depth integration**: The depth warning system references fields that don't exist in the API response. Either populate them or remove the false comfort.

8. **Implement position-level (not just trade-level) guards**: Check total exposure across all unsettled trades for a station, not just today's count.

9. **Make ensemble σ floor = calibrated σ**: The dynamic ensemble can reduce σ below calibrated levels (`lib/weather/ensemble.js:52`: `baseSigma * 0.8`), creating overconfident probability estimates. Minimum σ should be the validated calibration value.

10. **Stress-test against tail scenarios**: Chinook events at KDEN (P95=2.4°F per AGENTS.md), tropical disturbances at KMIA — add explicit tail risk scenarios to the backtest framework.
