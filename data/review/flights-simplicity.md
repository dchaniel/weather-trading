# Flight Delay Strategy — Simplicity Review

## Reviewer: Simplicity Agent
## Date: 2026-02-11

### Scoring (5 dimensions × 20 points)

#### 1. Modularity (20/20)
- Clean 3-file module structure: data.js / model.js / matcher.js
- Each file has single responsibility:
  - data.js: I/O (fetch weather, FAA, historical stats)
  - model.js: Pure computation (weather severity, delay probability, total delay prediction)
  - matcher.js: Market matching (Kalshi integration, scoring, strategy orchestration)
- Command layer (flights.js) is pure presentation — no business logic
- Clear dependency flow: data → model → matcher → command

#### 2. Code Reuse (19/20)
- Reuses `lib/core/sizing.js` for Kelly criterion position sizing
- Reuses `lib/core/utils.js` for fetchJSON, normalCDF, probabilities
- Reuses `lib/kalshi/client.js` for authenticated API access
- Follows same patterns as weather/matcher.js and crypto/strategy.js
- Minor: Weather fetching could share more with existing forecast.js (different coords though, so separate is justified) (-1)

#### 3. Readability (19/20)
- Comprehensive JSDoc on all exports
- Clear variable names (pDelay, weatherMultiplier, severityScore)
- Constants documented with source (BTS data years, feature thresholds)
- Model breakdown in comments explains each multiplier
- Minor: classifyWeatherSeverity could use a config object instead of nested ifs (-1)

#### 4. Minimal Complexity (19/20)
- Multiplicative model is the simplest reasonable approach for this problem
- No ML libraries, no neural networks — just calibrated statistics
- Weather severity as a categorical variable keeps the model interpretable
- Normal distribution for total delay counts — appropriate and simple
- Holiday detection uses straightforward date math
- Minor: Could reduce getHolidayMultiplier complexity with a lookup table of date ranges (-1)

#### 5. Maintainability (19/20)
- Historical base rates are easy to update (single constant object)
- Weather thresholds clearly documented and adjustable
- Model is fully interpretable — every prediction can be explained via breakdown
- New airports (JFK, LAX) can be added by extending ORD pattern
- Zero new dependencies — pure ES modules
- Minor: When markets reactivate, may need to update ticker parsing in normalizeFlightMarket (-1)

### Total: 96/100

### Code Metrics
- New files: 4 (data.js: 270 lines, model.js: 210 lines, matcher.js: 175 lines, flights.js: 180 lines)
- Total new code: ~835 lines
- New dependencies: 0
- Existing code modified: 2 files (bin/kalshi.js: +2 lines, commands/recommend.js: +25 lines)
- Breaking changes: 0

### Strengths
- Follows established patterns perfectly — a new contributor could understand the flights module by reading the weather module
- Model is fully interpretable (no black boxes)
- Zero dependency addition is ideal
- Minimal modification to existing code (just wiring)

### Recommendations
1. Extract weather severity thresholds to a config constant for easy tuning
2. Consider a shared `lib/airports/` module if adding JFK/LAX later
3. Add unit tests for model.js pure functions (classifyWeatherSeverity, predictDelayProbability)
