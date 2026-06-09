# Harness Record Command

**Mode**: Simple

> 🛠 **Design source**: this spec is built from three authoritative workshops (not a `/plan-1a` dossier):
> [`workshops/001-record-type-contract.md`](workshops/001-record-type-contract.md) ·
> [`workshops/002-cli-shape.md`](workshops/002-cli-shape.md) ·
> [`workshops/003-skills-update-inventory.md`](workshops/003-skills-update-inventory.md).
> Their decisions are authoritative and must not be contradicted by `/plan-3`.

## Summary

Add a **core** `harness record <type>` CLI command that scaffolds a record file from a template into `.harness/records/<type>/<YYYY-MM-DD>-<slug>.md` and returns the path for the calling agent to fill. Record types are defined by a tiny generic contract (`{ kind:'record', type, description, template }`) and come from two sources merged into one registry: **core-bundled** (starting with `retro`) and **extension-provided** (an extension whose default export is `kind:'record'`, discovered by the existing loader). The eng-harness loop skills are adapted to *call* this command instead of hand-writing `docs/harness/...`, with a gitignored scratch buffer at `.harness/temp/<agent>/` for crash-resilient working notes.

**Why**: the loop's Observe/Retro stages are currently prose-only (the harness violates its own "move invariants into the strongest refusal surface" doctrine). A core command makes record creation deterministic, agent-callable, and uniform — and the generic contract makes the *next* record type (survey, handover, …) a template + four fields, not a code change.

## Goals

- A reserved core command `harness record <type>` that creates a templated record file and returns its path (+ `next_action`), agent fills it.
- A generic 4-field `HarnessRecordType` contract, exported via `harness/contract` for extension authors.
- One merged record-type registry: **core ∪ extension**, discovered through the existing extension loader (via a `kind` discriminator), with the same isolation/safe-mode guarantees as verbs.
- `harness record --list` (discover) and `harness new <name> --record` (author a new type); `doctor` enumerates record types.
- `retro` shipped as the first (and, in v1, only) core record type; its template echoes the frozen `retro.schema.json`.
- Adapt `eng-harness-3-observe` / `eng-harness-4-retro` to call `harness record`: observe jots scratch to gitignored `.harness/temp/<agent>/`; drain materializes a committed record under `.harness/records/retro/`; harvest reads new + legacy paths.

## Non-Goals

- **No runtime schema validation** of filled records (the template *is* the schema in v1; an optional `schema?` field is reserved for later).
- **No buffer-append/atomic-write engine, no harvest/cluster/lifecycle logic in core** — those stay in the retro *skill*; the CLI only scaffolds files.
- **No bulk migration** of existing `docs/harness/agents/**` retros — `--harvest` reads them back-compat; no mover/pruner.
- **No edits to external pipeline skills** (`~/.agents/skills/plan-6a*`, `plan-6-companion`) — this repo owns `skills/eng-harness-*` only; the contract is defined here for them to adopt later.
- **No second core record type** beyond `retro` in v1 (`dev-survey` is an illustrative example only).
- **No `harness init` / governance writer** (separate deferred plan).

## Target Domains

> The repo's formal domain system is **not initialized** (constitution: "Domain system: Not yet initialized"). The table maps the affected areas; no NEW formal domain is created.

| Domain / Area | Status | Relationship | Role in This Feature |
|---|---|---|---|
| Harness CLI core (`harness/cli/`) | existing | **modify** | Add `acts/record.ts` + `services/record/`; extend the extension contract/loader for `kind:'record'`; add `E180`/`E181`; reserve `record`; extend `doctor`. |
| eng-harness loop skills (`skills/eng-harness-loop/`) | existing | **modify** | Adapt `eng-harness-3-observe` (scratch → `.harness/temp/`) and `eng-harness-4-retro` (drain materializes a record; harvest reads new+legacy). |
| Repo substrate (`docs/`, `README.md`, `.gitignore`) | existing | **modify** | `docs/how/` guide; README/`skills/README.md`; gitignore `.harness/temp/`. |

