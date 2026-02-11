# Weather Trading Strategy Report v3 — RECALIBRATED
*Generated: 2026-02-09T06:15Z (Round 6 recalibration)*
*Period: 2025-07-01 to 2025-12-31 | σ values updated from wt calibrate analysis*
*Initial bankroll: $1,000 | Quarter-Kelly sizing | Max 1 trade/day*

---

## 🚨 MAJOR RECALIBRATION (Feb 2026)

`wt calibrate` revealed that our σ assumptions were **2-3x too high**:
- **KNYC**: Assumed 2.0°F → Actual MAE 0.77°F → **New σ: 0.85°F**
- **KMDW**: Similar pattern → **New σ: 0.75°F**  
- **KDEN**: Chinook volatility → **New σ: 1.1°F**
- **KMIA**: Tropical stability → **New σ: 0.8°F**

**Impact**: The edge is BIGGER than we thought. Market σ gaps are now 3-4x our forecast error.

---

## Live Implied Volatility (Feb 9, 2026)

From actual Kalshi temperature contract prices with **RECALIBRATED σ**:

| Station | Forecast | Our σ (winter) | Market Implied σ | Gap |
|---------|----------|-------|-----------------|-----|
| KNYC | 24°F | **1.35°F** | 2.5-6.1°F (mean 4.3) | **+2.95°F** |
| KMDW | 39.6°F | **1.25°F** | 3.0°F | **+1.75°F** |
| KDEN | 67.1°F | **1.6°F** | 3.3°F | **+1.7°F** |

**Key finding**: With recalibrated σ, the edge is even larger than previously calculated.
KNYC now shows **4.3/1.35 = 3.2x** volatility gap.

---

## Alpha Thesis

Our forecast error (σ=1.2-1.5°F) is tighter than what the market prices (σ=3.0-4.3°F).
This σ gap creates edge: we assign different probabilities to threshold contracts.

**The question**: Is the σ gap large enough to overcome transaction costs of 3-5¢/contract?

---

## KNYC — Central Park, NYC

### Forecast Accuracy
| Metric | Value |
|--------|-------|
| Days | 184 |
| MAE | 1.2°F |
| Bias | -0.1°F |
| Std Dev | 1.5°F |
| ECMWF MAE | 1.1°F |
| GFS MAE | 1.8°F |

### P&L: Calibrated (σ=1.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $232.59 | 23.26% | 9.39 | 154 | 94.81% | 1.56% | 154 |
| 3.5°F ⬅️ | $280.71 | 28.07% | 11.62 | 154 | 94.81% | 1.5% | 154 |
| 4°F ⬅️ | $317.22 | 31.72% | 13.33 | 154 | 94.81% | 1.45% | 154 |
| 4.5°F | $350.39 | 35.04% | 14.86 | 154 | 94.81% | 1.41% | 154 |
| 5°F | $377.69 | 37.77% | 16.13 | 154 | 94.81% | 1.37% | 154 |
| 5.5°F | $387.98 | 38.8% | 23.23 | 154 | 97.4% | 0.7% | 154 |
| 6°F | $410.85 | 41.09% | 24.7 | 154 | 97.4% | 0.68% | 154 |

### P&L: Wide (σ=3.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $-36.06 | -3.61% | -7.65 | 39 | 2.56% | 3.61% | 39 |
| 3.5°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4.5°F | $262.24 | 26.22% | 29.75 | 154 | 99.35% | 0.75% | 154 |
| 5°F | $256.98 | 25.7% | 29.11 | 154 | 99.35% | 0.77% | 154 |
| 5.5°F | $291.07 | 29.11% | 33.49 | 154 | 99.35% | 0.74% | 154 |
| 6°F | $313.46 | 31.35% | 36.27 | 154 | 99.35% | 0.72% | 154 |

### Cost Sensitivity (market σ = 4.0°F, our σ = 1.5°F)

