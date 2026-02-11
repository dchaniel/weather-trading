# R12 Product Review — Kalshi Trading System

**Date**: 2026-02-10  
**Reviewer**: Fresh Product Agent  
**Previous Score**: Product 78

---

## 1. CLI UX — 16/20

**Strengths**: Help text is excellent — clear groupings, examples, emoji visual hierarchy. `kalshi iv` output is genuinely best-in-class with GO/NO-GO matrix. `kalshi crypto` shows real market data with actionable trades. `kalshi health` gives quick system overview.

**Issues**:
- `kalshi trade list` doesn't list trades — shows usage help instead. Expected it to show open positions. The actual command is `trade positions` or `trade ledger`, but `trade list` was in the review spec and shows no useful error.
- `kalshi trade settle` with no date argument settles today — fine, but no confirmation prompt before settling real money.
- `kalshi daily` says "P&L: +0.0$" then settle shows -2.15. Inconsistent state.

**Example**: `trade list` output:
```
Usage: kalshi trade <station> <contract> <yes|no> <qty> [--price X]...
```
This is a usage dump, not an error message. Should say "Did you mean `trade positions`?"

## 2. Operational Readiness — 13/20

**Strengths**: Health check exists and catches missing cron/IV history. API connectivity checks work. Settlement is automated with actual weather verification.

**Issues**:
- **No cron jobs configured** — health check itself flags this. System cannot run unattended.
- **12 open positions but max is 5** — daily briefing flags "⚠️ 12 open positions (max 5)" but the system still executed another trade via `recommend --execute`. The position limit guard is advisory, not enforced.
- **`calibrate` hangs** — command didn't return within 30 seconds, had to kill it. A customer running this would think it's broken.
- **No IV history file** — health check flags it. Data collection pipeline isn't running.

**Example**: Daily briefing says `🛡️ Trading: 🚫 Blocked` and `⚠️ 12 open positions (max 5)` but `recommend --execute` still placed a trade moments later. The block is cosmetic.

## 3. Documentation — 17/20

**Strengths**: AGENTS.md is thorough — honest station assessment with corrected calibration, clear trading rules, pre-trade checklist. CODING-STRATEGY.md explains the multi-agent review loop well. Help text is comprehensive.

**Issues**:
- AGENTS.md says "Settlement Stations" section lists KMDW as "⭐⭐ best calibration (σ=1.2)" but the honest assessment above says KMDW has MAE=2.56°F and is "UNPROFITABLE". Contradictory within same file.
- No README.md for someone new to the project (AGENTS.md is agent-focused, not human-focused).
- No documentation of the paper ledger JSON schema or how settlement actually works.

## 4. Automation — 12/20

**Strengths**: `recommend --execute` auto-places trades with caps (20→5 contracts without depth data). `data snapshot` collects forecasts/contracts/decisions. `trade settle` auto-verifies against actual weather.

**Issues**:
- **`perf` is completely broken** — All 12 open positions show `undefined` for every field (ticker, price, contract). This is the primary dashboard for tracking whether the system works. Output:
  ```
  ⏳ undefined NO 20x undefined @ $undefined
     Expected: +50.0% win prob, +0.00$ EV
  ```
  This is a showstopper. A customer sees this and loses all confidence.
- **No automated settlement** — must manually run `trade settle`. No cron, no auto-trigger.
- **No observation collection** — `data history` shows 0 observation records. Can't validate anything without actuals.
- **Balance inconsistency** — `recommend` shows $920.35, `daily` shows $918.45, difference unexplained.

## 5. Monetization Path — 14/20

**Strengths**: The edge thesis is sound — weather forecast accuracy vs market implied volatility is a real, quantifiable edge. Transaction cost awareness (4¢/contract) is built into every decision. Kelly sizing with quarter-Kelly is appropriately conservative. Crypto strategy adds diversification.

**Issues**:
- **No settled wins yet** — 0W/0L record. The one settlement was a loss (-$2.15). Can't evaluate if the edge is real without results.
- **Position limit violation** — 12 positions open vs 5 max. At $1000 paper balance, this is overleveraged. Real money would be at risk.
- **Crypto edge unvalidated** — GARCH model claims 9% edge on BTC but no backtest or track record supports this.
- **$1000 paper balance losing money** — started at $1000, now $918.45, first settlement was a loss. Early but not encouraging.

---

## Total Score: 72/100

| Dimension | Score | Change from R78 |
|-----------|-------|-----------------|
| CLI UX | 16/20 | — |
| Operational Readiness | 13/20 | ↓ (position limit breach) |
| Documentation | 17/20 | — |
| Automation | 12/20 | ↓ (perf broken) |
| Monetization Path | 14/20 | ↓ (first loss, no wins) |

## Top 3 Issues Preventing 95+

### 1. `perf` command is completely broken (all undefined)
The performance tracker — the single most important dashboard — shows `undefined` for every field on all 12 positions. This means the paper ledger schema doesn't match what `perf` expects. **Fix**: Align ledger field names with perf reader, or the ledger entries are missing required fields.

### 2. Position limit not enforced
Daily briefing says trading blocked at 12/5 positions, but `recommend --execute` still places trades. The guard is advisory, not a hard stop. **Fix**: `recommend --execute` must check position count before placing any trade and refuse if over limit.

### 3. No cron/automation for unattended operation
No cron jobs, no IV history, 0 observations collected. The system requires manual execution of every step. **Fix**: Set up cron for `data collect`, `data snapshot`, `trade settle`, and observation fetching.

## What Would Need to Change to Reach 95

1. Fix `perf` to correctly read ledger entries (field mapping bug)
2. Hard-enforce position limits in `recommend --execute`
3. Set up cron jobs for data collection, settlement, observations
4. Fix `calibrate` timeout/hang
5. Resolve balance inconsistencies between commands
6. Fix AGENTS.md KMDW contradiction in settlement stations section
7. Get 20+ settled trades with positive P&L to validate the edge
8. Add `trade list` as alias for `trade positions`
9. Collect actual observations automatically for settlement verification
10. Add confirmation prompt for destructive operations (settle)
