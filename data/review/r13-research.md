# R13 Research Review — Kalshi Multi-Strategy Trading System

**Reviewer**: Fresh research agent (no prior context, skeptical)  
**Date**: 2026-02-10T04:30Z  
**Codebase**: ~6,714 lines across lib/ commands/ bin/  
**Live results**: 13 trades, 9 settled, $77.55 profit (+7.8% on $1000)

---

## Executive Summary

The system has real, demonstrated edge on weather markets — particularly KMIA where tropical stability creates tight forecasts (MAE ~0.7°F) vs market-implied σ of ~3°F. The architecture is well-designed: multi-model consensus → probability estimation → Kelly sizing → guard system → paper execution. **However, critical issues persist from R12**: the guard bypass that allowed 8×20-contract trades on a single station/day was identified but the root cause evidence remains in the ledger. The ensemble σ floor fix and recommend.js refactor are genuine improvements. The system is **good enough for conservative paper trading** but not for staking real capital without addressing the issues below.

---

## Dimension Scores

### 1. Strategy Rigor — 15/20

**Strengths:**
- Kelly criterion correctly implemented: `f = (p - q) / (1 - q)` with quarter-Kelly (`lib/core/sizing.js:8-14`)
- Probability cap at 0.99 in `scoreContract()` prevents infinite Kelly fractions
- Station-specific σ calibration with honest tier system (KMDW = tier F, baseSigma=3.05)
- Transaction cost of 4¢ hardcoded and consistently applied everywhere
- Crypto uses separate strategy pipeline with GARCH-style vol modeling

**Issues:**
- **Winter σ bump is additive (+0.5°F), not multiplicative** — for KNYC (base=0.84), February σ = 1.34°F, a +60% increase. For KMDW (base=3.05), it's only +16%. This treats all stations as having equal seasonal difficulty increase, which is meteorologically wrong. Continental stations (KMDW, KDEN) should have larger winter bumps.
- **AGENTS.md says σ=0.85°F for KNYC** but actual February effective σ = `0.84 + 0.5 = 1.34°F`. The `iv` command confirms "Our σ=1.3°F". The documentation is **wrong by 60%** — anyone reading AGENTS.md would believe they have 3.45°F of gap when actual gap is only 2.85°F.
- **`positionSize` uses `costPerContract = pMarket`** (line 36) — this is correct for computing number of contracts from dollar risk, but the fraction `f` is capped at `maxPct=0.05` before conversion. With quarter-Kelly producing very small fractions on high-probability bets, the `maxPct` cap rarely binds. The 20-contract hard cap (`HARD_MAX_CONTRACTS`) is the actual binding constraint.
- **`iv` command Net Edge calculation is wrong**: It computes `calculateProbabilityDifference(forecastHigh, 75, ourSigma, marketSigma)` — hardcoded threshold of 75°F! This means the Net Edge column is only accurate for KMIA (where thresholds are near 75°F) and meaningless for KNYC (thresholds near 30°F) and KDEN (thresholds near 48°F). The GO/NO-GO matrix catches this via σ gap check, but the displayed "Net Edge" is misleading.

**Score rationale**: Core Kelly math is sound, σ calibration is real, but the hardcoded 75°F in IV and doc discrepancies reduce confidence.

### 2. Statistical Validity — 15/20

**Strengths:**
- Proper scoring rules: Brier, log loss, ECE, calibration curves (`lib/backtest/scoring.js`)
- Walk-forward validation with expanding window in backtest engine
- Sharpe ratio correctly uses ALL calendar days (zero-return days as zero, not excluded)
- Backtest engine imports cleanly: `node -e "import('./lib/backtest/engine.js').then(()=>console.log('OK'))"` → OK ✅ (R12 reported this was broken — **fixed**)
- σ sweep for optimal calibration across 9 σ values
- 30 winter observations per validated station — minimum viable sample

