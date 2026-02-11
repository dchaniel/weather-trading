# R15 Product Review — 2026-02-10

**Reviewer**: Fresh subagent, paying-customer mindset  
**System**: Kalshi Multi-Strategy Trading CLI v2.0.0  
**Commands tested**: --help, iv, recommend, crypto, daily, health, perf, trade list, trade positions, data snapshot, data history

---

## Scoring Summary

| Dimension | Score | Max |
|-----------|-------|-----|
| 1. CLI UX | 17 | 20 |
| 2. Operational Readiness | 14 | 20 |
| 3. Documentation | 18 | 20 |
| 4. Automation | 10 | 20 |
| 5. Monetization | 14 | 20 |
| **TOTAL** | **73** | **100** |

---

## 1. CLI UX — 17/20

**What works well:**
- `--help` is excellent — grouped sections (Core Strategy, Trading Ops, Quick Examples), clear descriptions, supported markets listed
- `kalshi iv` output is genuinely beautiful: validation badges, GO/NO-GO matrix, decision criteria footnotes
- `kalshi daily` is a tight morning briefing — balance, positions, drawdown, station-by-station weather + crypto, actionable recs in one screen
- `kalshi crypto` shows GARCH vs realized vol, RSI, drift, actionable trades with sizing — impressive depth
- `trade list` alias confirmed working (R15 fix)
- Zero dependencies — pure Node.js, fast startup

**Issues:**
- `trade list` shows 8 identical KMIA entries with same P&L (+10.70) — confusing; are these 8 separate trades or display bug? Settled trades show "Exit: $Open" which contradicts perf showing them settled
- `trade positions` shows "$0.00 Kalshi balance" and "No open positions" while `perf` shows 4 open positions — disconnect between paper and live views is jarring without explanation
- `perf` shows duplicate settled trades (4x identical KMIA lines) — either real duplicates or display issue; either way erodes trust

**Deduction**: -3 for confusing ledger display and paper/live position disconnect

## 2. Operational Readiness — 14/20

**What works well:**
- Health check covers API connectivity (NWS, GFS, ECMWF, Kalshi) — all green
- Balance tracking works ($1077.55, +8.3%)
- 9 pre-trade guards with clear pass/fail in `recommend`
- KMDW correctly excluded from trading (VAL* badge in iv, not in daily targets — R15 fix confirmed)
- Data pipeline: snapshot writes JSONL, history queries work, 300+ decision records accumulated

**Issues:**
- Health reports 83% (5/6) — IV history file missing, cron jobs missing
- No observations collected yet (0 records in history) — can't validate settlements
- `trade positions` showing $0 Kalshi balance means no real API integration for position tracking
- Paper ledger has suspicious data: 8 identical trades on same contract same day same size — violates own "maxTradesPerDay = 1" rule
- No circuit breaker test visible; $800 drawdown limit mentioned in README but never stressed

**Deduction**: -6 for missing observations, dubious ledger integrity, no live position sync

## 3. Documentation — 18/20

**What works well:**
- README.md is genuinely good (R15 addition) — quick start, command table, architecture diagram, strategy explanation, status section with real numbers
- AGENTS.md is thorough: station calibration tables, honest market reality, pre-trade checklist, trading rules
- "Zero external dependencies" and config paths clearly documented
- Honest about paper trading status — not overselling

**Issues:**
- No CHANGELOG or version history
- No troubleshooting section (what if NWS API is down?)

**Deduction**: -2 minor gaps

## 4. Automation — 10/20

**What works well:**
- `data collect --silent` and `data snapshot --silent` flags exist for cron
- Health check _reports_ on cron status (R15 addition)
- JSONL audit trail accumulating

**Issues:**
- Health confirms "No cron jobs found" — automation is designed but not deployed
- No scheduled daily briefing, no auto-collection, no auto-settlement
- `data observe` has 0 records — observations aren't being collected, so settlements can't auto-verify
- No alerting (e.g., notify when edge appears, circuit breaker triggers)
- The system is a manual CLI that _could_ be automated but isn't

**Deduction**: -10 for automation being entirely aspirational

## 5. Monetization — 14/20

**What works well:**
- Paper trading shows +8.3% return, 88.9% win rate — compelling if real
- Multi-strategy (weather + crypto) diversifies opportunity set
- Quarter-Kelly sizing is conservative and correct
- Transaction cost modeling built into every decision (4¢/contract)
- Guard system prevents bad trades (3 weather trades blocked today for insufficient edge)
- Crypto strategy found actionable ETH trade with 7% net edge

**Issues:**
- Only 9 settled trades — far too few to validate edge (need 50+ minimum)
- Ledger integrity concerns (duplicate entries) undermine confidence in the 88.9% number
- No Sharpe ratio calculated despite `perf` claiming to show it
- Open crypto positions are small ($3-4 risk each) — even at scale, edge per trade is thin
- No backtest results presented; `perf backtest` exists but no historical validation shown
- Real Kalshi balance is $0.00 — no capital deployed

**Deduction**: -6 for insufficient sample size, no backtest evidence, no real capital

---

## R15 Changes Verified

| Change | Status |
|--------|--------|
| README.md added | ✅ Excellent quality |
| `trade list` alias works | ✅ Confirmed |
| Duplicate settle removed from data.js | ✅ `data` subcommands clean |
| Health shows cron setup | ✅ Reports "No cron jobs found" |
| KMDW removed from daily targets | ✅ Not in daily weather section |

---

## Top 3 Priorities to Reach 90+

1. **Deploy automation** (+8-10 pts): Set up cron for `data collect`, `data snapshot`, `data observe`, `daily`. The silent flags exist — use them. This alone moves Automation from 10→18.

2. **Fix ledger integrity** (+4-5 pts): 8 identical KMIA trades violating maxTradesPerDay=1 is a red flag. Deduplicate, add trade ID uniqueness enforcement, reconcile paper vs display. Fixes UX and Monetization trust.

3. **Accumulate track record** (+3-4 pts): Run 50+ paper trades with auto-settlement and observation collection. Present backtest results. This is the difference between "interesting project" and "I'd pay for this."

---

## Would I Pay $100/mo?

**No.** At 73, this is an impressive engineering artifact with genuine analytical depth — the IV analysis, guard system, and multi-strategy design are legitimately good. But it's a sharp knife sitting in a drawer. No automation means no passive income generation. The ledger anomalies make me distrust the win rate. And 9 trades is a coin-flip sample, not a track record. 

Get cron running, fix the ledger, accumulate 50 clean trades, and this could be a 90+ system.
