# Research Dossier — First-Class Flow System

**Generated**: 2026-06-17 · **Flow**: 024-first-class-flow-system · **Stage**: research (1a explore)
**Research query** (verbatim intent): make the "flow" — a cursor-spine DAG of nodes the agent visits, tracked across compaction seams — a **first-class, deterministic concept inside the harness CLI** (`harness flow …`), so both `the-flow` and the harness's own workflows consume it instead of re-implementing the logic in prompts. Two built-in flows ship with it (onboarding + the engineering/the-flow flow); users author more. "Simple and elegant — not boiling the ocean."
**Lenses**: 6 read-only research agents — FP (existing flow system), CLI (harness CLI architecture), ON (onboarding flow + adopt-flow design), EV (event log / records precedents), SC (schemas / distribution / render), PL·CT·BD (prior learnings / contracts / boundaries). A background fork also produced a (mis-scoped) 023 plan — noted below.

---

## Executive Summary

The "flow" is today a **fully prompt-driven DAG navigator**. Its data model is real and stable — a `the-flow.json` flight plan (source of truth) rendered to `the-flow.md` (mermaid), plus a minimal `.the-flow-state.json` resume contract — but **every mutation is hand-cranked by the agent in prose**: cursor moves, status changes, artifact appends, timestamp stamping, and the 8–12 mermaid render rules. The user's thesis is exactly right: this logic belongs in **deterministic code** (a `harness flow` verb family), not in skill prompts.

The good news from research: **the architecture is ready for this.**

1. **The existing schema is the blueprint.** `flight-plan.schema.json` already models nodes (id/type/status/next/branch_of/command/ran_at/user_input/artifacts), a single `cursor` + `recommended_next`, a status taxonomy with colour mapping, excursions, and parallel `agents[]`. It explicitly says it is *reference-only with no runtime validator* — i.e. it was always waiting to be made first-class (FP-01..FP-15, SC-02, SC-05).
2. **The CLI slots a new verb family in cleanly.** `harness/cli/src/acts/*` + `services/*` + ports/adapters + the `Envelope` output kernel + `error-codes.ts` + POSIX path discipline + the `gen:docs` build-time-inlining distribution pattern give a precise template a `harness flow create|render|cursor|status|event|new` family follows with no architectural novelty (CLI-01..CLI-12).
3. **The split into shared-core + per-flow-custom schema is validated by the two built-in flows.** The engineering/the-flow flow needs spine/phase/workshop/fix-loop node types; the onboarding flow needs *different* record types (rungs with a `declined` status, per-file S3 weave state, a pre-materialised `boot_shape` decision). Same scaffolding (cursor, decisions, narration, lifecycle), different record types — exactly the user's "general shared schema + custom schema per flow" (ON-06, ON-10, SC-05, SC-A).
4. **The event log is mostly greenfield but well-precedented.** No existing code embeds a timestamped event array in a JSON file, nor duck-types values, nor measures inter-stage durations (EV GAP-A/B/C). But the observe buffer's per-kind prefixed-id append pattern, the record service's 7-key provenance stamping, and the injected `Clock` give a grounded shape for built-in event kinds (cursor-moved, status-changed, created) and duck-typed custom telemetry events (EV-01..EV-16).

**The headline risk is not feasibility — it is blast radius.** `the-flow` and `eng-harness-flow` become **consumers** of this system, and the byte-stable `--hook/--event/--hooks/--json` contract (plan 021) plus several silent CI traps (`check:docs`, `.minih.json`, `arch-check`, `skills-check`) must survive untouched (CT-01..CT-11). The cursor-vs-substrate authority boundary (CD-01) is the load-bearing safety rule.

**Verdict**: the design is sound, the substrate is ready, the scope is genuinely containable to a tight phase set. The plan's job is to sequence it so the CLI lands first (with one built-in flow proving the shape end-to-end), then migrate `the-flow` onto it, then add the onboarding flow — without ever breaking the consumers mid-flight.

---

## Critical Discoveries

