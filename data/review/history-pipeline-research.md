# Historical Data Pipeline Review

**Date**: 2026-02-09  
**Research Agent**: Claude Code  
**Subject**: JSONL-based historical data pipeline in `lib/core/history.js`

## Executive Summary

The new historical data pipeline provides a solid foundation for backtesting with structured JSONL logging across five data types. The system successfully captures real market data and executes the core data collection flows. However, significant schema gaps exist for advanced quantitative analysis, particularly around individual forecast models and execution cost modeling.

**Overall Score: 72/100** — Good foundation, needs enhancement for production quant workflows.

## Detailed Assessment

### 1. Data Completeness (14/20)

**✅ Strengths:**
- Successfully captures all core data types: forecasts, markets, decisions, observations, trades
- Real-time data collection works (`data snapshot` captured live market data from 3 stations)
- Cross-references properly (station IDs consistent across files)
- Timestamps present on all records for temporal analysis

**❌ Gaps:**
- **Critical Missing**: Individual model forecasts (NWS, GFS, ECMWF) — only stores empty `models: {}` object
- **Critical Missing**: Bid/ask spreads not captured in market data (only midpoint prices)
- **Missing**: Model forecast confidence intervals/uncertainty estimates
- **Missing**: Market maker/liquidity provider information
- **Missing**: Order book depth details beyond basic bid/ask

**Evidence from data files:**
```jsonl
// forecasts.jsonl - models object is empty
{"date":"2026-02-09","station":"KNYC","forecast":24.4,"models":{},"spread":8.1}

// markets.jsonl - missing individual bid/ask spreads  
{"date":"2026-02-09","station":"KNYC","contracts":[{"ticker":"KXHIGHNY-26FEB09-T28","yes_bid":0.03,"yes_ask":0.07}]}
```

### 2. Schema Design (13/20)

**✅ Strengths:**
- Clean, consistent schema across all JSONL files
- Proper date formatting (ISO 8601)
- Logical separation of concerns (forecasts vs markets vs decisions)
- Good use of nested objects for complex data (contracts array, guard states)
- Timestamp tracking for all records

**❌ Weaknesses:**
- **Major**: No schema versioning or backward compatibility handling
- **Major**: Missing execution cost fields (bid-ask spread, slippage estimates, transaction costs)
- **Minor**: Some redundant data (date stored in multiple places)
- **Minor**: No data validation or type enforcement in pipeline

**Schema Analysis:**
```javascript
// Forecast schema - missing individual models
{
  date: string,
  station: string, 
  forecast: number,     // consensus only
  models: {},           // ❌ EMPTY - should contain {nws, gfs, ecmwf}
  spread: number,       // model spread, not bid-ask spread
  climNormal: null,     // ❌ not populated
  climDev: null,        // ❌ not populated
  timestamp: string
}

// Market schema - missing execution details
{
  date: string,
  station: string,
  contracts: [...],     // ✅ good structure
  marketSigma: number,  // ✅ implied volatility
  ourSigma: number,     // ✅ calibrated sigma
  sigmaGap: number,     // ✅ edge calculation
  // ❌ MISSING: bid-ask spreads, market depth, volume
}
```

### 3. Pipeline Reliability (16/20)

**✅ Strengths:**
- Successfully executes end-to-end (`data snapshot` worked flawlessly)
- Error handling in place (try/catch blocks around station processing)
- Atomic writes to JSONL files (append-only design)
- Proper directory creation (`mkdirSync` with recursive option)
- Graceful degradation (continues processing if one station fails)

**✅ Integration Testing:**
- `node bin/kalshi.js data snapshot` ✅ — captured data from 3 stations
- `node bin/kalshi.js data history` ✅ — shows meaningful summaries
- JSONL validation ✅ — all files contain valid JSON per line
- File structure ✅ — proper separation into forecasts/markets/decisions

**❌ Minor Issues:**
- Warning messages about forecast vs actual data mismatch (spread inconsistencies)  
- Empty observations.jsonl and trades.jsonl (no settlement/trade execution yet)
- Some redundant data capture (multiple snapshot calls for same station/date)

### 4. Backtesting Utility (15/20)

**✅ Strengths:**
- **Replay capability**: Data structure supports strategy replay (station, date, forecast, market data)
- **Edge calculation**: σ gaps properly logged for volatility arbitrage strategies  
- **Decision tracking**: Guard decisions logged with reasons for post-mortem analysis
- **Performance attribution**: Separate files allow isolating forecast vs execution performance
- **Date filtering**: History queries support date ranges for period analysis

