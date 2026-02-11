# New Stations Coding Report — Feb 11, 2026

## Summary
**Expanded from 3 tradeable stations to 12 tradeable stations** (14 total calibrated, 2 failed).

## Calibration Methodology
- **Data source**: Open-Meteo Historical Forecast API (GFS `gfs_seamless` + ECMWF `ecmwf_ifs025`) vs Open-Meteo Archive API (actuals)
- **Period**: 60 days (Dec 12, 2025 – Feb 10, 2026), **N=61 observations per station**
- **baseSigma formula**: `MAE × 1.1` (10% safety margin, consistent with existing validated stations)
- **Tier assignment**: A (MAE < 1.5°F), B (1.5–2.5°F), F (≥2.5°F or ≥2°F with high bias)
- **Bias correction**: Applied where systematic bias > 0.5°F (rounded to nearest °F for `bias` field)

## Results

### Tier A — 10 stations (strong edge potential)
| Station | MAE | Bias | ECMWF | GFS | baseSigma | Ticker |
|---------|-----|------|-------|-----|-----------|--------|
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

### Tier B — 3 stations (marginal, trade cautiously)
| Station | MAE | Bias | Issue |
|---------|-----|------|-------|
| KOKC | 1.16°F | +1.09 | High bias, P95=3.55°F tail risk |
| KPHL | 1.26°F | +1.15 | LOW temp markets only (KXLOWTPHIL) |
| KDCA | 1.52°F | +1.32 | High systematic warm bias |

### Tier F — 2 stations (excluded from trading)
| Station | MAE | Bias | Issue |
|---------|-----|------|-------|
| KLAX | 2.22°F | +2.13 | Coastal microclimate, both models fail |
| KMDW | 2.77°F | N/A | Pre-existing failure |

## Files Changed
1. **`lib/weather/stations.js`** — 11 new station configs with NWS grid coordinates, climNormals, calibrated baseSigma, ecmwfMAE, gfsMAE, bias corrections. TRADEABLE_STATIONS: 3→12. VALIDATED_STATIONS: 4→15.
2. **`commands/implied_vol.js`** — SERIES_MAP updated with 7 new Kalshi ticker mappings (verified via live API).
3. **`commands/calibrate.js`** — Default station list uses TRADEABLE_STATIONS dynamically.
4. **`AGENTS.md`** — Updated station table with all 15 stations.
5. **`scripts/calibrate-new-stations.js`** — Reusable calibration script for future stations.

## Validation Results
- `kalshi health` → **100%** (12 tradeable, 15 total)
- `kalshi iv` → All 12 tradeable stations producing forecasts + market σ comparisons
- **3 stations GO today**: KATL (+6.35¢ edge), KDFW (+20.83¢ edge), KMSP (+10.39¢ edge)
- `kalshi calibrate KATL` → σ well-calibrated (1.04× ratio)

## Key Observations
1. **ECMWF dominates**: Avg ECMWF MAE ~0.85°F vs GFS ~1.75°F across all stations
2. **Coastal penalty**: KLAX (MAE=2.22) and KSFO (MAE=1.06) show marine layer effects
3. **Plains tail risk**: KOKC P95=3.55°F, P90=2.70°F — weather system boundaries cause outliers
4. **Warm bias common**: 9 of 14 stations show positive bias; strongest in KLAX (+2.13), KDCA (+1.32), KPHL (+1.15)
5. **KSFO anomaly**: GFS (1.17) beats ECMWF (1.38) — unusual, possibly due to SFO microclimatology