**Issues:**
- **N=30 is statistically marginal** — for a normal distribution, 30 observations give ~18% uncertainty on σ estimates (σ/√(2N)). With σ≈0.84°F, the 95% CI is roughly [0.65, 1.10]. If actual σ is 1.1°F instead of 0.84°F, the edge shrinks significantly.
- **Ensemble σ can still drop below base**: `calculateEnsembleSigma()` returns `baseSigma * 0.9` when NWS agrees with one model (line ~72 in ensemble.js). The code comment says "Floor at calibrated value — ensemble can only INCREASE σ" but then the NWS tie-breaker multiplies by 0.9, creating a contradiction. At KNYC: `0.84 * 0.9 = 0.756°F`, below the calibrated base.
- **No bootstrap or cross-validation on σ estimates** — the system uses point estimates from historical MAE without confidence intervals. Position sizing should account for parameter uncertainty.
- **Backtest `simulatePnL` uses `initialBankroll` for Kelly sizing, not current balance** (line 136) — this is actually conservative (prevents compounding of errors) but not true Kelly which should use current bankroll.

**Score rationale**: Backtest engine works now, scoring is proper, but sample size and ensemble σ floor bug reduce statistical rigor.

### 3. Market Microstructure — 15/20

**Strengths:**
- Mid-price used for IV computation: `(yesBid + yesAsk) / 2` — correct
- Liquidity cap: `min(Kelly, 10% of volume, 20 contracts)` — three-layer sizing
- Volume filter: skip contracts with 0 volume in `scoreContract()`
- Deep ITM/OTM filtered: skip mid < 0.02 or > 0.98
- Execution-time cap at 5 contracts without depth data (`commands/recommend.js:266`)
- Crypto spread filter at 20%

**Issues:**
- **No order book depth data**: `mkt.yesBidSize` and `mkt.yesAskSize` are populated from Kalshi API (`lib/kalshi/client.js`) but Kalshi's `yes_bid` and `yes_ask` are prices, not sizes. The depth fields come from... nowhere. The depth warnings in recommend.js are non-functional since `totalDepth` is always 0.
- **No slippage model**: 20-contract orders on Kalshi weather markets (typical volume 50-500) can move the market. The system assumes fills at mid, but actual fills on the ask side are already modeled via `spreadCost=0.03` in backtests. Live execution should track actual fill vs. expected.
- **`iv` command market σ uses ALL strikes equally**: Near-ATM implied vol is more reliable than deep OTM. The mean across all strikes dilutes the signal.
- **Bid-ask spread not checked for weather markets**: Crypto has `MAX_SPREAD=0.20` but weather has no explicit spread filter. A market with 10¢ bid and 90¢ ask (80% spread) would still pass all guards.

**Score rationale**: Good awareness of liquidity issues with appropriate caps, but depth data is phantom and no explicit spread filter on weather.

### 4. Risk Management — 14/20

**Strengths:**
- 7-point guard system (`lib/core/guard.js`): whitelist, spread, σ gap, daily limit, size cap, clim outlier, correlation
- Circuit breaker at $800 (`lib/core/risk.js:12`) — 20% drawdown halt
- Risk limits checked pre-trade in execution loop (`commands/recommend.js:227-232`)
- Max 1 trade per day per station, max 5 open positions, max 3 per station
- Live trading blocked by `LIVE_TRADING !== '1'` environment check
- Cross-station correlation (KNYC↔KMDW)

**Issues:**
- **Ledger shows guard was bypassed**: Trades #1-#8 are all KMIA, same contract (`KXHIGHMIA-26FEB10-B76.5`), same day (2026-02-09), 20 contracts each. Guard rule #4 should block after trade #1. Either: (a) guards weren't called, (b) trades were placed via `executeTrade()` directly, or (c) the `!t.settled` filter allowed them through. Given trades are currently settled, the filter would now pass, but at placement time the earlier trades should have been unsettled. **Root cause unclear — this is the #1 risk issue.**
- **`checkRiskLimits` IS called in execution loop** (line 227) — R12 said it was dead code, but it's there. However, the per-trade check (line 257) calls `checkRiskLimits(trade.station, trade.sizing?.dollarRisk)` — `maxPositionPct` checks `tradeCost > balance * 0.05`. Each trade is $9.30 which is 0.86% of $1077 — well under 5%. The check passes because it evaluates each trade independently, not cumulative exposure.
- **No cumulative exposure check**: 8 × $9.30 = $74.40 = 6.9% of bankroll on one station. Per-trade check passes but cumulative doesn't. Need `maxStationExposure` across all open positions.
- **Correlation map only has KNYC↔KMDW**. Missing: KDEN correlates with both during winter systems. KMIA is genuinely uncorrelated (subtropical).

