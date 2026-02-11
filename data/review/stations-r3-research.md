# Stations R3 Review — Research Agent
**Date**: 2026-02-11 04:17 UTC  
**Previous Score**: 88/100  

---

## Dimension 1: Correlation Groups Wired into guard.js (20/20)

**PASS ✅**

`guard.js` imports `CORRELATION_GROUPS` from `stations.js` (line 16) and builds a `CORRELATED_STATIONS` reverse-lookup map (lines 30-38). Guard rule #7 (lines 100-110) blocks same-day trades on correlated stations, checking all unsettled trades for the date.

`stations.js` derives `CORRELATION_GROUPS` dynamically from `stations.json` `correlationGroup` fields (lines 63-70). Three groups confirmed in `stations.json`:

| Group | Members | Verified in stations.json |
|-------|---------|--------------------------|
| texas_oklahoma | KDFW, KAUS, KOKC, KIAH | ✅ all 4 tagged |
| northeast | KNYC, KPHL, KDCA | ✅ all 3 tagged |
| west_coast | KSFO, KLAX, KSEA | ✅ all 3 tagged |

Guard rule #10 also warns about winter calibration window (Nov-Mar) with `CALIBRATION_MONTHS` matching `WINTER_MONTHS` in stations.js.

The `isCorrelatedStation()` helper is clean and symmetric. No hardcoded groups in guard.js — all derived from data. **Full marks.**

---

## Dimension 2: KAUS and KIAH Appearing in kalshi iv (20/20)

**PASS ✅**

`kalshi iv` output confirms both stations present and actively scanned:

| Station | Forecast | Our σ | Mkt σ | Gap | Net Edge | Status |
|---------|----------|-------|-------|-----|----------|--------|
| KIAH | 75.8°F | 1.5°F | 8.68°F | +7.18°F | 12.47¢ | ✅ STRONG |
| KAUS | 74.6°F | 1.7°F | 1.95°F | +0.25°F | -2.31¢ | ❌ NO PROFIT |

Both marked VAL (validated, N≥30). KIAH is the top station today with +7.2°F gap. KAUS has no edge today but is correctly in the tradeable whitelist (confirmed in guard warnings listing). Both have `kalshiTicker` and `kalshiCity` fields in `stations.json`. **Full marks.**

---

## Dimension 3: March Months Consistent Between stations.js and guard.js (20/20)

**PASS ✅**

Critical month sets:

| Module | Set Name | Months | Includes March? |
|--------|----------|--------|-----------------|
| stations.js | `WINTER_MONTHS` | {11, 12, 1, 2, 3} | ✅ Yes |
| guard.js | `CALIBRATION_MONTHS` | {11, 12, 1, 2, 3} | ✅ Yes |

Guard.js line 128 has explicit comment: `// Must match WINTER_MONTHS in stations.js`

Both use the same 5-month window. March (month 3) is included in both, ensuring:
- `getEffectiveSigma()` applies the +0.5°F `WINTER_SIGMA_BUMP` for March
- Guard's calibration warning fires only outside Nov-Mar

All 15 stations have `climNormalHigh` entries for month `"3"` (March) in `stations.json`. **Full marks.**

---

## Dimension 4: Kelly Correlation Discount Documented (18/20)

**PARTIAL ✅**

Documentation exists in `stations.js` header comment (line 20-22):
> *"Kelly sizing should treat correlated stations as partially the same bet."*

The correlation groups are well-documented with guidance to "avoid simultaneous large positions across this group."

However, the **actual Kelly discount factor** is not quantified anywhere in the codebase. There's no explicit `correlationDiscount = 0.5` or similar parameter. The guard blocks same-day correlated trades entirely (rule #7), which is a **stronger** protection than a Kelly discount — but the documentation says "partially the same bet" without specifying the partial factor for multi-day overlapping positions.

**Deduction: -2 pts** — The guard's binary block is conservative and safe, but the documented intent of a Kelly *discount* (fractional reduction) isn't implemented as a sizing adjustment. For overlapping multi-day positions on correlated stations, no discount is applied.

---

## Dimension 5: baseSigmaLow on All 15 Stations (20/20)

**PASS ✅**

All 15 stations in `stations.json` have `baseSigmaLow` values:

| Station | baseSigma | baseSigmaLow | Ratio |
|---------|-----------|-------------|-------|
| KNYC | 0.84 | 0.90 | 1.07 |
| KMDW | 3.05 | 3.20 | 1.05 |
| KMIA | 0.78 | 0.82 | 1.05 |
| KDEN | 0.92 | 1.05 | 1.14 |
| KIAH | 1.03 | 1.15 | 1.12 |
| KATL | 1.01 | 1.12 | 1.11 |
| KDFW | 0.84 | 0.95 | 1.13 |
| KLAX | 2.44 | 2.55 | 1.05 |
| KSFO | 1.16 | 1.28 | 1.10 |
| KSEA | 1.07 | 1.18 | 1.10 |
| KOKC | 1.28 | 1.42 | 1.11 |
| KDCA | 1.67 | 1.85 | 1.11 |
| KAUS | 1.16 | 1.28 | 1.10 |
| KMSP | 1.06 | 1.18 | 1.11 |
| KPHL | 1.38 | 1.52 | 1.10 |

`getEffectiveSigma()` in `stations.js` (line 108) correctly branches: `tempType === 'low' ? (s.baseSigmaLow || s.baseSigma || 3.5) : (s.baseSigma || 3.5)`. The low IV scan in `kalshi iv` uses these values (KNYC low σ = 1.4°F matches baseSigmaLow 0.9 + winter bump 0.5 = 1.4). **Full marks.**

---

## Health Check Summary

```
🏥 Health: 100% (6/6 checks pass)
   API Key: ✅ | NWS: ✅ | GFS: ✅ | ECMWF: ✅ | Kalshi: ✅
   Balance: $1048.20 | IV History: 105 snapshots
   Tradeable: 13 stations | Total: 15
```

`kalshi iv` scanned 18 tickers (15 high + 3 low), found 5 GO stations. System fully operational.

---

## Score

| Dimension | Points | Max |
|-----------|--------|-----|
| Correlation groups in guard.js | 20 | 20 |
| KAUS + KIAH in kalshi iv | 20 | 20 |
| March months consistent | 20 | 20 |
| Kelly correlation discount documented | 18 | 20 |
| baseSigmaLow on all 15 stations | 20 | 20 |
| **Total** | **98** | **100** |

**Score: 98/100** (up from 88)

### Remaining Gap (-2 pts)
- Kelly correlation discount is documented as intent but not implemented as a fractional sizing adjustment for multi-day overlapping correlated positions. The same-day binary block in guard.js is stricter but doesn't cover the documented "partially the same bet" scenario across days.