### CD-01 — Cursor-vs-substrate authority is the safety boundary (load-bearing)
*(ON-04, ON-12, FP-08)* — Some flow state the **persisted cursor authoritatively owns** (transient/declined choices, per-file progress, decisions made-but-not-yet-materialised, narration). Other state the **substrate must stay authoritative for** (is the CLI installed? does the governance doc exist? does boot actually boot?). The failure mode: a cursor that says "S2 done" while `.harness/engineering-harness.md` was never written reads as an engineering entry when it is really a provisioning gap. **Design rule the CLI must encode**: every flow node/field is tagged as *cursor-authoritative* (resume trusts it) or *substrate-verified* (resume re-checks it). This is a schema-level semantic, not just bookkeeping.

### CD-02 — `the-flow` and `eng-harness-flow` become consumers; the contract must not move
*(BD-02, BD-03, CT-01, PL-02, PL-03)* — Today `the-flow` hand-writes `the-flow.json`; tomorrow it calls `harness flow`. The router (`eng-harness-flow`) is **stateless and read-only** — it may *read* a flow file as one detection signal but never writes it. The byte-stable public surface (`--hook`, the permanent `--event` alias, the Shape-A `--hooks` manifest, the additive `--json` envelope) is **mirrored downstream** in `the-flow`'s `harness-seams.md`. Any change there breaks the mirror. **Design rule**: the flow system is *new machinery the consumers opt into*; it must not reshape the existing contract. Migration of `the-flow` onto the CLI is additive and reversible.

### CD-03 — The event log is the one genuinely greenfield piece, and it is already being born (badly) in the wild
*(EV GAP-A/B/C, FP-22; **live evidence: `docs/plans/021-harness-flow-hooks/.the-flow-state.json`**)* — There is **no clean precedent** for (a) a timestamped event array embedded *inside* the flow JSON, (b) duck-typed custom event values (bool/string/date/int auto-selected by shape), or (c) inter-event duration measurement. But the *need* is already proven: the 021 `.the-flow-state.json` has organically accreted **~12 ad-hoc prose keys** — `phase1_done`, `phase2_done`, `phase3_done`, `phase3_review_note`, `phase2_budget`, `phase3_tasks`, `workshops_done`, `ws1_resolution`, `plan_version`, `closed_out`, `milestones_note` — each a free-text "what happened, when, with which commits" blob (e.g. *"Phase 2 IMPLEMENTED 2026-06-17 with --companion … F001 HIGH … FIXED d2b0504"*). This is the event log **trying to exist**, but: unstructured, dumped into the *resume* contract (wrong file — `.the-flow-state.json` should be minimal), with the datetime buried in prose instead of a queryable field. **Two design consequences (user-directed):**
1. **Two logging surfaces, both timestamped.** A flow-level **`events[]`** at the root (cross-node: created, cursor-moved, status-changed, custom telemetry) **AND** per-node **`comments[]`** (one or more datetime-stamped annotations attached to a specific node — `phase2_done` is a comment on the Phase 2 node; `ws1_resolution` is a comment on the workshop node). Most of 021's blobs map to *node comments*; the flow-scoped ones (`closed_out`, `milestones_note`) map to *root events*.
2. **Separation of concerns.** `.the-flow-state.json` returns to minimal resume-only; **all audit/history moves into `the-flow.json`** as structured events + node comments. Built-in (un-exposed) events: `created`, `cursor-moved`, `status-changed`, `node-created`; public-but-manual events (agent/external tooling — e.g. a build-run marker); repo-defined custom telemetry — all append to the same log. **This deserves its own workshop** (the user explicitly asked for one on the event taxonomy).

