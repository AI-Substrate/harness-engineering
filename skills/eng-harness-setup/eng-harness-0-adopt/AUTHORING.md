# Authoring notes — eng-harness-0-adopt

**This file is repo-internal and NOT installed by the skill.** It documents the conventions future editors must preserve.

## What this skill is now

A **lean orchestration flow**. It installs the harness CLI from npx and drives a 3-step journey — install → (conditional) eng-harness-0-harnessability-assessment → stand up a basic `boot` via eng-harness-0-add-extension. It **generates no artifacts of its own**.

This is a deliberate, breaking simplification of the earlier skill, which generated a governance doc, a placeholder `harness/cli/`, a `docs/harness/` scaffold, an `AGENTS.md` block, and seeded known-difficulties from 19 templates. All of that deterministic substrate now lives in the **harness CLI** as real code (`harness init` stamps the governance doc). The skill orchestrates those surfaces; it no longer reimplements them.

## Sources

- `docs/plans/008-harness-setup-flow/harness-setup-flow-spec.md` — the spec (authoritative for the contract + clarifications).
- `docs/plans/008-harness-setup-flow/harness-setup-flow-plan.md` — the implementation plan + validation record.
- `docs/plans/008-harness-setup-flow/research-dossier.md` — the research behind the rework.
- `harness-foundations/first-principles.md` — #11 "Boot is the first proof", #12 "boot is orientation" (the `boot` framing).

## Load-bearing invariants

1. **Orchestrate, don't generate.** The skill must not write governance docs, an `AGENTS.md` block, a `docs/harness/` scaffold, a placeholder CLI, or retro/known-difficulties/back-pressure files. If a future need looks like generation, it belongs in the CLI (`harness init`) — not here.
2. **Chain the sibling skills, don't inline them.** `eng-harness-0-harnessability-assessment` and `eng-harness-0-add-extension` are invoked, never reimplemented.
3. **The report sentinel is exactly `.harness/reports/harnessability/latest.json`** (directory fallback allowed). This is a cross-skill contract with `eng-harness-0-harnessability-assessment`; keep both sides in sync.
4. **`boot` stays a basic nucleus.** A thin wrapper over the repo's existing readiness commands. Resist seed/reset/observe/sensor scope creep — those are later, loop-driven improvements.
5. **Public-safe.** Shipped surfaces (`SKILL.md`, `README.md`) must never contain a private repo name/path, person, or internal codeword — this is a public repo. Describe boot shapes generically. (`AI-Substrate/harness-engineering` is the public CLI repo URL and is fine.)
6. **Envelope-only consumption.** Any programmatic read of CLI output uses `--json` envelope fields + exit codes, never scraped prose — so a future MCP server reuses the same surfaces unchanged.
7. **Canonical boundary sentence.** *"The agent harness drives. The engineering harness proves."* appears verbatim in `SKILL.md` and `README.md`. Don't drift it.
8. **`harness init` ships (FX001) — keep the older-CLI fallback.** The flow calls it to stamp the governance doc, but must still degrade gracefully when an *older* installed CLI predates it (`.harness/extensions/` is created lazily by `harness new`).

## How to extend this skill

- Keep it a flow. New capability is usually a new step or a sharper hand-off, not a new generated file.
- If you touch the report-location contract, update `eng-harness-0-harnessability-assessment` in the same change.
- If you change the install recipe, keep it in lockstep with the `agents/install-and-validate-test-extension` e2e agent (the acceptance proof).
- Strong defaults beat options — resist configuration knobs (`harness-foundations/patterns-that-work.md`).
