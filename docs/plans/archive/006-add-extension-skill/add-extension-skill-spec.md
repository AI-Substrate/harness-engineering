# Add-Extension Skill (+ scaffold command)

**Mode**: Simple

ℹ️ Spec written directly from a clear ask (no `/plan-1a` research pass). Builds on the extension *runtime* shipped in plan 005 (`docs/plans/005-harness-extension-system/`).

## Summary

Make extending the harness a two-move, near-zero-friction action:

1. **`harness new <name>`** — a new **core** CLI command (the third reserved name alongside `help`/`doctor`) that templates an *empty but immediately loadable* extension file into `<cwd>/.harness/extensions/`. Deterministic, fast, test-covered.
2. **`add-extension` skill** — a context-aware authoring skill (`skills/add-extension/`) that orchestrates the human side: it reads whatever a spec-driven flow already gathered (spec, plan, workshop, or the live conversation), calls `harness new` to create the skeleton, fills the verb's handler/options from that context, verifies it with `harness doctor` + `harness <verb> --help`, and interviews the user **only** for genuinely missing pieces.

The split is the point: the **CLI** owns deterministic, repeatable scaffolding (always emits a valid extension that loads); the **skill** owns judgement and context extraction. Today, authoring an extension means hand-copying `examples/extensions/hello.ts` and editing by hand — there is no scaffolder and no context-aware assist.

## Goals

- A `harness new <name>` core command that writes a minimal, **loadable** extension stub and reports where it went (Envelope `ok` with the path).
- The freshly scaffolded stub is honest: its `run()` returns `ctx.unconfigured('…implement this verb…')` (exit 2 — "not built yet"), so it loads cleanly, shows in `harness help`/`doctor`, and tells the truth until implemented.
- A `--wrap <command>` flag that emits the "wrap a real repo command" starter instead of the minimal one (the harness's "wrap, don't rebuild" north star).
- A `--js` flag that emits a plain-`.js` + JSDoc starter (no contract runtime dependency) and `--force` to overwrite.
- An `add-extension` skill that is **lightly context-aware**: if the intended extension is obvious from what's already on hand (a spec/plan/workshop or the live conversation), use it; if it's ambiguous, just ask. **No elaborate context-source hierarchy or heavy protocol is encoded** — keep the skill thin.
- The skill closes the loop: after scaffolding + filling, it runs `harness doctor` / `harness help` and shows the user proof the verb loaded.
- The skill bundles its own `README.md` + `AUTHORING.md` + any templates, matching the existing `skills/<name>/` convention.

## Non-Goals

- No change to the extension **discovery/loader/contract** runtime from plan 005 — this consumes it, doesn't modify it.
- No interactive TUI / wizard inside the CLI command — the *skill* owns interview/judgement; the command stays a deterministic one-shot.
- No registry, marketplace, publishing, or remote-fetch of extensions.
- No editing/refactoring of existing extensions in v1 (scaffold-new only; editing is a later excursion).
- No variadic-arg or multi-verb-per-file scaffolding in v1 (single verb per file; matches the v1 contract limitation).

## Target Domains

> No formal `docs/domains/registry.md` exists in this repo; domains below are the informal code areas this feature touches.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness CLI (`harness/cli/`) | existing | **modify** | Add the `new` core command + its scaffold/template service; register the third reserved name |
| skills suite (`skills/`) | existing | **create** | New `skills/add-extension/` authoring skill (SKILL.md + README + AUTHORING + templates) |
| extension runtime (plan 005) | existing | **consume** | Reuse discovery path, contract types, Envelope helpers — no changes |

## Testing Strategy

- **Approach**: Hybrid — **Full TDD** for the `harness new` command and its scaffold/template service (matches the test-first, fake-adapter convention from plans 004/005); **manual/none** for the skill markdown (skills are prose, validated by dogfooding).
- **Rationale**: The CLI scaffolder is deterministic logic with file-system side effects and edge cases (name collisions, invalid names, `--force`, `--js`, `--wrap`) — exactly what unit tests with an `FsPort` fake should pin. The skill is judgement/orchestration, proven by running it.
- **Focus Areas**: stub validity (scaffolded file actually loads via the real loader — an integration test), path resolution into `.harness/extensions/`, flag matrix, invalid/duplicate name handling, reserved-name rejection.
- **Excluded**: the skill's narrative prose; the underlying loader/discovery (already covered by plan 005's suite).
- **End-to-end (minih)**: an `install-and-validate-test-extension` minih agent dogfoods the whole feature — in a throwaway fixture repo it installs the core, drives the `add-extension` skill to author a verb, and independently validates load/help/invoke. The skill is wired into minih via `.minih.json` (`path:skills`). Per `AGENTS.md`, the agent's retrospective + magic-wand feedback is collected and dispositioned after every run.
- **Mock Usage**: B — targeted fakes only (the existing `FsPort`/exec fakes); no liberal mocking.

