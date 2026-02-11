# Stations Expansion — Product Review
**Date**: 2026-02-11 | **Reviewer**: Product Agent | **Scope**: 3→12 tradeable stations

## Executive Summary
The expansion from 3 to 12 tradeable stations is **well-executed**. CLI output scales cleanly, calibration tiers are honest, and guard rails correctly block failed stations (KMDW, KLAX). One bug found in `recommend` (undefined `fetchPrecipRecs`). `calibrate` hangs/times out for full station set. Overall: **78/100**.

---

## Command Results

| Command | Status | Notes |
|---------|--------|-------|
| `kalshi iv` | ✅ Works | All 13 stations + 4 LOW temp. Clean table, GO/NO-GO matrix |
| `kalshi calibrate` | ❌ Timeout | Killed after >2min. Fetching 15 stations × 60 days historical data |
| `kalshi recommend` | ⚠️ Error | Works but throws `fetchPrecipRecs is not defined` at end |
| `kalshi health` | ✅ Works | Shows 12 tradeable / 15 available. 100% health score |
| `kalshi config` | ✅ Works | Clean layout. Risk/guard/execution sections |

---

## Scoring

### 1. CLI UX — 16/20
**Strengths**:
- `iv` output is exceptional: table + GO/NO-GO matrix + actionable next step ("Run `kalshi recommend`")
- Emoji status indicators (🟢🔴⚠️❌) scan well across 13 stations
- `health` cleanly shows 12/15 station breakdown
- `config` organized into logical sections with defaults shown
- Guard warnings (KPHL blocked from whitelist) are helpful

**Issues**:
- `calibrate` has no progress indicator — just hangs silently for minutes
- No `--station` filter documented for `iv` (it exists per help but output dumps everything)
- 13-row tables are at the edge of terminal readability; no summary line count

### 2. Operational Readiness — 15/20
**Strengths**:
- Whitelist correctly blocks KMDW, KLAX, KPHL (tier F/B)
- Seasonal σ adjustment applied (winter +0.5°F visible in recommend output)
- Validation status (VAL/VAL*) clearly distinguishes tradeable vs excluded
- All 4 data sources healthy (NWS, GFS, ECMWF, Kalshi API)
- IV history: 105 snapshots collected

**Issues**:
- `calibrate` timing out means operators can't re-validate stations on demand
- `recommend` crashes with `fetchPrecipRecs is not defined` — function exists at line 201 but scoping issue
- No cron jobs configured (health check warns ⚠️)
- `data/calibration/` directory is empty — calibration results not persisted?

### 3. Documentation — 16/20
**Strengths**:
- AGENTS.md has comprehensive station table with MAE, baseSigma, tier, ticker, status
- Honest station assessment with KMDW/KLAX failure documented
- Trading rules and pre-trade checklist are clear
- Tier system (A/B/F) is intuitive

**Issues**:
- AGENTS.md station count (14 calibrated) doesn't match health output (15 available)
- KIAH and KAUS missing from AGENTS.md honest assessment table (top) but present in bottom table
- No runbook for adding a new station (calibrate → validate → whitelist → trade)

### 4. Automation — 14/20
**Strengths**:
- `data collect --silent` exists for cron
- `data settle` for auto-settlement
- Guard system automatically blocks bad stations
- Multi-day horizon support (HORIZON_SIGMA multipliers)

**Issues**:
- No cron jobs actually configured (health warns)
- `calibrate` can't complete in reasonable time — blocks automation pipelines
- No automatic station promotion/demotion based on rolling accuracy
- `recommend` error would break any automated pipeline

### 5. Monetization — 17/20
**Strengths**:
- 4x expansion in tradeable surface area (3→12 stations)
- Today's scan found 4 STRONG edges (KMIA, KATL, KDFW, KMSP) + 2 marginal
- KDFW showing 20.98¢ net edge — excellent
- KMSP showing 10.39¢ net edge at 6.9°F market σ — huge mispricing
- LOW temp markets add additional opportunity (KNYC LOW: 4.51¢ edge)
- Transaction cost filtering works correctly (4¢/contract)

**Issues**:
- KPHL shows 13.33¢ edge but is blocked from trading (whitelist) — money left on table
- Only 3/12 stations cleared GO today (guard filters working but opportunity cost is real)
- No portfolio-level correlation analysis across 12 stations

---

## Bugs Found

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 HIGH | `fetchPrecipRecs is not defined` error in recommend | `commands/recommend.js:126` |
| 🔴 HIGH | `calibrate` times out (>2min, killed by OOM/timeout) | Full station set fetching |
| 🟡 MED | KPHL blocked despite 13.33¢ edge — needs LOW-only whitelist path | `lib/weather/stations.js:270` |
| 🟢 LOW | Empty `data/calibration/` directory | Calibration results not persisted |

---

## Final Score: 78/100

| Dimension | Score | Weight |
|-----------|-------|--------|
| CLI UX | 16/20 | Scales well, minor polish needed |
| Operational Readiness | 15/20 | Two bugs block clean operation |
| Documentation | 16/20 | Honest and comprehensive, minor gaps |
| Automation | 14/20 | No cron + calibrate timeout + recommend error |
| Monetization | 17/20 | 4x opportunity expansion, strong edges found |

**Verdict**: The station expansion is architecturally solid. The whitelist/tier system, guard rails, and calibration-based σ values are well-designed. Fix the two HIGH bugs (`fetchPrecipRecs` scoping, `calibrate` timeout) and this is production-ready. The 12-station surface with today's 4 strong edges (up to 20.98¢) represents meaningful monetization uplift.