> **Governance (Constitution P10)**: reserving a core `record` noun is consistent with the existing reserved core commands (`help`/`doctor`/`new`/`docs`/`skills`). P10 governs dynamic **verbs** ("the core hardcodes no verb list"); `record`'s **types** stay dynamic + extension-ownable, satisfying P10's spirit. No constitution amendment expected — confirm at `/plan-3`'s constitution gate.

## Testing Strategy

**Approach**: Hybrid.
- **Full TDD** for all CLI code (`services/record/`, `acts/record.ts`, loader/contract changes, error codes) — interface-first, **fake adapters** (Constitution P2/P3), RED→GREEN→REFACTOR.
- **Lightweight / manual** for skill-markdown (`eng-harness-3-observe`/`-4-retro`/`-flow`) and docs edits — verified by reading + a path-reference grep; the existing `docs-content.test.ts` guards published-docs exclusions.

**Rationale**: the CLI is the contract surface and the repo mandates TDD there; markdown skills can't be meaningfully unit-tested.

**Focus areas**: type resolution (core ∪ extension), path + collision logic (deterministic via fake clock/fs), envelope/exit-code mapping, loader routing by `kind`, reserved-name + safe-mode behaviour, back-compat harvest globs.

**Excluded**: the *content* an agent writes into a record (not CLI-validated in v1). The skill-markdown adaptation (observe/retro) is verified **manually** (read + path-reference grep) — it's downstream of the CLI; the CLI↔skill contract seam is pinned by the AC-9 template/schema unit test so the two don't drift.

**Mock Usage**: **Avoid mocks** — real fakes/fixtures only; `vi.mock` of internal modules is a repo anti-pattern. Inject fake `fs`/`clock`/`proc` ports.

## Documentation Strategy

**Location**: Hybrid (README + `docs/how/`).
- `docs/how/record-and-record-types.md` — using `harness record`, the placement/collision rule, and authoring a record type (core + extension), mirroring `docs/how/extend-the-harness.md`.
- README / `skills/README.md` — add `harness record` to the loop description; note records live in `.harness/records/`, scratch in gitignored `.harness/temp/`.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=1 (total 7 → CS-3)
- **Confidence**: 0.82
- **Assumptions**: `FsPort` already supports the `readdir`+`mkdirp`+`write`+`exists` ops needed (no new adapter). **NOTE — the extension system is currently verb-only** (`ExtensionExport = HarnessVerb | HarnessVerb[]`; `registry.ts` validates only verbs): routing a second `kind:'record'` is **not trivial** — it needs a widened export union, a record-type registry + dispatch, and a verb-vs-record load/validation split (a dedicated phase, not an incidental edit).
- **Dependencies**: existing `output/envelope`, `error-codes`, `services/extensions/*`, `services/scaffold` patterns.
- **Risks**: see below.
- **Phases** (Simple mode → inline/subtask sequencing): (1) record-type contract + core `retro` type + `record` service; (2) `record` act + `--list` + reserve + `doctor` + error codes; (3) extension `kind:'record'` discovery + `new --record`; (4) skill adaptation (observe scratch, drain materialize, harvest globs) + `.gitignore`; (5) docs.

## Acceptance Criteria

