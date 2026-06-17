# eng-harness-flow Hooks Interface
**Mode**: Full
**Plan Version**: 1.2.0
**Created**: 2026-06-16
**Updated**: 2026-06-17 (re-plan: WS-1, WS-2, WS-3 folded in)
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md

> **Readiness note**: Status **READY** (unconditional). **WS-1 (execution substrate) is resolved → skill-first** ([workshops/001-execution-substrate.md](./workshops/001-execution-substrate.md)): no CLI phase — routing is irreducibly skill (no `harness flow` act exists; the `--json` routing envelope is already skill-emitted), and `--hooks` is the named, additive CLI **escalation seam** that ships only if a non-agent consumer ever needs a byte-stable `--hooks --json`. **WS-2** pins the manifest as Shape A (top-level `{ manifest_version, hooks[5] }` + an `aliases` migration field); **WS-3** defers `--emit-injection` to **v2** — so the build is now **three phases** (AC-04 migrates to v2 with it). The conditional CLI rows in the Domain Manifest stay deferred.

## Business Specification

### Research Context
The 4-agent research pass (structure · consumer blast-radius · prior-art · prior-learnings) confirmed this is a **vocabulary projection over an existing taxonomy**, not a re-architecture: `the-flow.json` already carries only three active harness node types (`harness-boot`, `backpressure`, `harness-retro`) plus silent `observe`. Key grounding: SKILL.md is **347 lines** (the binding lean budget); the `--json` envelope is a **frozen, MCP-stable contract** (additive-only); **dozens of `--event` call sites** exist (~88 raw occurrences across both repos; many distinct invocation points), most in the *separate* `the-flow` skill, with no version-gating — so `--event` must remain a transparent alias. The one genuine fork (execution substrate: skill-interpreted vs CLI-backed) is now **resolved → skill-first** (WS-1; see [workshops/001-execution-substrate.md](./workshops/001-execution-substrate.md)): the router is already a markdown skill (no `harness flow` act exists in `harness/cli/src/app.ts`; the `--json` routing envelope is already skill-emitted), and `harness observe` shows the `coding` hook is already CLI — so the architecture is already hybrid along a principled line (side-effecting fire-points → CLI; routing → skill).

### Summary
Re-skin the stateless `eng-harness-flow` router's public surface as **five neutral lifecycle "hooks"** — two flight bookends (`pre-flight … post-flight`) bracketing a coding trio (`pre-coding · coding · post-coding`) — so host flows couple to a small, stable vocabulary instead of raw `--event` seams. Add a **self-describing discovery** call (`--hooks`) that advertises the hooks (turning the S3 "inject" rung into a handshake), a primary **`--hook <name>`** invocation that aliases `--event` (zero-break), an optional **`--emit-injection <idiom>`** host-snippet generator (idiom-not-product, **deferred to v2** per WS-3), and a concise program-style **`--help`**. The skill stays **lean** (net growth ≈ 0 by replacing longhand prose) and **neutral from any host flow**.

**Why this is cheaper/safer to build with**: a host couples to **five lifecycle hooks** (two flight bookends + a coding trio) instead of raw product-named seams plus the router's internal node types — fewer names to learn, a longer-stable contract, and a self-describing `--hooks` handshake so a new host wires itself in two calls (discover, then drop the hooks at the returned anchors). "Safer" is concrete: `--event` stays a zero-break alias, the `--json` envelope is additive-only, and one-door keeps child skills unnamed.

### Example — host usage (before → after)
```
# before (today)            # after (this work; --event still works as a transparent alias)
--event pre-implement   →   --hook pre-flight
--event post-spec       →   --hook pre-coding
--event task-pause      →   --hook coding        (kind: silent — the in-flight capture seam)
--event phase-end       →   --hook post-coding   (per phase — drain)
--event plan-complete   →   --hook post-flight   (terminal — harvest + present improvements + encode)
(also: silent `harness observe` is the coding hook's CLI capture — advertised, not a fire-point)
```

