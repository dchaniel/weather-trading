# Precipitation Strategy — Simplicity Review

## Reviewer: Simplicity Agent
## Date: 2026-02-11

### Scoring (5 dimensions × 20 points)

#### 1. Code Reuse (20/20)
- **Shared utilities**: `fetchJSON`, `round1`, `round2`, `sleep`, `today` from `core/utils.js`. ✅
- **Position sizing**: `positionSize()` and `TRANSACTION_COST` from `core/sizing.js` — no re-implementation. ✅
- **Kalshi API**: `getSeriesMarkets()` from `kalshi/client.js` — same API client for all strategies. ✅
- **Ledger**: `getLedger()` from `core/trade.js` — unified balance tracking. ✅
- **No new dependencies**: Zero external packages, consistent with platform policy. ✅

#### 2. Modularity & Separation of Concerns (19/20)
- **5 modules** in `lib/precipitation/` with clear single responsibilities:
  - `stations.js` — config/metadata (no logic)
  - `forecast.js` — data fetching + consensus (no probability math)
  - `ensemble.js` — probability models (Gamma + logistic, no I/O)
  - `matcher.js` — market scoring (bridges forecast to contracts)
  - `calibration.js` — historical validation (offline analysis)
- **Command layer**: `commands/precip.js` is pure CLI orchestration — no business logic.
- **Minor deduction**: `ensemble.js` contains both daily (logistic) and monthly (Gamma) models. Could split, but at 300 lines it's manageable. (-1)

#### 3. Pattern Consistency (20/20)
- **Follows weather strategy patterns exactly**:
  - `stations.js` ↔ `weather/stations.js` (same structure, precip-specific fields)
  - `forecast.js` ↔ `weather/forecast.js` (same NWS + GFS + ECMWF + consensus pattern)
  - `matcher.js` ↔ `weather/matcher.js` (same score → filter → size pipeline)
  - `calibration.js` ↔ `weather/calibration.js` (same historical data approach)
- **Same consensus builder pattern**: fetch multiple sources → weight → combine. ✅
- **Same edge calculation**: edge-at-executable-price, not midpoint. ✅
- **Same CLI pattern**: subcommands with `--help`, verbose flag. ✅

#### 4. Code Clarity (19/20)
- **Well-documented**: Every module has header comments explaining the statistical approach and why it differs from temperature.
- **Function-level docs**: JSDoc on all public functions with parameter descriptions.
- **Named constants**: `MAX_SPREAD`, `DEFAULT_MIN_EDGE` — no magic numbers.
- **Clear variable names**: `rainProb`, `precipAmount`, `gammaParams`, `mtdActual`.
- **Minor deduction**: The `lnGamma` function is duplicated (also in `core/utils.js`). Should import from shared module. (-1)

#### 5. Minimal Complexity (18/20)
- **~1750 lines** for a complete new strategy with CLI, calibration, and 2 probability models — reasonable.
- **No over-engineering**: No abstract base classes, no strategy interface pattern, no plugin system.
- **Direct function calls**: No event emitters, no middleware, no dependency injection.
- **Config is simple JSON**: Flat structure in `config.json`, no schema validation needed.
- **Deduction**: `gammaCFQ` and `gammaSeriesP` are complex numerical code (~40 lines). Necessary for correctness but could benefit from a comment explaining the algorithm source (Numerical Recipes §6.2). (-1)
- **Deduction**: Six stations defined but only 4 tradeable — the disabled ones add config weight. Could use a simpler enablement flag. (-1)

### Total: 96/100

### Summary
The precipitation module is clean, well-structured, and follows existing patterns closely. A developer familiar with the weather strategy would immediately understand the precipitation code. The key architectural decision — separate daily binary and monthly threshold models — is justified by the fundamentally different statistical needs. Code reuse is excellent: position sizing, API client, utilities, and ledger are all shared. The main areas for improvement are extracting the shared `lnGamma` function and adding algorithm source references for the numerical methods.