1. `harness record retro --slug "x" --json` creates `.harness/records/retro/<date>-x.md` from the retro template and returns an `ok` envelope whose `data.path` + `evidence[0].path` point at the new file, with a `next_action` telling the agent to open + fill it.
2. A second `harness record retro --slug "x"` the same day produces `…-x-001.md` (zero-padded collision counter); a third → `…-x-002.md`. No file is ever clobbered.
3. `harness record <unknown-type>` → `status: error`, exit 1, code **E180**, `next_action` lists known types.
4. `harness record retro` in a tree with no `.harness/` → `status: unconfigured`, exit 2, with a `next_action`; nothing is written.
5. `harness record --list` (human + `--json`) enumerates record types from **core ∪ extension**; the `--json` payload pins `data.types[]` as `{ type, description, source: "core"|"extension" }` (+ `entryPath` for extensions). `harness doctor` shows a record-types line with the same provenance.
6. A file in `.harness/extensions/` whose default export is `{ kind:'record', type:'dev-survey', … }` is discovered and usable as `harness record dev-survey`; `harness doctor` lists it under record-types; a load failure is non-fatal (`E140`, reported by doctor).
7. `harness new <name> --record` scaffolds a loadable record-type extension stub into `.harness/extensions/` and returns its path.
8. `record` is a reserved core name: it runs under `--no-extensions`/`HARNESS_NO_EXTENSIONS=1` (core types only), and `harness new record` is rejected as reserved (`E151`).
9. The core `retro` template's frontmatter covers the retro schema's **required** fields (`schema_version`, `retro_id`, `agent`, `started_at`) and uses only the schema's open `system` object — a unit test asserts the template parses and its keys are a superset of the schema's required set. (`system.compound.*` is a documented **convention** inside the schema's open `system` object, not a schema-defined field.)
10. `eng-harness-3-observe` writes session scratch to `.harness/temp/<agent>/` (gitignored); `eng-harness-4-retro --drain` materializes a committed record via `harness record retro` under `.harness/records/retro/`.
11. `eng-harness-4-retro --harvest` reads both `.harness/records/retro/*.md` (new canonical) **and** the legacy `docs/harness/agents/**/*.retro.md` + `docs/retros/*.md` globs (no existing retro becomes invisible).
12. `.harness/temp/` is gitignored; `.harness/records/` is committed.
13. The full existing CLI suite (`cd harness/cli && npx vitest run`) still passes, and every new CLI behaviour is covered by unit tests using **fake adapters** (no `vi.mock` of internal modules).
14. A record `type` is validated against `^[a-z][a-z0-9-]*$`; an invalid/empty type → `status: error`, exit 1, with a `next_action`.
15. Registry merge is **deterministic**: an extension declaring an existing **core** type (`retro`) → the core definition wins and the conflict is recorded by `doctor` (never fatal); two extensions with the same `type` → first-loaded wins, the other is recorded as a conflict and skipped.
16. A malformed `kind:'record'` export (missing `type`/`template`) is skipped + recorded by `doctor` (non-fatal, `E140`); it never crashes `harness record` or `harness record --list`.
17. `harness record` **ensures** `.harness/temp/` exists and is gitignored on first use (idempotent); `.harness/records/` stays committed.
18. Bare `harness record` (no type, no `--list`) prints the same orientation listing as `--list` — non-blocking, exit 0.

## Risks & Assumptions

- **Loader change risk**: the current `ExtensionExport` union + `registry.ts` validation are **verb-only**, so adding the `kind` discriminator is a dedicated phase (not an incidental edit) and must not break existing verb extensions (absent `kind` ⇒ `'verb'`). Mitigation: explicit back-compat test + a verb-vs-record routing test.
- **Template/schema drift**: the retro template and `retro.schema.json` could diverge. Mitigation: AC-9 + a test asserting the template's frontmatter keys match the schema's required fields.
- **Core-template packaging**: if core templates are bundled `.md` files they need a `package.json#files` entry; inline TS constants avoid that. Lean: inline constants (resolve in `/plan-3`).
- **Path re-derivation**: if context is lost mid-session, observe must re-find or recreate its scratch under `.harness/temp/<agent>/`. Mitigation: document the convention in the observe skill.

## Open Questions

- **Q-A (architecture)**: core templates as inline TS constants vs bundled `.md` files? *Lean: inline constants* (no packaging change; mirrors `services/scaffold/templates.ts`). Resolve in `/plan-3`.
- **Q-B → RESOLVED**: `harness record` **ensures** `.harness/temp/` exists + is gitignored on first use (low-cost, guarantees the gitignore). See AC-17.
- **Q-C**: ship `dev-survey` as a real second core type to prove genericity, or keep it docs-only example? *Lean: docs-only example* (keep core small per constitution).

## Workshop Opportunities

> All design workshops are **complete** (front-loaded before this spec). No further workshops required before architecture.

| Topic | Type | Status |
|---|---|---|
| Record-type contract — definition, loading, use (core + extension) | Data Model / Integration | ✅ Complete (`workshops/001`) |
| `harness record` CLI shape | CLI Flow | ✅ Complete (`workshops/002`) |
| Skills update inventory (flow adaptation) | Integration / Migration | ✅ Complete (`workshops/003`) |

## Clarifications

### Session 2026-06-09

**Round 1 (front-loaded):**
- **Workflow Mode** → **Simple** (user override of the recommended Full; cheaper to escalate later, and the work is well-understood post-workshops). Phases sequenced inline/as subtasks.
- **Testing Strategy** → **Hybrid** (Full TDD + fakes for CLI; lightweight/manual for skill-markdown + docs).
- **Mock Usage** → **Avoid mocks** (fakes/fixtures only; `vi.mock` is a repo anti-pattern).
- **Documentation Strategy** → **Hybrid** (README/`skills/README.md` + a `docs/how/` guide).

**Round 2 (conditional):**
- **Domain Review** → not fired (no NEW formal domains; domain system uninitialized).
- **Agent Harness Readiness** → **Feature doesn't need a separate agent harness.** This repo *is* the harness product; it has no `engineering-harness.md` governance doc by design. Validation is via the CLI's own `vitest` suite (227 tests, fakes) + manual skill verification. No Phase 0 harness build (would be circular). *(Recorded for `/plan-3`; override if a Boot→Interact→Observe loop is wanted.)*

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: Give `/plan-3` a buildable, unambiguous contract for a core `harness record <type>` command + generic record-type system, consistent with the 3 authoritative workshops and the real CLI architecture; resolve the loop's prose-only Observe/Retro doctrine violation.

**Value claim**: Record creation becomes deterministic + agent-callable + uniform; adding a new record type becomes "template + 4 fields"; placement / buffer-vs-record split / core∪extension loading are settled.

**Artifact promise**: `/plan-3` + the implementer can rely on the ACs, the contract, the placement rule, and the workshop decisions without contradiction.

**Intended beneficiaries**: `/plan-3` architect, the implementing agent, the eng-harness loop skills, future record-type authors.

**Proof target**: Contract.

**Evidence standard**: testable ACs; consistency with workshops 001–003; accurate claims about the CLI codebase.

**Thesis source**: workshops 001–003 + original-ask.md.

**Thesis verdict**: Advanced.

**Main thesis risk**: minor drift risk from the flow-adaptation ACs, but the core ask stays scaffold-only and placement/registry rules are settled.

---

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Accuracy (vs CLI source) | Evidence Sufficiency, Hidden Assumptions, Technical Constraints, Integration & Ripple | Evidence Sufficiency, Contract Integrity | 1 HIGH, 1 MED, 2 LOW — all fixed | ⚠️ → ✅ |
| Clarity & Completeness | Concept Documentation, Edge Cases, Hidden Assumptions, System Behavior | Implementation Readiness, Proof-Level Fit | 1 HIGH, 3 MED, 1 LOW — all fixed | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment | Thesis Alignment, User/Product Value | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Technical Constraints, Test Boundary | Downstream Usefulness, Safety to Change | 2 MED — addressed | ⚠️ → ✅ |

### Thesis Verdict (echoed)

- **Thesis understood?** Yes
- **Value claim advanced?** Yes
- **Proof level**: Target = Contract; Actual = Contract
- **Evidence quality**: Strong
- **Main thesis risk**: minor drift risk from flow-adaptation ACs; core ask stays scaffold-only.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-3-v3-architect` | phaseable, buildable units + non-contradictory contract | none/minor | ✅ | phases + ACs + architecture wiring present; workshops authoritative |
| Implementation (act/service/loader/skills) | contract shape, exit/error codes, placement, observe/retro adaptation | shape mismatch + test boundary | ✅ (after fixes) | `--list --json` payload pinned (AC-5); template/schema seam test (AC-9); skill-markdown scoped manual/downstream |

**Thesis alignment**: Value claim advanced at Contract proof with Strong evidence; main risk is minor flow-adaptation drift, mitigated by scaffold-only non-goals.

**Outcome alignment**: "the loop's Observe/Retro stages are currently prose-only … A core command makes record creation deterministic, agent-callable, and uniform." — The spec advances that outcome; the prior end-to-end-proof gap on skill adaptation is now scoped (manual/downstream) with the CLI↔skill seam pinned by the AC-9 test.

**Standalone?**: No — downstream `/plan-3` (the pending next command) consumes this spec.

Overall: ⚠️ VALIDATED WITH FIXES
