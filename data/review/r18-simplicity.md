# R18 Simplicity Review — Kalshi Trading System

**Date**: 2026-02-10  
**Codebase**: 37 files, 6,726 lines, zero external dependencies  
**Reviewer**: Simplicity Agent (fresh eyes, no prior context)

---

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Simplicity** | 19/20 | Clean module boundaries, ~182L avg. trade.js (421L) justified by 6 subcommands. |
| **Feature Necessity** | 18/20 | Crypto ~700L owner-mandated. KMDW now has `enabled: false` — self-documenting. Legacy iv-history.json removed. |
| **DRY Compliance** | 19/20 | Zero duplicate imports. 100 exports across 37 files reasonable. |
| **Cognitive Load** | 19/20 | Per-command --help, crypto maturity labels, station metadata self-documenting. |
| **Maintainability** | 19/20 | Zero deps, ESM throughout, clean layering, no circular deps. |

## **Total: 95/100**

---

## ✅ R18 Improvements

1. **iv-history.json removed** — `HISTORY_PATH`, `loadHistory()`, `saveHistory()` all gone. Unused `readFileSync`, `existsSync`, `mkdirSync`, `join`, `dirname`, `fileURLToPath` imports cleaned up. data.js went from 343→299 lines (-44).

2. **KMDW `enabled: false`** — Self-documenting in stations.js. No need to cross-reference guard.js or AGENTS.md to understand why KMDW isn't traded.

3. **All duplicate imports fixed** — trade.js (table+today+signed merged), perf.js (signed+round2+dateRange+table merged), crypto/strategy.js (positionSize+TRANSACTION_COST merged), crypto/backtest.js (round2+sleep merged). Zero duplicates remain.

4. **Crypto maturity labels** — "Strategy maturity: PAPER-ONLY — pending live validation" in all 3 crypto files.

5. **Bayesian σ update** — 15 lines of new code in stations.js, replaces a comment-only TODO. Net improvement in signal-to-noise ratio.

## ⚠️ Remaining Deductions

**1. Crypto ~700 lines for unvalidated strategy (-2, Feature Necessity)**
Owner-mandated, properly labeled PAPER-ONLY, sized conservatively. Still 10% of codebase for zero validated P&L. Not removable per mandate.

**2. 12 fetch functions across codebase (-1, Code Simplicity)**
NWS/GFS/ECMWF/Kalshi/CoinGecko each have custom fetch wrappers. Most have unique retry/parsing logic so extraction isn't trivial, but the pattern could be DRYer with a shared `fetchWithRetry(url, parser)`.

**3. Station correlation map is hardcoded (-1, Cognitive Load)**
guard.js has `['KNYC', ['KMDW']]` hardcoded. With KMDW disabled, this entry is dead weight. Could derive from station metadata or remove.

**4. backtest/engine.js at 397 lines (-1, Code Simplicity)**
Largest lib file. Does walk-forward validation, scoring, and reporting in one file. Could split into engine + reporter but not urgent.

---

## Verdict

**95/100 — Excellent.** R18 cleaned up the major simplicity debts: legacy JSON removed, duplicate imports eliminated, disabled stations self-documenting, crypto labeled. The codebase is 6,726 lines of zero-dep, ESM-native trading infrastructure where every major module earns its keep. The remaining 5 points are structural items (crypto mandate, fetch pattern, hardcoded correlations) that are defensible trade-offs.
