# Multi-Agent Coding Strategy

## How We Build Software Here

Use a **3+1 agent review loop** for any serious development work. Don't stop until scores converge at 95+.

## The Agents

### 1. Coding Agent
- Does the actual implementation work
- Gets a focused brief with specific fixes from the latest review round
- Writes a self-assessment when done
- Spawned with `sessions_spawn`, typically 600s timeout, sonnet model for speed

### 2. Research Agent (Rigor)
- Skeptical, independent verification of claims
- Scores: Strategy rigor, Statistical validity, Market microstructure, Risk management, Data quality
- Always FRESH — never carries context from prior rounds (prevents groupthink)
- Will actively try to break things, find flaws, verify fixes were actually applied
- The hardest grader — treats the code like it's going into production with real money

### 3. Product Agent (Polish)
- Runs every command, tests every user-facing flow
- Scores: CLI UX, Operational readiness, Documentation, Automation, Monetization path
- Thinks like a paying customer — "would I pay $100/month for this?"
- Pushes for ambition within scope

### 4. Simplicity Agent (Pruning)
- Runs every ~3 rounds to fight bloat from additive development
- Scores: Code simplicity, Feature necessity, DRY compliance, Cognitive load, Maintainability
- Ruthless — if a feature doesn't contribute to the core mission, it's bloat
- Prevents the codebase from growing unboundedly

## The Loop

```
1. Coding Agent implements fixes from latest reviews
2. Research + Product + (optionally Simplicity) review IN PARALLEL
3. Main agent reads all reviews, synthesizes findings
4. Main agent crafts focused brief for next Coding Agent round
5. Repeat until all scores ≥ 95
```

## Key Principles

- **95 means 95.** Do not declare victory at 94 or 92. The target is ≥95 for Research and Product — hit the actual number or keep iterating. No rounding up, no "close enough." If you're at 94, that's one more round, not a celebration.
- **Fresh reviewers every round** — mark them as "You are FRESH" so they don't inherit prior biases
- **Scores must be earned** — reviewers should only give 95+ if they'd stake reputation/money on it
- **Research and Product run in parallel** — no dependencies between them
- **Coding agent gets SPECIFIC fixes** — not vague "make it better", but exact file + line + what's wrong
- **Main agent is the orchestrator** — reads all reviews, resolves conflicts, prioritizes for next round
- **Never let scores regress** — if research drops (like R6's 67), that's the #1 priority next round
- **Simplicity agent prevents bloat** — additive rounds naturally grow code; periodic pruning keeps it lean

## What Makes This Work

1. **Adversarial review** — agents are incentivized to find problems, not rubber-stamp
2. **Parallel execution** — reviews run simultaneously, fast iteration
3. **Specialization** — each agent focuses on what it's best at
4. **Score tracking** — quantitative progress makes it clear when you're stuck vs improving
5. **Fresh eyes** — no agent carries baggage from prior rounds
6. **Orchestrator judgment** — main agent resolves conflicting recommendations (e.g., simplicity says delete crypto, product says keep it)

## Score History Example (Weather/Kalshi Trading)

| Round | Research | Product | Simplicity | Key Change |
|-------|----------|---------|------------|------------|
| R1 | 42 | 38 | — | Initial build |
| R2 | 52 | 58 | — | Guard system |
| R3 | 54 | 72 | — | Backtest fixes |
| R4 | 62 | 78 | — | Parameter alignment |
| R5 | 73 | 82 | — | Calibration tools |
| R6 | 67↓ | 88 | — | σ recalibration (KMDW broke it) |
| R7 | 89 | 91 | 27 | Fixed KMDW, honest assessment |
| R8 | ? | ? | ? | Rebrand + simplicity cuts |

## When to Use This

- Any project with >500 lines of code
- Anything involving money, risk, or external APIs
- Any system that needs to be trustworthy
- When "good enough" isn't good enough

## When NOT to Use This

- Quick scripts or one-off tasks
- Exploratory prototyping (just build first, review later)
- Simple CRUD or configuration changes