### CD-03b — Datetime is a first-class, queryable theme (not prose)
*(user-directed; EV-05, EV-16, FP-23)* — The whole point of structuring the above is **temporal analysis later**: when was each node created, modified, run; how long between stages; when was each comment/event added. So *every* time-bearing field must be a real ISO-8601-UTC value from the injected `Clock` (never embedded in a sentence): nodes carry `created_at` + `modified_at` + `ran_at`; events carry `fired_at`; **comments carry `at`**; the flow root carries `created_at`. The 021 blobs prove the anti-pattern (dates trapped in prose like *"IMPLEMENTED 2026-06-17"* can't be queried). Determinism rule (Constitution P2): generated via `Clock.nowIso()` in the CLI, not `new Date()` in a prompt.

### CD-04 — The render command is a deterministic-generation problem the repo already solved once
*(SC-04, SC-08, SC-09, FP-15, FP-20)* — The 8–12 mermaid/markdown render rules (classDefs, spine vs dotted excursions, harness-violet nodes, 🗣 user bubbles, companion subgraphs / worker side-nodes, legend, rail line) are fully specified in prose and must become a pure function `harness flow render` (same JSON → byte-identical markdown). The `gen:docs → docs-content.ts → git diff --exit-code` pipeline is the **exact parity precedent**: a generator + a CI drift guard. `harness flow render --check` mirrors it, letting committed `the-flow.md` be guarded as a derived artifact.

### CD-05 — `the-flow` will hard-require the CLI; but a repo need not be *adopted*
*(user brief; ON-05, SC-07)* — A deliberate behaviour change: with a first-class flow system, `the-flow` should **error and stop if the harness CLI is absent** (no more hand-crank fallback). But the target repo does **not** need to be *adopted* — `harness flow` can create flows anywhere (`docs/plans/<slug>/the-flow.json` by default, `.harness/` for harness-owned flows, or a redirected path). This decouples "have the CLI" (required) from "adopted the harness" (not required) and is a clean, testable precondition.

---

## How the existing flow system works (what we are supplanting)

**The state trio** *(FP-04..FP-06)*
- `the-flow.json` — **source of truth**: the flight-plan DAG (root fields + `nodes[]` + `agents[]`).
- `the-flow.md` — **rendered mermaid**, never hand-edited; a pure function of the JSON.
- `.the-flow-state.json` — **minimal resume contract** (slug, plan_dir, mode, current_stage, pending_command, intent, milestones, last_checkpoint_at, status). Written temp-file + atomic-rename. Guided mode is the **sole writer**.

**The node model** *(FP-01)* — `id, type, label, status, next[]` (required) + `command, ran_at, user_input, note, artifacts[], branch_of, phase, iterations, tool, reconstructed`. Types: spine (`research, deep-research, spec, plan, phase, merge`), harness (`backpressure, harness-boot, harness-retro`), conditional (`workshop, fix-loop, review`).

**The cursor** *(FP-07, FP-08)* — exactly one `cursor`; `recommended_next` is the guide-owned suggestion. Advancement = re-derive from artifact existence (idempotency), then move cursor + set prior node `done`.

**Status → colour + transitions** *(FP-09)* — `done`🟩 `in_progress`🟧 `blocked`🟥 `known`🟦(designed) `assumed`⬜(speculative). Legal: `assumed→known` (only at the plan pass) `→in_progress→done`; any active `→blocked→in_progress`. No backwards moves.

**Excursions & agents** *(FP-10, FP-11, FP-14)* — `branch_of` hangs deep-research/workshops/backpressure/fix-loops off the spine as dotted edges; `agents[]` (companion `render:wrap` subgraph / worker `render:side` node) are tracked but never *run* by the flow.

**What is prompt-driven today (the migration target)** *(FP-16..FP-21)* — cursor advancement, status transitions, artifact capture, verbatim `user_input` capture, mermaid regeneration, and `recommended_next` selection are **all hand-cranked by the agent**. The Graph itself (the single owner of "what's next") is a **prose markdown table** in `00-routing.md`.

**What's missing that the new system adds** *(FP-22..FP-26)* — an embedded **event log**; node `created_at`/`modified_at` timestamps; `created_from_branch` provenance; runtime **custom-metadata** fields; unique CLI-addressable node ids (already present, now used by commands); and a **machine-readable Graph** with edge predicates (replacing the prose table) — boolean decision points → serial sub-flows.

---

## The harness CLI: how the `harness flow` verb family slots in

**Architecture (clean hexagonal)** *(CLI-01..CLI-05)*
- **Acts** (`src/acts/*`) = thin command wiring only; register on the Commander program, parse flags, call a service, finalise an `Envelope`, exit through the single chokepoint `exitWithEnvelope`. **No business logic in acts.**
- **Services** (`src/services/*`) = pure logic, injected ports only (`FsPort, ProcessPort, Clock, EnvPort, GitPort, ExecPort`). **Never import `node:fs`/`process`/`node:path` directly** (Constitution P2; enforced by `arch-check`).
- **Adapters** (`src/adapters/*`) = real + `Fake*` implementations (in-memory fs, frozen clock) for deterministic tests.

**Output contract** *(CLI-03, EV-06)* — every command returns an `Envelope { command, status: ok|error|degraded|unconfigured, timestamp, data?, error?, evidence?, next_action?, update_available? }`. Exit codes: ok/degraded→0, unconfigured→2 (honest "not built yet"), error→1. `--json` emits the envelope as-is.

**Paths** *(CLI-04, SC-07)* — POSIX-normalised at the boundary (`toPosix`, `posixJoin`, `isWithin` escape-guard). `.harness/` is the committed root; `.harness/temp/` is gitignored transient (via `ensureTemp()`); `.harness/records/<type>/<date>/` for records. Default flow placement: `docs/plans/<slug>/the-flow.json` (mirrors today) or `.harness/` for harness-owned flows; `--path`/redirect to anywhere inside the repo.

**Schema validation** *(CLI-06, SC-03)* — the CLI is **deliberately schema-agnostic today** (no ajv; record schema "lives in the template body"). A runtime validator was *deferred, not rejected* (flight-plan schema `$comment` + workshop 002 Q1). The flow system is the natural place to introduce **optional, version-gated** JSON-Schema validation.

**Distribution** *(SC-04, SC-06)* — bundled assets travel via the **`gen:docs` pattern**: a manifest → a build-time generator inlines content into a committed `.ts` module → ships in `dist/` (zero runtime fs, byte-stable, CI-drift-guarded). Built-in flow schemas (the-flow, onboarding) ship the same way (`gen:flows` → `schemas-content.ts` → `check:flows`). User custom-flow schemas resolve from `.harness/schemas/<type>.schema.json` (convention) or `--schema <path>`.

**Errors / reserved names / tests** *(CLI-08, CLI-10, CLI-12)* — add an `E3xx` flow block to `error-codes.ts`; reserve `flow` as a core command (always present, even `--no-extensions`); test under `test/acts/flow.test.ts` + `test/services/flow/*` with `Fake*` adapters (spy `process.exit`, assert envelope + exit code).

**Proposed verb family** *(CLI-07, synthesis)* — a single core `flow` act dispatching subcommands:
- `harness flow new <type>` — scaffold a new flow **type** (a schema), for users inventing their own flow.
- `harness flow create <type> [--path|--plan-dir]` — instantiate a flow from a schema (built-in or custom).
- `harness flow render [--input|--output|--check]` — deterministic mermaid+markdown (the render function).
- `harness flow cursor --to <node>` / `flow status --node <id> --status <s>` / `flow node add-artifact|set-user-input` — atomic mutations (replace hand-crank).
- `harness flow event <name> --kind <k> [--value <v>]` — append a built-in or duck-typed custom event to the root log.
- `harness flow comment --node <id> --text "<…>" [--kind <k>]` — append a timestamped comment to a node (CD-03/CD-03b).
- `harness flow show|list [--json]` — read state / list flows.
*(Exact CLI surface is a workshop topic — the user asked to "workshop the entire CLI for this.")*

---

## Schema: shared-core + per-flow custom overlay

*(SC-05, SC-A, ON-06)* — JSON-Schema Draft 2020-12, dual versioning (`x-schema-version` in the schema file + a required `schema_version` SemVer in every instance; readers reject unknown majors).

**Shared core** (`flow.schema.json`) — invariant across all flows: `schema_version, kind (discriminator), slug, plan_dir, created_at, mode, cursor, recommended_next, nodes[], agents[], events[]`, plus the universal node fields (`id, type, status, next, label, command, created_at, modified_at, ran_at, user_input, note, artifacts, branch_of, custom-metadata, comments[]`) and the **event log** (built-in + custom events). Every node carries the **datetime trio** (`created_at`/`modified_at`/`ran_at`) and an append-only **`comments[]`** (CD-03/CD-03b). `additionalProperties:false` at the core; **`true` on nodes** so each flow type extends freely.

**Per-flow custom overlay** (`allOf` + discriminated `oneOf` on node `type`):
- **flight-plan** (the engineering/the-flow flow) — `kind:"flight-plan"`, `mode ∈ {Simple,Full,unknown}`, spine/harness/workshop/fix-loop node types, `phase`/`tool`/`iterations` per-type fields.
- **onboarding / adopt-flow** — `kind:"adopt-flow"`, **different record types**: 5 rungs (S0–S4) each with a `status ∈ {done, declined, pending, not-started}` (note the **`declined`** value the engineering flow has no use for), S3's unique **`files[]`** per-file weave vector (`decision: woven|declined|pending`, `hook`), `decisions.boot_shape`/`skills_install_targets` (made-but-not-materialised), `narration_thread`, `pending_command`. This concretely proves "different flows store different record types."

**Custom metadata + links** *(FP-25, EV-03)* — nodes carry optional runtime `custom-metadata` (free key/values created at runtime), `created_from_branch` (the git branch at creation — reuse the record-provenance `branch` key), and `harness_record_link` (point a node at a `harness record`).

---

## The event log + per-node comments (embedded, the user's distinctive ask)

*(EV-01..EV-16, GAP-A/B/C, CD-03, CD-03b)* — **two timestamped surfaces inside the flow JSON** (the user: "inside the main json file, not separate"; and "each flow node needs the ability to have one or more comments appended, each with their own datetime"):

**Surface 1 — per-node `comments[]`** (node-scoped annotations; absorbs most of the 021 prose blobs):
```jsonc
"comments": [
  { "at": "2026-06-17T03:30:00.000Z", "source": "agent", "kind": "note",
    "text": "Phase 2 IMPLEMENTED with --companion. F001 HIGH fixed d2b0504; F002 MEDIUM fixed 79561cd." }
]
```
- `at` (required ISO-8601 UTC), `text` (required), optional `source` (`user | agent | system`), optional `kind` (`note | decision | warning | …`), optional `refs[]` (commits/artifacts). Append-only; never rewritten. A node accumulates its own history.

**Surface 2 — flow-level `events[]`** (cross-node, machine-fired). Grounded shape:

- **Provenance once** (record-service pattern): stamp `created_at`, `harness_version`, `agent`, `plan_id` at the log root, not per event.
- **Per-event**: `id` (per-kind prefix + zero-padded ordinal, e.g. `CM-001` — observe-buffer pattern), `kind`, `fired_at` (injected `Clock`, ISO-8601 UTC ms), `description`, optional `details{}`.
- **Built-in kinds (not exposed / fired by the engine)**: `created`, `cursor-moved` (from→to), `status-changed` (node, from→to), `node-created`. These are the events the user said should "not be exposed" (the CLI fires them as a side effect of cursor/status commands).
- **Public-but-manual kinds**: events agents or external tooling fire deliberately (e.g. a build/run-hook marker) — same append path, invoked explicitly.
- **Custom telemetry kind**: `{ kind:"custom", name, type, value }` where `type` ∈ bool|string|date|int|float and is **auto-selected by value shape (duck-typed)** — JSON already does this; implement via `typeof`/narrowing, store `type` explicitly so readers deserialize without guessing.
- **Durations**: store explicit `fired_at`; compute deltas (e.g. "time between flow stages") at read time — the log is the source, duration is interpretation.
- **Tolerant** (observe-buffer principle): never silently drop entries; preserve unparseable ones.

---

## Render rules the deterministic renderer must implement

*(SC-08, FP-15)* — `harness flow render` is a pure function; checklist:
1. `flowchart TD` + all classDefs (`done/wip/blocked/known/assumed` + `said/companion/worker` + **`harness` violet `#EDE7F6/#673AB7`**).
2. **Spine** (`type ∈ research, spec, plan, phase, merge`) solid `-->` in `next` order; unified `plan` connects directly to first `phase`.
3. **Excursions** (`branch_of` set) dotted `-.->`, rejoining the spine; every workshop is its own node (never collapsed); a `backpressure` node is a `:::harness` excursion off `plan`.
4. **Harness seam nodes** (`harness-boot`/`harness-retro`) dotted `:::harness`, `command` always a `/eng-harness-flow --hook …` router invocation; **emitted only when router installed AND repo provisioned**; Layer-1 miss → omit *all* harness nodes, spine stays intact; one retro node per phase.
5. Each node `:::<class>` from `status` (harness nodes always `:::harness`; status via note).
6. **User bubbles**: every node with `user_input` → a `said` node `>"🗣 …"]` dotted `-.-`, verbatim.
7. **Agents**: companion `render:wrap` → subgraph over `covers[]`; worker `render:side` → side-node `-. builds .->`.
8. Legend line; then the one-line **rail** (coach's glanceable twin).
**Parity**: `--check` re-renders and `git diff`-guards (the `gen:docs` precedent); committed `.md` is a derived artifact.

---

## Ownership & boundaries (after the system lands)

| Component | Role | Reads flow state | Writes flow state |
|---|---|---|---|
| **harness CLI** (`harness/cli`) | **Owns the flow system** — verbs, schemas, render, event log, validation | yes (its own verbs) | **yes — the only writer** |
| **the-flow** skill | **Consumer** — calls `harness flow` instead of hand-cranking; owns its SDD *stage* artifacts | via CLI | via CLI only (never direct) |
| **eng-harness-flow** router | **Consumer (read-only)** — reads a flow file as one detection signal; stays stateless | yes (signal) | **never** |
| **onboarding/adopt** verb | **Consumer** — drives the built-in onboarding flow; owns its substrate | via CLI | via CLI only |

**Boundary rules** *(BD-01..BD-07, ON-05, ON-10)* — the unifying rule ("state that must persist lives in deterministic substrate a child owns") *authorises* moving flow state into the CLI; the router never gains memory. **L1 de-leak** (plan 022): verb modules under `references/stages/` stay harness-blind/flow-blind — no sibling slugs, no flow position, no hook self-refs. One Graph, one owner. One voice (coach), one place.

---

## Must-not-break / CI traps *(CT-01..CT-11, PL-01..PL-12)*

- **Byte-stable contract**: `--hook` (5 fixed lifecycle hooks), permanent `--event` alias (~88 call sites, never deprecate), Shape-A `--hooks` manifest, additive-only `--json` envelope. Mirrored in `the-flow`'s `harness-seams.md` — diff for byte-parity on any change.
- **`check:docs`**: any bundled-doc/skill-reference change ⇒ run `npm run gen:docs` (regenerates `docs-content.ts`) or CI red. A `gen:flows`/`check:flows` of the same shape is the model for bundled schemas.
- **`just test` = vitest only** (not biome/check:docs/typecheck) → the **green-local/red-CI trap**; run `npm run build` + `check:docs` locally before commit.
- **`ci-required`** = `rename-guard` + `build-test` (Node 22+24: lint→build→check:docs→typecheck→vitest→arch-check→skills-check) + `package-smoke`. New flow code must pass `arch-check` (hexagonal rules) and any new skill must pass `skills-check` (description ≤1024).
- **`.minih.json`**: a known live debt (E211 post-022 → `--no-skills`) — if the flow work touches skills, reconcile the include array.
- **Contract imports** scoped `@ai-substrate/engineering-harness/contract`; **don't edit `docs/plans/**`** history.

---

## Open questions (decide in/at planning + workshops)

1. **CLI surface** — the full `harness flow` verb/flag set (the user asked to *workshop the entire CLI*). Single `flow` act + subcommands vs multiple acts; mutation granularity. *(workshop)*
2. **Event taxonomy** — built-in (un-exposed) vs public-manual vs custom; duck-typing rules; whether durations are computed in-CLI or downstream. *(the user explicitly requested this workshop)* *(CD-03)*
3. **Graph as data** — does the machine-readable Graph (edge predicates, decision points, sub-flows) ship in v1, or do the mutation commands ship first and the Graph follow? *(FP-26 — scope lever for "limit phases")*
4. **Validator** — introduce optional version-gated JSON-Schema validation now, or keep self-check + defer? *(SC-03)*
5. **Migration ordering** — when does `the-flow` cut over from hand-crank to `harness flow`, and how is it kept reversible? When does `the-flow` start hard-requiring the CLI (CD-05)?
6. **Onboarding flow timing** — build the onboarding flow on the new system in this plan, or land the engine + the-flow migration first and add onboarding as a fast-follow? (Relationship: 023's `adopt-flow.json` workshop is the **authoritative design input**; this plan generalises it.) 
7. **Staleness/concurrency/archive** — TTL on abandoned flows, last-writer-wins, archive-vs-delete on completion *(ON-11)*.

---

## Suggested phase shape (input to the plan — "limit phases please")

A tight, consumer-safe sequence (the plan pass sets the real Mode/CS and may merge/split):
- **P0 · Contract snapshot sensor** — a frozen-snapshot fixture test over the byte-stable `--hook/--event/--hooks/--json` surface *before* touching anything (CD-02; the zero-sensor gap).
- **P1 · CLI flow engine (core)** — `flow` act + service + shared-core schema + state read/write (atomic) + `flow create/show`, with **one built-in flow type** (flight-plan) proving the shape. `E3xx` codes, tests.
- **P2 · Deterministic render** — `flow render [--check]` implementing all render rules + `gen:flows`/`check:flows` parity guard.
- **P3 · Event log + node comments + datetime** — embedded `events[]` (built-in + duck-typed custom), per-node `comments[]`, the node datetime trio, `flow event`/`flow comment`; migrate 021-style prose blobs out of the resume file. *(preceded by the event-taxonomy workshop)*
- **P4 · the-flow migration** — `the-flow` calls `harness flow` instead of hand-cranking; hard-require the CLI (CD-05); keep reversible.
- **P5 · Onboarding flow** — the second built-in flow on the new system (generalises 023's `adopt-flow.json`); honours CD-01.
- **P6 · Docs sweep** — reconcile governance doc, catalogs, the npm-vs-GitHub-Packages stale-doc contradiction the fork spotted.

---

## Notes on the background fork & relationship to plan 023

The forked worker (`we are going to build a first class flow system`) ran with only the short directive + inherited 023 context, so it scoped to the **narrower onboarding-UX work** and wrote `docs/plans/023-documentation-updates/documentation-updates-plan.md` (Phase 0 contract sensor, cold-start breadcrumb, `adopt-flow.json`, router signal, coach port, docs sweep). That is a coherent plan for the **paused 023**, not for this bigger vision. Useful corroboration (its Phase 0 = our P0; its adopt-flow.json = our onboarding built-in flow), but **plan 024 supersedes it conceptually**: 023's hand-rolled `adopt-flow.json` becomes *one built-in flow on the general system* rather than bespoke state. Decide during planning whether 023 is folded into 024, kept as a fast-follow, or closed.

## External research opportunities
None external — every gap is internal/empirical (CLI surface, event taxonomy, Graph-as-data, validator timing). All resolved by the workshops and the plan pass above.
