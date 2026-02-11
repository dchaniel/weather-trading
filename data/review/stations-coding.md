# New Stations Coding Report — Feb 11, 2026

## Summary
Expanded from 3 tradeable stations to **12 tradeable stations** (14 total calibrated, 2 failed).

## Calibration Methodology
- **Data source**: Open-Meteo Historical Forecast API (GFS + ECMWF) vs Archive API (actuals)
- **Period**: 60 days (Dec 12, 2025 – Feb 10, 2026), N=61 observations per station
- **baseSigma formula**: MAE × 1.1 (10% safety margin, consistent with existing stations)
- **Tier assignment**: A (MAE < 1.5°F), B (1.5-2.5°F), F (≥ 2.5°F or ≥2°F with high bias)

## Results by Station

### Tier A — Strong Edge Potential (10 stations)
| Station | MAE | Bias | ECMWF MAE | GFS MAE | baseSigma | Kalshi Ticker |
|---------|-----|------|-----------|---------|-----------|---------------|
| KMIA | 0.57°F | +0.11 | 0.90 | 1.19 | 0.63 | KXHIGHMIA |
| KDFW | 0.76°F | +0.07 | 1.06 | 1.69 | 0.84 | KXHIGHTDAL |
| KDEN | 0.80°F | +0.03 | 0.86 | 1.38 | 0.88 | KXHIGHDEN |
| KATL | 0.92°F | -0.04 | 0.82 | 1.68 | 1.01 | KXHIGHTATL |
| KNYC | 0.93°F | +0.74 | 0.70 | 2.13 | 1.03 | KXHIGHNY |
| KIAH | 0.94°F | +0.52 | 0.78 | 1.80 | 1.03 | KXHIGHTHOU |
| KSEA | 0.97°F | -0.68 | 0.81 | 1.46 | 1.07 | KXHIGHTSEA |
| KMSP | 0.97°F | +0.45 | 0.58 | 1.90 | 1.06 | KXHIGHTMIN |
| KAUS | 1.05°F | +0.58 | 0.65 | 1.76 | 1.16 | KXHIGHAUS |
| KSFO | 1.06°F | -0.42 | 1.38 | 1.17 | 1.16 | KXHIGHTSFO |

### Tier B — Marginal (3 stations)
| Station | MAE | Bias | Issue |
|---------|-----|------|-------|
| KOKC | 1.16°F | +1.09 | High bias, P95=3.55°F tail risk |
| KPHL | 1.26°F | +1.15 | LOW temp markets only (KXLOWTPHIL) |
| KDCA | 1.52°F | +1.32 | High systematic bias |

### Tier F — Failed (2 stations)
| Station | MAE | Bias | Issue |
|---------|-----|------|-------|
| KLAX | 2.22°F | +2.13 | Coastal microclimate, both models struggle |
| KMDW | 2.77°F | N/A | Pre-existing failure, kept disabled |

## Files Changed
1. `lib/weather/stations.js` — Added 11 new station configs with full calibration data, NWS grid points, climNormals, bias corrections. Updated TRADEABLE_STATIONS (3→12) and VALIDATED_STATIONS (4→15).
2. `commands/implied_vol.js` — Updated SERIES_MAP with correct Kalshi ticker symbols (verified via API).
3. `commands/calibrate.js` — Updated default station list to use TRADEABLE_STATIONS set.
4. `AGENTS.md` — Updated station table with all 14 calibrated stations.

## Kalshi Ticker Verification
All tickers verified via live Kalshi API (`getEvents({ series_ticker })`) on Feb 11, 2026:
- Tickers with `T` suffix pattern (KXHIGHT*): HOU, ATL, SFO, SEA, OKC, DC, MIN, DAL
- Tickers without `T`: NY, CHI, DEN, MIA, AUS, LAX
- KPHL: Only LOW temp (KXLOWTPHIL), no HIGH

## Validation
- `kalshi health` → 100% (12 tradeable, 15 total)
- `kalshi iv` → All 12 tradeable stations producing forecasts and market σ comparisons
- 3 stations cleared GO for trading today: KATL, KDFW, KMSP

## Key Observations
1. ECMWF consistently outperforms GFS (avg ECMWF MAE ~0.85°F vs GFS MAE ~1.75°F)
2. Coastal stations (KLAX, KSFO) have higher errors due to marine layer effects
3. Plains stations (KOKC) have high tail risk (P95=3.55°F) from weather system boundaries
4. Bias corrections applied where systematic bias > 0.5°F
