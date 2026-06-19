# First-Class Flow System
**Mode**: Full
**Plan Version**: 1.2.0
**Created**: 2026-06-17 (amended 2026-06-18)
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md (6-lens fan-out), **workshops 001 (CLI surface) + 002 (event + comment taxonomy) + 003 (templates, node insertion, decision points)** — all authoritative — the **2026-06-17 grill session** (8 decisions: deterministic mechanics not routing; no external enforcement; clean break / no back-compat; `flow agent` → v2; capability-not-presence check; drop onboarding → separate plan; the-flow owns its schema; renderer supplants the prototype), and the **2026-06-18 render-surface decision** (genesis `user_input` bubble + `comments[]` count badge + markdown body log).

> **v1.2.0 amendment (2026-06-18, direct edit — not a full re-plan)**: additive fold of workshop 003 + the render-surface decision. No structural change (phases stay 3, CS-4 holds, gates stay PASS, thesis unchanged). Deltas: AC-01 (create from template/`--bare`), AC-06 (decision type + comment render), **new AC-15** (insert-node edge algebra); tasks 1.2/**1.3a (new)**/1.6/1.7/1.11/2.2 (task 1.3 unchanged); `E309`; Coverage Map + 2 risks + a Clarifications entry. See `### Clarifications` § 2026-06-18.

---

## Business Specification

### Research Context
The "flow" — a cursor-spine DAG of nodes the agent visits, tracked across `/compact` seams — exists today only as **prompt-cranked logic**. Its data model is real and stable (`the-flow.json` source of truth → `the-flow.md` rendered mermaid → minimal `.the-flow-state.json` resume contract), but *every* mutation is hand-done by the agent in prose: cursor moves, status changes, artifact/`user_input` capture, timestamp stamping, and the 8–12 mermaid render rules. Research confirmed the substrate is ready: the existing `flight-plan.schema.json` is the blueprint; the CLI's act/service/adapter architecture slots a `harness flow` verb family in cleanly; and `gen:docs → docs-content.ts → git diff` is the exact precedent for a deterministic, CI-guarded render. A **20-flow corpus review** (every `the-flow.json` in this repo) grounded the design in real usage: `events[]`/`comments[]`/`created_at`/`modified_at` are **0/20** (genuinely greenfield); only `ran_at` is ever stamped; `agents[]` appears in 8/20 (companion runs); and the 021 `.the-flow-state.json` (13 ad-hoc prose keys with dates trapped in sentences) is the event log being **born badly**. Two workshops then pinned the contract: the full `harness flow` verb surface (001) and the event + comment taxonomy (002).

### Summary
Make the flow a **first-class, deterministic concept inside the harness CLI**: a `harness flow` verb family that owns flow creation, atomic state mutation, an embedded event log + per-node timestamped comments, and a deterministic mermaid/markdown renderer — driven by a **shared-core schema + per-flow custom overlay**. This is the **mechanics** of the flow made deterministic (mutation, history, render) — **not** automated routing (the prose Graph stays; the agent still drives). Ship the engine with the harness-owned built-in schema bundled, migrate `the-flow` onto it (the-flow ships + points at its own flight-plan schema), and supplant the hand-cranked prototype outright — **no backward compatibility** with pre-CLI hand-written flows.

### Goals
- Move flow **mechanics** from prompts into deterministic CLI code: atomic mutation commands replace hand-cranking; auto-fired events + auto-stamped timestamps remove the fields humans forget; a render command replaces by-hand mermaid. *(Routing/"what's next" stays prose — explicit Non-Goal.)*
- A **shared-core flow schema** + **per-flow custom overlays** (different flows store different record types), proven by **two** schemas: the **harness-loop** overlay (bundled with the CLI) and `the-flow`'s **flight-plan** overlay (shipped with the `the-flow` skill).
- **Datetime is first-class and queryable**: every node carries `created_at`/`modified_at`/`ran_at`; an embedded `events[]` log (built-in + public-manual + duck-typed custom) and per-node `comments[]` (each with its own `at`) enable temporal analysis (durations derived at read time).
- A **deterministic `harness flow render`** producing byte-identical mermaid + markdown, guarded by a CI parity check — **free to supplant** the old hand-rendered shape (best-fit to current requirements, not byte-matched to the prototype).
- `the-flow` consumes the engine and **errors-and-stops** if the CLI is absent **or too old** (a capability/version-floor check, not presence-only); flows can be created anywhere (default `docs/plans/<slug>/the-flow.json`, `.harness/`, or a redirect) with **no adoption required**.
- Preserve the byte-stable `--hook/--event/--hooks/--json` contract that downstream consumers mirror.

