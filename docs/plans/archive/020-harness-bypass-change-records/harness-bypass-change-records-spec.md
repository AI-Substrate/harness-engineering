# Harness bypass + change records, the `win` retro kind, and a measures doc

**Mode**: Full
**Status**: VALIDATED WITH FIXES (validate-v2 applied — header shape + `plan_id` + `resolves` format locked). 2 low-stakes confirmations remain: base `HEAD` SHA (rec OUT) · the-flow pre-implement edit (rec OOS follow-up).

📚 Specification incorporates findings from `research-dossier.md` (2 explore passes) and the locked decisions in `distilled-ask.md`.
ℹ️ No `docs/domains/registry.md` in this repo — Target Domains below uses logical code boundaries, identified as part of this spec.

## Research Context
Two explore passes established: (1) a record type is "a template + four fields" plugging in at `services/record/registry.ts` with **no new CLI verb**; (2) the decided design is feasible and code-first. The harness loop today can *notice* friction (`harness observe` → retro) but has **no durable, scannable signal** for when the paved path was **abandoned** (bypass) or **improved** (change), and **no positive "it worked" signal**. `.harness/history.md` (the improvement changelog) has **zero code writers** — pure hand-maintained prose. The measurement doctrine (bypass rate, encoded-mitigation rate, DORA-as-downstream, anti-Goodhart / team-level-only governance) is already written in `harness-foundations/source-notes/notes3.md`.

## Summary
**WHAT:** Make harness **use / non-use / effectiveness** legible in every repo by (a) adding two committed record types — `harness-bypass` and `harness-change`; (b) adding a first-class positive retro kind `win`; (c) stamping a CLI-owned provenance header (`harness_version`, `branch`, `repo`, `created_at`, `agent`) onto **all** record writes; (d) wiring in-repo capture-seam prompts so these signals actually get recorded; (e) removing the `.harness/history.md` concept (the `harness-change` record ledger replaces it); and (f) writing a design doc describing the measures these records enable.
**WHY:** You can't answer "is the harness creating value?" with positive signals alone. Bypass is the negative-space signal that silently vanishes today; `harness-change` is the encoded-improvement signal; `win` is the "it worked" signal. Stamping provenance makes records correlatable across a fleet later. **This plan records the signals in-repo; it does not build the cross-repo scanner or DORA correlation (OOS).**

## Goals
- Two committed record types (`harness-bypass`, `harness-change`) addable via `harness record <type>` — no new verb.
- A frozen, cross-repo-ready frontmatter contract on both types, pinned by tests.
- CLI-stamped provenance header on **every** record write (incl. `retro`), via deterministic ports — never agent-guessed.
- A new positive retro `kind: win` ("this worked well / the harness was effective here").
- In-repo capture seams that reliably prompt these records without depending on user-global skills.
- Remove `.harness/history.md`; migrate its one row; re-point all readers to the `harness-change` record ledger.
- A measures design doc (`docs/how/harness-value-measures.md`).

## Non-Goals (OOS — a separate plan)
- The single-repo **rate emitter** / `compound-value` computation.
- The **cross-repo / fleet scanner** that aggregates records.
- **DORA correlation** study, dashboards, governance-firewall tooling.
- **CLI usage telemetry** (the "extent of use" signal).
- Editing `the-flow`'s pre-implement seam (user-global, **not vendored** here — a coordinated follow-up; see D10).
- Any change to the retro `kind` enum beyond adding `win`.

## Target Domains
*(No formal domain registry — these are logical code boundaries.)*

| Domain (code area) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `services/record` | existing | **modify** | add `harness-bypass` + `harness-change` core types; provenance-stamping in `record-service` |
| `services/observe` + retro schema (`eng-harness-4-retro/references/retro.schema.json`) | existing | **modify** | add `win` to the `kind` enum + `OBSERVATION_KINDS`; `schema_version` minor bump |
| `adapters/git` | existing | **modify** | add `remoteUrl()` to `GitPort` (+ `ExecGit`/`FakeGit`) |
| harness-loop skills (`eng-harness-loop/*`, `eng-harness-setup/eng-harness-0-add-extension`) | existing | **modify** | capture-seam prompts; `history.md` removal prose |
| governance docs (`.harness/engineering-harness.md`, `eng-harness-flow/references/{governance-doc,maturity-assessment}.md`) | existing | **modify** | drop `history.md`; reword L3 rung |
| `docs/how/` | existing | **create (doc)** | `harness-value-measures.md` |