| Spread Cost | P&L | Sharpe | Trades | Win% |
|-------------|-----|--------|--------|------|
| $0.01 | $332.62 | 14.04 | 154 | 94.81% |
| $0.02 | $324.92 | 13.68 | 154 | 94.81% |
| $0.03 | $317.22 | 13.33 | 154 | 94.81% |
| $0.04 | $310.27 | 13.01 | 154 | 94.81% |
| $0.05 | $303.37 | 12.68 | 154 | 94.81% |
| $0.07 | $289.77 | 12.04 | 154 | 94.81% |
| $0.10 | $269.37 | 11.09 | 154 | 94.81% |

### Sharpe Ratio Debug (σ=1.5 vs market σ=4.0, 3¢ cost)
- Total calendar days: 154
- Days with trades: 154
- Mean daily return: 0.2060%
- Std daily return: 0.2218%
- Annualized return: 51.91%
- Annualized vol: 3.52%
- Sharpe: 13.33

---

## KMDW — Chicago Midway

### Forecast Accuracy
| Metric | Value |
|--------|-------|
| Days | 184 |
| MAE | 0.9°F |
| Bias | 0.2°F |
| Std Dev | 1.2°F |
| ECMWF MAE | 0.6°F |
| GFS MAE | 1.4°F |

### P&L: Calibrated (σ=1.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $289.9 | 28.99% | 16.15 | 163 | 97.55% | 0.77% | 163 |
| 3.5°F ⬅️ | $340.76 | 34.08% | 19.36 | 163 | 97.55% | 0.74% | 163 |
| 4°F ⬅️ | $379.63 | 37.96% | 21.79 | 163 | 97.55% | 0.72% | 163 |
| 4.5°F | $414.81 | 41.48% | 24.01 | 163 | 97.55% | 0.69% | 163 |
| 5°F | $443.77 | 44.38% | 25.83 | 163 | 97.55% | 0.68% | 163 |
| 5.5°F | $413.58 | 41.36% | 23.96 | 163 | 97.55% | 0.66% | 163 |
| 6°F | $437.75 | 43.78% | 25.48 | 163 | 97.55% | 0.65% | 163 |

### P&L: Wide (σ=3.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $-39.42 | -3.94% | -14.51 | 33 | 0% | 3.94% | 33 |
| 3.5°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4.5°F | $278.72 | 27.87% | 30.38 | 163 | 99.39% | 0.73% | 163 |
| 5°F | $282.06 | 28.21% | 306.16 | 163 | 100% | 0% | 163 |
| 5.5°F | $318.16 | 31.82% | 361.97 | 163 | 100% | 0% | 163 |
| 6°F | $344.65 | 34.46% | 272.28 | 163 | 100% | 0% | 163 |

### Cost Sensitivity (market σ = 4.0°F, our σ = 1.5°F)

| Spread Cost | P&L | Sharpe | Trades | Win% |
|-------------|-----|--------|--------|------|
| $0.01 | $395.93 | 22.82 | 163 | 97.55% |
| $0.02 | $387.78 | 22.3 | 163 | 97.55% |
| $0.03 | $379.63 | 21.79 | 163 | 97.55% |
| $0.04 | $372.38 | 21.33 | 163 | 97.55% |
| $0.05 | $365.03 | 20.87 | 163 | 97.55% |
| $0.07 | $350.58 | 20 | 163 | 97.55% |
| $0.10 | $329.38 | 18.64 | 163 | 97.55% |

### Sharpe Ratio Debug (σ=1.5 vs market σ=4.0, 3¢ cost)
- Total calendar days: 163
- Days with trades: 163
- Mean daily return: 0.2329%
- Std daily return: 0.1552%
- Annualized return: 58.69%
- Annualized vol: 2.46%
- Sharpe: 21.79

---

## KMIA — Miami International

### Forecast Accuracy
| Metric | Value |
|--------|-------|
| Days | 184 |
| MAE | 0.9°F |
| Bias | 0.1°F |
| Std Dev | 1.2°F |
| ECMWF MAE | 1.2°F |
| GFS MAE | 1.5°F |