### Non-Goals
- **A machine-readable routing Graph** with edge predicates — the prose Graph in `00-routing.md` stays authoritative; the CLI provides mutation + render *primitives*, not a decision engine. **(Grill decision 1.)** *Deferred indefinitely by design.*
- **External enforcement of "good" flow usage** — no linter for whether a comment is *useful* or the cursor advanced *wisely*. Mechanical integrity (auto-events, auto-timestamps, schema validation, render `--check`) is enforced; narrative quality stays agent judgment. **(Grill decision 2 — risk accepted.)**
- **Backward compatibility with pre-CLI hand-written flows** — the 20 existing `the-flow.json` files (and 024's own) are a *first manual attempt* being **supplanted**, not a compatibility target. They error cleanly (`E308`); no tolerant-load, no lazy-upgrade, no migration. **(Grill decisions 3 + 8.)**
- **The onboarding / adopt-flow built-in** — moved to a separate, already-staged plan (the user forked it off). 024 ships the-flow + harness-loop as its two built-ins. **(Grill decision 6.)** *024 ships **no adopt features**, but the shared-core deliberately leaves **extension room** for that plan — overlay-declared statuses (so `declined`/`pending`/`not-started` need no core change) + an optional `authority` tag slot — so the known-next plan extends the core rather than reshaping it (AC-03/AC-10; forward-compat fix).*
- **An `eng-harness-flow` loop-flow driver** and a `flow agent` verb — the harness-loop *schema* ships as a bundled default (schema-only, proves the split), but nothing *creates/drives* a harness-loop instance in 024, and recording `agents[]` is deferred to v2. **(Grill decisions 4 + 6.)**
- **Parallel nodes** as a first-class DAG construct, the `--emit-injection` renderer, and any reshape of the `--hook/--event/--hooks/--json` contract. *Deferred.*

### Target Domains

> No `docs/domains/` registry exists in this repo — boundaries are the hexagonal architecture layers (`docs/project-rules/architecture.md`) plus the consumer skills. `domain.md`/registry scaffolding is **N/A** (there is no domain system to update).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli · **flow** (services/flow + acts/flow + schemas) | **NEW** | **create** | The flow engine: verb family, shared/custom schemas, state I/O, event log, renderer |
| harness-cli · output/adapters/services (envelope, ports, error-codes, gen pipeline) | existing | **consume** | Reuse Envelope, FsPort/Clock/GitPort/EnvPort, `E3xx` codes, the `gen:docs` distribution pattern, and the observe/record precedents (id format, provenance block) |
| `the-flow` skill (source: `~/github/tools/skills/SDD/the-flow`, deploys to `~/.claude/skills/the-flow`) | existing | **modify** | Becomes a consumer: calls `harness flow` instead of hand-cranking; ships + points at its own flight-plan schema; hard-requires a capable CLI. **User-controlled source — in-scope to edit** |

#### New Domain Sketches

##### harness-cli · flow [NEW]
- **Purpose**: Own flow state deterministically — create/mutate/render flows, log events, support shared-core + per-flow-custom schemas. The single writer of flow state.
- **Boundary Owns**: the `flow.schema.json` shared core + the **harness-loop** built-in overlay; the `flow` act + `services/flow/*`; atomic state read/write; the event log + node comments + datetime stamping; the renderer + its CI parity guard.
- **Boundary Excludes**: routing/"what's next" decisions (stay in `the-flow`/`eng-harness-flow` prose Graphs); running agents/`minih`; `the-flow`'s flight-plan **schema** (owned + shipped by the skill); the byte-stable hook contract (owned by `eng-harness-flow`, untouched); the onboarding/adopt-flow overlay (separate plan).

### Testing Strategy
- **Approach**: **Full TDD**. Tests-first throughout — this is a contract-bearing, deterministic system other skills consume.
- **Rationale**: matches the repo's vitest + `FakeFs`/`FakeClock` port culture and the harness "deterministic backpressure over inference" doctrine; render byte-parity, schema validation, and the contract-snapshot sensor are naturally golden-file/test-first.
- **Focus areas**: schema validation (shared-core + two distinct overlays); atomic state I/O; built-in event auto-firing + duck-typed custom events; node comments + datetime stamping; render byte-parity (`--check`) against **fresh CLI-authored golden fixtures**; the frozen `--hook/--event/--hooks/--json` contract snapshot; the `E308` legacy-format path; consumer round-trips + the capability/version-floor precheck.
- **Excluded**: exhaustive mermaid visual-diffing beyond byte-equality; performance benchmarking (not a stated NFR); any test asserting parity with the *old* hand-rendered shape (the renderer supplants it).
- **Mock usage**: **Real fixtures / in-memory fakes only** — the existing port + Fake adapter pattern (`FakeFs`, `FakeClock`, `FakeGit`); no mocking libraries.

### Documentation Strategy
- **Location**: **Hybrid (README + docs/how/)** — a `docs/how/` guide for the `harness flow` verbs + authoring custom flow types, plus README pointers; reconcile the stale npm-vs-GitHub-Packages docs.
- **Rationale**: a new public CLI verb family + user-authored flows need a discoverable guide; the README is the entry point.

### Complexity
- **Score**: CS-4 (large) — *down from CS-5 after the grill descope (onboarding + `flow agent` cut) and the two workshops de-risked the greenfield event log.*
- **Breakdown**: S=2, I=2, D=2, N=1, F=1, T=1 (sum 9 → CS-4)
- **Confidence**: 0.85
- **Assumptions**: the CLI architecture (acts/services/adapters, Envelope, ports) is stable; `the-flow` source is editable as part of this work (the user confirmed); no existing `--hook` consumer needs the contract to change; the harness-loop overlay is shipped schema-only (no driver in 024).
- **Dependencies**: the byte-stable hook contract (plan 021); the `gen:docs` pipeline; `flight-plan.schema.json` as the schema blueprint; the observe (`buffer-codec`) + record (`provenance`) precedents; workshops 001 + 002 (folded below).
- **Risks**: see `### Risks & Assumptions` and the implementation `### Risks` table.
- **Phases**: 3 (foundation engine → render + CI + docs → the-flow migration).

### Acceptance Criteria
- **AC-01**: `harness flow create <type> [--path|--plan-dir|--slug]` instantiates a flow JSON (default `docs/plans/<slug>/the-flow.json`, or `.harness/`, or a redirect) with `schema_version`, `kind`, `slug`, `cursor`, `created_at`, and a `provenance` block stamped (incl. `branch` = `created_from_branch`); returns an `ok` Envelope with the path as evidence. **By default it scaffolds the type's *template skeleton*** (the default node shape, e.g. flight-plan `research → plan → [assumed phase] → review → merge`), not a bare flow; **`--bare`** produces root + provenance only. The template resolves as a **sibling of the resolved schema** (`<dir>/<type>.template.json`), `--template <path>` overriding; instantiation **stamps root identity fields + deep-copies template nodes verbatim** (no templating engine). **(Workshop 003 T1/T2.)**
- **AC-02**: `harness flow new <type>` scaffolds a new flow **type** (a schema template) into `.harness/schemas/flows/<type>.schema.json` so users can invent their own flows.
- **AC-03**: A shared-core schema plus a per-flow custom overlay validate **distinct record types** (`kind` discriminator + `oneOf` node constraints; a wrong-flow node is rejected). Proven by **two** overlays: the bundled **harness-loop** overlay (Phase 1) and a second test-fixture overlay. The **status vocabulary is overlay-declared** — the core validates a node's status against *the resolved overlay's* declared set + transitions, not a hard-coded enum — and the fixture overlay carries a status value absent from harness-loop (e.g. `declined`) **plus** a populated optional `authority` tag, so the test proves the split is extensible (not just node-`type` discrimination). This is the forward-compat guard for the later adopt plan.
- **AC-04**: Every node carries `created_at`/`modified_at`/`ran_at` and an append-only `comments[]` where each comment has its own ISO-8601 `at` (`{at, text, source?, kind?, refs?}`); `harness flow comment --node <id> --text "<…>"` appends one and bumps `modified_at`.
- **AC-05**: An embedded `events[]` logs **built-in** events (`created`, `cursor-moved`, `status-changed`, `node-created`, `node-updated`) **automatically** when the corresponding mutation runs; `harness flow event <name> --kind manual|custom [--value <v>]` appends a public-manual or duck-typed custom event. Custom `type` is auto-selected by value shape (`bool|int|float|date|string`, leading-zero→string, `--type` overrides) and stored explicitly. Provenance is stamped **once** at the log root (reusing the record 7-key block); event ids use `<PREFIX>-<NNN>` (reusing observe's `nextId`).
- **AC-06**: `harness flow render` produces **byte-identical** mermaid + markdown from a given flow JSON across runs; `--check` exits non-zero on drift; a CI guard (`check:flows`) enforces committed `.md` parity against **fresh CLI-authored golden fixtures**; the renderer **tolerates unknown node types** (fallback class, never crashes). It is **not** required to reproduce the old hand-rendered shape. **The render surface (workshop 002 § Render surface + 003 DP2 + the 2026-06-18 render-surface decision)**: the node box carries **label + status** only; each node's **`user_input` renders as the one 🗣 genesis bubble** (the directive that created/first-directed the node — render rule 6, unchanged); **`comments[]` are NOT bubbled** — the node shows a **`💬N` count badge** and the **markdown body** (AC-06's previously-underspecified "markdown" half) carries a **per-node history log** (each node's `user_input`, `ran_at`, status, and full timestamped `comments[]`, source/kind-tagged); the **`decision` node type** renders with a distinct class (a labelled fork). User-supplied bubble/badge/log text is mermaid-safe-escaped (task 2.3). **The markdown body-log is render-only output — a pure function of the flow JSON, never parsed back; `comments[]` in the JSON is the single source of truth, and no consumer (incl. `the-flow`) depends on the rendered markdown shape** (closes the VPO accidental-exposure risk).
- **AC-07**: All mutations write atomically (temp + rename) and return the standard `Envelope` (`ok`/`error`/`unconfigured`) with correct exit codes (0/1/2) and `E3xx` error codes; a **write path** (`--path`/`--output`) outside the repo root is rejected via `isWithin` with `E303` + `next_action`. *(Containment guards **writes**; `--schema` is a deliberate out-of-repo **read** — see AC-11.)*
- **AC-08**: The byte-stable `--hook/--event/--hooks/--json` contract is unchanged — a frozen-snapshot sensor is a **two-checkpoint blocking gate** (baseline on unmodified `main` before Phase 1; re-run + must-pass after Phase 3). A **second snapshot** freezes the *new* `harness flow` Envelope `data` shapes (`create`/`show`/`event`) that the-flow will consume — baselined at end of Phase 1, re-run in 3.1 — since those become a consumer contract the instant Phase 3 lands. The `the-flow` `harness-seams.md` mirror check is a **manual cross-repo verification** (the mirror lives in the the-flow source repo, not vendored here — it cannot be a CI gate).
- **AC-09**: `the-flow` uses `harness flow` for all flow-state mutations (no hand-cranking); it **errors and stops** if the CLI is **absent OR too old to expose `flow`** (a capability/version-floor probe, e.g. `harness flow --help`/a min-version), with an honest `next_action` ("run `harness update`"); a repo need **not** be adopted to create flows.
- **AC-10**: The **harness-loop** overlay ships **bundled** with the CLI and is validated by tests as a second distinct record type (satisfying AC-03's split proof). It is **schema-only** — nothing in 024 creates or drives a harness-loop instance (that is the later `eng-harness-flow` work). CD-01 dual-authority resume *enforcement* moves to the onboarding/adopt plan, **but** the shared-core node schema reserves an **optional `authority` field** (`cursor | substrate`, default `cursor`, unused by the-flow/harness-loop) so the adopt plan populates it **without reshaping the core** (Finding 02b; forward-compat guard).
- **AC-11**: Built-in **harness-owned** schemas (shared-core + harness-loop) travel **bundled** with the CLI (a `gen:flows` step inlines them into a committed `.ts`, byte-stable, zero runtime fs). `the-flow`'s flight-plan schema is **owned + shipped by the `the-flow` skill** and supplied to the CLI via `--schema` (no second CLI copy → no drift). User custom schemas resolve `--schema <path>` › `.harness/schemas/flows/<type>.schema.json` › bundled built-in › `E304` not-found. **`--schema` deliberately resolves absolute out-of-repo paths** (the-flow's schema lives at `~/.claude/skills/the-flow/…`, outside the repo) and is therefore **exempt from `isWithin`** — guarded instead by canonicalize + JSON-only parse + a size cap. *(Supersedes workshop 001 §D4's bundled-built-in example list — per grill 6/7 the bundled set is **shared-core + harness-loop only**; flight-plan and adopt-flow are NOT CLI-bundled.)*
- **AC-12**: New CLI code passes `arch-check` (hexagonal), `skills-check` (any skill edits), and the existing vitest + `check:docs` guards. **024 does *not* touch `.minih.json`** — `the-flow` is user-global and never vendored (`no-vendor-the-flow`), and no *vendored* skill changes here; reconciliation applies only if a vendored skill is added/renamed (none).
- **AC-13**: Docs reconciled — a `docs/how/` guide for `harness flow` + custom-flow authoring, README pointers, and the stale GitHub-Packages→public-npm contradiction in `constitution.md` §4 / `architecture.md` §4 fixed; `the-flow`'s deleted hand-crank/render prose is replaced with a short "previous hand-cranked way; the CLI won't read old flows" legacy note.
- **AC-14**: A pre-CLI hand-written flow produces `E308 FLOW_LEGACY_FORMAT` with an honest `next_action` ("this looks like a pre-CLI hand-authored flow the CLI doesn't read — likely the cause, but it could be a bug"); **no** tolerant-load, lazy-upgrade, or migration. The detector keys on a **positive legacy signature** (a bare-integer `schema_version` and/or **absence of `provenance`**), **not** on an empty `events[]` — a freshly-`create`d flow with an empty log must **not** trip `E308`. (Distinct from the CLI's preserved *intra-format* tolerance of its own log entries.) **024's own `the-flow.json` is an accepted clean-break casualty** — it stays hand-cranked to completion and is not migrated (consistent with grill decision 3); nobody runs `harness flow` against it.
- **AC-15**: `harness flow insert-node --id <id> --type <t> --label <l> (--after|--before|--branch-of <target>)` inserts a node and **splices `next[]` deterministically** so the agent never hand-recomputes edges: **`--after X`** moves X's out-edges to the new node (`N.next = old X.next`, `X.next = [N]`); **`--before X`** moves X's in-edges (each predecessor `X→N`, `N.next = [X]`); **`--branch-of X`** adds a dotted excursion (`N.branch_of = X`, `N.next = [X]` or `--rejoin <id>`, **`X.next` unchanged**). The result is **re-checked as a DAG before the atomic write** — a cycle/orphan/illegal splice is rejected with **`E309 FLOW_EDGE_INVALID`** and nothing lands; the placement flags are mutually exclusive (`E108` otherwise) and a missing target → `E305`. Each splice fires `node-created` + **one `node-updated` per rewired edge** carrying `edge_op` (`splice-after|splice-before`) in `details{}` — **no new built-in event kind** (reuses workshop 002's set). It is a **distinct verb from `add-node`** (the only verb that mutates *existing* nodes' edges). **(Workshop 003 I1–I4.)**

### Risks & Assumptions
- **Consumer blast radius (CD-02)**: `the-flow` + `eng-harness-flow` mirror the byte-stable `--hook/--event/--hooks/--json` contract; any drift breaks them. Mitigation: contract-snapshot sensor (Phase 1) lands *before* any consumer change; migration is additive + reversible.
- **`the-flow` is a separate, user-controlled repo** — source at `~/github/tools/skills/SDD/the-flow/`, deployed to `~/.claude/skills/the-flow/`. Phase 3 edits the *source* (in-scope) → a **cross-repo change + a deploy step**. Mitigation: keep migration behind a clean CLI boundary so it's revertible; deploy after the CLI lands. (Per the no-vendor rule, `the-flow` is never copied into this repo.)
- **Skill/CLI version skew**: `the-flow` (global skill) and the CLI (global npm) ship independently; a new `the-flow` on an old CLI would hard-fail. Mitigation: the capability/version-floor precheck (AC-09) + an honest "run `harness update`" message; no lockstep release.
- **Event log is greenfield (CD-03)**: now **resolved by workshop 002** (two surfaces, three tiers, duck-typing algorithm, provenance/id reuse). Residual risk low.
- **Clean break (no back-compat)**: old flows error (AC-14). Mitigation: a *good, honest* error that hedges (could be legacy, could be a bug); documented in the docs/how guide + the-flow legacy note.
- **CI traps**: `check:docs`/`gen:docs`, `just test`=vitest-only, `arch-check`, `skills-check`, `.minih.json`. Mitigation: run `npm run build` + `check:docs` locally; reconcile `.minih.json`.

### Open Questions
- ~~Does version-gated JSON-Schema validation ship in v1?~~ **Resolved: yes, ships gated** (task 1.10, `E306`).
- Staleness/concurrency/archive of completed flows? **Resolved posture: last-writer-wins** (atomic temp+rename prevents corruption, not logical clobber — accepted for the migration window); archive-on-completion deferred (out of scope this plan).

### Workshop Opportunities

| Topic | Type | Status |
|-------|------|--------|
| The full `harness flow` CLI surface | CLI Flow | ✅ **Done** — `workshops/001-harness-flow-cli-surface.md` (Contract Ready); folded below |
| Event + comment taxonomy | Data Model + State Machine | ✅ **Done** — `workshops/002-event-and-comment-taxonomy.md` (Contract Ready); folded below |
| Templates, node insertion + decision points | Data Model + State Machine + CLI Flow | ✅ **Done** — `workshops/003-templates-insertion-decision-points.md` (Contract Ready); folded below (v1.2.0) |

### Clarifications
#### Session 2026-06-17 (initial)
- **Workflow Mode** → **Full**; **Testing** → **Full TDD**; **Mock Usage** → **Real fixtures / fakes only**; **Documentation** → **Hybrid**.

#### Session 2026-06-17 (workshops + grill — folded into v1.1.0)
- **Workshop 001 (CLI surface)**: single core `flow` act + Commander subcommand group (the first nested group; other acts stay flat); `new`=author a flow type / `create`=instantiate (matches existing `harness new`); fine-grained atomic mutations (`cursor`/`status`/`add-node`/`set-node`/`comment`/`event`), **not** a coarse `advance`; flow-file precedence `--path › --plan-dir › discovery` + `isWithin`; schema precedence `--schema › .harness/schemas/flows/ › bundled`; `E300–E307`.
- **Workshop 002 (event + comment taxonomy)**: two surfaces (root `events[]` machine facts vs per-node `comments[]` narrative); three event tiers (built-in/engine-fired, public-manual, custom-duck-typed); duck-typing algorithm; durations **derived** at read time; provenance stamped once (record 7-key reuse; `branch`=`created_from_branch`); event id `<PREFIX>-<NNN>` (observe reuse); comment shape `{at,text,source?,kind?,refs?}`; tolerant/append-only.
- **Grill (8 decisions)**: (1) goal = deterministic *mechanics*, not routing; (2) no external enforcement of good usage (risk accepted); (3) no back-compat — old flows error (`E308`) + delete the-flow's hand-crank/render prose; (4) `flow agent` → v2; (5) capability/version-floor check, not presence-only; (6) drop onboarding/adopt → separate plan; two defaults = the-flow (skill-shipped schema) + harness-loop (CLI-bundled); (7) the-flow tells the CLI where its schema is (`--schema`); single owner, no drift; (8) renderer/schema supplant the prototype — free to drift, golden = fresh fixtures.

#### Session 2026-06-18 (workshop 003 + render-surface decision — folded into v1.2.0, direct amend)
- **Workshop 003 (templates, node insertion, decision points)**: (T) `flow create` scaffolds the type's **template skeleton** by default (`--bare` opts out); template = a sibling of the schema, stamp-root-not-substitute. (I) **`insert-node`** is a distinct verb that **splices edges for the agent** — `--after` moves out-edges, `--before` moves in-edges, `--branch-of` adds a dotted excursion; DAG-rechecked before write (**`E309`**); audited via `node-created` + per-edge `node-updated{edge_op}` (no new event kind). (D) a **`decision` node type** = ≥2 `next[]` heading serial sub-flows, **zero new schema fields** (chosen-ness via successor status; un-taken stays `assumed`, or `declined` via the overlay-declared status vocab — the first real consumer of the Finding 02b forward-compat hook). All additive; no new phase.
- **Render-surface decision (2026-06-18)**: the rendered `the-flow.md` keeps today's clean look — node box = label + status; **one 🗣 bubble per node = the genesis `user_input`** (the directive that created/first-directed it); **`comments[]` = a `💬N` count badge** on the node + **full timestamped text in the markdown body log** (source/kind-tagged). Closes the gap that no render rule covered `comments[]` (they were JSON-only). Baked in, no flag. Folds into workshop 002 (new § Render surface) + Phase 2 render rules + AC-06 + task 2.2.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: **none — both folded** (CLI surface 001, event taxonomy 002).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (CD-01..CD-05, CLI readiness, gen:docs precedent, corpus review) |
| workshops/001-harness-flow-cli-surface.md | y | **authoritative** — verb/flag surface + E3xx + schema precedence |
| workshops/002-event-and-comment-taxonomy.md | y | **authoritative** — event/comment data model + duck-typing + provenance/id reuse |
| docs/project-rules/constitution.md | y | G2 active; §4 npm-vs-GitHub-Packages contradiction to reconcile (AC-13) |
| docs/project-rules/architecture.md | y | G3 active; hexagonal rules the flow code must obey |
| docs/adr/*.md | n | G4 N/A |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Two sessions complete; no `[NEEDS CLARIFICATION]`; both workshops folded |
| G2 | Constitution | PASS | Follows hexagonal/ports doctrine; §4 distribution stale-doc is a *docs reconciliation task* (AC-13), not a violation |
| G3 | Architecture | PASS | New code obeys acts-thin / services-pure / ports; `arch-check` enforces in CI |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present and populated |
| G6 | Testing Alignment | PASS | Full TDD — every phase orders test tasks before implementation; ACs measurable |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry → scaffolding N/A; Target Domains present; Domain Manifest covers every referenced file |

### Summary
Build a `harness flow` verb family that becomes the single deterministic owner of flow **mechanics** — schema, atomic mutations, an embedded event log + node comments + datetime, and a byte-stable renderer — driven by a shared-core schema with per-flow custom overlays. Land the engine + the bundled harness-loop overlay first (with a contract-snapshot safety sensor and the `E308` clean-break path), then the deterministic renderer + CI parity guard + the docs sweep, then migrate `the-flow` onto the engine (shipping its own flight-plan schema, hard-requiring a capable CLI, reversibly). The system supplants the hand-cranked prototype without disturbing the byte-stable hook contract its consumers mirror.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/acts/flow.ts` | harness-cli·flow | contract | The `flow` command (subcommand dispatcher); thin wiring only |
| `harness/cli/src/services/flow/flow-service.ts` | harness-cli·flow | internal | Create/new/show/list + state I/O logic (pure, ports-injected) |
| `harness/cli/src/services/flow/flow-schema.ts` | harness-cli·flow | contract | Shared-core + overlay types; schema loading/resolution (`--schema › .harness/schemas/flows/ › bundled`) |
| `harness/cli/src/services/flow/flow-mutations.ts` | harness-cli·flow | internal | cursor/status/add-node/set-node/**insert-node**/comment mutations + built-in event firing (incl. the splice edge-algebra + DAG re-check) |
| `harness/cli/src/services/flow/flow-events.ts` | harness-cli·flow | internal | Event log + duck-typed custom events + comments + datetime (reuses observe id + record provenance shapes) |
| `harness/cli/src/services/flow/flow-renderer.ts` | harness-cli·flow | internal | Deterministic mermaid + markdown render (tolerates unknown types) |
| `harness/cli/src/services/flow/schemas/*.schema.json` | harness-cli·flow | contract | Bundled **harness-owned** schemas (flow shared-core, harness-loop) |
| `harness/cli/src/services/flow/schemas-content.ts` | harness-cli·flow | contract | Generated bundle (`gen:flows`); byte-stable, CI-guarded |
| `harness/cli/src/output/error-codes.ts` | harness-cli·output | cross-domain | Add `E3xx` flow error block (E300–E308) |
| `harness/cli/src/app.ts` | harness-cli | cross-domain | Register `registerFlowAct`; reserve `flow` as a core command |
| `scripts/gen-flows.mjs` | harness-cli·flow | internal | Build-time schema inliner (mirrors `gen-docs.mjs`) |
| `harness/cli/test/acts/flow.test.ts`, `test/services/flow/*` | harness-cli·flow | internal | TDD coverage (Fake adapters + fixtures) |
| `harness/cli/test/contract/hooks-snapshot.test.ts` | harness-cli·flow | internal | Frozen `--hook/--event/--hooks/--json` snapshot sensor |
| `~/github/tools/skills/SDD/the-flow/**` (source; deploys to `~/.claude/skills/the-flow`) | the-flow | cross-domain | Migrate to call `harness flow`; ship + point at its own flight-plan schema; capability precheck; delete hand-crank/render prose |
| `docs/how/harness-flow.md` | docs | contract | The `harness flow` + custom-flow authoring guide |
| `docs/project-rules/constitution.md`, `architecture.md` | docs | cross-domain | Reconcile §4 GitHub-Packages→public-npm |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **CD-02 blast radius** — `the-flow` + `eng-harness-flow` mirror the byte-stable `--hook/--event/--hooks/--json` contract | Land a frozen contract-snapshot sensor in Phase 1 *before* any consumer touch; re-run after Phase 3; keep migration additive + reversible |
| 02 | High | **Clean break (grill 3/8)** — old hand-written flows are a prototype being supplanted, not a compatibility target | `E308` honest error keyed on a *positive* legacy signature (not empty `events[]`); **no** tolerant-load/migration; delete the-flow's hand-crank/render prose + leave a legacy note |
| 02b | High | **Forward-compat (validate-v2 FC ❌)** — a closed shared-core status enum + a dropped CD-01 authority tag would force the *already-staged adopt plan* to breaking-reshape the core | Make the status vocabulary **overlay-declared** + reserve an **optional `authority` field** in the shared core; prove both via the Phase-1 fixture overlay (AC-03/AC-10). No adopt features ship — only the extension room |
| 03 | High | **CD-03/03b resolved by workshop 002** — two timestamped surfaces (`events[]` + `comments[]`), datetime as queryable fields, durations derived | Implement per workshop 002; reuse observe `buffer-codec` id format + record `provenance` 7-key block; keep `.the-flow-state.json` minimal |
| 04 | High | **CLI architecture + precedents are ready** — acts/services/adapters, Envelope, ports, error-codes, POSIX paths, `gen:docs`, observe id, record provenance | Follow the patterns exactly; `flow` is a core reserved command; reuse, don't reinvent |
| 05 | High | **Schema split + ownership (grill 6/7)** — harness-owned schemas bundle in the CLI; the-flow owns + ships its flight-plan schema (`--schema`) | `gen:flows` bundles shared-core + harness-loop only; the-flow supplies flight-plan via `--schema`; no second copy |
| 06 | High | **`gen:docs → docs-content.ts → git diff --exit-code` is the render-parity precedent** | Mirror as `gen:flows`/`check:flows`; golden = **fresh CLI-authored fixtures** (renderer supplants the old shape, grill 8) |
| 07 | High | **CD-05 + version skew** — the-flow hard-requires a *capable* CLI (not just present), shipping independently of it | Capability/version-floor precheck → error-and-stop with "run `harness update`"; no adoption required |
| 08 | Medium | **Corpus review** — `agents[]` real (8/20) but pure bookkeeping; `validation` ad-hoc node type seen (3/20) | `flow agent` deferred to v2; renderer must tolerate unknown node types (Phase 2) |

### Phases

> **Phasing rationale ("fewest phases that hold")**: 3 phases, each a real dependency boundary *and* an independently-reviewable checkpoint. The event log + comments + datetime fold into the foundation (Phase 1) as the **data model** — a cohesive schema can't be half-shipped. Render + CI parity + the docs sweep share Phase 2 (the CLI is feature-complete there, so it's the natural place to document it; docs is small, folded per the principle). The `the-flow` migration (Phase 3) is isolated because it is the riskiest change and touches an external skill — worth its own clean review. Onboarding/`flow agent`/the routing Graph are out of scope (grill), which is what dropped this from the prior 4-phase / CS-5 shape to 3 / CS-4.

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Flow engine: schema, state, mutations, event log | harness-cli·flow | Deterministic create/mutate/state-I/O + full data model (events, comments, datetime) + bundled harness-loop overlay + contract sensor + `E308` clean break | None |
| 2 | Deterministic render + CI parity + docs | harness-cli·flow | `harness flow render` byte-identical + `check:flows` guard + `docs/how` guide + stale-doc reconcile | Phase 1 |
| 3 | `the-flow` migration onto the CLI | the-flow | `the-flow` consumes `harness flow`; ships its own schema; capability precheck; deletes hand-crank prose; reversible deploy | Phases 1–2 |

#### Phase 1: Flow engine — schema, state, mutations, event log
**Objective**: Stand up the `harness flow` verb family as the deterministic owner of flow mechanics, with the full data model (events, node comments, datetime), the bundled harness-loop overlay, a contract-snapshot safety sensor, and the `E308` clean-break path.
**Domain**: harness-cli·flow
**Delivers**: shared-core `flow.schema.json` (incl. the `decision` node type) + harness-loop overlay (bundled); `flow` act (core, reserved); `services/flow/*`; atomic state I/O; `flow create` (template-scaffolded, `--bare`) `/new/show/list/cursor/status/add-node/set-node/`**`insert-node`**`/comment/event`; built-in event auto-firing (incl. `node-updated{edge_op}` for splices); duck-typed custom events; provenance/id reuse; `E300–E309`; optional version-gated validation; the frozen `--hook/--event/--hooks/--json` snapshot sensor.
**Depends on**: None.
**Key risks**: Cohesive-but-large first phase — mitigated by clear task groups + TDD. Touching `error-codes.ts`/`app.ts` is additive only.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Tests: frozen contract-snapshot sensor for `--hook/--event/--hooks/--json` — **created, committed, passing on unmodified `main` BEFORE any of 1.2–1.13**; **plus** a second snapshot of the new `harness flow` Envelope `data` shapes (`create`/`show`/`event`) baselined at end of Phase 1 | harness-cli·flow | Hook snapshot captures current bytes (blocking gate, re-run in 3.1); flow-Envelope `data` shapes frozen for the-flow to consume | Finding 01; two-checkpoint gate; Risk-agent #4 |
| 1.2 | Tests: schema validation — shared-core + **two** distinct overlays (harness-loop + a fixture overlay) incl. `kind` discriminator + `oneOf` node constraints (a wrong-flow node is rejected); **the fixture overlay declares a status absent from harness-loop (e.g. `declined`) + a populated `authority` tag, asserting the core accepts overlay-declared statuses + the reserved tag**; **the `decision` node type validates** (workshop 003); state I/O round-trip; atomic temp+rename | harness-cli·flow | Failing tests define the schema + distinct-record-types proof + **extensibility proof** (overlay-owned status vocabulary + authority slot) + the `decision` type + atomic-write contract | Findings 03/05; AC-03/AC-10/AC-15; FC-agent fix; ws-003 |
| 1.2a | Tests: path containment — a **write path** (`--path`/`--output`) outside the repo root rejected via `isWithin` with `E303` + `next_action`; **`--schema` is NOT subject to `isWithin`** (out-of-repo skill schemas are allowed) | harness-cli·flow | Write-escape paths rejected; in-repo write redirects + out-of-repo `--schema` reads accepted | Security; AC-07; Risk-agent #9 |
| 1.2b | Tests: schema resolution precedence — `--schema <path>` (incl. **absolute out-of-repo**, canonicalized + JSON-only + size-capped) › `.harness/schemas/flows/<type>.schema.json` › bundled built-in (**shared-core + harness-loop only**) › **`E304`** | harness-cli·flow | All four resolution branches covered; out-of-repo `--schema` resolves | AC-11/AC-02; workshop 001 §D4 *(bundled-list superseded by grill 6/7)* |
| 1.2c | Tests: `E308 FLOW_LEGACY_FORMAT` — a pre-CLI hand-written flow (bare-integer `schema_version` and/or **absent `provenance`**) is rejected with an honest hedging `next_action`; **a freshly-`create`d flow with an empty `events[]` must NOT trip `E308`**; no tolerant-load | harness-cli·flow | Legacy fixture → `E308`; new-empty-flow fixture → ok; intra-format log tolerance preserved | AC-14; grill 3/8; Risk-agent #2 |
| 1.3 | Tests: mutations fire built-in events; `comment` appends a timestamped entry; datetime trio stamped via `Clock`; provenance stamped once at the root (`branch`=`created_from_branch`) | harness-cli·flow | `events[]`/`comments[]` populated; `created_at` at create, `modified_at` every mutation, **`ran_at` on `in_progress→done`/`blocked`**; provenance = record 7-key block | Findings 03/04; AC-04/AC-05; workshop 002 §E2/E5 |
| 1.3a | Tests: **`insert-node` edge algebra** — `--after X` (out-edges move to N), `--before X` (in-edges move to N, incl. **multi-predecessor**), `--branch-of X` (excursion, `X.next` unchanged, `--rejoin`); **post-splice DAG re-check rejects a cycle/orphan with `E309`** (nothing written); mutually-exclusive placement flags (`E108`); fires `node-created` + per-edge `node-updated{edge_op}` | harness-cli·flow | Each mode's `next[]` rewiring asserted incl. multi-edge cases; cycle rejected pre-write; audit events carry `edge_op` | AC-15; workshop 003 I2–I4; **E309 verified free (`error-codes.ts` ≤E204)** |
| 1.4 | Tests: duck-typed `flow event` — `type` auto-selected by value shape (`boolean`→bool; ISO-8601-UTC→date; `^-?(0|[1-9]\d*)$`→int; fractional→float; else string; leading-zero→string; `--type` overrides) and **stored explicitly**; event id `<PREFIX>-<NNN>` via observe's `nextId` | harness-cli·flow | Each branch covered; `type` + id persisted | Finding 03; workshop 002 §E3/E6 |
| 1.5 | Implement shared-core `flow.schema.json` (incl. the **optional `authority` field** + **overlay-declared status vocabulary** hooks) + harness-loop overlay + `flow-schema.ts` loader (resolves `--schema`/`.harness/schemas/flows/`/bundled) | harness-cli·flow | 1.2/1.2b pass; overlays validate distinct record types; status validated against the *resolved overlay's* declared set, not a hard-coded enum | AC-03/AC-10/AC-11; FC-agent fix |
| 1.6 | Implement `flow-service.ts` (create/new/show/list) + atomic state I/O (temp+rename); **`create` resolves the type's template (sibling of the schema, `--template` override), deep-copies its nodes verbatim + stamps root identity; `--bare` = root-only** | harness-cli·flow | 1.2 pass; `create` stamps schema_version/kind/slug/cursor/created_at/provenance **and scaffolds the template skeleton (or `--bare`)**; `new` scaffolds a schema template into `.harness/schemas/flows/` (name-validated, `--force`); `show`/`list` round-trip read + discovery (read-only verbs) | AC-01/AC-02/AC-07; workshop 003 T1/T2; Coherence-agent #3/#4 |
| 1.7 | Implement `flow-mutations.ts` (cursor/status/add-node/set-node/comment **+ `insert-node`**) + built-in event firing | harness-cli·flow | 1.3/1.3a pass; events auto-logged incl. **`node-updated` on `set-node`/`comment`/`insert-node`** (insert carries `edge_op`); **`insert-node` implements the 3-mode edge algebra + pre-write DAG re-check (`E309`)**; `cursor --recommend` sets `recommended_next` **without** moving the cursor; `modified_at`/`ran_at` set | AC-04/AC-05/AC-15; workshop 002 §E2; workshop 003 I2–I4 |
| 1.8 | Implement `flow-events.ts` (event log + duck-typed custom events + comments + duration-source timestamps) | harness-cli·flow | 1.4 pass; durations derivable at read time (not stored) | AC-05; workshop 002 §E4 |
| 1.9 | Wire `acts/flow.ts` (subcommand dispatcher, Envelope, `E3xx`) + register in `app.ts` + reserve `flow` | harness-cli·flow | `harness flow …` returns correct Envelope + exit codes | AC-07; workshop 001 §D1 |
| 1.10 | Version-gated schema validation (`schema_version` major-reject → `E306`) — **ships gated** (Open Question resolved) | harness-cli·flow | Unknown major rejected with `E306` | Open Question → resolved |
| 1.11 | Allocate + document the `E3xx` flow block in `error-codes.ts` (`E300` schema-invalid, `E301` not-found, `E302` write-failed, `E303` path-escape, `E304` type-unknown, `E305` node-not-found **or** illegal-transition *(one code, two related causes — intentional, documented)*, `E306` schema-version, `E307` ambiguous-target, `E308` legacy-format, **`E309` edge-invalid (insert-node cycle/orphan/illegal splice)**) | harness-cli·flow | Codes defined (E300–E309 verified free in `error-codes.ts` — allocated only ≤E204); each error path returns the right code + `next_action` | AC-07/AC-14/AC-15; additive; ws-003 |
| 1.12 | Implement `scripts/gen-flows.mjs` + `schemas-content.ts` bundle for **harness-owned** schemas (shared-core + harness-loop); change the root `build` script to `gen:docs && gen:flows && tsc`; **land 1.12 with/before 1.5** so the bundled-resolution branch is testable | harness-cli·flow | Harness-owned schemas bundled; `build` regenerates before `tsc`; bundle exists before the loader test | AC-11; mirrors `gen:docs`; Coherence-agent #7 (`check:flows` CI guard in 2.4) |

#### Phase 2: Deterministic render + CI parity + docs
**Objective**: Replace by-hand mermaid with a pure `harness flow render`, guard committed `.md` as a derived artifact, and document the now-complete CLI surface.
**Domain**: harness-cli·flow; docs
**Delivers**: `flow-renderer.ts` (all render rules, tolerates unknown types; **the genesis `user_input` bubble + `comments[]` `💬N` badge + per-node markdown body-log + `decision`-node class**); `harness flow render [--input|--output|--check]`; `check:flows` script + CI wiring; `docs/how/harness-flow.md`; README pointers; the §4 stale-doc reconcile.
**Depends on**: Phase 1 (stable data model + `gen:flows` bundle).
**Key risks**: Byte-stability across OS/format — mitigated by golden-file tests (fresh CLI-authored) + biome formatting (the `gen:docs` precedent).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Tests: golden-file render parity (mermaid+markdown) from **fresh CLI-authored fixtures** (incl. a re-rendered 024), regenerated via a documented command — **never hand-edited**; `--check` drift exits non-zero | harness-cli·flow | Failing tests pin byte-identical output + drift detection; **no** assertion of parity with the old hand-rendered shape; fixtures are CLI artifacts | Finding 06; AC-06; grill 8; Risk-agent #8 |
| 2.2 | Tests: all render rules — classDefs; spine (incl. **phase-node** styling); excursions; harness-node conditional; status class; **`user_input` genesis bubble (one per node)**; **`comments[]` → `💬N` count badge on the node + per-node markdown body-log (timestamped, source/kind-tagged)**; **`decision` node type → distinct class (labelled fork)**; **agents subgraph (via a pre-populated fixture — no v1 writer)**; legend; rail; **unknown node `type` → fallback class (never crash)**; **an adversarial fixture (mermaid/markdown/newline chars in `text`/`value`/`label`/comment text)** | harness-cli·flow | All render rules + comment-badge/body-log + `decision` render + unknown-type tolerance + adversarial-input safety covered | dossier render checklist; Findings 08; Risk-agent #10; workshop 002 § Render surface; workshop 003 DP2 |
| 2.3 | Implement `flow-renderer.ts` (all rules, **mermaid-safe escaping of user-supplied `text`/`value`/`label`**) + `flow render` | harness-cli·flow | 2.1/2.2 pass; output deterministic + visually faithful (best-fit, not byte-matched to the prototype); adversarial input cannot corrupt the `.md` | AC-06; Risk-agent #10 |
| 2.4 | Add a distinct **`check:flows`** npm script (`gen:flows && git diff --exit-code …schemas-content.ts` + `flow render --check` over committed fixtures) as its **own CI step after the "check:docs" step** (mirroring it, not folded into `build`); document the **run `npm run build` before `vitest`** rule (golden fixtures come from the built CLI) | harness-cli·flow | CI green; distinct check:flows step; trap documented; no `check:docs` regression | AC-12; mirrors `gen:docs`; Risk-agent #6 |
| 2.5 | Write `docs/how/harness-flow.md` (verbs + custom-flow authoring + the legacy/clean-break note) + README pointers | docs | Guide covers create/new/render/mutations/events/comments + how the-flow ships its own schema | AC-13 |
| 2.6 | Reconcile `constitution.md` §4 / `architecture.md` §4 GitHub-Packages→public-npm | docs | Stale contradiction fixed | AC-13 |

#### Phase 3: `the-flow` migration onto the CLI
**Objective**: Make `the-flow` a consumer of the engine — call `harness flow` for all flow-state mutations, ship + point at its own flight-plan schema, hard-require a *capable* CLI, delete the now-redundant hand-crank prose, keep it reversible.
**Domain**: the-flow (separate user-controlled repo: `~/github/tools/skills/SDD/the-flow/`)
**Delivers**: `the-flow` guided-mode writes via `harness flow`; a capability/version-floor precheck (error-and-stop + "run `harness update`"); the-flow's flight-plan schema shipped with the skill + supplied via `--schema`; "no adoption required" path; deletion of the hand-crank cadence + 8 mermaid render rules (CLI owns them) + a short legacy note; `harness-seams.md` mirror re-verified; the updated skill deployed.
**Depends on**: Phases 1–2.
**Key risks**: Cross-repo edit + deploy + contract blast radius (Finding 01) — mitigated by the 1.1 sensor + additive/reversible cutover.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Tests: contract-snapshot sensor (1.1, both snapshots) re-run + must-pass; `harness-seams.md` mirror byte-match as a **manual cross-repo step** (the mirror is in the the-flow source repo, not CI-reachable here) | the-flow | Hook + flow-Envelope snapshots pass post-migration; mirror parity manually verified | AC-08; Risk-agent #5 |
| 3.2 | Tests: `the-flow` create/mutate round-trips via `harness flow` (supplying its flight-plan schema via `--schema`); CLI-absent **or too old** → errors-and-stops with remediation | the-flow | Failing tests define the consumer contract + the capability-floor abort path | AC-09; CD-05 |
| 3.3 | Replace the **state-mutation hand-crank** (prose steps that edit `the-flow.json`) with `harness flow` calls (cursor/status/add-node/set-node/comment **+ `insert-node` for phase-reveal + workshop/fix-loop excursions, replacing hand edge-recomputation**); **delete** the hand-crank cadence + the mermaid render rules from the references (the CLI owns them, **incl. the genesis-bubble + comment-badge/body-log render surface**); the-flow **ships the create-seed template** alongside its schema; the routing **Graph in `00-routing.md` stays prose, unchanged** | the-flow | Guided mode mutates (incl. inserts) + renders via CLI; render-rule/cadence prose removed; create-seed shipped; Graph untouched | AC-09/AC-13; CD-02; ws-003 |
| 3.4 | Add the **capability/version-floor** precheck (probe `harness flow --help`/min-version; error-and-stop with "run `harness update`") + "no adoption required" flow creation + a short legacy note. **Deploy order = CLI first, then skill**; document the reverse-skew case (old the-flow + new CLI → the old hand-crank's writes hit `E308` on read — a clean stop, not silent divergence) | the-flow | Absent/too-old CLI → clean honest stop; reverse-skew documented; flows created in `docs/plans/<slug>/` without adoption; legacy note present | AC-09/AC-13; grill 5/3; Risk-agent #3 |
| 3.5 | Ship the-flow's flight-plan schema with the skill; verify the CLI resolves it via `--schema` | the-flow | `the-flow` flows validate against shared-core + its skill-shipped overlay; no second CLI copy | AC-11; grill 6/7 |
| 3.6 | Deploy: publish/copy the updated `the-flow` source to `~/.claude/skills/the-flow/`; verify a fresh load works; **rollback = revert the skill + `harness update --pin <prev>`** to drop the published CLI back (the CLI is a global npm package; the cutover is additive/reversible) | the-flow | Updated skill deployed + verified; concrete rollback (skill revert + CLI pin) documented | cross-repo deploy; Risk-agent #3 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.6 | `flow create` stamps schema_version/kind/slug/cursor/created_at/provenance + scaffolds the template skeleton (or `--bare`); ok Envelope |
| AC-02 | 1.6, 1.2b | `flow new` scaffolds a flow type into `.harness/schemas/flows/`; resolution covers it |
| AC-03 | 1.2, 1.5 | discriminator enforced; shared-core + two distinct overlays |
| AC-04 | 1.3, 1.7 | datetime trio (incl. `ran_at`) + `comments[]` with `at`; `flow comment` |
| AC-05 | 1.3, 1.4, 1.7, 1.8 | built-in event auto-firing; duck-typed `flow event`; provenance once; id reuse |
| AC-06 | 2.1, 2.2, 2.3, 2.4 | byte-identical render; `--check` drift; unknown-type tolerance; fresh-fixture golden; genesis `user_input` bubble + `comments[]` badge/body-log + `decision` class |
| AC-07 | 1.6, 1.9, 1.2a, 1.11 | atomic writes; Envelope + exit codes; path containment; `E3xx` block |
| AC-08 | 1.1, 3.1 | contract snapshot sensor (two-checkpoint); mirror parity |
| AC-09 | 3.2, 3.4 | consume CLI; capability/version-floor error-and-stop; no-adoption path |
| AC-10 | 1.2, 1.5, 1.12 | harness-loop overlay bundled + validated as a distinct record type; schema-only (no driver) |
| AC-11 | 1.2b, 1.5, 1.12, 3.5 | bundled harness-owned schemas (`gen:flows`); the-flow ships flight-plan via `--schema`; resolution precedence |
| AC-12 | 2.4 | arch-check/skills-check/vitest/check:docs; `.minih.json` |
| AC-13 | 2.5, 2.6, 3.3, 3.4 | docs/how guide + README + §4 reconcile; deleted prose + legacy note |
| AC-14 | 1.2c, 1.11 | `E308` legacy-format with honest hedging `next_action`; no migration |
| AC-15 | 1.3a, 1.7, 1.11 | `insert-node` 3-mode edge algebra; pre-write DAG re-check (`E309`); `node-created` + per-edge `node-updated{edge_op}` |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hook contract drift breaks `the-flow`/router mirror | Medium | High | Frozen snapshot sensor (1.1) lands first; re-run post-migration (3.1); additive/reversible cutover |
| `the-flow` is a separate repo (cross-repo edit + deploy) | Medium | Medium | Source is user-controlled; migration behind a clean CLI boundary; reversible; deploy after the CLI lands; separately-reviewable phase |
| Skill/CLI version skew (new the-flow on old CLI) | Medium | High | Capability/version-floor precheck (3.4) → honest "run `harness update`"; independent ship, no lockstep |
| Clean break confuses users hitting `E308` on old flows | Medium | Low | Honest hedging error (could be legacy / could be a bug); documented in docs/how + the-flow legacy note |
| Render byte-parity drift (OS / Node / mermaid version) | Medium | High | Fresh-fixture golden tests; biome formatting; `check:flows` CI guard; `render --check` |
| CI green-local/red-CI (`check:docs`/`check:flows`, `.minih.json`, arch-check) | High | Medium | Run `npm run build` (runs `gen:flows`) before `vitest` locally; reconcile `.minih.json`; arch-check in CI |
| Phase 1 cohesive-but-large | Medium | Medium | Clear task groups; TDD; the data model is genuinely one schema (can't ship half) |
| Frozen-wrong core blocks the adopt plan (closed status enum / no authority slot) | Medium | High | Overlay-declared status vocabulary + reserved optional `authority` field, both proven by the Phase-1 fixture overlay (Finding 02b; AC-03/AC-10) |
| New `harness flow` Envelope `data` shapes drift before Phase 3 consumes them | Medium | High | Second frozen-snapshot of the flow Envelope shapes, baselined end of Phase 1, re-run in 3.1 (AC-08) |
| `--schema` reads an arbitrary out-of-repo file (escape/parse vector) | Low | Medium | `--schema` exempt from `isWithin` by design (skill-home schema) but canonicalized + JSON-only parsed + size-capped (AC-11; task 1.2a/1.2b) |
| User-supplied comment/event text corrupts the rendered mermaid | Low | Medium | Mermaid-safe escaping of `text`/`value`/`label` + an adversarial golden fixture (tasks 2.2/2.3) |
| `insert-node` splice corrupts the DAG (cycle/orphan) | Low | Medium | Post-splice DAG re-check **before** the atomic write rejects with `E309` (nothing lands); every splice audited via `node-created` + per-edge `node-updated{edge_op}` (tasks 1.3a/1.7; AC-15) |
| Comment volume bloats the rendered diagram | Low | Low | `comments[]` render as a `💬N` badge + markdown body-log, **not** bubbles — only the single genesis `user_input` bubbles (render-surface decision; task 2.2) |

---

## Validation Record (v1.1.0 — 2026-06-17)

### Validation Thesis
**Raison d'être**: Sequence a CS-4 build moving flow **mechanics** (mutation/history/render) into a deterministic `harness flow` CLI — **not** automated routing — without breaking the byte-stable `--hook/--event/--hooks/--json` contract, **supplanting** (not preserving) the hand-cranked prototype.
**Value claim**: A 3-phase, dependency-clean, TDD-first sequence folding two authoritative workshops + 8 grill decisions, with measurable ACs + named risks, so implementers don't re-derive scope or break consumers.
**Proof target**: Implementation. **Beneficiaries**: tasks/implement agents, reviewers, the-flow maintainers, the later adopt/eng-harness-flow plan.
**Thesis source**: research-dossier.md, workshops 001/002, the 8 grill decisions (the-flow.json `plan`/`ws-cli` comments), this plan's Business Specification.
**Thesis verdict**: **Advanced** at the Implementation proof target; evidence Strong (grounded in a 20-flow corpus + real reused precedents — observe `nextId`, record provenance, `gen:docs` parity — and a self-dogfooded comment shape).

### Agents (broad, 4)

| Agent | Verdict | Issues → disposition |
|-------|---------|----------------------|
| Coherence + Completeness | PASS WITH FIXES | 12 issues — `node-updated`/`--recommend` in tasks, `new`/`show`/`list` test+AC coverage, 1.12-before-1.5 ordering, version-gated OQ resolved, E305-overload documented → **fixed**; CS-4 + phase boundary **confirmed sound** |
| Risk + Deployment/Ops | APPROVE WITH FIXES | `E300–E308` free + `flow` registers cleanly **(both code-facts verified)**; E308 false-positive on empty log, reverse version-skew + `--pin` rollback, flow-Envelope snapshot, `--schema` escape, render injection, CI wiring, `.minih.json` no-touch → **all fixed** |
| Thesis Alignment | Thesis-aligned, no blockers | 4 LOW (stale workshop residue + 2 cross-repo `--schema`/overlay assumptions) → **fixed** (plan + workshop errata); mechanics-not-routing + supplant-not-preserve **confirmed consistent** |
| Forward-Compatibility | ❌ → ✅ (post-fix) on consumer 4 | Closed status enum + dropped authority tag would force the adopt plan to reshape the core → **fixed**: overlay-declared status vocabulary + reserved optional `authority` field, proven by the Phase-1 fixture (AC-03/AC-10, Finding 02b) |

### Forward-Compatibility Matrix (post-fix)

| Consumer | Requirement | Verdict | Evidence |
|----------|-------------|---------|----------|
| `tasks` stage | per-task success criteria + deps | ✅ | every task has criteria + AC linkage; Phase Index deps; Coverage Map |
| Phase 3 the-flow migration | stable verb surface + schema ownership fixed first | ✅ | workshop 001 Contract Ready; AC-11 + grill 6/7 (the-flow ships flight-plan via `--schema`); §D4 superseded-note added |
| hook-contract consumers | byte-stable `--hook/--event/--hooks/--json` | ✅ | AC-08 two-checkpoint gate; `flow` is a net-new namespace |
| later adopt / eng-harness-flow | extend the core (`declined` status + authority tag) **without** reshaping it | ✅ (post-fix) | overlay-declared status vocabulary + reserved optional `authority` field; Phase-1 fixture exercises both (AC-03/AC-10) |

**Outcome alignment**: The plan, as written (post-fix), **fully advances** "Make the flow a first-class, deterministic concept inside the harness CLI" — it delivers the deterministic mechanics, verb surface, event/comment data model, and byte-stable contracts for the near consumers, **and** leaves the shared core extensible for the known-next adopt plan rather than freezing it closed.
**Standalone?**: No — downstream consumers exist (tasks stage, the-flow, the later adopt plan).

### Fixes applied (this pass)
Plan: AC-03/AC-07/AC-08/AC-10/AC-11/AC-12/AC-14 tightened; Non-Goals (extension-room clarification); Finding 02b added; tasks 1.1/1.2/1.2a/1.2b/1.2c/1.5/1.6/1.7/1.10/1.11/1.12 + 2.1/2.2/2.3/2.4 + 3.1/3.4/3.6 sharpened; 4 risks added; 2 Open Questions resolved.
Workshops (errata reconciling pre-grill residue): **001** §D4 bundled-list (`flight-plan`/`adopt-flow` → shared-core + harness-loop; flight-plan via `--schema`); **002** `flow agent`/`agents[]`-population footnoted as v2-deferred.

**Overall: VALIDATED WITH FIXES** — all gates PASS, Status **READY**. One judgment-call surfaced for your veto: the forward-compat fix (overlay-declared status + reserved `authority` slot) adds *extension room* for the adopt plan, not adopt features — included because that plan is staged, not speculative.

---

## Validation Record (v1.2.0 amendment — 2026-06-18, narrow scope)

Validates the **additive amendment** (folded workshop 003 + the render-surface decision) — not a full re-validation of v1.1.0 (that record stands above).

**Thesis verdict**: **Advanced** at the Implementation proof target; evidence **Strong** (corpus-grounded + self-dogfooded + reconciles with workshops 001/002/003; `E309` code-verified free). **Main thesis risk**: the reserved `authority` field stays genuinely unused in v1 — the Phase-1 task 1.2 fixture is the gate (low).

### Agents (narrow, 3)

| Agent | Lenses | Verdict | Issues → disposition |
|-------|--------|---------|----------------------|
| Coherence + Completeness + Code-fact | Coherence, Integration & Ripple, Evidence, Edge Cases, Contract Integrity | PASS | **E309 verified FREE** (`error-codes.ts` ≤E204); **"additive/no structural change" verified TRUE** (3 phases, CS-4, gates unchanged); AC↔task↔coverage-map closure clean. 1 banner nit (delta list said `1.3` not the new `1.3a`) → **fixed** |
| Thesis Alignment | Thesis Alignment, Hidden Assumptions, Proof-Level Fit | NO ISSUES | **No routing creep** (decision = data; cursor moves only via explicit agent call); no non-goal creep; render surface = real Knowability value, not proxy optimization; proof level holds at Implementation |
| Forward-Compatibility | Forward-Compatibility (5 modes), Integration & Ripple, Deployment & Ops | NO ISSUES | All 4 consumers ✅. One Position risk (body-log becoming a parsed contract) → **hardened** (AC-06 + workshop 002 now state render-only, never parsed back) |

### Forward-Compatibility Matrix (post-fix)

| Consumer | Requirement | Mode | Verdict | Evidence |
|----------|-------------|------|---------|----------|
| `tasks` stage (Phase 1) | AC-15 / 1.3a / 1.7 buildable w/ concrete criteria (incl. multi-predecessor + cycle-reject) | encapsulation lockout | ✅ | workshop 003 §I2 full algebra; task 1.3a multi-edge + `E309`; Dogfood grounding |
| Phase 3 the-flow migration | `insert-node` covers phase-reveal (`--after`) + excursions (`--branch-of`); render preserves genesis bubble; comments render-only | shape mismatch · contract drift | ✅ | Dogfood maps 024's hand-edits → CLI calls; body-log now explicitly render-only (not parsed); task 3.3 calls verbs, never parses md |
| later adopt plan | `decision`/`declined` extends core via overlay-declared status + `authority` slot, no reshape | lifecycle ownership | ✅ | workshop 003 DP2 (first consumer of the hook); task 1.2 fixture proves extensibility |
| hook-contract consumers | byte-stable `--hook/--event/--hooks/--json` untouched | contract drift | ✅ | `flow` net-new namespace; `insert-node` reuses `node-updated` (no new kind); AC-08 two-checkpoint gate |

**Thesis alignment**: The amendment advances the value claim at the Implementation proof target with Strong evidence; the only residual risk (reserved `authority` stays unused in v1) is gated by the Phase-1 fixture test.

**Outcome alignment**: The amended plan, as written (v1.2.0), **fully advances** the VPO Outcome — "Make the flow a first-class, deterministic concept inside the harness CLI" — by delivering the deterministic mechanics, the `insert-node` 3-mode edge algebra, the decision-point type, and the render surface, **while preserving the shared core's extensibility** for the known-next adopt plan rather than freezing it closed.

**Standalone?**: No — downstream consumers exist (tasks stage, the-flow migration, the adopt plan, hook-contract consumers).

### Fixes applied (this pass)
1. v1.2.0 banner delta list: `1.3` → `1.3a (new)` + "task 1.3 unchanged" (Coherence agent).
2. AC-06 + workshop 002 § Render surface: explicit **render-only / never-parsed-back** clause (Forward-Compat Position risk).

**Overall: VALIDATED WITH FIXES** — narrow pass; both fixes mechanical; Status **READY** for Phase 1 tasks.
