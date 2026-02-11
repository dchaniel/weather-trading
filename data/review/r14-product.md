# R14 Product Review — Kalshi Trading System
**Date**: 2026-02-10 04:37 UTC  
**Reviewer**: Fresh product agent (no prior context)  
**Perspective**: Would I pay $100/month for this?

---

## Overall Score: 78/100

---

## 1. CLI UX — 17/20

**Strengths:**
- `--help` is excellent. Clear grouping (Core Strategy / Trading Operations / Data / Perf), with examples. Best-in-class for a personal trading CLI.
- Output formatting is polished — emoji indicators, box-drawing, color-coded GO/NO-GO matrix in `iv`.
- `iv` output is the crown jewel: forecast, σ comparison, gap, net edge, decision matrix all in one screen. Genuinely useful.
- `daily` is a tight briefing — balance, open positions, weather + crypto recs in ~10 lines.
- Guard explanations inline ("Market σ 2.5°F - our σ 1.3°F = gap 1.2°F < required 1.5°F") — shows its work.

**Issues:**
- `trade list` shows usage help instead of listing trades. Expected it to show the ledger. Confusing subcommand routing — `trade ledger` or `trade positions` exist but `trade list` doesn't alias to anything useful.
- `health -v` output is identical to `health` (no verbose difference visible).
- Entry point is `node bin/kalshi.js`, not `kalshi`. No npm link or PATH setup in docs. First-run friction.

## 2. Operational Readiness — 14/20

**Strengths:**
- `health` checks API connectivity, data integrity, balance — good operational dashboard.
- `data snapshot` and `data collect` exist for cron use with `--silent` flag.
- `data settle` for auto-settlement exists.
- Balance tracking and duplicate-trade-ID detection built in.

**Issues:**
- **No cron is actually configured.** Health warns about it but the "cron setup instructions" mentioned in R14 fixes aren't visible in the non-verbose output. This is a paper trading system that requires manual operation.
- **No IV history file.** The system has been running but hasn't accumulated the historical data it needs for longitudinal analysis.
- **No alerting.** If an API goes down or balance hits zero, nobody gets notified.
- **No retry/backoff logic visible.** Network failures during `data collect` in cron would silently fail.
- **Kalshi balance is $0.00** (real) — this is purely paper trading. Fine, but operational readiness for *real* money is untested.

## 3. Documentation — 16/20

**Strengths:**
- AGENTS.md is comprehensive and honest. The KMDW calibration correction story (3.4x error discovery) builds trust — this isn't a system that hides its failures.
- Station assessment table with actual MAE values, σ gaps, and honest "NO EDGE" labels.
- Pre-trade checklist is actionable.
- Transaction cost analysis baked into strategy docs.

**Issues:**
- No README.md for cold-start setup. AGENTS.md is written for the AI agent, not a human operator.
- No inline `--help` for subcommands (e.g., `kalshi data --help` doesn't exist, you just get the error or usage).
- Code comments not reviewed but file sizes (10-15KB per command) suggest reasonable structure.

## 4. Automation — 16/20

**Strengths:**
- Full trading pipeline exists: `iv` → `recommend` → `trade` → `data settle`.
- Guard system is genuinely good: σ gap check, spread filter, climatological normal check, daily position limit — all enforced at trade time.
- Kelly sizing with quarter-Kelly conservative default.
- Multi-strategy (weather + crypto) with unified ledger and balance management.
- `recommend` automatically filters and sizes, showing blocked trades with reasons.
- `data snapshot` captures forecasts, contracts, and decisions to JSONL for audit trail.

**Issues:**
- **No autonomous trading loop.** Each step requires manual invocation. For $100/mo I'd want `kalshi autopilot` that runs the full cycle.
- **Settlement is manual.** `data settle` exists but isn't automated.
- Crypto edge calculation looks simplistic — flat 11% gross edge on both BTC and ETH trades with identical drift adjustments (+3.0%). Suspicious uniformity.
- **Paper trade performance** (89% win rate, +8.3%) is from only 9 settled trades over ~2 days. Statistically meaningless.

## 5. Monetization Path — 15/20

**Strengths:**
- The core insight is real: weather forecast models (NWS/GFS/ECMWF) have sub-1°F MAE for certain stations, while Kalshi markets price in 3-4°F σ. That's a genuine informational edge.
- KNYC shows 2.83°F σ gap = 16.56¢ net edge per contract. At 20 contracts/day, that's ~$3.30/day or ~$100/month from one station. The math works *if the edge persists*.
- Transaction cost awareness (4¢/contract budget) and guard system prevent negative-EV trades.
- KMDW exclusion after honest calibration shows intellectual rigor.

**Issues:**
- **Liquidity ceiling.** Kalshi weather markets are thin. 20 contracts at 4-5¢ spread is probably the max before you *are* the market.
- **Edge decay risk.** If Kalshi tightens spreads or more sophisticated players enter, the 3-4°F implied σ will compress toward reality. This is a temporary market inefficiency, not a structural advantage.
- **Crypto strategy is weaker.** The edge estimates (7% net) on crypto look like GARCH model confidence that may not survive real-world slippage. BTC/ETH prediction markets are more competitive than weather.
- **Scale problem.** At $3.30/day theoretical max from the best station, you need perfect execution across multiple stations to justify $100/mo SaaS pricing. This is a tool that makes $50-150/mo for its operator, not a sellable product.
- **No live trading track record.** Kalshi balance is $0. Paper trading for 2 days with 9 trades doesn't validate the strategy.

---

## Would I Pay $100/month?

**No.** But it's closer than most hobby trading systems.

**Why not:**
1. No autonomous operation — I'd be running commands manually every day
2. No live track record — 9 paper trades over 2 days isn't evidence
3. The theoretical edge (~$100/mo from KNYC) barely covers the subscription cost
4. No alerting, no cron, no autopilot = this is a toolkit, not a service

**What would change my mind ($100/mo tier):**
1. Autonomous daily operation with Telegram alerts for trades and settlements
2. 60+ day paper trading track record showing consistent edge
3. Live trading with real money, even small ($50-100 positions)
4. Autopilot mode: one cron job runs the full daily cycle
5. Multi-station operation proving the edge isn't KNYC-specific

**What would make it worth $500/mo:**
- All of the above plus proven live P&L of $500+/mo across 3+ stations
- That would mean the tool pays for itself 1x over, which is the minimum bar for trading tools

---

## Summary Table

| Dimension | Score | Notes |
|-----------|-------|-------|
| CLI UX | 17/20 | Polished output, good help, minor subcommand confusion |
| Operational Readiness | 14/20 | Health checks exist, but no cron/alerts/autopilot |
| Documentation | 16/20 | AGENTS.md is honest and thorough, no human README |
| Automation | 16/20 | Full pipeline exists but requires manual operation |
| Monetization Path | 15/20 | Real edge exists, but thin markets + no live track record |
| **TOTAL** | **78/100** | **Promising toolkit, not yet a product** |

---

## R14-Specific Observations

The noted R14 fixes are partially visible:
- ✅ `perf` output looks clean (no duplicate grouping issues visible, no NaN)
- ⚠️ `health` cron instructions: not visible in normal or `-v` output — either the fix didn't land or verbose mode isn't differentiated
- ✅ `data snapshot` works and completes quickly (reuse of matcher.js plausible given speed)
- ✅ `perf` shows station breakdown correctly (KXHI grouped)

**Bottom line:** This is a well-engineered personal trading tool with a real (if small) edge. It needs 2-3 more iterations to become operationally autonomous, and 60+ days of live results to prove the edge is real. The craftsmanship is evident — the question is whether the market opportunity justifies productization.
