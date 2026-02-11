# R12 Simplicity Review — Kalshi Trading System

**Date**: 2026-02-10  
**Reviewer**: Simplicity Subagent (fresh, no prior context)  
**Codebase**: 7,095 lines across ~26 files, zero external dependencies

---

## Scores

### 1. Code Simplicity — 14/20

**Problems:**
- `recommend.js` (606 lines) is a god-function. One `export default` function does: arg parsing, date generation, IV display, forecast fetching, market matching, probability calculation, guard checking, trade execution, history logging, and summary output. This should be 3-4 functions max.
- `data.js` (570 lines) has 10 internal functions behind a switch/case router — it's a mini-application stuffed into one command file.
- `trade.js` (419 lines) same pattern — 6+ subcommands in one file.
- `stations.js` (266 lines) — wall of metadata objects. Fine for data, but the metadata per station is excessive (20+ fields each, some estimated/speculative like `ecmwfMAE`, `gfsMAE`).

**What's good:**
- `guard.js` (115 lines) — clean, focused, single responsibility. This is what every file should look like.
- `sizing.js` (60 lines) — perfect size for what it does.
- `observe.js` (36 lines) — crisp.
- `utils.js` (94 lines) — reasonable utility grab bag.

### 2. Feature Necessity — 13/20

**Questionable features:**
- **Crypto subsystem** (962 lines = 13.5% of codebase): `crypto/strategy.js`, `crypto/forecast.js`, `crypto/backtest.js`, `crypto/prices.js`, `crypto/markets.js`. Daniel chose to keep it, but it's nearly 1,000 lines for a strategy that isn't validated. At minimum, `crypto/backtest.js` (193 lines) could be removed if not actively used.
- **`calibrate.js`** (339 lines) — how often is this run? If it's a one-time setup tool, it shouldn't live in the main command set.
- **`health.js`** (200 lines) — health checks are nice but 200 lines is a lot. What's in there?
- **`perf.js`** (245 lines) — performance reporting. Could this be part of `daily`?
- **History/JSONL pipeline** (`history.js` 230 lines + consumers) — append-only JSONL logging across 5 files. Is anyone reading this data? If it's for future backtesting, it's premature infrastructure.
- **`data.js` snapshot subcommand** — the full snapshot function is ~120 lines. Is it used?

**What earns its keep:**
- `recommend.js` (core trading logic) ✅
- `implied_vol.js` (key analysis) ✅  
- `daily.js` (operator briefing) ✅
- `trade.js` (execution) ✅
- Guard system ✅
- Forecast pipeline ✅

### 3. DRY Compliance — 12/20

**Duplications found:**

1. **`probAboveThreshold` exists in 3 places:**
   - `commands/recommend.js:17` — uses `normalCDF` from utils
   - `commands/daily.js:15` — **inlines its own CDF approximation** (different implementation!)
   - `lib/crypto/forecast.js:244` — yet another version for crypto
   
   This is the worst kind of duplication — same concept, different implementations. One canonical version should live in `utils.js` or a shared `math.js`.

2. **`fetchActualObservation` in `data.js:226`** duplicates `fetchObservation` in `observe.js:9`. Both fetch NWS observations for a station+date. The data.js version also has an Open-Meteo fallback, but the core logic is copy-pasted.

3. **Date parsing pattern** (`args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || today()`) appears in at least 3 commands. Should be a utility.

4. **Station iteration with TRADEABLE_STATIONS filter** — `Object.keys(STATIONS).filter(k => TRADEABLE_STATIONS.has(k))` appears in multiple commands. Should be a single exported array.

5. **Ledger access pattern** — `getLedger()` followed by filtering trades by date/station/settled status is repeated across guard.js, recommend.js, trade.js, daily.js.

### 4. Cognitive Load — 15/20

**Good:**
- File naming is clear and intuitive
- Directory structure (`lib/weather/`, `lib/crypto/`, `lib/core/`, `lib/kalshi/`, `commands/`) makes sense
- Zero external dependencies means no dependency graph to learn
- AGENTS.md provides excellent context for the trading strategy
- Guard system is easy to understand

**Bad:**
- `recommend.js` requires reading 600 lines to understand the trading flow. A new developer would get lost.
- Crypto vs weather strategy split is unclear from file structure — when does each run? What triggers what?
- `data.js` being a 570-line Swiss army knife means you have to read it all to find anything
- Station metadata in `stations.js` has fields like `tier`, `notes`, `ecmwfMAE`, `gfsMAE`, `consensusMAE` — some seem like documentation stuffed into code

### 5. Maintainability — 15/20

**Good:**
- Zero dependencies = nothing breaks from upstream
- Each strategy is isolated in its own directory
- Guard system is centralized and clear
- Config-as-code in stations.js (debatable but consistent)