## Documentation Strategy

- **Location**: Hybrid, anchored in **`docs/how/`**. The canonical, user-facing guide lives at **`docs/how/extend-the-harness.md`** — covers `harness new` (all flags/variants) and the `add-extension` skill end-to-end. The skill still bundles a short `README.md` + `AUTHORING.md` (skill convention); `harness/cli/docs/authoring-verbs.md` is updated to point at `harness new` as the starting point and cross-links to the `docs/how/` guide.
- **Rationale**: A single discoverable home (`docs/how/`) for "how do I extend the harness?" Keeps the authoring manual and the scaffolder in sync.
- **Forward note**: Documentation will later become a **first-class concept surfaced on the CLI** (e.g. a `harness docs`/`--help`-integrated path). Writing the guide in `docs/how/` now means that future upgrade can promote/index these files rather than relocate scattered prose. Author the guide so it reads standalone and is cleanly indexable.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=0, T=1 (total 5 → CS-3)
- **Confidence**: 0.75
- **Assumptions**:
  - The plan-005 extension runtime (loader, contract, discovery, reserved-name set) is present on the working branch — `harness new` builds directly on it.
  - Adding a third reserved core name (`new`) is acceptable and won't collide with a desired extension verb name.
- **Dependencies**: plan 004 (CLI kernel) + plan 005 (extension system), both currently on `feat/harness-cli-core` (unmerged). Plan 006 work continues on / off that branch.
- **Risks**: see Risks & Assumptions.
- **Phases**: Single implementation phase (Simple mode) — CLI scaffold command (TDD) then the skill, then docs.

## Acceptance Criteria

1. Running `harness new greet` in a repo creates `.harness/extensions/greet.ts` and returns an `ok` Envelope whose `data` includes the created path.
2. The scaffolded file loads cleanly: `harness doctor` lists it as loaded (not `failed`), and `harness help` shows the `greet` verb.
3. Invoking the freshly scaffolded verb (`harness greet`) returns an `unconfigured` Envelope (exit 2) with a `next_action` telling the author to implement it — never a crash, never a silent `ok`.
4. `harness new greet --wrap "npm test"` emits the wrap-a-real-command starter (a `ctx.exec(...)` body), not the minimal stub.
5. `harness new greet --js` emits `greet.js` with a JSDoc contract reference and no runtime import of the contract package.
6. `harness new help` (or `doctor`) is rejected with a clear error Envelope (reserved name) and writes no file.
7. `harness new greet` when `greet.ts` already exists fails safely (error Envelope, no overwrite) unless `--force` is passed.
8. An invalid verb name (empty, spaces, path separators) is rejected with an actionable error and writes no file.
9. The `add-extension` skill, when a spec/plan/workshop describing the extension exists, extracts the intended name + summary + wrapped command from it and scaffolds accordingly **without** re-asking the user for what's already known.
10. The skill, when no prior context exists, interviews the user for the minimum (name, what it does / what it wraps), then scaffolds + fills + verifies.
11. After authoring, the skill runs `harness doctor`/`harness help` and surfaces the result so the user sees the verb is live.
12. The skill folder follows the repo convention: `skills/add-extension/{SKILL.md,README.md,AUTHORING.md}` (+ templates if used).
13. A user-facing guide exists at `docs/how/extend-the-harness.md` documenting `harness new` (every flag/variant) and the skill flow end-to-end; it reads standalone and is cleanly indexable for the future "docs as a first-class CLI concept" upgrade. `harness/cli/docs/authoring-verbs.md` cross-links to it and points at `harness new` as the starting point.

