# R17 Product Review — Kalshi Multi-Strategy Trading System

**Date**: 2026-02-10  
**Reviewer**: Product Agent (fresh, no prior context)  
**Version**: 2.0.0  
**Scoring**: 5 dimensions × 20 pts = 100

---

## 1. CLI UX — 19/20

**Excellent.** The `--help` at every level is thorough and well-formatted. The top-level help is a genuine reference card — stations, examples, subcommand trees all visible at a glance.

Per-command `--help` works for all 5 main commands (iv, recommend, crypto, trade, data). Each shows arguments, flags, and realistic examples. The `iv --help` includes the mid-vs-ask pricing note — exactly the kind of domain-specific detail that separates pro tools from toys.

Output formatting is strong: Unicode box-drawing, emoji status indicators, GO/NO-GO decision matrices, clear station tables. The `iv` output is the crown jewel — forecast σ, market σ, gap, net edge, and a validation status legend all in one screen.

Minor deductions:
- `trade list` shows "7 duplicate trades from guard bypass hidden" — the fact that duplicates exist at all is a UX smell (even if hidden). -0.5
- `daily` output doesn't show KDEN (which `iv` says is GO). Slight inconsistency. -0.5

## 2. Operational Readiness — 18/20

**Health at 100%** (6/6 checks). All external APIs healthy: NWS, GFS, ECMWF, Kalshi. Balance positive ($1,077.55). IV history has 51 snapshots (0.1h old). Paper ledger active with real trades.

The guard system is working — `recommend` correctly blocked 3 KMIA trades where σ gap was below threshold. The system refused to trade when it shouldn't. That's operational discipline.

Data pipeline is functional: `data snapshot` captures forecasts, contracts, decisions to JSONL. `data history` shows 337 decision records across 2 days.

Deductions:
- Cron not configured (health warns ⚠️). For a system that depends on regular IV collection, this is a gap. -1
- 7 duplicate trades in ledger from "guard bypass" suggests a past execution bug. Data integrity issue even if patched. -1

## 3. Documentation — 19/20

README is clean, accurate, and matches actual behavior. Architecture section maps directories to purpose. Strategy section explains the core thesis (sub-1°F MAE vs 3-4°F market σ) in one paragraph.

AGENTS.md is a detailed operational playbook: station-specific σ tables, pre-trade checklists, honest assessment of which stations work and which don't (KMDW exclusion well-documented with the 3.4x calibration error story).

The `iv --help` note about mid-price for display vs ask-price for execution is exactly right — this catches a common quant mistake.

Deductions:
- No docs on settlement mechanics or how `data settle` verification works. -1

## 4. Automation — 17/20

Data collection is automatable (`data collect --silent` designed for cron). Snapshot pipeline works. `recommend --execute` enables hands-off trade placement.

The system collects 51 IV snapshots, so clearly *something* is driving regular collection (likely the agent, not cron).

Deductions:
- No cron configured. The `--silent` flag exists but nothing uses it. -1
- No alerting on health degradation or missed collections. -1
- `recommend --execute` exists but no evidence of automated execution loop (daily agent run is manual/agent-triggered). -1

## 5. Monetization Readiness — 17/20

The system has a real edge thesis backed by calibration data. Quarter-Kelly sizing is correct for a new strategy. Paper trading shows +$83.45 P&L with 89% win rate on 9 settled trades.

Multi-strategy (weather + crypto) diversifies the opportunity set. Crypto found an actionable ETH trade today with 7% edge.

The $800 drawdown circuit breaker and 9 independent pre-trade guards show serious risk management thinking.

Deductions:
- Still paper-only (expected, not penalized per instructions)
- No Sharpe ratio or risk-adjusted metrics in `perf` output. For a system approaching live trading, you need this. -2
- No P&L attribution by strategy in `perf` (weather vs crypto split). The breakdown shows "weather: +8.55$" but crypto positions are open and not broken out. -1

---

## Final Score: 90/100

| Dimension | Score | Notes |
|-----------|-------|-------|
| CLI UX | 19/20 | Per-command --help, mid/ask note, excellent formatting |
| Operational Readiness | 18/20 | Health 100%, guards working, minor ledger duplicates |
| Documentation | 19/20 | Honest station assessment, clear README, good playbook |
| Automation | 17/20 | Silent mode exists but no cron, no alerting |
| Monetization | 17/20 | Real edge, good risk mgmt, needs risk-adjusted metrics |
| **TOTAL** | **90/100** | |

## Verdict

**Strong B+.** This is a well-built quantitative trading system with genuine intellectual honesty (KMDW exclusion, calibration corrections, conservative sizing). The CLI is professional-grade. The gap to 95+ is operational polish: wire up cron, add Sharpe/Sortino to perf, fix the duplicate trade data, and add strategy-level P&L attribution. The core product — finding and sizing mispriced volatility — works.

## R17-Specific Assessment

✅ Per-command `--help` for all 5 main commands — **shipped and working**  
✅ IV output notes mid vs ask pricing — **present in both `iv --help` and `iv` footer**  
✅ Health at 100% — **confirmed, 6/6 checks pass**  
✅ Zero dependencies — **confirmed in package.json and README**
