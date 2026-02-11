# R18 Product Review — Kalshi Multi-Strategy Trading System

**Date**: 2026-02-10  
**Reviewer**: Product Agent (fresh, no prior context)  
**Scoring**: 5 dimensions × 20 pts = 100

---

## 1. CLI UX — 19/20

Per-command `--help` for all commands. Output formatting with Unicode box-drawing, emoji indicators, GO/NO-GO matrix. The `iv --help` mid-vs-ask note is domain-specific detail that builds trust.

Sharpe/Sortino now in `perf` output with clear "preliminary" label when N<30. Strategy breakdown shows weather vs crypto P&L.

Minor deductions:
- `trade list` shows "duplicate trades hidden" message — legacy smell. (-0.5)
- `daily` output occasionally doesn't show all GO stations from `iv`. (-0.5)

## 2. Operational Readiness — 19/20

Health at 100% (6/6). All APIs healthy. Guards working — correctly blocking low-edge trades. Risk limits proportional to bankroll (20% drawdown from peak, 5% daily loss).

Legacy iv-history.json fully removed — clean JSONL-only pipeline.

Deductions:
- Cron not yet configured (health gives crontab example). The tooling is ready (`--silent` on collect/snapshot) but not wired. (-1)

## 3. Documentation — 19/20

README accurate with settlement mechanics documented. AGENTS.md is detailed operational playbook. Station-specific σ tables with honest assessment. KMDW has `enabled: false` — code matches docs.

Crypto files labeled "PAPER-ONLY — pending live validation." Health output includes crontab setup instructions.

Deductions:
- No runbook for "what to do when health degrades" beyond the health check itself. (-1)

## 4. Automation — 19/20

`data collect --silent` and `data snapshot --silent` designed for cron. Health output provides ready-to-use crontab entries. `recommend --execute` for hands-off trade placement. 54 IV snapshots collected.

Deductions:
- No alerting on health degradation or missed collections (would need external monitoring). (-1)

## 5. Monetization Readiness — 19/20

Real edge thesis backed by calibration. Bayesian σ updating improves confidence over time. Sharpe/Sortino metrics visible in perf. Strategy P&L breakdown present.

Proportional risk limits scale with account growth. Settlement docs explain the full trade lifecycle.

Deductions:
- No projected annualized return estimate. (-1)

---

## Final Score: 95/100

| Dimension | Score | Notes |
|-----------|-------|-------|
| CLI UX | 19/20 | Sharpe/Sortino, strategy breakdown, excellent formatting |
| Operational Readiness | 19/20 | Health 100%, proportional risk, legacy cleanup |
| Documentation | 19/20 | Settlement docs, KMDW enabled:false, crontab examples |
| Automation | 19/20 | --silent wired, crontab in health, recommend --execute |
| Monetization | 19/20 | Risk-adjusted metrics, Bayesian updating, proportional limits |
| **TOTAL** | **95/100** | |

## Verdict

**A.** R18 closed the R17 product gaps: Sharpe/Sortino in perf, legacy iv-history.json removed, settlement docs added, crontab examples in health output, proportional risk limits. The system is production-ready for paper trading and well-documented for the transition to live.
