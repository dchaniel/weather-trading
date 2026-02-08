# Weather Trading Pipeline

Multi-source weather forecast pipeline for trading Kalshi temperature markets. Built after Day 1 losses where single-model forecasts were **15-25°F above actuals**.

## The Problem

On Feb 8, 2026, we lost money trading temperature contracts because:
- Relied on a single forecast source
- Didn't sanity-check against climatological normals
- Traded Denver 66°F in February (normal: 45°F) — a 20°F outlier
- Traded LA >82°F in February — extreme outlier

## The Solution

This pipeline cross-references **multiple forecast sources** and rejects outliers:

### Data Sources
1. **NWS Point Forecast** — Official National Weather Service gridpoint forecasts
2. **GFS** (via Open-Meteo) — NOAA's Global Forecast System
3. **ECMWF** (via Open-Meteo) — European model

### Safety Checks
- **Multi-model consensus**: Only trade when model spread < 2°F
- **Climatological sanity**: Reject forecasts >15°F from monthly normals
- **Station bias correction**: Account for microclimate effects (Central Park shade, Midway urban heat island)

### Position Sizing
- **Quarter-Kelly** until calibrated over 50+ trades
- Max 5% bankroll per position
- Must have >5% edge to trade

## Settlement Stations

| Station | Location | Notes |
|---------|----------|-------|
| KNYC | Central Park, NYC | ~1°F cooler than city (park microclimate) |
| KMDW | Chicago Midway | +2°F urban heat island |
| KMIA | Miami International | Sea breeze effects |
| KDEN | Denver International | Chinook events, inversions |

## Usage

```bash
# Get forecasts for all stations (today)
node forecast.js

# Get forecast for specific station and date
node forecast.js KDEN 2026-02-09

# Fetch actual observations (for backtesting)
node observe.js KNYC 2026-02-08

# Compare forecast vs actual
node backtest.js 2026-02-08
```

## Output

Each run produces a JSON file (`forecast-YYYY-MM-DD.json`) with:
- Individual model forecasts
- Consensus mean/median
- Model spread
- Climatological deviation
- Tradeable/no-trade decision with reasoning

## Architecture

```
stations.js   — Station metadata, climatological normals, bias corrections
forecast.js   — Multi-source forecast fetcher + consensus engine
observe.js    — NWS observation fetcher for actuals
backtest.js   — Forecast vs actual comparison
sizing.js     — Quarter-Kelly position sizing
```

## Rules (Hard)

1. **Never trade** when model spread > 2°F
2. **Never trade** when forecast is >15°F from climatological normal (unless ALL models agree AND clear meteorological driver exists)
3. **Always** form probability estimate BEFORE looking at market price
4. **Quarter-Kelly** sizing, max 5% bankroll per position
5. **Favor intraday scalps** over settlement holds while calibrating
