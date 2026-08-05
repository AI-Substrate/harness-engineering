# Spine — Flow Token Efficiency (plan 057)

**Status**: requirements capture (pre-flow). This document records what the user has asked for across the 056 dogfood run and follow-on sessions, so the builder flow can pick it up without re-deriving intent. It is the durable successor to the session-scratch seed.

## Thesis

The builder flow (and eng-harness-flow) does not treat every token as gold, and we must not make that worse. This plan makes the discipline **"write what you have to, but consider every token"** land mechanically — channel-fitted and re-encountered at the seams where spending decisions happen, not restated as prose. The discipline already exists as prose (builder invariant #13, § Artifact Elegance, coach lean-narration) and demonstrably isn't landing; 056 proved the fix pattern for exactly this problem: **placement beats prose**.

Doctrinal anchor: `harness-foundations/rules-of-why.md` — Rule 5 (small things compound at team scale) and Rule 6 (tokens are a friction like any other; a token-saving magic wand is a first-class magic wand). Cite it, don't restate it.

## The four dimensions

### D1 — What the flow WRITES

Research dossiers, plans, workshops, validation sidecars, narration. Front-load the discipline; cut restating what a link carries; no doctrine duplicated across references.

### D2 — What the flow CONSUMES during build

The implement stage is the named hot spot — "the flow can go crazy during implementation and burn tokens." Includes what the engine itself reads (boot references, CLI echo) and what it emits into the transcript.

### D3 — Right model for the task; subagents by default for chores

- **Tier scales with difficulty, never defaults to the parent's model**: cheap/Sonnet-class for chores (codebase search, git commit/push, file sweeps, grep audits, artifact collection); capable/Opus-class for analysis, review, critique; lead/premium (Fable-class) reserved for judgement, design, adjudication — and reviews deemed genuinely hard.
- **Subagents by default, not in-window**, for delegable beats (code review, commits, searches, sweeps). Two independent reasons: (a) chore output clogs the parent context window; (b) the expensive parent model burns on work a cheap model does reliably.
- **The flow suggests, never mandates.** Explicit user or context instructions about model or execution placement always override.
- Encoded already for this repo in `AGENTS.md` § Model-to-task fit & delegation; this plan encodes it into the **builder skill** so every consumer repo gets it.

### D4 — Token efficiency as a first-class harness-improvement target

Token waste is a friction like any other — it belongs in the same observe → retro → encode loop as flaky steps and misleading errors, alongside difficulties and magic wands. Small costs multiply across a team (every developer, same problems, every week). The flow's improvement machinery (observe kinds, retro dispositions, insight generators) should treat token-saving opportunities as first-class capture, not a special case.

## Committed evidence (the 056 dogfood observations)

`.harness/records/retro/2026-07-09/001-056-dont-apologise-fix-phase1.md` — all `target: token-efficiency`, `disposition: deferred`, charter for this plan:

| id | friction | suggested encoding |
|---|---|---|
| SUGG-001 | Guided-mode boot reads ~100KB of references before first useful action; doctrine restated 2–3× | tiered/leaner refs, or a compiled quick-card the engine reads instead of full docs |
| SUGG-002 | Every `harness flow` CLI verb echoes a full duplicate envelope; ~4× the same block per create sequence | `--quiet` flag or batched envelope for multi-call sequences |
| SUGG-003 | Lead premium model burns tokens on delegable review/analysis | model-tier hints in worker packets / skill guidance |
| SUGG-004 | Delegation scope broader than review: commits, searches, sweeps, audits, collection | per-stage delegable-work table (chores → cheap tier; adjudication/design → lead) |
| COORD-001 | User tier mapping: Opus analysis/review · Sonnet chores · lead reserved for judgement | tier table in builder worker-spawn guidance |

## Measurement requirements

- **Consume, don't build**: per-stage token attribution already exists (`FlowEvent × TurnEvent` — in/out/cache_read/cache_create per stage; 056 finding F-07). This plan uses it.
- **Early task — open the real telemetry and look**: does today's telemetry actually show where the flow burns tokens per stage? Same discipline as 056's tripwire task (T017-style: verify sufficiency against real data before assuming).
- **The 056 run is the baseline**: a real end-to-end journey (research → plan → build → review → ship) captured under telemetry, representative of flow token use before this plan's changes.
- **T+3wk re-entry**: like 056, the plan needs an affordance for returning with real telemetry to check the changes were effective (tripwire node / runbook).
- Metrics stay non-agent-facing; never gate, score, or block (056 decision, unchanged here).

## Source material

- **Cost-Aware Subagent Delegation Policy** (`scratch/paste/20260710T011335.md`, gitignored — quarry, not policy). Reviewed 2026-07-10; verdict agreed with user. **Keep/mine**: the delegate-when/keep-when decision test; "cheapest *reliable* model, not cheapest model"; escalation + retry rules (never re-run the same weak model with the same prompt — fix the packet or escalate); the subagent output contract (findings/evidence/confidence/recommended-action, never raw logs); read-only-by-default with explicit file ownership for writes; the overhead floor ("don't delegate what the parent can do faster than describe + verify"); the ~25-line compact version as the seed of what gets encoded. **Reject**: the 0–16 scoring rubric (ceremony; clashes with never-gate/score/block and low-ceremony principle #51); the 5× internal redundancy; unenforceable budget fields (max turns/tool calls); its framing as a monolithic system-prompt/AGENTS.md install (the anti-pattern this plan exists to kill).
- 056 plan + retro records (the fix pattern: layered directive, template `instructions[]`, seam echo, parity guard).
- `harness-foundations/rules-of-why.md` (Rules 5, 6, 8, 9).
- `AGENTS.md` § Model-to-task fit & delegation (repo-local statement to be generalised into the skill).

## Anti-goals & constraints

1. **Never under-build to save tokens** — invariant #13's floor holds; the target is directness *past* the floor, not doing less real work (fewer re-dos is the win, not thinner plans).
2. **No scoring, no ceremony, no gates** — delegation and terseness are suggestions with an override; no compliance floors, no delegation-score rubrics.
3. **Channel-fitted, not monolithic** — encode at the seams where decisions happen (per-stage `instructions[]`, worker-packet template, tier table in spawn guidance); never a standalone policy essay agents must read every session.
4. **The irony guard** — the plan and its artifacts must themselves obey the rule they encode; a verbose plan about terseness fails on arrival. This spine, the dossier, and the plan doc should cite anchors instead of restating them.
5. **Don't duplicate pij** — packet shape, pointer delivery, token-lean output already live in pij conventions C1–C7; the builder encoding references, never restates, or it will drift.
6. **New-flows-only posture** (unless a mid-flow fix is trivially safe), consistent with 056.

## Adjacent (not core scope — carry as tasks, don't let them bloat the plan)

- `flow-pair observe` should scope its diff to the delegation's allowed-paths (retro DL-001-orchestrator).
- Rail should render a pip for `assumed`-status chores (retro DL-001-rail).
- Stale governance-doc reference to `harness/cli/` path (layout moved to repo root) misled a rebuild.

## Suggested first move

`/builder 1a explore` with this spine as the intent → the dossier answers: where does the flow actually spend tokens (writing vs building, per stage, from real telemetry), and which wording / mechanical / delegation changes cut spend without weakening correctness?
