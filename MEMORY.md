# Kalshi Trader Memory

## Development Strategy (established 2026-02-09)
- **Use multi-agent review loop for all serious development** — see CODING-STRATEGY.md
- 4 agents: Coding (implements), Research (rigor), Product (UX), Simplicity (pruning)
- Run in rounds until all scores ≥ 95. Fresh reviewers each round.
- Daniel's preference: this is the DEFAULT approach for complex work.
- **95 MEANS 95.** Do not declare victory at 94 or 92. Hit the actual target or keep going.
- **NEVER stop early.** Every DRI must spawn reviewers AND verify scores ≥ 95 before reporting done. If a DRI can't spawn reviewers, the main agent MUST spawn them and loop until verified. No manual fixes without re-review. No "should be good enough." No reporting done without verified scores. Daniel catches you slacking = you failed.
- **DRI completion checklist**: (1) Code done (2) Reviewers spawned (3) All scores verified ≥ 95 (4) If any < 95, fix and re-review (5) Only THEN report done. Skipping any step is unacceptable.

## Project Rebrand (2026-02-09)
- Renamed from "Weather Trading" / `wt` to "Kalshi" / `kalshi` CLI
- Multi-strategy platform: weather + crypto + future strategies
- Repo still at `/home/node/.openclaw/workspace/code/weather-trading` (may rename later)

## Day 1 Results (2026-02-07)
- Started with $1,000 paper balance
- Lost $30 (-3.0%) mostly from bad Denver forecast (predicted 66°F, actual was ~45°F)
- Lesson: MUST cross-reference multiple models, reject climatological outliers

## Live Market Implied Vol Discovery (2026-02-09)

### Critical Finding: Market σ is 3.0-4.3°F
From live Kalshi contract prices:

| Station | Forecast | Our σ | Market Implied σ | Gap |
|---------|----------|-------|-----------------|-----|
| KNYC | 24°F | 1.5°F | 2.5-6.1°F (mean 4.3) | +2.8°F |
| KMDW | 39.6°F | 1.2°F | 3.0°F | +1.8°F |
| KDEN | 67.1°F | 1.5°F | 3.3°F | +1.8°F |

### Backtest v2 Results (Fixed Engine)
- Fixed: Sharpe now includes ALL calendar days (not just trading days)
- Fixed: Max 1 trade per day (avoids correlated bets)
- Fixed: Costs reduce P&L gradually (no cliff)
- Fixed: Tests calibrated σ=1.5 AND wide σ=3.5

### Key Findings
1. **σ=1.5 (calibrated) works at market σ ≥ 3.0** — profitable across all stations
2. **σ=3.5 (wide) needs market σ ≥ 4.5** — market is NOT that wide (only KNYC approaches)
3. **MUST use calibrated σ=1.5** — old σ=3.5 strategy would not work in real markets
4. **KNYC is best** — widest market implied σ (4.3°F), most edge
5. **KMDW is still good** — despite tighter market σ (3.0°F), our tighter calibration creates enough edge
6. **Sharpe 9-22 in backtest → expect 3-4 live** (divide by 3-5x for real-world execution)

### Transaction Costs
- Kalshi fee: ~1.5¢ per contract
- Crossing spread: ~1.5-3.5¢ per contract
- Total round-trip: 3-5¢ per contract
- Strategy is profitable even at 10¢ cost (at market σ=4.0)

### Strategy Parameters (CORRECTED)
- **σ = station-specific calibrated** (NOT 3.5 for everyone)
  - KNYC: σ=1.5°F
  - KMDW: σ=1.2°F (or 1.5 for safety)
  - KDEN: σ=1.5°F
  - KMIA: σ=1.2°F
- **minEdge = 2%** (lowered from 5% — let costs filter naturally)
- **kellyFraction = 0.25** (quarter Kelly)
- **maxTradesPerDay = 1** (avoid correlated bets)
- **DO NOT trade when market σ < 2.5** — no edge after costs

### New Tool: `wt iv`
Run `wt iv` to check implied vol before trading. This is the #1 gate for trade decisions.
