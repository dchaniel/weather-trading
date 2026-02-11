# Product Review: 12-Station Expansion

**Date**: 2026-02-11  
**Reviewer**: Product Subagent  
**Scope**: UX evaluation of the expanded 13-tradeable / 15-total station system  
**Commands tested**: `kalshi iv`, `kalshi recommend`, `kalshi calibrate KNYC`, `kalshi health`, `kalshi config`

---

## Command Outputs Summary

### `kalshi iv` — ✅ Ran successfully
- Scanned all 13 tradeable + 2 failed stations for HIGH temps
- LOW temp IV section present (3 stations)
- GO/NO-GO decision matrix: 4 GO, 9 NO-GO
- Guard warnings displayed for whitelisted stations (KLAX blocked correctly)
- Runtime: ~5s

### `kalshi recommend` — ✅ Ran successfully
- Showed σ thresholds for all 13 tradeable stations
- Weather recs deferred to `iv` (correct behavior)
- Precipitation recs generated (rain daily + monthly)
- Flights section: dormant market handled gracefully
- Runtime: ~20s (slow — market fetches)

### `kalshi calibrate KNYC` — ✅ Ran successfully
- 13/30 days analyzed, correctly flagged as INSUFFICIENT (N<30)
- MAE=1.31°F vs σ=1.3°F → "well-calibrated" (1.01x ratio)
- Seasonal breakdown present, CI shown
- Clear actionable guidance at bottom

### `kalshi health` — ✅ All green
- 6/6 checks pass, 100% health
- All APIs (NWS, Open-Meteo GFS/ECMWF, Kalshi) connected
- 105 IV history snapshots, balance $1048.20
- 13 tradeable / 15 total stations reported correctly

### `kalshi config` — ✅ Clean output
- Three sections (RISK, GUARD, EXECUTION) with defaults shown
- Edit/reset instructions at bottom

---

## UX Scoring: 5 Dimensions × 20 Points

### 1. Information Density & Readability (18/20)

**Strengths:**
- `iv` table is excellent: station, validation, forecast, σ comparison, gap, net edge, status all in one line
- Color-coded status (✅ STRONG, ⚠️ MARGINAL, ❌ NO PROFIT) is instantly scannable
- GO/NO-GO matrix provides clear binary decisions with criteria columns
- `health` output is concise and complete

**Weaknesses:**
- `iv` output is long for 13+ stations — no summary count at top (you must scroll to bottom)
- LOW temp section only shows 3 stations — unclear if others were checked and had no markets, or weren't checked

**Score: 18/20**

### 2. Multi-Station Scalability (15/20)

**Strengths:**
- All tables handle 13 stations without layout breakage
- Station tiers (A/B/F) from AGENTS.md are implicit in the whitelist filtering
- Guard warnings properly block failed stations (KLAX, KMDW marked VAL*)

**Weaknesses:**
- `recommend` lists all 13 stations' σ thresholds in a wall of text before showing any actionable recs — this doesn't scale well to 20+ stations
- No grouping by tier or region; scanning 13 lines for "which ones are GO?" requires reading the full table
- `calibrate` only accepts one station at a time — running `calibrate ALL` for 13 stations would be tedious
- No "portfolio view" — how much total capital is allocated across stations?

**Score: 15/20**

### 3. Decision Support Quality (17/20)

**Strengths:**
- GO/NO-GO matrix is the standout feature — clear, multi-criteria, binary output
- Net edge after costs shown directly (not just raw gap)
- `recommend` correctly defers weather sizing to `iv` when no specific contracts found
- Transaction cost budget embedded in calculations
- Validation status (VAL/VAL*/NO) clearly distinguishes station readiness

**Weaknesses:**
- 4 GO stations but `recommend` didn't produce weather trade recs for them — disconnect between `iv` saying "GO" and `recommend` not sizing those trades
- No ranking of GO stations by expected return or risk-adjusted edge
- Missing: "total portfolio expected edge today" summary line

**Score: 17/20**

### 4. Error Handling & Edge Cases (16/20)

**Strengths:**
- KMDW/KLAX correctly blocked with clear explanations
- Insufficient calibration data (N=13) properly flagged with CI
- Dormant markets (flights) handled gracefully
- Seasonal adjustment transparently noted

**Weaknesses:**
- `calibrate KNYC` only got 13/30 days of data — no explanation of why 17 days are missing (API gaps? weekends? no markets?)
- `recommend` took ~20s with no progress indicator — felt hung
- No timeout/retry messaging if an API call fails mid-scan
- KMDW shows "10.54¢ edge" in LOW temp section despite being UNTRADEABLE — confusing (edge number is meaningless if blocked)

**Score: 16/20**

### 5. Workflow Coherence (16/20)

**Strengths:**
- Clear command pipeline: `health` → `iv` → `recommend` → execute
- `iv` footer says "Run `kalshi recommend` for sizing" — good chaining
- `config` shows all tunable parameters with defaults
- `calibrate` output ends with actionable guidance

**Weaknesses:**
- `recommend` shows σ thresholds but says "Run `kalshi iv` for live market σ" — circular if you already ran `iv`
- No unified "morning briefing" that chains iv → recommend → sizing in one command (user must run 3 commands)
- `config` doesn't show which stations are tradeable — must cross-reference with `health`
- No `kalshi status` or dashboard command that shows: open positions + today's GO stations + P&L in one view

**Score: 16/20**

---

## Final Score

| Dimension | Score |
|-----------|-------|
| Information Density & Readability | 18/20 |
| Multi-Station Scalability | 15/20 |
| Decision Support Quality | 17/20 |
| Error Handling & Edge Cases | 16/20 |
| Workflow Coherence | 16/20 |
| **TOTAL** | **82/100** |

---

## Top Recommendations

1. **Add summary header to `iv`**: "4/13 stations GO • Best: KPHL +6.5°F gap • Portfolio edge: ~$X.XX" at the very top before the table
2. **Fix `recommend` ↔ `iv` disconnect**: If `iv` says GO, `recommend` should size those trades (or explain why not)
3. **Add `calibrate ALL`**: Batch calibration across all tradeable stations with summary table
4. **Add progress indicators**: `recommend` taking 20s with no output feels broken
5. **Suppress misleading edge numbers**: KMDW LOW showing "10.54¢ edge" while marked UNTRADEABLE is confusing — show "N/A" or "BLOCKED" instead
6. **Portfolio dashboard command**: Single command showing open positions + today's opportunities + cumulative P&L
