# Fix FX001: `harness init` — seed the governance-doc skeleton

**Created**: 2026-06-15
**Status**: ✅ **Implemented 2026-06-15** on `feat/harness-init-command` (commits `b40d6c1` FX001-1, `faa8e2a` FX001-2/3) — all acceptance criteria met; reviewed live by `code-review-companion`. Full suite **535 green**, `npm run build` clean, `harness arch-check` ok, biome clean. Validated 2026-06-15 (⚠️ VALIDATED WITH FIXES — see Validation Record at end).
**Plan**: [008-harness-setup-flow](../harness-setup-flow-plan.md)
**Source**: Plan 008 named Non-Goal ("Not building the `harness init` CLI command (forward dependency)") + the `init` reference audit (10 live surfaces reference a command that doesn't exist)
**Workshop**: [`../workshops/001-harness-init-command.md`](../workshops/001-harness-init-command.md) (Contract Ready)
**Domain(s)**: harness-cli (new act + service — reserved core command, no contract change to the Envelope)

---

## Problem

`harness init` is referenced across **10 live surfaces** (`AGENTS_README.md`, the three `eng-harness-flow` files, `eng-harness-1-boot`, the three `eng-harness-0-adopt` files, `skills/README.md`) as the **inception writer** of the governance doc `.harness/engineering-harness.md` — but the command **does not exist**. `app.ts` registers nine acts — `help`, `doctor`, `new`, `docs`, `skills`, `record`, `instructions`, `observe`, plus the per-extension `verb` loop — and **no `init`** (those eight core names are the reserved set in `registry.ts:46-55`). Plan 008 deferred it on purpose (its Non-Goals), wiring every skill with an "owed, not provisioned" graceful fallback in the meantime.

Three consequences of the gap:

1. **Boot is permanently `UNAVAILABLE` on governance.** Nothing writes the doc — `eng-harness-0-adopt` explicitly refuses to ("orchestrate, don't generate") — so `eng-harness-1-boot` never finds a maturity snapshot to read.
2. **The router has no durable injection map.** The router's S3 rung reads `## Injection map` from the governance doc; with no doc, a cold agent has no structural reason to call the harness, and the inject step is re-offered every call.
3. **Onboarding agents trip on a documented-but-missing command** — the recurring complaint. The AGENTS_README even ships a troubleshooting row teaching agents to *skip* it.

The governance doc *is* consumed (boot maturity + router injection map), so the right fix is to **write the inception writer**, not to delete the references.

## Proposed Fix

Build a **deliberately minimal** `harness init` per workshop 001 — **scaffold-and-seed, never populate**. It stamps the governance-doc *skeleton* (fixed BIO headings + `Maturity: L0` seed + empty `## Injection map` + the `AGENTS START HERE` breadcrumb) and returns the path. Repo-specific content (boot command, signals, real maturity, the filled injection map) stays the skills' / Improve-beat's job — a populated-but-false doc would make boot misreport and violates "the harness never fakes success."

It is the governance-doc analogue of the two template-stamping commands the repo already ships:
- `harness record retro` (`services/record/core-types/retro.ts` → `RETRO_TEMPLATE`, written at `record-service.ts:174`), and
- `harness new` (`services/scaffold/templates.ts`).

**Packaging is a non-issue** (workshop §4): the skeleton is an inline **TS string constant** that compiles into `dist/` and ships via the existing `files: ["harness/cli/bin","harness/cli/dist","LICENSE"]` glob — no `package.json`/build/`gen:docs` change, no runtime file read.

**Shape** (workshop §2–§3):
- One fixed path `.harness/engineering-harness.md`; `mkdirp` `.harness/` (bootstrapping it is `init`'s job).
- **Never clobber.** Existing doc → idempotent `ok` with `data.created:false`, byte-identical.
- `fs` port only; no Clock (static skeleton, fixed path).

**Error code**: a new `ErrorCodes.INIT_WRITE_FAILED = 'E190'`. *(The workshop drafted `E150`, but `E150` is already `SCAFFOLD_INVALID_NAME` — `E190` is the free decade, matching the per-command convention: scaffold E150-3, docs E160, skills E170, record E180-1.)*

Explicit scope guards (don't boil the ocean):
- ✗ **No repo-specific population** — boot cmd / health / interact / observe / signals / evidence paths / maturity stay `TODO`; skills fill them.
- ✗ **No injection-map fill** — `eng-harness-0-adopt` Step 3 writes it into the now-existing doc.
- ✗ **No `.harness/history.md` seed, no `.harness/extensions/` scaffold** (lazy via `harness new`).
- ✗ **No `--force` / overwrite, no Clock, no `exec`, no assessment.**
- ✗ **No doc de-reference sweep** — simplifying the "owed, not provisioned" language + removing the AGENTS_README troubleshooting row once `init` ships is **workshop Q3, a separate follow-up**, out of scope here.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | New `acts/init.ts` + `services/init/` (pure template builder + constant + service). `'init'` added to `RESERVED_NAMES` (`registry.ts:46-55`). One registration line in `app.ts` `main`. One new error code `E190`. **No** change to the `Envelope`/`Evidence` contract, ports, or existing acts. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | **Skeleton template + pure builder** — `GOVERNANCE_SKELETON` constant (the exact skeleton from workshop §1) + `buildGovernanceSkeleton(): string`; I/O-free | harness-cli | `harness/cli/src/services/init/governance-template.ts` | Builder returns the skeleton **mirroring the canonical governance-doc section set + order** (verified against this repo's `.harness/engineering-harness.md` / `governance-doc.md:24-35`): `## Boot command`, `## Health check`, `## Interact method`, `## Observe method`, `## Deterministic signal inventory`, `## Evidence paths`, `## Injection map` (empty table), `## Back-pressure gaps`, then a trailing `## Current maturity snapshot` whose body is `**L0 — …**`; plus the `AGENTS START HERE → npx harness instructions` breadcrumb. No imports of fs/clock | Inline constant ships via `dist` (workshop §4 Packaging); section names are verbatim so boot/adopt read it as a real governance doc |
| [x] | FX001-2 | **Act + service wiring** — `InitActDeps = { fs, proc, clock }` (mirrors `RecordActDeps`/`NewActDeps`: the **act** needs `clock` for the envelope timestamp; the **builder** stays pure). `services/init/init-service.ts` resolves the doc path from `proc.cwd()` (POSIX-joined, cf. `record-service.ts:95`); **exists-check FIRST** → present ⇒ return `created:false` (skip mkdirp+write, never clobber) → absent ⇒ `mkdirp` `.harness/` then `writeText` the skeleton; returns typed `InitOutcome = {ok:true; path; created} | {ok:false; code; message; next_action}`. `acts/init.ts` (`registerInitAct(program, io, deps)`) maps the outcome to the envelope; register in `app.ts` `main`; add `'init'` to `RESERVED_NAMES` | harness-cli | `harness/cli/src/services/init/init-service.ts` · `harness/cli/src/acts/init.ts` · `harness/cli/src/app.ts` · `harness/cli/src/services/extensions/registry.ts` | `harness init` runs, creates the doc, is reserved (an extension verb named `init` is refused like `record`); service does the fs side-effects via `proc`+`fs`, builder stays pure | Sibling of `new`/`record`; **service** uses `fs`+`proc`; **act** also `clock` |
| [x] | FX001-3 | **Envelope + exit + error code** — created→`ok` `data:{path,created:true,maturity_seed:'L0'}`; exists→`ok` `data:{path,created:false}` (idempotent, no clobber; **`maturity_seed` only on `created:true`** — it names what was seeded this run); fs failure→`error` exit 1 with new `ErrorCodes.INIT_WRITE_FAILED='E190'` + `next_action` | harness-cli | `harness/cli/src/acts/init.ts` · `harness/cli/src/output/error-codes.ts` | All three paths return the contracted envelope; created/exists exit `0`, failure exit `1`; `evidence[0].path` = the doc path; no stack trace | `E190` (E150 taken) |
| [x] | FX001-4 | **Tests + build + commit** — pure builder snapshot; act tests via FakeFs (creates incl. `mkdirp .harness/` in empty repo; idempotent no-clobber → `created:false`, byte-identical; reserved-name conflict; fs-error → `E190`); `npm run build` clean; full vitest green; conventional commit | harness-cli | `harness/cli/test/services/init/*.test.ts` · `harness/cli/test/acts/init.test.ts` | Snapshot pins the skeleton bytes; all four act paths covered by FakeFs; `npm run build` exit 0; `cd harness/cli && vitest run` all pass; `feat(init): …` commit referencing FX001 | — |

## Workshops Consumed

[`../workshops/001-harness-init-command.md`](../workshops/001-harness-init-command.md) — §1 is the byte-source for the skeleton (FX001-1 mirrors it), §2–§3 fix path/idempotency/envelope, §4 fixes architecture wiring + packaging, D1–D6 are the decisions, Q1–Q3 the open questions (Q1 resolved here: `E190`).

## Acceptance

- [x] `harness init` in a repo with no `.harness/` creates `.harness/engineering-harness.md` whose section set + order **match the canonical governance doc verbatim** (`## Boot command`, `## Health check`, `## Interact method`, `## Observe method`, `## Deterministic signal inventory`, `## Evidence paths`, `## Injection map`, `## Back-pressure gaps`, `## Current maturity snapshot` — per this repo's `.harness/engineering-harness.md`), with the `## Current maturity snapshot` body seeded `L0` and an empty `## Injection map` table → exit `0`, `data.created:true`, `data.maturity_seed:'L0'`.
- [x] Re-running `harness init` leaves the file **byte-identical**, returns `data.created:false`, exit `0` (idempotent; never clobbers).
- [x] `harness init --json` emits a valid envelope with `data.path` + `evidence[0].path` = `.harness/engineering-harness.md`.
- [x] An extension declaring a verb named `init` is refused (reserved-name conflict, like `record`).
- [x] `buildGovernanceSkeleton()` is pure (no fs/clock import) and matches a committed snapshot.
- [x] An fs write failure surfaces `status:error`, exit `1`, `error.code === 'E190'`, `next_action` present, no stack trace.
- [x] No change to the `Envelope`/`Evidence` contract, ports, or existing acts; only `dist`-shipped code added (no `package.json` `files`/build/`gen:docs` change).

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-06-15 | FX001-1 | contract-drift (companion F001, MED) | `governance-doc.md`'s contents table listed `Back-pressure gaps` **before** `Injection map` — the opposite of the skeleton / workshop §1 / this repo's `.harness/engineering-harness.md`, leaving two "authoritative" section orders for boot/adopt/router readers. | Reconciled at source: swapped the two rows in `governance-doc.md` so the order is consistent everywhere (Evidence paths → **Injection map → Back-pressure gaps** → Current maturity snapshot). Skeleton/test unchanged; the `CANONICAL_SECTIONS` test constant remains the pinned contract (not coupled to the living, evolving `.harness` doc). |

---

## Validation Record (2026-06-15)

### Validation Thesis

**Raison d'être**: Turn the long-deferred `harness init` (plan 008's named Non-Goal; referenced by ~10 live skill/doc surfaces but never built) into a lean, implementable plan-6 brief that ships the governance-doc INCEPTION writer as scaffold-and-seed only.

**Value claim**: plan-6 implements with minimal clarification; boot moves `UNAVAILABLE → L0`; adopt gets a doc to weave the injection map into; onboarding agents stop tripping on a phantom command — **without** ever faking harness state (L0 + empty fields, never a populated-but-false doc).

**Artifact promise**: cited refs accurate; the 4 tasks buildable; envelope/error contract internally consistent and non-colliding (`E190`); scope stays scaffold-and-seed; the seeded doc matches the canonical governance-doc structure so its runtime readers (boot, adopt, router) recognise it.

**Intended beneficiaries**: plan-6 implementer (primary); the harness skills that read the produced doc (boot, router, adopt); onboarding agents; human approver.

**Proof target**: Implementation. **Evidence standard**: source-code match, full ripple, internally consistent contract, testable acceptance.

**Thesis source**: `workshops/001-harness-init-command.md`; plan 008 spec Non-Goals/Goals; `skills/.../eng-harness-flow/references/governance-doc.md` (G5); this repo's `.harness/engineering-harness.md` (canonical structure).

**Thesis verdict**: Advanced (after fixes — pre-fix: Partially, the seeded skeleton diverged from the canonical doc structure).

**Main thesis risk**: was "the seeded skeleton format (paraphrased headings; inline `**Maturity**` line) wouldn't match what boot/adopt read, so boot stays `UNAVAILABLE` and the value claim silently fails" — **eliminated** by aligning the skeleton to the canonical section set + order (`## Boot command` … `## Current maturity snapshot`) verified against `.harness/engineering-harness.md`.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source Truth | Evidence Sufficiency, Technical Constraints, Integration & Ripple, Concept Documentation | Evidence Sufficiency | 1 HIGH fixed (`app.ts` act list omitted `observe`+`instructions`), 1 MED fixed (workshop Evidence-Ledger list), 1 LOW fixed (heading paraphrase) | ⚠️ → ✅ |
| Implementation Readiness | Implementation Readiness, Hidden Assumptions, Edge Cases & Failures, Contract Integrity, System Behavior | Implementation Readiness | 1 HIGH fixed (service path via `proc.cwd()`), 3 MED fixed (`InitOutcome` type, `maturity_seed` rule, exists-before-mkdirp order), 2 LOW noted (`InitActDeps`, snapshot location — folded into FX001-2/4) | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit, User/Product Value Preservation | Thesis Alignment, Proof-Level Fit | 1 HIGH fixed (maturity representation = honesty linchpin); proof level Contract → Implementation post-fix | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Domain Boundaries, Deployment & Ops | Downstream Usefulness | 1 HIGH fixed (boot maturity-section contract drift) | ⚠️ → ✅ |

**Deduped issues** (all fixed): (HIGH) `app.ts` registration mis-enumerated — corrected to the 9 acts / 8 reserved names; (HIGH) skeleton headings paraphrased + maturity as an inline line — rewritten to mirror the canonical `.harness/engineering-harness.md` section set + order, maturity as a trailing `## Current maturity snapshot` section; (MED) `maturity_seed` only on `created:true` — pinned in brief + workshop §3; (MED) service contract under-specified — `InitActDeps {fs,proc,clock}`, path from `proc.cwd()`, exists-check-before-mkdirp, typed `InitOutcome` added to FX001-2; (LOW) workshop Evidence-Ledger app.ts line corrected. **Confirmed clean**: `E190` is genuinely free (E150 = `SCAFFOLD_INVALID_NAME`); `RESERVED_NAMES` ready for `'init'`; packaging claim accurate (`files:["harness/cli/bin","harness/cli/dist","LICENSE"]` → inline TS constant ships via `dist`, zero build change); precedents real (`retro.ts` `RETRO_TEMPLATE` written at `record-service.ts:174`, `scaffold/templates.ts`); `## Injection map` section name matches adopt's expectation; doc de-reference sweep correctly deferred to workshop Q3.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 implementer (FX001-1..4) | Unambiguous buildable tasks + accurate refs | shape mismatch | ✅ (post-fix) | Skeleton aligned to canonical doc; `InitActDeps`/`InitOutcome`/path/ordering pinned in FX001-2; `app.ts` list corrected |
| `harness/cli/src/output/error-codes.ts` | A free, non-colliding code | contract drift | ✅ | `E190` unused; `E150` confirmed taken (`SCAFFOLD_INVALID_NAME`) |
| `registry.ts` `RESERVED_NAMES` | `init` added like `record` | contract drift | ✅ | Set currently 8 names, no `init`; FX001-2 adds it; literal-set edit, no ripple |
| `eng-harness-1-boot` (reads produced doc) | Parse the seeded doc, report L0 not UNAVAILABLE | contract drift | ✅ (post-fix) | Skeleton now uses `## Current maturity snapshot` (body `**L0 …**`) + canonical section names, matching `.harness/engineering-harness.md`; boot reads the doc semantically (SKILL.md:65) |
| `eng-harness-0-adopt` Step 3 (writes injection map) | Empty `## Injection map` section to fill | encapsulation lockout | ✅ | Skeleton ships `## Injection map` + empty 3-col table; adopt SKILL expects that exact heading |
| Doc de-reference follow-up (workshop Q3) | FX001 must leave it cleanly deferred | contract drift | ✅ | FX001 scope guard explicitly defers it; no skill/AGENTS_README edits in the task list |

**Thesis alignment**: Value claim advanced at Implementation proof level (post-fix); the only residual is the deliberately-accepted deferral of the doc de-reference sweep (workshop Q3).

**Outcome alignment**: (Forward-Compatibility agent, verbatim) — *"The VPO Outcome states 'The flow's success condition is a working boot, even if basic' … FX001 as written will NOT achieve this outcome if implemented per workshop §1, because boot will fail to parse the maturity representation."* — **This was the linchpin finding; it is now RESOLVED**: the skeleton was rewritten to the canonical `## Current maturity snapshot` section (+ verbatim section names), so the seeded doc is read as a real governance doc at L0 and the working-boot outcome is back on trajectory.

**Standalone?**: No — six downstream consumers enumerated above.

Overall: ⚠️ VALIDATED WITH FIXES
