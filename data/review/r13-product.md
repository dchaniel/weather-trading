# R13 Product Review — Kalshi Trading System
**Date**: 2026-02-10 | **Reviewer**: Fresh product agent (no prior context)

## Overall Score: 74/100

---

## 1. CLI UX — 16/20

**What works well:**
- Help text is excellent — organized by section (Core, Trading, Data, Perf) with examples
- Emoji-rich output is scannable and professional
- `iv` command output is a masterclass: station table → GO/NO-GO matrix → action recommendation
- `daily` briefing is genuinely useful — balance, P&L, weather, crypto, recs in one shot
- `health` command gives real diagnostic value (API checks, data integrity, cron status)

**Issues:**
- `trade positions` shows "$0.00 balance" and "no open positions" on Kalshi (real), but `perf` shows 4 open paper trades — the mental model split between paper and real is confusing
- `perf` shows duplicate trades (4x identical KMIA entries on same date) — looks like a bug or poor dedup
- Temperature Forecast Quality shows `MAE: NaN°F` — broken metric in production output
- `recommend` blocked 3 weather trades then showed 1 crypto trade — the flow works but the "blocked" messaging could be tighter

**Verdict:** Polished surface, a few data-display bugs undermine trust.

## 2. Operational Readiness — 13/20

**What works:**
- `data snapshot` and `data collect` exist for cron-driven collection
- `health` explicitly warns about missing cron jobs and IV history
- Risk limits enforced (model spread > 3°F correctly blocks KNYC/KMDW)
- Balance tracking works ($1077.55 paper)

**Issues:**
- **No cron jobs configured** — health check itself flags this. System can't run unattended today.
- No alerting/notification pipeline visible (what happens if API goes down overnight?)
- Settlement appears manual (`trade settle <date>`, `data settle <date>`) — no auto-settlement
- No retry logic visible for API failures
- IV history file missing per health check — data pipeline incomplete

**Verdict:** All the building blocks exist but nothing is wired up for autonomous operation.

## 3. Documentation — 16/20

**What works:**
- AGENTS.md is outstanding — honest station assessment with corrected calibration data, clear trading rules, pre-trade checklist
- The KMDW correction story (3.4x calibration error caught and documented) builds real trust
- Transaction cost analysis is embedded in strategy docs
- Key files section helps navigation

**Issues:**
- No README.md visible (first thing a new user looks for)
- Inline `--help` per subcommand not tested but top-level help is solid
- No architecture diagram or data flow explanation
- TOOLS.md is mostly template boilerplate

**Verdict:** The AGENTS.md alone is worth the price of admission. Honest, detailed, actionable.

## 4. Automation — 14/20

**What works:**
- Paper trading flow is functional: recommend → trade → settle → perf
- 9 settled trades with 89% win rate tracked
- Multi-strategy (weather + crypto) unified in one ledger
- `data snapshot` captures forecasts, contracts, decisions to JSONL — good for analysis
- Risk guards actually fire (blocked 3 KMIA trades for insufficient edge)

**Issues:**
- Duplicate trades in ledger (4 identical KMIA entries) suggest the recommend→execute pipeline may double-fire
- No approve/reject workflow observed in action (commands exist per help)
- Settlement requires manual trigger
- 0 observation records in history — forecast verification pipeline broken
- `MAE: NaN` in perf confirms observations aren't being collected

**Verdict:** The happy path works. The feedback loop (verify forecasts, measure actual edge) is broken.

## 5. Monetization Path — 15/20

**What works:**
- The core thesis is sound: weather forecast σ << market implied σ, sell volatility
- KMIA showing 11.32¢ net edge per contract is real money
- Quarter-Kelly sizing is appropriately conservative
- 89% win rate on 9 trades (small sample but directionally correct)
- Crypto adds diversification with independent signal (GARCH + momentum)
- $83.50 paper profit on ~$1000 = 8.3% return (timeframe unclear but promising)

**Issues:**
- Sample size is tiny (9 settled trades, 2 days of data)
- KNYC showing -4¢ edge today despite being the "best edge" station per AGENTS.md — edge may be seasonal/variable
- Only 1 station (KMIA) cleared for trading today — opportunity set is narrow
- Crypto trade sizing ($3.60 risk) is trivially small
- No backtest results visible to validate historical edge
- Real Kalshi balance is $0.00 — hasn't crossed the paper→real bridge

**Verdict:** Promising thesis with early positive results. Needs 50+ trades and multi-week data before anyone should trust it with real money.

---

## Would I Pay $100/month?

**Not yet.** Here's what's missing:

1. **Cron automation** — I shouldn't have to run commands manually. The system should wake up, scan, recommend, and notify me.
2. **Observation collection** — Can't validate edge without measuring forecast accuracy continuously. MAE: NaN is disqualifying.
3. **Dedup bug** — 4 identical trades on the same contract is either a display bug or a real execution bug. Either way, it's trust-destroying.
4. **More data** — 9 trades over 2 days isn't enough. Need 30+ days of tracked performance.
5. **Real money bridge** — The system shows $0.00 Kalshi balance. Until it places a real trade, it's a simulator.

**I'd pay $100/month when:**
- It runs autonomously via cron and sends me a daily Slack/Discord digest
- It has 30+ days of verified paper performance with observation data
- The forecast verification loop is closed (actual temps collected, MAE tracked)
- It has placed and settled real trades successfully

**Current fair price: $0 (beta tester).** But the bones are good — 2-3 weeks of hardening could get it there.

---

## Priority Fixes

| Priority | Issue | Impact |
|----------|-------|--------|
| P0 | Collect observations (MAE: NaN) | Can't validate edge without ground truth |
| P0 | Fix duplicate trades in ledger | Trust-destroying display/execution bug |
| P1 | Set up cron for daily collect + snapshot | Required for unattended operation |
| P1 | Auto-settlement pipeline | Manual settlement won't scale |
| P2 | Add README.md | First-run experience for new users |
| P2 | Reconcile paper vs real position display | Confusing to show both without context |