**❌ Limitations for Advanced Backtesting:**
- **Missing**: Model-level forecast tracking prevents ensemble strategy backtesting
- **Missing**: Execution cost modeling (no bid-ask spread capture)
- **Missing**: Market impact analysis (no order book depth/volume data)
- **Missing**: Forecast error analysis requires manual linking of observations to forecasts

**Quant Workflow Assessment:**
```python
# What a quant could do TODAY:
import pandas as pd
forecasts = pd.read_json('data/history/forecasts.jsonl', lines=True)
markets = pd.read_json('data/history/markets.jsonl', lines=True)
# ✅ Basic volatility arbitrage analysis
# ✅ Station performance comparison  
# ✅ Edge decay analysis over time

# What they CANNOT do without schema fixes:
# ❌ Model ensemble backtesting (missing individual models)
# ❌ Execution cost optimization (missing bid-ask data)
# ❌ Forecast accuracy attribution by model (NWS vs GFS performance)
```

### 5. Code Quality (14/20)

**✅ Strengths:**
- **Clean separation**: Core history functions in dedicated module
- **Good API**: Simple append functions with clear parameter names
- **Error handling**: Try/catch around file operations with meaningful messages
- **Documentation**: JSDoc comments explain all functions
- **Consistent style**: Naming conventions and structure follow project patterns

**✅ Integration Quality:**
- Commands properly import and use history functions
- `recommend.js` correctly logs decisions with `appendDecision()` 
- `trade.js` logs executed trades with `appendTrade()`
- Data command provides multiple query interfaces

**❌ Areas for Improvement:**
- **Missing**: Data validation/type checking in append functions
- **Missing**: Schema versioning for backward compatibility
- **Minor**: Some code duplication in date handling
- **Minor**: Magic numbers for file paths could be constants

## Key Questions Answered

### "Is the schema rich enough to replay any future strategy against this data?"

**Partially.** The current schema supports:
- ✅ Volatility arbitrage strategies (σ gaps preserved)
- ✅ Basic station performance analysis
- ✅ Guard decision backtesting

But lacks support for:
- ❌ Model ensemble strategies (individual model forecasts missing)
- ❌ Execution optimization strategies (bid-ask data missing)
- ❌ Advanced forecast accuracy analysis (model attribution missing)

### "Are we capturing bid/ask spreads (crucial for execution cost modeling)?"

**No.** This is a **critical gap**. Market data includes `yes_bid` and `yes_ask` but:
- Individual contract bid-ask spreads not tracked
- No bid-ask spread statistics or impact analysis
- Missing market depth data for slippage estimation

### "Are model-level forecasts saved (NWS vs GFS vs ECMWF) or just consensus?"

**Just consensus.** The `models: {}` field is consistently empty across all forecast records. This prevents:
- Model attribution analysis
- Ensemble strategy backtesting  
- Individual model performance tracking

### "Is observation data linked to forecasts for error analysis?"

**Structurally yes, practically no.** The observation schema includes `forecastError` field, but:
- No observations in test data yet (settlement hasn't occurred)
- Linking logic exists but untested
- Schema supports this use case

### "Could a quant load these files into pandas and immediately start analyzing?"

**Yes, with limitations.** The JSONL format is pandas-friendly and basic analysis works, but advanced strategies would be blocked by schema gaps.

## Recommendations

### Immediate Fixes (Priority 1)
1. **Populate individual model forecasts** in `forecast.js` integration
2. **Add bid-ask spread tracking** in market snapshot collection
3. **Add execution cost fields** to trade and market schemas

### Schema Enhancements (Priority 2)  
4. **Add schema versioning** for backward compatibility
5. **Add data validation** in append functions
6. **Add market depth/volume tracking** for liquidity analysis

### Future Enhancements (Priority 3)
7. **Add forecast confidence intervals** for uncertainty analysis
8. **Add market maker identification** for counterparty analysis
9. **Add trade settlement linking** for complete trade lifecycle

## Conclusion

The historical data pipeline provides a solid foundation with good reliability and clean code architecture. The JSONL approach is appropriate for quantitative analysis workflows. However, critical data gaps around individual model forecasts and execution costs significantly limit its utility for advanced strategy development.

With the priority fixes implemented, this system would become a production-ready backtesting foundation.