## Frozen Frontmatter Contract
*(The cross-repo contract — frozen now, pinned by a template↔schema superset + provenance-coverage test. Expensive to change once consumer repos write records, so it's enumerated here, not split across docs.)*

**Header shape (LOCKED, was R1/D6):** **single merged frontmatter.** The CLI splices the provenance keys in at the **top of the record's existing `---` frontmatter** (textual splice after the opening `---\n`, a P2-clean string op) — so every record has **one** frontmatter block a scanner parses YAML-first, and template *constants* (`RETRO_TEMPLATE` etc.) stay byte-identical.

**Provenance keys — CLI-stamped on every record write (all types incl. `retro`):**

| Key | Source | Null when |
|---|---|---|
| `schema_version` | record-type constant | never |
| `record_kind` | record-type constant (`harness-bypass`/`harness-change`/`retro`) | never |
| `harness_version` | CLI build constant (`version.ts`) | never |
| `branch` | `GitPort.currentBranch()` | not-a-repo / detached HEAD |
| `repo` | `GitPort.remoteUrl()` (NEW method) | no remote |
| `created_at` | `Clock.nowIso()` | never |
| `agent` | `HARNESS_AGENT` env → `--agent` → `null` | unset |
| `plan_id` | `HARNESS_PLAN_ID` env → branch/cwd inference (as retro does) → `null` | no plan context |

> `plan_id` re-added per validate-v2 (it's a session/plan join-key + a denominator anchor; dropping it would force a fleet migration later). `commit` (the *produced* SHA) is intentionally absent — unknowable pre-commit; `branch` is the join. base `HEAD` SHA: **OUT** (recommended; addable later if the scanner needs it).

**Body keys (agent-filled):**
- `harness-bypass`: `cause` (enum `missing-command|command-failed|too-slow|unclear-output|no-coverage|policy|agent-could-not`), `attempted` (bool), `command` (string), `severity` (`blocking|degrading|annoying`).
- `harness-change`: `resolves`, `change_type` (enum `new-command|sensor|fixture|template|doc|skill-edit|routing`), `target`.
- **`resolves` format (LOCKED):** a free-form ref string ≤200 chars. Recommended forms — an in-repo record path (`.harness/records/harness-bypass/2026-06-16/001-x.md`), an issue/PR ref (`issues/123`, `org/repo#45`), or a retro cross-ref (`<retro_id>:<entry_id>`). Scanners parse it as-is; no normalization.

## Testing Strategy
- **Approach: Hybrid.** Full TDD with hand-written fake adapters for all CLI code (record types, provenance stamping, `win` enum, `GitPort.remoteUrl`); manual/read-grep verification + dogfood for skill-markdown edits and the doc.
- **Focus areas**: provenance header is stamped (not placeholdered) and degrades to `null` when git is unavailable; template body stays byte-unchanged; frozen frontmatter pinned by a template↔schema superset test; `win` enum additive (old records still validate); `record --list`/`doctor` enumerate the new core types.
- **Excluded**: cross-repo aggregation (OOS); end-to-end DORA (OOS).
- **Mock Usage: B (targeted, repo idiom).** Hand-written `Fake*` adapters for injected ports (`FakeFs`/`FakeClock`/`FakeProcess`/`FakeGit`) — **never `vi.mock` internal modules** (established anti-pattern, PL-15).

## Documentation Strategy
- **Location: Hybrid (docs/how/ + generated CLI docs).** New `docs/how/harness-value-measures.md`; update `docs/how/record-and-record-types.md` for the two new types + provenance; update `AGENTS_README.md` if record guidance changes, then **`npm run gen:docs`** so `docs-content.ts` passes the `check:docs` CI gate.
- **Rationale**: the measures doc is the in-scope "describe the measures" deliverable; the record-doc + gen:docs gate is mandatory to keep the published CLI docs in sync.

## Complexity
- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=1, N=1, F=1, T=2 → 9
- **Confidence**: 0.80
- **Assumptions**: the record contract stays 4-field + provenance header; `proc`/`clock` ports suffice + one new `GitPort` method; the retro schema lives in the skill and is the validation source.
- **Dependencies**: code-first — the capture-seam skill prompts are inert until the two core record types ship; the `win` prompt is inert until the enum ships.
- **Risks**: see below.
- **Phases (anticipated; architect to finalize)**:
  1. **CLI core** — `harness-bypass` + `harness-change` core types; provenance stamping (`GitPort.remoteUrl`, version dep, header injection); tests.
  2. **`win` retro kind** — enum + `schema_version` minor bump; `OBSERVATION_KINDS`/`WIN` prefix; `RETRO_TEMPLATE` doc; encoding-hint; tests.
  3. **Remove `history.md`** — migrate the one row → a `harness-change` record; delete the file; the prose reword/deletes (incl. L3 maturity rung).
  4. **In-repo capture seams** — retro `--drain` bypass backstop + `win` "what worked well?" prompt; router `bypass_recommended` envelope flag; add-extension Step 4 change record.
  5. **Measures doc + docs sync** — `docs/how/harness-value-measures.md`; update record doc + `gen:docs`.

## Acceptance Criteria
1. `harness record harness-bypass` and `harness record harness-change` scaffold a record at `.harness/records/<type>/<YYYY-MM-DD>/<NNN>[-slug].md`, return its path, exit 0; unknown type still errors (E180); no `.harness/` → unconfigured (exit 2).
2. `record --list` and `harness doctor` enumerate both new types with source `core`.
3. **Every** record the CLI writes (incl. `retro`) is stamped — at write time, by the CLI, merged into the record's frontmatter — with the provenance keys in the Frozen Frontmatter Contract (`schema_version`, `record_kind`, `harness_version`, `branch`, `repo`, `created_at`, `agent`, `plan_id`), values from Clock/`GitPort`/version/env — never agent-filled. *(This is a property of records that ARE written; it is not a guarantee that every bypass produces a record — see AC-9 + R6.)*
4. When git is unavailable / detached-HEAD / no remote / no plan context, the affected keys (`branch`, `repo`, `plan_id`, `agent`) stamp as `null` (never guessed); the write still succeeds.
5. **Template *constants* stay byte-identical** (`RETRO_TEMPLATE` and the two new templates are unchanged source strings); the CLI produces the written file by **splicing the provenance keys into the template's frontmatter** at write time. The existing `retro-template` superset test (which asserts on the *constant*, not the written file) still passes; a new provenance-coverage test asserts the *written* record carries every Frozen-Contract key.
6. `harness-bypass` and `harness-change` records carry exactly the body keys in the Frozen Frontmatter Contract (incl. the locked `cause`/`change_type` enums and the `resolves` ref format). A template↔schema superset test pins both bodies; the provenance-coverage test (AC-5) pins the header.
7. `kind: win` is a valid retro/observe kind: `harness observe "<x>" --kind win` succeeds; `win` validates against `retro.schema.json` (bumped `schema_version`, minor); existing retros without `win` still validate (additive). Forward contract: an older harness reading a `win` record may not recognize it — the measures doc (AC-10) documents that a scanner reports **version-coverage** (% of records readable at its schema version) and logs unreadable kinds rather than silently dropping them. *(R5 resolved: the schema lives only in the skill; the CLI template is a deployment echo pinned by `retro-template.test.ts` — one schema edit + buffer-codec + template + test.)*
8. `harness-change` records are the improvement ledger: `.harness/history.md` is deleted, its one row migrated into a `harness-change` record, and **no** doc/skill still instructs writing `history.md`; the L3 maturity rung reads in terms of `harness-change` records. (The removal sweep is itemized in `research-dossier.md` § history.md removal — ~17 ops across 7 docs incl. `.harness/engineering-harness.md`, `governance-doc.md` §G3, `maturity-assessment.md`, `eng-harness-1-boot/SKILL.md`, `getting-started.md`.)
9. In-repo capture seams **prompt** the records (prose, dogfood-verified, never blocks): `eng-harness-4-retro --drain` includes a bypass backstop and a `win` "what worked well?" beat; `eng-harness-flow` documents a stateless `bypass_recommended`/`bypass_cause` envelope field; `eng-harness-0-add-extension` has a "record the change" step on verification pass. Acceptance = the prose exists in the SKILL bodies, references the locked record types with no typos, and fires at the intended seam in dogfood testing (not CI-gated). **Honest tradeoff (R6)**: a bypass is recorded only if someone engages the prompt — capture is best-effort, so under-reporting is expected; the measures doc handles it via team-level-only framing, never a per-individual rate.
10. `docs/how/harness-value-measures.md` exists and is **load-bearing for the thesis** — it must (a) describe bypass rate + change rate (encoded-mitigation ratio) and recommend the **denominator** (PRs primary, plans/sessions secondary); (b) include one hand-traced `harness-bypass` and one `harness-change` example showing every Frozen-Contract field, demonstrating the frozen frontmatter is **sufficient** for a scanner to parse + extract join keys (`repo`, `branch`, `created_at`, `harness_version`, `agent`, `plan_id`); (c) frame DORA as leading/lagging correlation (not a 5th metric); (d) state the anti-Goodhart / team-level-only / no-individual-attribution governance guardrails and the under-reporting (R6) defense.
11. The full CI gate passes (biome, build, **check:docs**, typecheck, vitest+coverage, arch-check, skills-check, package-smoke); skill `description:` frontmatter stays under the 900-char `skills-check` warn band (prompt beats go in the body).

## Risks & Assumptions
- **R1 — provenance header shape: RESOLVED (validate-v2) → single merged frontmatter** (textual splice after the opening `---`; template constants stay byte-identical; one frontmatter block for scanners). See Frozen Frontmatter Contract. Confirmable, but locked to remove the AC3↔AC5 contradiction.
- **R2 — schema version skew**: adding `win` is additive/backward-compatible, but older harness versions in other repos go briefly blind to `win` entries until upgraded. Accepted; document the `schema_version` minor bump.
- **R3 — frozen frontmatter is a fleet contract**: changing a required field later breaks committed records across repos. Mitigate by freezing the join-key set now + pinning with tests.
- **R4 — under-reporting (Goodhart)**: bypass's numerator is voluntary self-report; frame records as gifts that fix friction, team-level-only — captured in the measures doc, not enforced here.
- **R5 — schema location: RESOLVED (validate-v2)** — `retro.schema.json` lives **only** in `skills/eng-harness-loop/eng-harness-4-retro/references/`; the CLI's `RETRO_TEMPLATE` is a "deployment echo" pinned by `retro-template.test.ts` (runs in CI). Adding `win` = one schema edit + `buffer-codec.ts` + template doc + test. No hidden second copy.
- **R6 — "recorded" vs "never blocks"** (named by validate-v2): AC-3 stamps provenance on records that *are* written; capture (AC-9) is suggestive, never blocking, so some bypasses go unrecorded. Accepted: rates are team-level-only with under-reporting framing in the measures doc; a CI cross-check against independent harness-invocation signals is a deferred (OOS) backstop.

## Open Questions
*(Header shape + `plan_id` + `resolves` format resolved by validate-v2 — see Frozen Frontmatter Contract. Two low-stakes confirmations remain:)*
1. **(D4)** base `HEAD` SHA in the provenance header — in or out? *Recommendation: OUT* (branch + repo + timestamp suffice; avoids an extra git call and header noise; addable later as a non-breaking add). Confirm.
2. **(D10)** the-flow pre-implement bypass prompt — confirmed **user-global follow-up, OOS** for this repo's deliverables; the in-repo retro-drain backstop is the guarantee. Confirm.

## Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| Provenance header shape | Storage Design | Affects every record + the future scanner contract | merged frontmatter vs prepended block; how scanners parse it |
| Frontmatter join-key freeze | Data Model | It's a cross-repo contract that's expensive to change later | exact required vs optional fields; the `cause`/`change_type` enums; `resolves` ref format |
| `harness-change` ⇄ retro `[e]ncode` lifecycle | State Machine | When exactly is a change "encoded" (suggested vs landed)? | does add-extension auto-emit, or only on verification pass; relation to retro `system.compound.status` |

## Clarifications
### Session 2026-06-16
**Round 1 (resolved from research — no interactive prompt per session policy):**
- **Workflow Mode → Full.** CS-4, multi-area (record service, git adapter, retro schema, ~6 skill/governance docs, a doc), 5 anticipated phases.
- **Testing Strategy → Hybrid.** Full TDD + fakes for CLI code; manual/dogfood for skill prose (repo culture, PL-15).
- **Mock Usage → B (targeted).** Hand-written `Fake*` port adapters; never `vi.mock` internals.
- **Documentation Strategy → Hybrid.** `docs/how/harness-value-measures.md` + update `record-and-record-types.md`/`AGENTS_README` + `gen:docs`.

**Decisions carried from `distilled-ask.md` (D1–D10):** separate record types (not kinds); highly-suggestive non-blocking capture (CLI writes, flow prompts, router flags); scope = in-repo recording only; frozen join-key frontmatter (drop produced `commit`, keep `branch`; `resolves` = flexible ref); remove `history.md`; provenance stamping on all types; `win` new positive retro kind; used/not-used/extent framing; the-flow edit is user-global.

**Resolved by validate-v2 (2026-06-16):** header shape → merged frontmatter; `plan_id` re-added to the provenance contract; `resolves` ref format locked; AC3↔AC5 contradiction fixed; under-reporting tradeoff named (R6); R5 confirmed. **Still open (low-stakes, recommended defaults applied):** D4 (base HEAD — OUT), D10 (the-flow — OOS follow-up).

---

## Validation Record (2026-06-16)

### Validation Thesis
**Raison d'être**: The harness loop has no durable, scannable signal for when it was *not used* (bypass) or *improved* (change), and no positive "it worked" signal — so "is the harness creating value?" is unanswerable. This spec defines the in-repo recording substrate.
**Value claim**: harness use/non-use/effectiveness becomes recorded and (later) scannable; the improvement changelog gets its first deterministic writer.
**Artifact promise**: the architect can phase it; records carry a frozen frontmatter contract a future fleet scanner can rely on; capture seams prompt records without depending on user-global the-flow.
**Intended beneficiaries**: the architect + 5 phases (now), the future OOS measurement plan, engineering leaders asking "does the harness create value?"
**Proof target**: Decision/Contract.
**Evidence standard**: testable ACs, an enumerated frozen frontmatter contract, explicit scope boundary, decisions grounded in dossier code findings.
**Thesis source**: `distilled-ask.md` (10 decisions) + `research-dossier.md` (2 passes).
**Thesis verdict**: Partially advanced → **advanced after fixes** (frozen contract now sufficient + under-reporting named).
**Main thesis risk**: records frozen but frontmatter insufficient for the promised measurement — mitigated by re-adding `plan_id`, locking header shape, and the AC-10 sufficiency/example requirement.

| Agent | Lenses | Issues | Verdict |
|---|---|---|---|
| Clarity | Evidence Sufficiency, Proof-Level Fit, UX, Hidden Assumptions | 1 CRIT, 2 HIGH, 4 MED, 3 LOW | ⚠️ → fixed |
| Completeness | Edge Cases, Deployment/Ops, Domain Boundaries, Integration, Concept Docs | 0 spec defects (validated code facts; R5 resolved) | ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | 2 MED, 3 LOW | ⚠️ → fixed |
| Forward-Compatibility | Forward-Compat, Integration & Ripple, Technical Constraints | 2 CRIT, 3 MED, 2 LOW | ⚠️ → fixed |

### Forward-Compatibility Matrix
| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| The architect (`/the-flow 3`) | testable ACs, phase shape, scope boundary, OQ resolution | scope boundary | ✅ (post-fix) | 11 ACs testable; 5 phases; open Qs down to 2 low-stakes |
| The 5 anticipated phases | unambiguous deliverables | lifecycle ownership | ✅ (post-fix) | `win` already its own Phase 2; deliverables concrete |
| Future OOS cross-repo scanner | frozen, migration-safe join-key contract | contract drift / shape mismatch | ✅ (post-fix) | `plan_id` re-added; header shape + `resolves` format locked; version-coverage required in AC-10 |

**Thesis alignment**: Value claim advanced at the Decision/Contract proof level; main risk (frozen-but-insufficient frontmatter) closed by re-adding `plan_id`, locking the header shape, and requiring an AC-10 sufficiency proof.

**Outcome alignment**: The spec as written advances the VPO ("make harness use/non-use/effectiveness legible so the harness's value can be measured") — after fixes it now also establishes a frozen, migration-safe contract for the future OOS scanner (the three load-bearing decisions — `plan_id`, header shape, `resolves` format — are closed).

**Standalone?**: No — downstream consumers (architect, 5 phases, future scanner) exist.

Overall: ⚠️ **VALIDATED WITH FIXES**
