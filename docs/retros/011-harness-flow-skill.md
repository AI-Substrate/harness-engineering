# Retros — 011-harness-flow-skill

Paired companion + orchestrator retrospectives for the `eng-harness-flow` router + no-new-CLI governance refactor (G1–G5). Implemented with `plan-6-v2-implement-phase-companion` (Power-On-Mode); the `code-review-companion` reviewed every commit live and supersedes a separate `/plan-7` pass.

## 2026-06-09T08:49Z — code-review-companion / 2026-06-09T18-22-26-936Z-7ddf

- runId: 2026-06-09T18-22-26-936Z-7ddf
- runDir: agents/code-review-companion/runs/2026-06-09T18-22-26-936Z-7ddf
- summary: Reviewed the full Plan 011 implementation phase as a long-running companion across 9 task pings. Sent 5 MEDIUM findings, all centered on **deferred-writer wording drift** — governance being described as *provisioned* by setup rather than *owed* until the deferred `harness init` writer exists. Follow-up commits `c67d8b1` and `f9f82cf` resolved the F001–F005 theme; final checks found no remaining issues in router statelessness, canonical-first governance read order, the L0–L4 single-source rule, backpressure's corroboration-only stance, or retro harness-field null semantics. Final verdict: **APPROVE, 0 open findings**.
- **workedWell** (gift): The inbox task protocol worked well for per-commit review — each review request carried the exact commit SHA, task scope, and focused hazards, which made the companion effective without blocking the outside implementer.
- **confusing**: The prompt said to `cd` to `MINIH_PROJECT_ROOT` first, but in this run that variable resolved to the run folder rather than the repository root, so the companion had to infer the real project root with `git rev-parse` before orienting.
- **magicWand** (target: minih): Ensure `MINIH_PROJECT_ROOT` always points to the repository root for coordinated agents, or expose a separate verified `projectRoot` field in the coordination context so agents do not have to recover it manually.
- difficulties:
  - [degrading] config (MH-001): `MINIH_PROJECT_ROOT` resolved to the run directory even though the companion prompt required using it as the project root. (workaround: used `git rev-parse --show-toplevel` and absolute paths under the repository root for orientation and reviews.)
  - [annoying] debug (MH-002): Large `git show` outputs were truncated into temp files, making full-diff review noisy for markdown-heavy commits. (workaround: switched to targeted `rg` searches and view ranges around the contractual lines under review.)

### Findings reconciliation

| ID | Severity | Theme | Disposition |
|----|----------|-------|-------------|
| F001 | MEDIUM | router: setup-gate "provisions it" implies setup owns governance establishment | Fixed in `c67d8b1` (reworded to owed/route-or-attempt) |
| F002 | MEDIUM | governance-doc.md G5 "Who" cell said "setup — provisioned at inception" | Fixed in `c67d8b1` (names the deferred `harness init` writer) |
| F003 | MEDIUM | boot prose "provisioned by the separate setup effort" (multiple lines) | Fixed in `c67d8b1` (qualified with deferred writer + owed-until-ships) |
| F004 | MEDIUM | final-sweep confirmation of the F001–F003 theme | Fixed across `c67d8b1` |
| F005 | MEDIUM | boot maturity-model intro still said setup "provisions the ladder into the governance doc" | Fixed in `f9f82cf` |

All five findings shared one root cause (deferred-writer wording drift vs. plan Finding 08 / AC15 / T016) and were resolved; companion re-swept and approved with zero open findings.

### Orchestrator retro

- **OH-011-1 [gift]**: The companion's single sustained theme (deferred-writer honesty) was exactly the plan's highest-risk design principle — that the governance *writer* is deferred and readers must say "owed, not provisioned." It caught residual drift in six prose sites the structural grep checks (T011/T012) could not see, because they check *paths and tables*, not *claims about who provisions*. Live review at commit time made the fix one wording pass instead of a re-litigation later.
- **OH-011-2 [difficulty]**: Pre-existing inherited wording is a drift trap. Boot's "provisioned by the separate engineering-harness setup effort" predated this plan and read as accurate ("not by boot"), so it survived the first authoring pass; only an adversarial read against the new owed-not-provisioned contract surfaced it. Inheriting a phrase ≠ that phrase still being correct under a new contract.
- **OH-011-3 [improvement-suggestion]**: When a plan's central invariant is a *negative claim* ("X does not provision Y"), add a grep-able lint to the validation tasks (e.g. flag bare "provision(s|ed) ... governance" without an "owed"/"deferred" qualifier in the same sentence), so the structural gate catches wording drift the path/table checks miss.
