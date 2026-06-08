# Rework `engineering-harness-setup` into a lean install→assess→extend flow

**Mode**: Simple

📚 Specification incorporates findings from `research-dossier.md`

## Research Context

`engineering-harness-setup` is today a heavyweight, **generative** skill (621-line `SKILL.md` + **19 templates**, ~2,039 template lines) with CREATE / VALIDATE / STATUS modes. It generates a governance doc (`docs/project-rules/engineering-harness.md`), a **placeholder** `harness/cli/` (Python/Node stdlib), a `docs/harness/` scaffold, an `AGENTS.md` block, and seeds `## Known Difficulties` from the retro ledger.

That work has been superseded by:
- the real, npx-installable `harness` CLI (package `harness-engineering`, bin `harness`, installed via `npx github:AI-Substrate/harness-engineering <cmd>`; acts `help` / `doctor` / `new` / `docs` + dynamic extension verbs); extensions live in `<cwd>/.harness/extensions/`;
- the `harnessability-assessment` skill (scores Operate-Today + Adaptability, emits recommendations/remediations);
- the `add-extension` skill (drives `harness new <name> [--wrap "<cmd>"]`);
- the `install-and-validate-test-extension` minih agent, which already proves install → `add-extension` → verify end-to-end.

## Summary

**WHAT**: Replace the generative setup skill with a lean **orchestration flow** (documented as a simple mermaid DAG) that: (1) installs the harness via npx and proves it runs, (2) runs `harnessability-assessment` only if no report exists at `.harness/reports/harnessability`, and (3) guides the user to stand up a **basic `boot` extension** — the single command agents run at the top of every engineering task — using the assessment's recommendations (what to build / run / health-check for *this* repo) via the `add-extension` skill.

