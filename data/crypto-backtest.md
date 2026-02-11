# Crypto Strategy Backtest Results

Generated: 2026-02-09T02:02:16.221Z

## Summary

| Metric | Value |
|--------|-------|
| Total predictions | 840 |
| Overall accuracy | 98.0% |
| Brier score | 0.0200 (lower=better, 0.25=random) |
| Model | GARCH vol + Student-t tails + momentum drift |

## BTC

- Predictions: 540
- Accuracy: 98.0%
- Avg Brier: 0.0200

### Calibration

| Bucket | Count | Avg Predicted | Avg Actual | Gap |
|--------|-------|--------------|------------|-----|
| 0-10% | 39 | 2.0% | 3.0% | 1.0% |
| 10-20% | 12 | 14.0% | 8.0% | 6.0% |
| 20-30% | 6 | 22.0% | 0.0% | 22.0% |
| 30-40% | 8 | 35.0% | 13.0% | 22.0% |
| 40-50% | 2 | 44.0% | 50.0% | 7.0% |
| 50-60% | 4 | 56.0% | 50.0% | 6.0% |
| 60-70% | 7 | 62.0% | 86.0% | 24.0% |
| 70-80% | 6 | 76.0% | 100.0% | 24.0% |
| 80-90% | 7 | 85.0% | 86.0% | 1.0% |
| 90-100% | 41 | 96.0% | 93.0% | 4.0% |

## ETH

- Predictions: 300
- Accuracy: 99.0%
- Avg Brier: 0.0500

### Calibration

| Bucket | Count | Avg Predicted | Avg Actual | Gap |
|--------|-------|--------------|------------|-----|
| 0-10% | 11 | 3.0% | 0.0% | 3.0% |
| 10-20% | 3 | 11.0% | 33.0% | 22.0% |
| 20-30% | 1 | 25.0% | 0.0% | 25.0% |
| 40-50% | 1 | 43.0% | 0.0% | 43.0% |
| 70-80% | 3 | 73.0% | 100.0% | 27.0% |
| 80-90% | 3 | 85.0% | 67.0% | 18.0% |
| 90-100% | 5 | 95.0% | 60.0% | 35.0% |

## Interpretation

- **Brier score < 0.20**: Model adds value over random
- **Brier score 0.20-0.25**: Marginal, barely better than guessing
- **Brier score > 0.25**: Model is worse than random
- **Calibration gap < 5%**: Well-calibrated bucket
- **Calibration gap > 10%**: Poorly calibrated, don't trust edges in that range

## Notes

- Backtest uses 1-day forward predictions only
- Does NOT account for spread/execution costs
- Real trading needs edge > spread to profit
- Crypto markets on Kalshi have 20-80% spreads — very few actionable trades
