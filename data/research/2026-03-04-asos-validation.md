# Research: Open-Meteo Archive vs ASOS Validation
**Date:** March 4, 2026

## Finding

Open-Meteo archive data has a **massive systematic cold bias** compared to NWS ASOS observations (which Kalshi uses for settlement).

### KNYC (Feb 25 – Mar 3, 2026)
| Date | Open-Meteo High | ASOS High | Diff |
|------|----------------|-----------|------|
| 2026-02-25 | 34.7°F | 39.7°F | -5.0°F |
| 2026-02-26 | 35.4°F | 42.6°F | -7.2°F |
| 2026-02-27 | 34.2°F | 44.1°F | -9.9°F |
| 2026-02-28 | 37.3°F | 54.0°F | -16.7°F |
| 2026-03-01 | 37.0°F | 42.8°F | -5.8°F |
| 2026-03-02 | 28.3°F | 37.0°F | -8.7°F |
| 2026-03-03 | 35.3°F | 42.4°F | -7.1°F |

- **MAE: 8.7°F**
- **Bias: -8.7°F** (Open-Meteo consistently colder)
- **0% within ±2°F**

## Why This Matters

1. **Backtests are invalid**: All existing backtests compare forecasts to Open-Meteo archive as "actuals". Since both forecast and archive come from the same model family (ERA5 reanalysis), they agree well (MAE ~1°F), but both are systematically wrong vs real ASOS observations.

2. **Calibration was correct**: The Mar 3 recalibration to baseSigma 4.0-5.5°F was directionally right (moving away from the false precision of Open-Meteo-vs-Open-Meteo comparisons), but may still underestimate true error.

3. **All 25 settled weather trades lost** because:
   - ourSigma was 0.68-1.16°F (based on flawed backtest data)
   - Real forecast error vs ASOS is likely 4-8°F
   - System was maximally overconfident, seeing "edge" everywhere

## Root Cause

Open-Meteo's archive endpoint returns ERA5 reanalysis data interpolated to a grid point. This is fundamentally different from an ASOS point observation at an airport station. The difference includes:
- Grid-vs-point representation error
- Model physics biases (especially for urban heat islands like Central Park)
- Temporal sampling differences

## Recommendation

1. **Do NOT trust backtests** that use Open-Meteo archive as ground truth
2. **Build a proper backtest** using NWS ASOS observations as actuals
3. **Consider widening baseSigma** further — 4.5°F for KNYC might still be conservative if real forecast MAE vs ASOS is 5-8°F
4. **Add ASOS validation to calibration pipeline** — script at `scripts/validate-asos.js`