**The `boot` deliverable is the point.** "Boot is the first proof" (first-principles #11): before coding, an agent runs `harness boot`, which (a) proves the environment is ready for engineering — builds, runs (e.g. in Docker), and confirms readiness — and (b) re-orients the agent on how this project's harness works (#12: a boot/doctor command is orientation, not just diagnostics). The flow's success condition is **a working boot, even if basic**. We deliberately **do not boil the ocean**: a minimal boot is the *nucleus* that lets the team start working inside the engineering harness and begin encoding project memory into the environment; the harness is self-improving from there.

**WHY**: The deterministic substrate (nucleus creation, retro/known-difficulties, backpressure surfaces, the CLI itself) now lives in the harness CLI as real code. The skill should orchestrate those surfaces, not re-generate stand-ins for them. This makes setup faster, consistent, and forward-compatible with a future MCP server that reuses the same CLI surfaces.

## Goals

- Reduce the skill to a **three-step flow**: install → (conditional) assess → add first extension(s).
- **Generate no artifacts of its own** — `harness init` and the CLI own all generated files.
- Install the harness via **npx** and verify with `harness doctor`, with concrete troubleshooting guidance for common failures.
- Run `harnessability-assessment` **only when** no report exists at `.harness/reports/harnessability`; otherwise reuse the existing report.
- Stand up a **basic `boot` extension** (the nucleus deliverable) — the command agents run before each engineering task. It proves the environment is ready (build / run / health, per the assessment) **and** re-orients the agent on how the harness works. Authored via the `add-extension` skill (`harness new boot --wrap …` or a thin `boot.ts`), kept deliberately **minimal** — don't boil the ocean.
- End the flow with a **working boot, even if basic**, verified via `harness doctor` / `harness boot` / `harness help`.
- Document the flow as a **simple mermaid DAG** in `SKILL.md` and `README.md`.
- Keep all dependence on the **CLI command/envelope surface** so a future MCP server reuses it unchanged.

## Non-Goals

- **Not** building the `harness init` CLI command (forward dependency; out of scope here — the flow references and calls it, degrading gracefully if absent).
- **Not** updating the `harnessability-assessment` skill's output location to `.harness/reports/harnessability` (parallel work by the user; this spec only consumes that path).
- **Not** building or shipping an MCP server (out of scope; only forward-compatibility is preserved).
- **Not** building a comprehensive/production boot — **don't boil the ocean**. The deliverable is a *basic* boot nucleus; the harness is self-improving, so boot grows by use, not by up-front design.
- **Not** authoring the actual extension logic beyond what `add-extension` already does.
- **Not** retaining CREATE / VALIDATE / STATUS modes, the placeholder-CLI generators, governance-doc generation, `docs/harness/` scaffolding, AGENTS.md patching, or known-difficulties seeding.

## Target Domains

> No `docs/domains/` registry exists in this repo (it's a skills + CLI repo, not a domain-layered app). The unit of change is the `engineering-harness-setup` skill package.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `engineering-harness-setup` (skill package) | existing | **modify** | Full rewrite into a lean orchestration flow; delete all 19 templates + CREATE/VALIDATE/STATUS machinery |
| `skills/README.md` catalog | existing | **modify** | Update the skill's catalog rows + "where it fits" ordering + report-location reference |
| `harnessability-assessment` (skill) | existing | **consume** | Called as a sub-step; reads its report at `.harness/reports/harnessability` (no changes here) |
| `add-extension` (skill) | existing | **consume** | Called as a sub-step to author the first extension(s) (no changes here) |
| `harness` CLI | existing | **consume** | Uses `npx`, `harness doctor`, `harness new`, and a future `harness init` (no changes here) |

No new domains.

## Testing Strategy

- **Approach**: Manual verification + reuse the existing `install-and-validate-test-extension` minih e2e agent as the acceptance proof.
- **Rationale**: The skill is prompt + Markdown (no runtime code under unit test). The e2e agent already exercises the real install → `add-extension` → verify path in a throwaway repo and reports honestly; running it against the reworked skill is the deterministic proof that the flow works.
- **Focus Areas**: the documented DAG matches the skill's actual steps; the install + `doctor` recipe matches the e2e agent's recipe; the conditional assessment check (`.harness/reports/harnessability`) behaves; `add-extension` is driven (not bypassed) and the resulting verb loads/runs.
- **Excluded**: unit tests for the skill prose; testing the (out-of-scope) `harness init` command itself.
- **Mock Usage**: N/A — no runtime code in the skill; the e2e agent uses a real throwaway repo, not mocks.

## Documentation Strategy

- **Location**: the skill's own `SKILL.md` + `README.md` (with the mermaid DAG), plus `AUTHORING.md` and the `skills/README.md` catalog updated to the new lean behavior. (Hybrid: README quick-view + SKILL depth.)
- **Rationale**: the skill *is* documentation; the user explicitly wants the flow rendered as a simple mermaid DAG. No separate `docs/how/` guide needed.

## Basic Boot (the nucleus deliverable)

**Why boot matters** (`harness-foundations/first-principles.md`): *#11 "Boot is the first proof"* — every serious run begins by proving the product can start from a known state; *#11c "boot-and-validate command"* — build/install if needed, start the product, wait for readiness, prove the loop with a health/smoke check; *#12* — a boot/doctor command is **orientation**, not just diagnostics: it reminds the agent how the project wants to be operated. Boot is the command agents run at the **top of every engineering task**.

**What "basic" means here.** A minimal boot is a *thin wrapper over the repo's existing commands*, sized to the repo. The flow reads the assessment to pick what's cheapest-and-most-valuable to prove for *this* codebase, e.g.:
- build / install (does it compile / deps resolve?)
- run / up (start the app — directly, or `docker compose up`)
- a readiness signal (health endpoint, smoke route, or "tests pass" if there's no running service)
- a short orientation note (what the harness is, what to do next)

**Reference (a guide, not a template).** A mature private reference repo (a Dockerized pnpm/Turborepo web app) boots medium-thin: a container entrypoint does `install` (only if the lockfile changed) → `build` → starts services via a concurrent runner; a host-side boot command runs `docker compose up -d`, polls health until ready, and returns an **envelope with endpoints + a health summary**; agents read success via the envelope/exit code. Other repos differ — a repo with no Docker might boot as `build && test` with a printed ready note. **Use that for the *shape* (wrap existing commands, prove readiness, return a verdict), not the specifics.** *(The reference repo is private — keep its name/paths out of the published skill; describe boot generically.)*

**Forward nudge.** The harness CLI may later **complain when `boot` is missing** (e.g. `doctor`/`help` flags it), reinforcing boot as the expected entry point. This flow only needs to leave a working basic boot behind; the rest compounds through normal use.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=2, D=0, N=1, F=0, T=1 (P=6)
- **Confidence**: 0.80
- **Assumptions**: a future `harness init` will exist; the assessment skill will write `.harness/reports/harnessability`; the e2e agent remains the proof harness.
- **Dependencies**: see `## Dependencies`.
- **Risks**: see `## Risks & Assumptions`.
- **Phases**: single phase (Simple mode) — rewrite SKILL/README/AUTHORING, delete templates, update catalog, validate via e2e agent.
- **CS challenged in validation**: an agent argued CS-4 (621-line rewrite + 19-template deletion + cross-surface drift). Held at **CS-3 / Simple**: the deletion is mechanical, there is **no runtime code**, and the work is single-package prose + chaining. The real risk is cross-surface drift (SKILL/README/AUTHORING/catalog + the boot contract) — mitigated by T005's sweep and T006's AC table, not by adding multi-phase ceremony.

## Acceptance Criteria

1. `SKILL.md` presents the flow as a **three-step DAG** (install → conditional assess → first extension) rendered in **mermaid**, and contains **no** CREATE / VALIDATE / STATUS modes.
2. The **install step** uses npx (`npx github:AI-Substrate/harness-engineering …`), calls a future **`harness init`** (documented as a CLI dependency, out of scope to build), uses **`harness doctor`** as the success check, and includes troubleshooting guidance for common failures (Node version, network/`gh` access, build/`prepare`).
3. The install step **degrades gracefully when `harness init` is absent** today — it explains the step and continues (e.g., relying on lazy `.harness/` creation), rather than failing the flow.
4. The **assess step** invokes the `harnessability-assessment` skill **only when** no report exists at `.harness/reports/harnessability`; when a report exists, the flow reuses it and skips re-assessment.
5. The **boot step** calls the `add-extension` skill (never hand-writing the file) to stand up a **basic `boot` extension** — a thin wrapper over the repo's real readiness commands (e.g. build, run/up, health), with the specific commands chosen from the assessment's recommendations. It is kept minimal (nucleus), and verified via `harness doctor` / `harness boot` / `harness help`.
5a. The resulting `boot` (a) returns a clear ready/degraded/error verdict an agent can act on (envelope + exit code), and (b) serves as orientation — it reminds the agent how this project's harness works / what to do next.
6. **All 19 templates are deleted**, and the skill generates **no** governance doc, AGENTS.md block, `docs/harness/` scaffold, or known-difficulties seeding.
7. `README.md` documents the flow as a **simple mermaid DAG**; `AUTHORING.md` and `skills/README.md` are updated to the lean behavior and reference `.harness/reports/harnessability` (not the old `harness/assessment/`).
8. The flow depends **only** on the harness CLI's command/envelope surface (no bespoke parsing that would break a future **MCP server** reusing the same surfaces).
9. The `install-and-validate-test-extension` e2e agent (or an equivalent run) demonstrates **install → add-extension → verify** succeeds against the reworked skill.

## Dependencies

- **Future `harness init` CLI command** (deterministic bootstrap of the `.harness/` nucleus). Out of scope to build in this plan; the flow references/calls it and tolerates its absence (AC-3).
- **`harnessability-assessment` report-location update** to `.harness/reports/harnessability` (parallel work). The flow's "report exists?" check targets that path; until the assessment skill is updated, the check simply finds no report and runs the assessment (which then writes wherever it currently writes). Pin the exact file (e.g. `.harness/reports/harnessability/latest.json` or `latest.md`) when the assessment update lands.
- **Future harness CLI "boot missing" nudge** (e.g. `doctor`/`help` flags a missing `boot`). Reinforces boot as the expected entry point; out of scope to build here, but the flow's deliverable (a working basic boot) is what satisfies it.

## Risks & Assumptions

- **R1 — `harness init` doesn't exist yet.** The user chose to assume/define it. Mitigation: AC-3 graceful degradation; the SKILL documents the call and the fallback so the flow is usable today and "just works" once `init` ships.
- **R2 — Report-location contract drift.** If the assessment skill and this flow disagree on the exact `.harness/reports/harnessability` path/file, the conditional check misfires. Mitigation: pin the exact path with the parallel update; document the contract in both skills.
- **R3 — Deleting 19 templates may strand references.** Mitigation: grep the repo for template references (catalog, other skills, docs) before deletion; update or remove each.
- **R4 — Over-engineering boot ("boiling the ocean").** Temptation to build a comprehensive boot. Mitigation: spec mandates a *basic* nucleus boot — a thin wrapper over existing commands; depth comes later via the self-improving loop, not now.
- **A1 — The `install-and-validate-test-extension` e2e agent stays representative** of the human-guided flow; keep the install + verify recipes in lockstep.

## Open Questions

- **OQ1** *(resolved in validation)*: pin the "report exists?" sentinel to **`.harness/reports/harnessability/latest.json`** (fallback: any file under `.harness/reports/harnessability/`). The parallel assessment-skill update must write that path.
- **OQ2**: When `harness init` ships, does it also create the governance doc + AGENTS route (confirming those fully leave this skill)? *(Recommended: yes — record as the `init` contract; out of scope here.)*

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| The `harness init` contract | CLI Flow | The flow calls a command that doesn't exist yet; pinning its inputs/outputs/exit behavior de-risks both this skill and the future CLI work | What does `init` create (`.harness/`, governance, AGENTS route)? Idempotent? Envelope shape? How does the flow detect "already initialized"? |
| Minimal `boot` shape per repo type | CLI Flow | "Basic boot" differs by repo (Docker vs no-service vs CLI); a small decision guide keeps it from boiling the ocean | What's the cheapest readiness proof when there's no health endpoint? When to wrap `docker compose up` vs `build && test`? What orientation should boot print? |
| Install + troubleshooting recipe | Integration Pattern | Getting `npx`/`gh`/Node failure modes right is the main human-friction surface | Which failures are common (Node version, network, gh auth, build)? What's the minimal sanity sequence (`doctor --json`)? |

*(Both are optional — the spec already encodes recommended defaults; workshop only if you want the `harness init` contract nailed before planning.)*

## Clarifications

### Session 2026-06-09

- **Q: Workflow mode?** → **Simple.** Single skill package; mostly deletion + rewrite + chaining + catalog cleanup.
- **Q: What does "install the harness" mean (no `harness init` exists today)?** → **Assume/define a future `harness init` bootstrap the flow calls; note it as a CLI dependency, out of scope to build now.** (Also establish a working `npx harness` and verify with `harness doctor`.)
- **Q: Given the flow calls a future `harness init`, should the skill generate no artifacts of its own?** → **Yes — pure orchestration; `harness init` + CLI own all generated artifacts.** Drop the governance doc, AGENTS.md block, `docs/harness/` scaffold, and known-difficulties seeding; delete all 19 templates.
- **Q: Testing strategy?** → **Manual + reuse the `install-and-validate-test-extension` e2e agent as the acceptance proof.**
- **Defaulted (not asked):** Mock usage = N/A (prompt+docs skill). Documentation = the skill's own `SKILL.md` + `README.md` with mermaid DAG (per the explicit ask), plus `AUTHORING.md` + `skills/README.md` catalog updates.
- **Agent harness readiness:** this feature does not need an agent harness; it's validated via manual walkthrough + the `install-and-validate-test-extension` e2e agent. (This repo has no `docs/project-rules/engineering-harness.md`; informational only.)

### Session 2026-06-09 (boot refinement)

- **Refinement: the "first extension" is specifically the `boot` extension.** Frame the flow's deliverable as a **basic `boot`** — the command agents run at the top of every engineering task. Build/test/run/Docker are things boot *validates*, not separate extensions. Grounded in first-principles #11 ("Boot is the first proof") and #12 (boot is orientation + reminder of how the harness works).
- **Aim: a working boot, even if basic.** A minimal boot is the **nucleus** that lets the team start working inside the harness and begin encoding project memory. **Don't boil the ocean** — the harness is self-improving; boot grows by use.
- **Guide (not template): a private Dockerized reference repo** — boot there is a thin-ish wrapper: install (if lockfile changed) → build → `docker compose up -d` → poll health → return envelope with endpoints + health. Other repos differ; use it for the *shape* (wrap existing commands, prove readiness, return a verdict), not specifics. *(Keep the private repo's name/paths out of the published skill.)*
- **Forward nudge:** the harness CLI may later complain when `boot` is missing — reinforcing it as the expected entry point. This flow just needs to leave a working basic boot behind.