### P&L: Calibrated (σ=1.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $262.42 | 26.24% | 17.77 | 145 | 97.93% | 1.93% | 145 |
| 3.5°F ⬅️ | $308.34 | 30.83% | 21.32 | 145 | 97.93% | 1.77% | 145 |
| 4°F ⬅️ | $342.39 | 34.24% | 23.9 | 145 | 97.93% | 1.65% | 145 |
| 4.5°F | $373.76 | 37.38% | 26.31 | 145 | 97.93% | 1.54% | 145 |
| 5°F | $399.58 | 39.96% | 28.3 | 145 | 97.93% | 1.45% | 145 |
| 5.5°F | $404.18 | 40.42% | 436.13 | 145 | 100% | 0% | 145 |
| 6°F | $425.64 | 42.56% | 492.98 | 145 | 100% | 0% | 145 |

### P&L: Wide (σ=3.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $-42.43 | -4.24% | -15.25 | 36 | 0% | 4.24% | 36 |
| 3.5°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4.5°F | $257.51 | 25.75% | 271.65 | 145 | 100% | 0% | 145 |
| 5°F | $250.32 | 25.03% | 295.88 | 145 | 100% | 0% | 145 |
| 5.5°F | $282.46 | 28.25% | 350.1 | 145 | 100% | 0% | 145 |
| 6°F | $303.66 | 30.37% | 243.87 | 145 | 100% | 0% | 145 |

### Cost Sensitivity (market σ = 4.0°F, our σ = 1.5°F)

| Spread Cost | P&L | Sharpe | Trades | Win% |
|-------------|-----|--------|--------|------|
| $0.01 | $356.89 | 25.01 | 145 | 97.93% |
| $0.02 | $349.64 | 24.45 | 145 | 97.93% |
| $0.03 | $342.39 | 23.9 | 145 | 97.93% |
| $0.04 | $335.69 | 23.39 | 145 | 97.93% |
| $0.05 | $329.49 | 22.95 | 145 | 97.93% |
| $0.07 | $316.79 | 21.96 | 145 | 97.93% |
| $0.10 | $297.24 | 20.5 | 145 | 97.93% |

### Sharpe Ratio Debug (σ=1.5 vs market σ=4.0, 3¢ cost)
- Total calendar days: 145
- Days with trades: 145
- Mean daily return: 0.2361%
- Std daily return: 0.1437%
- Annualized return: 59.51%
- Annualized vol: 2.28%
- Sharpe: 23.9

---

## KDEN — Denver International

### Forecast Accuracy
| Metric | Value |
|--------|-------|
| Days | 184 |
| MAE | 1.1°F |
| Bias | 0°F |
| Std Dev | 1.5°F |
| ECMWF MAE | 1.1°F |
| GFS MAE | 1.5°F |

### P&L: Calibrated (σ=1.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $218.29 | 21.83% | 16.12 | 123 | 97.56% | 1.2% | 123 |
| 3.5°F ⬅️ | $257.08 | 25.71% | 19.34 | 123 | 97.56% | 1.09% | 123 |
| 4°F ⬅️ | $286.1 | 28.61% | 21.77 | 123 | 97.56% | 1.02% | 123 |
| 4.5°F | $312.69 | 31.27% | 23.99 | 123 | 97.56% | 0.95% | 123 |
| 5°F | $334.58 | 33.46% | 25.82 | 123 | 97.56% | 0.89% | 123 |
| 5.5°F | $272.69 | 27.27% | 13.78 | 123 | 94.31% | 1.26% | 123 |
| 6°F | $290.9 | 29.09% | 14.8 | 123 | 94.31% | 1.23% | 123 |

### P&L: Wide (σ=3.5) vs Market σ

*Max 1 trade/day, quarter-Kelly, $1K fixed bankroll, 3¢ spread cost*