### Goals
- A five-hook public vocabulary (`pre-flight/pre-coding/coding/post-coding/post-flight`) that maps cleanly onto the existing loop stages and node types — two flight bookends around a coding trio.
- `--hook <name>` as the primary invocation, with `--event <seam>` kept as a transparent back-compat alias — **no caller breaks**.
- `--hooks [--json]` discovery manifest the router advertises (the inject handshake), derived not stored.
- A concise, print-and-stop `--help` synopsis that *replaces* verbose prose so the skill does not grow.
- `--emit-injection <idiom>` (make/ci/shell/sdd-skill) that renders the manifest into a host idiom — idiom-not-product, unknown→neutral fallback. **(Deferred to v2 — WS-3; v1's wiring contract is `--hooks`.)**
- Keep the skill lean (line-count guard) and neutral from `the-flow` (which migrates itself later).

### Non-Goals
- **Editing `the-flow`** — it is a separate, external skill; it reads `--hooks` and adapts itself later. Out of scope for this repo.
- Renaming/removing `--event` — it stays as a permanent alias (no deprecation in this plan).
- A variable/maturity-gated hook set, or growing the count beyond five — the **five-hook spine is closed and fixed**; new capability grows the *n* behind a hook, never the count (`post-flight` is the one deliberate exception, spent on the terminal Improve beat).
- Changing the meaning of any existing `--json` envelope field — additive only.
- A product-specific (`the-flow`) injection profile — banned by the idiom-not-product rule.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|----------------------|
| eng-harness-flow (skill) | existing | **modify** | The router skill — add the hooks surface (`--hook`, `--hooks`, `--help`, `--emit-injection`); primary edit site |
| harness-cli | existing | **consume** | Prior-art for `--help`/envelope/manifest house style; becomes **modify** only if the CLI escalation trigger fires (a non-agent consumer needs byte-stable `--hooks --json`; workshops/001) |
| the-flow (external) | external | **consume (NOT modified)** | The primary consumer; keeps working via the `--event` alias; migrates to `--hook` on its own later |

> This repo has **no `docs/domains/registry.md`** — domains are identified in-doc (above). The two in-repo domains are the `eng-harness-flow` skill and the `harness-cli`.

### Testing Strategy
- **Approach**: Hybrid.
- **Rationale**: The skill-first default is markdown — validated by the **`validate-harness-flow` extension** (which replays the router end-to-end), `harness doctor`, and a **line-count guard**. Any CLI code (only if WS-1 escalates) follows **TDD** with vitest + the `arch-check` extension. Docs-bundle changes (if any) are gated by `check:docs`.
- **Focus areas**: the `--event`→`--hook` alias equivalence (every existing seam string still routes); envelope additive-compatibility (no snapshot break); the fixed 5-hook manifest; `--help` print-and-stop behavior; idiom-not-product enforcement.
- **Excluded**: heavy unit tests for pure-markdown edits (no code to unit-test on the skill-first path).
- **Mock usage**: targeted only — external systems / no fakes for the skill path; CLI path (if any) uses the repo's existing port/fake patterns (Constitution P2: no `node:fs`/`child_process`/`process.cwd` in services).

### Documentation Strategy
- **Location**: Hybrid. Primary docs are the skill's own references — `references/getting-started.md` (seam-contract + quick-reference) and `references/governance-doc.md` if the injection-map handshake changes. A `docs/how/harness-flow-hooks.md` guide + a `docs-manifest.json` bundle entry are added **only if** the CLI escalation trigger fires (workshops/001), so `harness docs harness-flow-hooks` works.
- **Rationale**: the router is a skill; its primary documentation surface is its references. CLI-surfaced docs only matter if the CLI gains a verb.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=1, T=1 → sum 6 → CS-3
- **Confidence**: 0.90 (WS-1/2/3 all resolved — substrate skill-first, manifest Shape A, emit-injection deferred to v2; CS-3 holds, surface trimmed to 3 phases)
- **Assumptions**: skill-first default (no CLI code); `--event` stays a permanent alias; the five-hook spine is fixed.
- **Dependencies**: none external; depends only on the current `eng-harness-flow` SKILL.md + references.
- **Risks**: see § Risks & Assumptions.
- **Phases**: **3** (skill-first; WS-3 defers `--emit-injection` to v2). A CLI phase would insert only behind the WS-1 escalation trigger (workshops/001).

### Acceptance Criteria
- **AC-01** — `eng-harness-flow --hook <name>` routes correctly for all five hooks (`pre-flight`, `pre-coding`, `coding`, `post-coding`, `post-flight`), producing the same routing decision the corresponding `--event` seam(s) produce today.
- **AC-02** — `eng-harness-flow --hooks [--json]` returns the **fixed five-hook** manifest as **top-level `{ manifest_version: 1, hooks: [...] }`** (Shape A per WS-2 — not wrapped in `data`); `coding` is marked `kind: silent` (advertised, not a fire-point); each entry carries `hook / intent / run_at / kind / invoke / aliases / produces / needs / preconditions` (see § Manifest contract). A routing call (`--hook X --json`) returns the existing routing envelope + one additive `hook` field and does **not** embed the manifest. No existing envelope field is reshaped.
- **AC-03** — `eng-harness-flow --help` prints a concise, program-style, **print-and-stop** usage block (synopsis + hooks + flags) and does no detection/routing/state; the SKILL.md net line delta is **≤ 0** versus the pre-change 347 (it replaces longhand prose). The budget has **no headroom** (347 exactly today) — if removals genuinely can't offset the additions, the line-count guard **surfaces the overage for a human call** rather than silently passing (never auto-gates).
- **AC-04** — **DEFERRED to v2 (WS-3)** — not a v1 acceptance criterion. *(v2)* `eng-harness-flow --emit-injection <idiom>` renders the manifest into a host idiom (`make`/`ci`/`shell`/`sdd-skill`); unknown idiom → neutral manifest (never guesses); no product profile (no `the-flow` idiom); `coding` renders silent; every block advisory/never-gates. Full v2 design: [workshops/003-emit-injection-scope.md](./workshops/003-emit-injection-scope.md).
- **AC-05** — All **six** existing `--event` seam strings (`session-start`, `post-spec`, `pre-implement`, `task-pause`, `phase-end`, `plan-complete`) continue to route **unchanged** — verified zero-break (the alias holds). `task-pause` maps to the **`coding`** hook (the silent in-flight capture moment — it is the seam the `coding` hook had lacked).
- **AC-06** — The documented mapping is correct: `session-start`+**`pre-implement` → `pre-flight`** (both fire the `harness-boot` node), `post-spec` → `pre-coding`, `task-pause` → `coding` (the silent in-flight capture seam), `phase-end` → `post-coding` (per-phase drain), **`plan-complete` → `post-flight`** (the terminal close-out — harvest + present improvements + encode, NOT folded into post-coding). No `pre-implement → pre-coding` mis-bin anywhere.
- **AC-07** — Neutrality: the change touches only `eng-harness-flow` (+ its references, + CLI only if WS-1 escalates); **`the-flow` is not edited** in this repo.
- **AC-08** — One-door preserved: hook names are stage-neutral and **no child-skill slug** appears in prose or the envelope.
- **AC-09** — The `--json` routing envelope remains snapshot-compatible — only additive fields introduced (`harness doctor`/router envelope snapshots unaffected).

### Risks & Assumptions
- **Assumption**: skill-first (confirmed by WS-1 — workshops/001-execution-substrate.md); the router stays markdown-only.
- **Risk** (residual): a non-agent consumer later needs a byte-stable `--hooks --json` → the named additive CLI escalation seam absorbs it without reshaping Phases 1–3.
- **Risk**: net SKILL.md growth despite intent (bloat creep) → mitigated by an explicit line-count guard task.
- **Risk**: cross-repo drift — `the-flow` keeps emitting `--event`; the alias must be treated as permanent until a deliberate, separate deprecation effort.
- **Risk**: `--emit-injection` erodes neutrality if a product profile is ever added → enforce idiom-not-product as a guard/test.

### Open Questions
1. ~~**WS-1**: execution substrate — skill-interpreted vs CLI-backed~~ — **RESOLVED → skill-first** ([workshops/001-execution-substrate.md](./workshops/001-execution-substrate.md)): no CLI phase; `--hooks` is the named CLI escalation seam behind an objective trigger.
2. ~~Is `--emit-injection` in v1, or deferred to v2 (WS-3)?~~ — **RESOLVED → v2** ([workshops/003](./workshops/003-emit-injection-scope.md)): v1 ships `--hooks` as the wiring contract; the full v2 design is specified.
3. ~~Does the `--hooks` manifest match the `doctor` house style, or a lighter shape (WS-2)?~~ — **RESOLVED → Shape A** ([workshops/002](./workshops/002-manifest-shape.md)): lighter top-level `{ manifest_version, hooks[5] }`; the routing call keeps the envelope + additive `hook`.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| **WS-1 — Execution substrate** ✅ **RESOLVED** | CLI Flow | **Done** → skill-first; no CLI phase. See [workshops/001-execution-substrate.md](./workshops/001-execution-substrate.md). | Resolved: skill-first (Option A) — routing is irreducibly skill; `--hooks` is the named additive CLI escalation seam behind an objective trigger. |
| **WS-2 — Manifest shape** ✅ **RESOLVED** | API Contract | **Done** → Shape A: top-level `{ manifest_version, hooks[5] }` + an `aliases` field; routing call keeps envelope + additive `hook`. See [workshops/002-manifest-shape.md](./workshops/002-manifest-shape.md). | Resolved: Shape A; fixed-5 spine; `coding`=silent. |
| **WS-3 — `--emit-injection` scope** ✅ **RESOLVED** | Integration Pattern | **Done** → deferred to v2 (renderer is a projection of the WS-2 manifest; stabilize it first) → v1 = 3 phases. See [workshops/003-emit-injection-scope.md](./workshops/003-emit-injection-scope.md). | Resolved: defer to v2; idiom allow-list + neutrality guard specified for v2. |

### Clarifications
#### Session 2026-06-16
Round 1 was answered with defaults (per the user's "do it all without stopping to ask"):
- **Workflow Mode** → **Full**. Rationale: multiple distinct sequenced surfaces + an open design fork (WS-1) that benefits from phase legibility + a "first-class" request.
- **Testing Strategy** → **Hybrid** (validate-harness-flow replay + doctor + line-count guard for the skill path; TDD + arch-check for any CLI path).
- **Mock Usage** → **B (targeted, external only)**.
- **Documentation Strategy** → **C (Hybrid)** — skill references primary; `docs/how/` + manifest only if CLI-backed.

Round 2 (Domain Review / topic clarifications) was **not** run interactively; the three design forks are recorded as Workshop Opportunities (WS-1/2/3) instead, to be optionally workshopped + re-planned before building.

#### Session 2026-06-17
**WS-1 (execution substrate) resolved → skill-first** (Option A) via [workshops/001-execution-substrate.md](./workshops/001-execution-substrate.md). Folded into this re-plan (Plan Version 1.1.0):
- Status lifted from "READY (conditional on WS-1)" → unconditional **READY**.
- No CLI phase inserts; the four-phase skill-first shape stands.
- The Domain Manifest's `harness/cli/**` + `docs/how/…` rows stay **deferred** — they materialize only if the workshop's objective escalation trigger fires (a named non-agent consumer needing byte-stable `--hooks --json`).
- KF-04 and the WS-1 risk re-framed from "undecided / may overturn" to "resolved; escalation behind a trigger."
- WS-2 (manifest shape) and WS-3 (`--emit-injection` scope) remain open and non-blocking.

**Validation (`/validate-v2`, 3 parallel agents)** found the fold-in consistent and coherent, and surfaced one pre-existing HIGH + nits, all applied:
- **HIGH** — the live SKILL.md (L129) has **six** `--event` seams, not five: `task-pause` had been dropped. Dispositioned **`task-pause` → `coding`** (the silent in-flight-capture seam the `coding` hook had lacked — it *tightens* the design). AC-05/AC-06/KF-02/Phase 1.1/1.4 corrected to six.
- **MEDIUM** — Phase-Index footnote stale `phase-end` → `post-coding`; AC-03/Phase 2.3 made honest about the zero-headroom 347 budget (surface overage, never silently pass; concrete removal targets named).
- **LOW** — Target-Domains `harness-cli` row re-framed to escalation-trigger language; task 1.3 firmed `hook` field (dropped "e.g."); task 1.1 now also anchors the corrected mapping in the integration call-site block (~SKILL.md L326).

#### Session 2026-06-17 — WS-2 + WS-3 fold (Plan Version 1.2.0)
**WS-2 (manifest shape)** → Shape A ([workshops/002-manifest-shape.md](./workshops/002-manifest-shape.md)): `--hooks --json` returns top-level `{ manifest_version, hooks[5] }` (not `data.hooks`); each entry gains an **`aliases`** field (the `--event` seams a hook subsumes — the migration map). AC-02 + § Manifest contract updated.
**WS-3 (`--emit-injection` scope)** → **deferred to v2** ([workshops/003-emit-injection-scope.md](./workshops/003-emit-injection-scope.md)): a renderer is a projection of the manifest, so it waits for the shape to settle. Consequences folded:
- **Phase 3 (`--emit-injection`) removed from v1** → the build is **3 phases** (1 · 2 · old Phase 4 renumbered to 3); the v2 design lives in workshops/003.
- **AC-04 migrated to v2** — no longer a v1 criterion; the Acceptance Coverage Map + Risks row repointed; the docs/guards phase now depends on Phases 1–2.
- v1 wiring contract is `--hooks` (each hook carries its `invoke`); `--emit-injection` is convenience deferred, not cut.
Both workshops validated (`/validate-v2`, 2 agents each): WS-2 Contract-Ready/accurate; WS-3 decision-sound/Forward-Compat Yes-with-fixes — fixes applied in-workshop (re-plan delta checklist, aliases-not-yet-in-plan claim, citation nits).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: **none — all resolved** (WS-1 skill-first · WS-2 Shape A · WS-3 emit-injection→v2; see workshops/001–003).
- Backpressure coverage: not captured (optional post-plan refinement available via the router).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings + the Critical/High findings |
| workshops/*.md | y | **001/002/003** (authoritative) → WS-1 skill-first · WS-2 Shape A · WS-3 emit-injection→v2 (all folded) |
| backpressure-coverage.md | n | optional Phase 0 sensors (not captured) |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 via recorded defaults; WS-1/2/3 all resolved + folded (Sessions 2026-06-17); no open forks |
| G2 | Constitution | PASS | Skill-first path touches no governed services code; any CLI escalation must honor P2 (no `node:fs`/`child_process`/`process.cwd` in services) — see Risks |
| G3 | Architecture | PASS | Skill edits only; CLI path (if any) follows existing ports/adapters layering |
| G4 | ADR Compliance | N/A | No ADR contradicted by a markdown-surface vocabulary change |
| G5 | Structure | PASS | All required sections present and populated |
| G6 | Testing Alignment | PASS | Hybrid: each phase carries a validation task (validate-harness-flow replay / doctor / line-count); CLI tasks would be test-first |
| G7 | Domain Completeness | PASS | All target domains present with status+relationship+role; Domain Manifest covers every referenced file; no registry to cross-check (none exists) |

### Summary
Project the existing harness-loop taxonomy onto a five-hook lifecycle vocabulary (two flight bookends + a coding trio) and expose it through the stateless router with `--hook` (primary, aliasing `--event`), `--hooks` (discovery manifest), `--help` (concise synopsis), and `--emit-injection` (idiom renderer — **deferred to v2**). The work is **skill-first** (markdown edits to `eng-harness-flow` + references), kept lean via prose replacement and a line-count guard, and neutral from `the-flow`. The **three** phases sequence: vocabulary+alias → discovery+help → docs sync+guards. `--emit-injection` is **deferred to v2** (WS-3); a CLI phase inserts only behind the WS-1 escalation trigger.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| skills/eng-harness-loop/eng-harness-flow/SKILL.md | eng-harness-flow | contract | The public router surface — hooks vocabulary, `--hook`/`--hooks`/`--help` (+ `--emit-injection` in v2), additive envelope |
| skills/eng-harness-loop/eng-harness-flow/references/getting-started.md | eng-harness-flow | internal | Seam-contract section + quick-reference table → hooks vocabulary |
| skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md | eng-harness-flow | internal | Injection-map handshake reference (only if `--hooks` changes the inject story) |
| harness/cli/src/** (**deferred** — escalation only) | harness-cli | contract | WS-1 resolved skill-first → **not built now**. Materializes only if a non-agent consumer needs byte-stable `--hooks --json` (workshops/001 trigger): a `harness flow --hooks` act on the `observe`/`doctor` template |
| docs/how/harness-flow-hooks.md (**deferred** — escalation only) | eng-harness-flow | internal | Only if the CLI act ships: a `harness docs`-surfaced guide + manifest entry |

### Key Findings

| KF | Impact | Finding | Action |
|----|--------|---------|--------|
| KF-01 | Critical | `--event pre-implement` fires the `harness-boot` node → maps to **pre-flight**, NOT pre-coding (naming trap; research agent initially mis-binned) | Encode the corrected mapping in SKILL.md + getting-started.md; AC-06 verifies |
| KF-02 | Critical | Dozens of `--event` call sites (~88 raw occurrences; many distinct invocation points), no version-gating; most in the *separate* `the-flow` repo. **Six** seam strings exist today (SKILL.md L129) — incl. `task-pause` → the `coding` hook; all must keep routing | `--hook` is primary; `--event` stays a **transparent alias** for all six; AC-05 verifies zero-break |
| KF-03 | High | `--json` envelope is a frozen, MCP-stable contract; additive fields are snapshot-safe, reshaping is not (019/020 precedent) | Hooks output rides as **additive** data only; AC-09 verifies |
| KF-04 | High | Execution substrate **resolved → skill-first** (WS-1): routing is irreducibly skill (no `harness flow` act; `--json` envelope already skill-emitted); `harness observe` shows the `coding` hook is already CLI → architecture already hybrid | Build skill-only; `--hooks` is the named additive CLI **escalation seam** behind an objective trigger (workshops/001-execution-substrate.md); no CLI phase now |
| KF-05 | High | Statelessness is load-bearing — no stored registry; manifest must be **derived**; the five-hook spine is fixed | `--hooks` computes from the closed set every call; AC-02 |
| KF-06 | High | Lean budget — SKILL.md is 347 lines with a large Per-turn UX block | `--help` **replaces** longhand prose; line-count guard task; AC-03 |
| KF-07 | High | One-door discipline — never name child skills in prose/envelope | Hook names stage-neutral; `command` names the invocation; AC-08 |
| KF-08 | High | `phase-end` (per-phase drain) and `plan-complete` (terminal harvest+improve) are distinct lifecycle positions — collapsing both into `post-coding` buries the **Improve** beat (the loop's compounding moment) | Split out a **fifth hook `post-flight`** for the terminal close-out; AC-06 |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Hook vocabulary + `--hook` alias | eng-harness-flow | Introduce the five-hook vocabulary and `--hook` (aliasing `--event`) with the corrected seam→hook mapping (incl. the post-coding/post-flight split) | None |
| 2 | `--hooks` manifest + `--help` | eng-harness-flow | Add the derived discovery manifest + a concise print-and-stop help that replaces longhand prose | Phase 1 |
| 3 | Docs sync + neutrality + guards | eng-harness-flow | Sync references/getting-started, verify neutrality, run the line-count + validate-harness-flow guards | Phases 1–2 |
| ~~(v2)~~ | ~~`--emit-injection <idiom>`~~ → **deferred to v2** (WS-3) | eng-harness-flow | Idiom renderers — full design in [workshops/003](./workshops/003-emit-injection-scope.md); built in v2, not v1 | (v2) |

> **Harness seam rows** (`N.0` pre-flight / `N.z` post-coding) are included because the `/eng-harness-flow` router is installed — advisory scaffolding the implement verb auto-fires. Delightfully recursive here: we use the harness loop to build the harness loop's own interface.

#### Phase 1: Hook vocabulary + `--hook` alias

**Objective**: Introduce the five-hook lifecycle vocabulary and `--hook <name>` as the primary invocation aliasing `--event`, with the corrected seam→hook mapping (incl. `phase-end`→post-coding / `plan-complete`→post-flight).
**Domain**: eng-harness-flow
**Delivers**: hooks vocabulary in SKILL.md; `--hook` flag (alias `--event`); corrected mapping table; additive `--json` echo of the resolved hook.
**Depends on**: None
**Key risks**: mis-binning `pre-implement` (KF-01); accidentally reshaping the envelope (KF-03).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.0 | **Harness pre-flight** — `/eng-harness-flow --hook pre-flight --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled; verdict narrated verbatim before any edit | _Harness seam_ |
| 1.1 | Add a "Lifecycle hooks" subsection to SKILL.md defining the **five** hooks + the mapping table (incl. `pre-implement → pre-flight`, `task-pause → coding`, and the `phase-end`→post-coding / `plan-complete`→post-flight split); also **add** the `pre-implement → pre-flight` (and `task-pause → coding`) rows to the integration call-site block (~SKILL.md L326) — no such row exists there today | eng-harness-flow | All five hooks defined; mapping table present (incl. `task-pause`) and matches KF-01 + KF-08 | Per KF-01, KF-08 |
| 1.2 | Add `--hook <name>` to the parameter contract as primary; document `--event` as a transparent alias | eng-harness-flow | `--hook` documented; `--event` marked alias; slug map unaffected | Per finding 02 |
| 1.3 | Add the resolved hook to the `--json` envelope **additively** (the `hook` field, per § Manifest contract) | eng-harness-flow | New field only; no existing field reshaped | Per finding 03 / AC-09 |
| 1.4 | Validation: confirm all **six** `--event` strings still resolve via the alias mapping (incl. `task-pause` → `coding`) | eng-harness-flow | Each seam → correct hook; AC-05 holds | TDD-style check |
| 1.z | **Harness phase-end** — `/eng-harness-flow --hook post-coding --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled at phase end | _Harness seam_ |

#### Manifest contract (Shape A — confirmed by WS-2)

Pinned by [workshops/002-manifest-shape.md](./workshops/002-manifest-shape.md):
- **`--hooks --json`** (Shape A) → **top-level `{ manifest_version: 1, hooks: [...] }`** (not wrapped in `data`) — a host (e.g. `the-flow`) detects future shape changes via `manifest_version`. `hooks` is an array of **5** entries; per entry: `hook`, `intent`, `run_at`, `kind` (`fire`|`silent`), `invoke`, **`aliases` (`string[]` — the `--event` seams this hook subsumes; the migration map)**, `produces` (`|null`), `needs` (`string[]`), `preconditions` (`string[]` — e.g. `["S2-governance","S4-boot"]` for `pre-flight`; `[]` otherwise). The 5 entries: `pre-flight` (fire), `pre-coding` (fire), `coding` (silent), `post-coding` (fire — per-phase drain), `post-flight` (fire — terminal: harvest + present improvements + encode).
- **`--hook <name> --json`** → the **existing routing envelope** with one additive field (`hook`). It does **NOT** embed the manifest. (Routing call → envelope + `hook`; discovery call → top-level `{ manifest_version, hooks }`.)
- The 5-hook set is **fixed**; per-repo variability rides in each entry's `preconditions` (not in the hook list) — closed spine, honest statelessness (KF-05).

#### Phase 2: `--hooks` manifest + `--help`

**Objective**: Add the derived five-hook discovery manifest and a concise, print-and-stop `--help` that replaces longhand prose (net line delta ≤ 0).
**Domain**: eng-harness-flow
**Delivers**: `--hooks [--json]` manifest (fixed spine, `coding`=silent); `--help` synopsis block; trimmed stateless-contract/parameter prose; line-count guard.
**Depends on**: Phase 1
**Key risks**: bloat (KF-06); manifest drifting into a variable registry (KF-05).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.0 | **Harness pre-flight** — `/eng-harness-flow --hook pre-flight --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled | _Harness seam_ |
| 2.1 | Implement the `--hooks` manifest per **§ Manifest contract** (5 entries + `manifest_version: 1`; per-entry incl. `preconditions`; `coding` = `kind: silent`, `post-flight` = terminal fire); routing call stays envelope + `hook` only | eng-harness-flow | Manifest lists exactly 5 with `manifest_version`; `coding` silent; routing-vs-discovery `--json` boundary holds | KF-05, KF-03 / AC-02 |
| 2.2 | Add the concise `--help` synopsis block (synopsis + hooks + flags); print-and-stop, no detection | eng-harness-flow | `--help` does no routing/state; matches CLI help spirit | Per finding 06 / AC-03 |
| 2.3 | **Replace** longhand prose with the synopsis so net SKILL.md delta ≤ 0 — concrete removal targets: the stateless-contract bullets (§"The stateless contract", ~L16–27) and parameter-contract longhand (~L111–142); the Per-turn UX block is **off-limits** (KF-06). If the math can't close, surface the overage | eng-harness-flow | `wc -l SKILL.md` ≤ 347 (or overage surfaced for a human call) | line-count guard / AC-03 |
| 2.4 | Validation: `--hooks` manifest is internally consistent and one-door-clean (no child-skill names) | eng-harness-flow | No slug names; stage-neutral | Per finding 07 / AC-08 |
| 2.z | **Harness phase-end** — `/eng-harness-flow --hook post-coding --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled | _Harness seam_ |

#### Phase (former `--emit-injection`) — DEFERRED to v2 (WS-3)

`--emit-injection` is **not built in v1**. A renderer is a projection of the WS-2 manifest, so it waits until the manifest shape has settled in real use. The **full v2 design** (idiom allow-list `shell|sdd-skill|make|ci`, fire-only rendering, `coding` as a comment note, the idiom-not-product guard + unknown→neutral fallback) is specified in [workshops/003-emit-injection-scope.md](./workshops/003-emit-injection-scope.md). v1's wiring contract is `--hooks` (each hook carries its `invoke`). **AC-04 moves to v2 with this phase.**

#### Phase 3: Docs sync + neutrality + guards

**Objective**: Sync the reference docs to the hooks vocabulary, verify neutrality, and run the closing guards.
**Domain**: eng-harness-flow
**Delivers**: updated `getting-started.md` (seam-contract + quick-ref → hooks, `--event` shown as alias); governance-doc inject-map note if needed; line-count guard pass; `validate-harness-flow` replay + `harness doctor` clean; neutrality verification (no `the-flow` edits).
**Depends on**: Phases 1–2
**Key risks**: leaving stale `--event`-only prose; accidental the-flow edits.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.0 | **Harness pre-flight** — `/eng-harness-flow --hook pre-flight --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled | _Harness seam_ |
| 3.1 | Update `getting-started.md`: seam-contract section + quick-reference table → hooks vocabulary; show `--event` as an accepted alias | eng-harness-flow | Docs lead with `--hook`; `--event` noted as alias | AC-01/AC-06 |
| 3.2 | Update `governance-doc.md` injection-map reference if `--hooks` changes the inject handshake | eng-harness-flow | Inject story consistent with `--hooks` | Per finding (S3 handshake) |
| 3.3 | Neutrality verification: `grep` confirms no `the-flow` files changed in this repo; only `eng-harness-flow` touched | eng-harness-flow | `the-flow` untouched; AC-07 holds | AC-07 |
| 3.4 | Closing guards: `wc -l SKILL.md ≤ 347`; run the `validate-harness-flow` extension replay + `harness doctor` | eng-harness-flow | Line guard passes; replay + doctor clean | AC-03 + testing strategy |
| 3.z | **Harness phase-end** — `/eng-harness-flow --hook post-coding --plan-dir docs/plans/021-harness-flow-hooks` | — | Router envelope handled at phase end | _Harness seam_ |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.1, 1.2, 3.1 | hooks route correctly; docs lead with `--hook` |
| AC-02 | 2.1 | `--hooks` manifest fixed 5 (Shape A), `coding` silent, additive JSON |
| AC-03 | 2.2, 2.3, 3.4 | `--help` print-and-stop; line-count ≤ 347 guard |
| AC-04 | — (**deferred to v2** with `--emit-injection` — WS-3) | not a v1 criterion; v2 design in workshops/003 |
| AC-05 | 1.4 | six `--event` strings still route (alias) |
| AC-06 | 1.1, 3.1 | mapping correct — incl. `pre-implement → pre-flight`, `task-pause → coding`, `plan-complete → post-flight` |
| AC-07 | 3.3 | `the-flow` not edited (neutrality grep) |
| AC-08 | 2.4 | one-door — no child-skill names |
| AC-09 | 1.3 | envelope additive-only |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ~~WS-1 resolves to CLI-backed~~ → **resolved skill-first** (retired). Residual: a non-agent consumer later needs byte-stable `--hooks --json` | Low | Low | Named additive escalation seam (`harness flow --hooks` on the observe/doctor template); no rework of Phases 1–3 (workshops/001) |
| SKILL.md grows despite intent (bloat) | Medium | Medium | Line-count guard task (2.3, 3.4); `--help` replaces prose |
| Cross-repo drift — `the-flow` keeps emitting `--event` | High | Low | Alias is permanent until a deliberate separate deprecation |
| `--emit-injection` erodes neutrality (product profile added) | Low | Medium | **Deferred to v2** with the feature; idiom-not-product guard + unknown→neutral fallback specified in workshops/003 (built in v2) |
| Envelope snapshot break | Low | High | Additive-only discipline (1.3); AC-09 |

### Harness Seams
- **Entry point**: `/eng-harness-flow --hook <name> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named in this plan. (`--event <seam>` is the back-compat alias.)
- **Backpressure** (pre-coding / `post-spec` seam): an optional refinement off this plan — `backpressure-coverage.md` not captured. [Recommended Phase 0 folded in? no]
- **Pre-flight** (`--hook pre-flight`, alias `--event pre-implement`): fired at the start of each phase (the N.0 rows); verdicts narrated verbatim (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`); `UNAVAILABLE` is not an error.
- **Post-coding** (`--hook post-coding`, alias `--event phase-end`): fired at each phase seam (the N.z rows) — per-phase drain.
- **Post-flight** (`--hook post-flight`, alias `--event plan-complete`): the **terminal close-out**, fired by the merge verb after merge — harvest across the journey + **present improvement opportunities** + route chosen ones to encode (the human chooses; the router never auto-improves).
- **Best-effort**: every item is advisory and never blocks; the router decides what the harness does at each seam.