**Bad:**
- God-functions in recommend.js/data.js/trade.js mean any change risks breaking everything
- No tests (understandable for a trading agent, but large functions are harder to manually verify)
- Multiple sources of truth for station filtering (TRADEABLE_STATIONS set vs tier field vs hardcoded checks)
- History pipeline adds coupling — 6 `appendX` functions called from various places

---

## Total Score: 69/100

| Dimension | Score | Notes |
|-----------|-------|-------|
| Code Simplicity | 14/20 | 3 god-files drag it down |
| Feature Necessity | 13/20 | Crypto (962 lines) + history pipeline + calibrate questionable |
| DRY Compliance | 12/20 | probAboveThreshold ×3, observation fetch ×2, patterns repeated |
| Cognitive Load | 15/20 | Good structure, but big files hurt |
| Maintainability | 15/20 | Zero deps great, but god-functions fragile |

---

## Specific Refactoring Suggestions

### High Impact (would save ~800+ lines, gain ~15 points)

1. **Split `recommend.js` (606→~200 lines saved)**
   - Extract probability functions to `lib/core/math.js` (shared)
   - Extract market-matching logic to `lib/weather/matcher.js`
   - Extract execution loop to reuse `lib/core/executor.js`
   - The main function should be: fetch data → score opportunities → present/execute

2. **Split `data.js` (570→~200 lines saved)**
   - `data collect` and `data snapshot` could merge (both collect market data)
   - `data settle` should use `observe.js` instead of its own `fetchActualObservation`
   - `data history` query logic could be simpler — do we need all those filters?

3. **Consolidate `probAboveThreshold` (save ~30 lines, fix correctness risk)**
   - One version in `lib/core/math.js`
   - `daily.js` has a DIFFERENT CDF implementation than `recommend.js` — this is a latent bug

4. **Trim crypto if not actively trading (~200-400 lines)**
   - `crypto/backtest.js` (193 lines) — remove if not running backtests
   - `crypto/forecast.js` (310 lines) — GARCH + kurtosis modeling is sophisticated but unvalidated

### Medium Impact (would save ~300 lines, gain ~5 points)

5. **Merge `perf.js` into `daily.js`** — performance is part of the daily briefing. Two commands = two places to maintain.

6. **Simplify `stations.js`** — Remove speculative metadata fields (`ecmwfMAE`, `gfsMAE`, `consensusMAE`, `notes`, `tier`) that duplicate what's in AGENTS.md. Keep only what code actually reads.

7. **Extract common patterns to utils:**
   - Date arg parsing
   - `TRADEABLE_STATIONS` as pre-computed array
   - Trade filtering helpers

### Low Impact (polish)

8. **`calibrate.js` (339 lines)** — if run rarely, add a comment saying so. Consider moving to `bin/` or `scripts/`.

9. **`history.js` (230 lines)** — 6 append functions with similar patterns. Could be one generic `appendToHistory(type, data)` with type-specific validation.

---

## What Would Need to Change to Reach 95

To go from 69 → 95 requires aggressive action:

1. **Split the 3 god-commands** (recommend, data, trade) into focused functions of <100 lines each → +8 points
2. **Eliminate all DRY violations** (shared math, shared observation fetch, shared patterns) → +6 points  
3. **Remove or gate crypto** behind a feature flag, delete backtest.js if unused → +4 points
4. **Merge perf into daily**, simplify history to one generic function → +3 points
5. **Trim station metadata** to only code-consumed fields → +2 points
6. **Extract common arg parsing and trade filtering** → +3 points

Total potential: 69 + 26 = 95. It's achievable but requires real refactoring work, not just deletions.

---

## Files Ranked by Simplification Priority

| File | Lines | Action | Lines Saved |
|------|-------|--------|-------------|
| `commands/recommend.js` | 606 | Split into 3-4 modules | ~200 |
| `commands/data.js` | 570 | Dedupe observe, simplify | ~200 |
| `commands/trade.js` | 419 | Extract subcommands | ~100 |
| `lib/crypto/backtest.js` | 193 | Remove if unused | 193 |
| `lib/crypto/forecast.js` | 310 | Trim if crypto not active | ~100 |
| `commands/calibrate.js` | 339 | Move to scripts/ | 0 (reorg) |
| `commands/perf.js` | 245 | Merge into daily | ~150 |
| `lib/core/history.js` | 230 | Genericize append fns | ~80 |
| `lib/weather/stations.js` | 266 | Remove unused metadata | ~60 |
| **Total potential savings** | | | **~1,083** |

Target: 7,095 - 1,083 = ~6,012 lines with better organization and zero duplication.