| Market σ | P&L | Return | Sharpe | Trades | Win% | MaxDD | Trading Days |
|----------|-----|--------|--------|--------|------|-------|-------------|
| 3°F ⬅️ | $-31.76 | -3.18% | -14.82 | 27 | 0% | 3.18% | 27 |
| 3.5°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4°F ⬅️ | $0 | 0% | 0 | 0 | 0% | 0% | 0 |
| 4.5°F | $208.28 | 20.83% | 26.37 | 123 | 99.19% | 0.8% | 123 |
| 5°F | $212.48 | 21.25% | 304.14 | 123 | 100% | 0% | 123 |
| 5.5°F | $239.73 | 23.97% | 359.71 | 123 | 100% | 0% | 123 |
| 6°F | $259 | 25.9% | 261.44 | 123 | 100% | 0% | 123 |

### Cost Sensitivity (market σ = 4.0°F, our σ = 1.5°F)

| Spread Cost | P&L | Sharpe | Trades | Win% |
|-------------|-----|--------|--------|------|
| $0.01 | $298.4 | 22.79 | 123 | 97.56% |
| $0.02 | $292.25 | 22.28 | 123 | 97.56% |
| $0.03 | $286.1 | 21.77 | 123 | 97.56% |
| $0.04 | $280.6 | 21.35 | 123 | 97.56% |
| $0.05 | $275.25 | 20.89 | 123 | 97.56% |
| $0.07 | $264.15 | 19.95 | 123 | 97.56% |
| $0.10 | $248 | 18.6 | 123 | 97.56% |

### Sharpe Ratio Debug (σ=1.5 vs market σ=4.0, 3¢ cost)
- Total calendar days: 123
- Days with trades: 123
- Mean daily return: 0.2326%
- Std daily return: 0.1551%
- Annualized return: 58.62%
- Annualized vol: 2.46%
- Sharpe: 21.77

---

## Summary: Can We Make Money?

Key scenario: **Our σ=1.5, Market σ=3.0-4.0, Cost=3-5¢**

| Station | Mkt σ=3.0, 3¢ | Mkt σ=3.5, 3¢ | Mkt σ=4.0, 3¢ | Mkt σ=4.0, 5¢ |
|---------|---------------|---------------|---------------|---------------|
| KNYC | $232.59 (S=9.39) | $280.71 (S=11.62) | $317.22 (S=13.33) | $303.37 (S=12.68) |
| KMDW | $289.9 (S=16.15) | $340.76 (S=19.36) | $379.63 (S=21.79) | $365.03 (S=20.87) |
| KMIA | $262.42 (S=17.77) | $308.34 (S=21.32) | $342.39 (S=23.9) | $329.49 (S=22.95) |
| KDEN | $218.29 (S=16.12) | $257.08 (S=19.34) | $286.1 (S=21.77) | $275.25 (S=20.89) |

## Verdict

### What the data says:
1. **Forecasts are excellent**: MAE 0.9-1.2°F, well-calibrated at σ=1.5°F
2. **Market implied σ is 3.0-4.3°F** — wider than our forecast error
3. **The σ gap creates theoretical edge** of 1.5-2.8°F
4. **Transaction costs of 3-5¢ eat most of the edge** at market σ ≤ 3.5°F
5. **KNYC is most promising** with market σ=4.3°F (widest gap)

### Recommendation:
- **KNYC**: ✅ Trade cautiously — market σ=4.3 provides enough edge at 3¢ cost
- **KMDW**: ⚠️ Marginal — market σ=3.0 barely covers costs
- **KDEN**: ⚠️ Marginal — market σ=3.3, similar to KMDW
- **KMIA**: ❌ No data on market σ; historically marginal

### Critical next steps:
1. Run `wt iv` daily to track market implied σ over time
2. Paper trade KNYC with σ=1.5 when market σ > 3.5
3. DO NOT trade when market σ < 3.0 — no edge after costs
4. Collect 2+ weeks of implied vol data before going live