## Risks & Assumptions

- **Branch dependency**: 004+005 are unmerged on `feat/harness-cli-core`. If 006 builds before they merge, it must continue on that branch — flag at architect time.
- **Reserved-name growth**: adding `new` to `RESERVED_NAMES` is a (pre-1.0) behavior change; an existing repo with a `new.ts` extension verb would start being shadowed by core. Low risk (no such fixture/example exists), but note it.
- **Context-extraction stance (DECIDED — keep it thin)**: "context-aware" must **not** become a heavy, over-encoded protocol. The rule is simple: if the wanted extension is **obvious** from gathered context (spec/plan/workshop/conversation), use it and skip the interview; if it's **not obvious**, ask. No ranked context-source matrix, no conflict-resolution engine. Over-encoding here is the risk to avoid.
- **Command-name bikeshed**: `new` vs `scaffold` vs `add` vs `init` — see Open Questions.

## Open Questions

- **Q1 — command name**: `harness new <name>` (cargo/rails-style, recommended) vs `harness scaffold <name>` (most explicit) vs `harness add <name>` vs `harness init <name>`. Default: `new`. *Resolvable at architect/workshop.*
- **Q2 — core vs bundled-extension**: scaffold as a **core** command (recommended — bootstraps before any extension exists, like `help`/`doctor`) vs ship it as a bundled example extension. Default: core.
- **Q3 — default stub return**: `ctx.unconfigured(...)` (recommended — honest "not built yet", exit 2) vs `ctx.ok({todo:…})`. Default: `unconfigured`.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Scaffold template set + layout | CLI Flow | Pin the exact emitted file contents for minimal / `--wrap` / `--js` variants (so they're test-fixtures, not prose), the exact write path, and where the source templates live | What does each starter contain verbatim? Where is the file written (`.harness/extensions/<name>.ts`)? Where do the template sources live (in the CLI package vs the skill)? How do flags compose (`--wrap --js`)? |

> ~~Skill context-awareness contract~~ — **resolved, no workshop** (2026-06-08): keep the skill thin (obvious-from-context → use it; ambiguous → ask). See Clarifications.

## Clarifications

### Session 2026-06-08

- **Q: What should the skill actually do?**
  **A** (user): "first yes, we need to have a cli command to template out the empty extension. Then, depending on the situation the user may need to be interviewed etc. but probably they will use their spec driven flow to define it. this skill will be in the mix probably (not already), and it will have gathered information that we will use. so the skill should be context aware." → Split into (1) a deterministic `harness new` core scaffold command and (2) a context-aware orchestrating skill that reuses gathered intent and only interviews to fill gaps.
- **Q: Workflow Mode?** A: **Simple** (user: "we need a simple plan").
- **Q: Testing?** A: **Hybrid** — TDD for the CLI scaffolder (repo convention from plans 004/005), manual for the skill prose.
- **Q: Mocks?** A: **B** — targeted fakes only (existing `FsPort`/exec fakes).
- **Q: Docs?** A: **Hybrid** — skill bundles its own README/AUTHORING; update `authoring-verbs.md`.
- **Agent harness**: This repo has no `docs/project-rules/engineering-harness.md` (it is the meta-repo *about* harnesses); the CLI's own vitest suite is the feedback loop. Feature does not need a separate agent harness. Recorded for `/plan-3`.
- **Workshop decisions** (user, 2026-06-08):
  - **Skill context-awareness** — "don't overbake it. if its not obvious what the user is asking for then ask, otherwise dont over encode into the skill." → **No workshop.** Folded as a thin principle (obvious → use; ambiguous → ask).
  - **Scaffold template set** — "I want to know details on what will be scaffolded and where and where the templates live." → **Run `/plan-2c`** on the scaffold template set + layout.
- **Documentation** (user, 2026-06-08): "make sure the work includes good doco, as later we will be upgrading doco to first class concept on the cli, so just write it in docs/how for now." → Canonical guide at `docs/how/extend-the-harness.md`; authored standalone/indexable so a future "docs as first-class CLI concept" upgrade can promote it. Added AC13.