**Score rationale**: Guard system is well-designed but demonstrably failed to prevent concentrated risk. Cumulative exposure check is missing.

### 5. Data Quality — 16/20

**Strengths:**
- Triple-source forecasts: NWS (human forecaster), GFS, ECMWF with inverse-MAE weighting
- Append-only JSONL history: 239 decisions, 47 forecasts, 39 market snapshots, 13 trades logged
- Retry with exponential backoff and 15s timeout (`lib/core/utils.js:18-34`)
- Schema versioning (`v: 1`) on all history records
- Rate limiting with 150-200ms sleep between API calls
- Historical forecast/actual pipeline via Open-Meteo archive API
- Health check validates all data sources and API connectivity (83% — 5/6 pass)

**Issues:**
- **No automated observation fetching for settlement**: `fetchObservation()` exists in `lib/weather/observe.js` but `settleDate()` in `lib/core/trade.js` takes `actuals` as a parameter. There's no cron or automated pipeline connecting observations to settlement.
- **IV history file missing**: Health check flags "No IV history file found". Market σ snapshots are in `data/history/markets.jsonl` (39 records) but `data/iv-history.json` format expected by health check is absent.
- **No data validation/integrity checks on JSONL files**: A corrupted line would crash the reader. Should use try/catch per line.
- **`fetchHistoricalForecasts` uses Open-Meteo's `gfs_seamless` model** — this is actually a blend, not raw GFS. The calibration σ values are technically for the blended model, not operational GFS.

**Score rationale**: Solid multi-source pipeline with proper logging, but settlement automation gap and minor integrity issues.

---

## Overall Score: 75/100

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Strategy Rigor | 15/20 | 20% | Sound Kelly math, IV display bug (hardcoded 75°F), doc discrepancy |
| Statistical Validity | 15/20 | 20% | Backtest fixed ✅, ensemble σ floor contradicts itself, N=30 marginal |
| Market Microstructure | 15/20 | 20% | Good liquidity awareness, phantom depth data, no weather spread filter |
| Risk Management | 14/20 | 20% | Well-designed guards, demonstrably bypassed, no cumulative exposure |
| Data Quality | 16/20 | 20% | Triple-source pipeline, missing settlement automation |

---

## Critical Fixes (Before Real Capital)

1. **Fix IV Net Edge calculation** — remove hardcoded 75°F threshold, compute per-contract edge
2. **Add cumulative station exposure check** — sum all open positions per station, not just count
3. **Root-cause the guard bypass** — 8 trades on KMIA same day should be impossible. Add guard-call logging.
4. **Fix ensemble σ floor** — remove the `* 0.9` NWS tie-breaker that violates the stated floor
5. **Add weather bid-ask spread filter** — reject contracts with spread > 10¢
6. **Update AGENTS.md** — document actual effective σ (including winter bump), not base σ

## What's Working Well

- **Real demonstrated P&L**: $77.55 profit on 9 settled trades (all winners on KMIA). The edge is real.
- **Clean architecture**: forecast → probability → sizing → guards → execution is a proper pipeline
- **Honest self-assessment**: KMDW removal, tier system, honest AGENTS.md warnings
- **Guard system design**: 7 checks covering the right failure modes — just needs enforcement
- **History pipeline**: JSONL append-only logging is production-grade pattern

## Would I Stake My Reputation?

**No.** The guard bypass evidence in the ledger is disqualifying for capital deployment. The system *should* work correctly but demonstrably didn't on its first day of trading. Fix the cumulative exposure check, add guard-call logging, and run 30+ trades with no bypasses. Then reassess.

For paper trading with <$100 at risk? **Yes**, the architecture and edge are sound enough.
