# R17 Simplicity Review — Kalshi Trading System

**Date**: 2026-02-10  
**Codebase**: 37 files, 6,682 lines, zero external dependencies  
**Reviewer**: Simplicity Agent (fresh eyes, no prior context)

---

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Simplicity** | 18/20 | Clean module boundaries. trade.js (422L) is the biggest command — justified by 6 subcommands. No framework overhead. |
| **Feature Necessity** | 17/20 | Crypto strategy (~700L across 3 files) is owner-mandated. KMDW still in stations.js + guard.js despite being marked "NO EDGE" — harmless but conceptually noisy. Legacy iv-history.json ref still in data.js (line 29). |
| **DRY Compliance** | 18/20 | 100 exports across 37 files = reasonable. No chalk/color deps. Date handling spread across 36 call sites but mostly native Date — acceptable. Dual `import { signed }` and `import { table, today }` from same utils.js in trade.js (lines 6,11) could merge. |
| **Cognitive Load** | 18/20 | Per-command --help is excellent. Station metadata is self-documenting with inline calibration notes. 37 files / ~180L avg is digestible. Biggest cognitive tax: understanding which stations are actually tradeable requires cross-referencing stations.js, guard.js, and AGENTS.md. |
| **Maintainability** | 19/20 | Zero deps = zero supply chain risk. ESM throughout. Clean separation: lib/weather, lib/crypto, lib/core, lib/kalshi, commands/. Station config is single-source-of-truth. |

## **Total: 90/100**

---

## Findings

### ✅ What R17 Got Right
1. **stations.js 260→210 lines** — good trim, uncalibrated cruft removed
2. **Per-command --help** — reduces cognitive load for operators
3. **Zero dependencies** — exceptional for a 6.7K line system
4. **Clean module graph** — no circular deps, clear layering

### ⚠️ Deductions (10 points)

**1. Legacy iv-history.json reference (-2, Feature Necessity)**
`commands/data.js:29` still imports `HISTORY_PATH` pointing to deprecated `iv-history.json`. Comment says "kept temporarily" — this is R17, time to finish the migration or remove.

**2. KMDW ghost (-2, Feature Necessity)**  
KMDW is in `STATIONS`, `guard.js` correlation map, and `lib/kalshi/markets.js` — but is documented everywhere as untradeable (MAE=2.56°F). Either remove it entirely or add an explicit `enabled: false` field so the code is self-documenting.

**3. Dual import from utils.js in trade.js (-1, DRY)**
```js
import { table, today } from '../lib/core/utils.js';  // line 6
import { signed } from '../lib/core/utils.js';          // line 11
```
Trivial but symptomatic — merge into one import.

**4. 12 fetch functions across codebase (-1, Code Simplicity)**
Not necessarily duplicated logic, but worth auditing whether any share patterns that could be extracted (retry logic, error handling).

**5. Crypto kept on trust (-4 across dimensions)**
~700 lines (crypto/forecast.js 297L, crypto/strategy.js 214L, crypto/backtest.js 193L) for a strategy with no documented live performance. Owner-mandated so not removable, but it's 10% of the codebase serving an unvalidated strategy.

### 💡 To Hit 95+

1. **Kill the iv-history.json reference** — finish migration, delete the const
2. **Add `enabled: false` to KMDW** in stations.js, filter on it in guard.js and commands
3. **Merge duplicate imports** in trade.js (and audit other commands)
4. **Add a one-line comment** in crypto files: "Strategy status: paper-only, pending validation" so future readers know the maturity level

---

## Verdict

**90/100 — Very good.** A 6.7K-line zero-dep trading system with clean architecture. The remaining 10 points are small hygiene items, not structural problems. The biggest philosophical question is whether KMDW config and crypto strategy earn their lines — both are defensible (KMDW for future recalibration, crypto by owner mandate) but add cognitive weight without current value.
