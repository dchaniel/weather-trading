# R14 Simplicity Review — 2026-02-10

**Reviewer**: Fresh-eyes simplicity agent  
**Codebase**: 6,726 lines across 37 JS files, zero external deps

---

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Simplicity** | 14/20 | Functions mostly clear but several command files are 300-470 lines with mixed concerns |
| **Feature Necessity** | 16/20 | Everything has a purpose. Crypto is kept by owner choice. Walk-forward in backtest engine is heavy but justifiable |
| **DRY Compliance** | 13/20 | **Duplicate `settleCmd`** in both data.js and trade.js. R14 calibrate.js fix helped but more remains |
| **Cognitive Load** | 15/20 | Good module boundaries. CLI entry points are discoverable. Some files do too much (data.js = 5 subcommands, 468 lines) |
| **Maintainability** | 16/20 | Clean lib/ vs commands/ split. Shared utilities. No circular deps apparent. Easy to find things |

### **Total: 74/100** — Solid for a zero-dep system, but has identifiable waste

---

## Critical Issues

### 1. Duplicate Settlement Logic (DRY violation)
`commands/data.js:settleCmd` (lines 126-188) and `commands/trade.js:settleCmd` (lines 347-395) both implement settlement. data.js does it manually with `fetchObservation` + `parseTicker` + `updateTrade`. trade.js delegates to `executeSettlement()` from `lib/core/settlement.js`. **Three implementations of the same concept.**

**Fix**: Delete `settleCmd` from data.js, route `kalshi data settle` to trade.js's version (or directly to `lib/core/settlement.js`). ~60 lines saved.

### 2. data.js is a God File (468 lines, 5 subcommands)
`collectCmd`, `snapshotCmd`, `historyCmd`, `settleCmd`, `observeCmd` — these are essentially 5 separate commands crammed into one file. `snapshotCmd` alone is ~80 lines that re-implements forecast+market fetching that `implied_vol.js` already does.

**Fix**: Extract snapshot logic to a lib function, or have snapshot call `iv` internally (like `collectCmd` already does).

### 3. recommend.js Execution Loop (298 lines total)
This file mixes recommendation scoring, display formatting, dry-run mode, save-to-file, and a full execution loop with retry logic. The `executeTradesLoop` function is 60+ lines of orchestration that belongs in `lib/core/executor.js`.

---

## Minor Issues

| Issue | Location | Impact |
|-------|----------|--------|
| `trade.js` imports `STATIONS` twice (line 3 and line 6) | commands/trade.js | Cosmetic |
| `positionsCmd` has inline Kalshi API calls instead of using a shared position-fetching function | commands/trade.js:175-240 | 65 lines of inline API work |
| `daily.js` hardcodes `targetStations = ['KMDW', 'KNYC']` but KMDW is marked as NO EDGE in AGENTS.md | commands/daily.js:121 | Stale config |
| `formatBriefingForTelegram` in daily.js is 45 lines that could be a template | commands/daily.js | Minor bloat |
| `lib/crypto/forecast.js` at 310 lines is the largest lib file — contains 10+ exported functions | lib/crypto/forecast.js | Dense but each function is focused |
| `backtest/engine.js` walk-forward loop (lines 300-345) repeats sigma-sweep logic from earlier in same function | lib/backtest/engine.js | Internal duplication |

---

## What's Good

- **Zero deps** — remarkable discipline, nothing to audit or update
- **lib/core/ separation** — utils, sizing, guard, risk, trade, history all cleanly split
- **matcher.js reuse** — R14 fix correctly has snapshot using matcher.js (confirmed in data.js imports)
- **calibrate.js uses historical.js** — R14 DRY fix confirmed, `fetchHistoricalActuals` is shared
- **Guard system** — single `runGuards()` function used consistently across iv, trade, recommend, data
- **Station config** — single source of truth in `lib/weather/stations.js` (254 lines but comprehensive)

---

## Recommended Next Actions (by impact)

1. **Delete duplicate settleCmd from data.js** → route to settlement.js (~60 lines saved, DRY fix)
2. **Fix KMDW in daily.js** → replace with KMIA or use TRADEABLE_STATIONS
3. **Extract executeTradesLoop from recommend.js** → move to lib/core/executor.js
4. **Split data.js subcommands** into separate files or at minimum extract snapshotCmd to lib/

---

*Estimated savings from fixes #1-#4: ~120 lines removed, 1 DRY violation fixed, reduced cognitive load on the two largest files.*
