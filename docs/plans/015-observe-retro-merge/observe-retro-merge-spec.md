# Observe–Retro Merge: CLI-Owned Friction Capture + One Friction-Lifecycle Skill

**Mode**: Simple
**Created**: 2026-06-10
**Original ask**: [original-ask.md](./original-ask.md)

📚 Specification incorporates findings from `original-ask.md` — the pre-flow design discussion (2026-06-10) that examined both skills, the record service, and the foundations docs (`docs/harness-basics/intro-to-harness.md`, `harness-foundations/simple-mode.md`). No separate research dossier was needed; the discussion record carries the agreed direction.

## Research Context

Key facts established before this spec (item 3 corrected during validation):

1. **The merge is canon-restoring.** The harness loop is *boot → backpressure check → do-work-and-observe → retro → encode*. Observe was never a stage of its own — it is ambient behavior inside "do work." A standalone `eng-harness-3-observe` skill (186 lines) over-formalizes an ambient habit; the foundations describe it as "tell the agent to keep a record of friction it encounters as it works."
2. **The current observe skill violates the harness thesis.** To log one entry the agent must re-infer (per session, and after every compaction): the buffer path from its own slug, the per-kind max ID by scanning the buffer, correct YAML entry shape, and the gitignore semantics. All of that is deterministic work the CLI should own (simple-mode Rule 2: *encode the fix, not the memory*).
3. **The gitignore protection exists but has a hole** *(corrected at validation — the original draft overstated this as wholesale drift)*: `ensureTemp()` in `record-service.ts` already creates `.harness/temp/` with a nested self-`.gitignore` — but only on first **`harness record`** use. The capture path (agents hand-writing the buffer per the observe skill) never triggers it, so in a fresh consumer repo the buffer can sit unprotected until the first record call; and no doctor check proves the protection is in place. This repo's root `.gitignore` line 159 covers `.harness/temp/` as a manual belt-and-braces.
4. **The strong signal has canonical phrasing** (simple-mode Rule 5): the magic wand AND the companion back-pressure question — *"What did you have to infer that the harness should have proved?"* Today the second question is buried as in-flight trigger #7 ("proof-gap self-check") and **absent from the drain prompt entirely**.
5. **Token framing is already canon**, not new scope: "Tokens are expensive — never re-discover something twice"; "you are paying for the inference." Recurrence in the harvest view *is* the token-leak detector; the current skills never say so.
6. **Extension points exist**: the record contract reserves a `placement?` hook explicitly deferred for this kind of growth; doctor has an established convention-complaint pattern (E144 precedent, degraded + exit 0); the core instructions briefing (plan 014) is the zero-context delivery vehicle for teaching any new verb; `RESERVED_NAMES` (extensions/registry.ts) protects core verb names from extension shadowing.
7. **Reference inventory for the rename** (live surfaces only, grep-verified complete at validation; `docs/plans/` history untouched): `README.md`, `INSTALL.md`, `.minih.json`, `docs/how/record-and-record-types.md`, `skills/README.md`, `skills/eng-harness-loop/eng-harness-flow/SKILL.md` (including its dispatch table), `harness/cli/src/services/docs/docs-content.ts` (regenerated via `gen:docs`).
8. **Size baseline**: `eng-harness-3-observe/SKILL.md` (186) + `eng-harness-4-retro/SKILL.md` (517) = **703 lines** — the merged skill must come in under this.

## Summary

Merge the Observe and Retro skills into **one friction-lifecycle skill** (notice → hold safely → present at the seam → route to encoding) and move the mechanical half of observation into the **harness CLI** as a capture verb. The CLI owns everything deterministic about in-flight friction capture — buffer path, agent identity resolution, ID assignment, timestamps, schema validation at write, transient (gitignored, never-committed) storage, and a structured read-back/clear path — so capture survives context compaction and costs the agent one command instead of 186 lines of re-inferred convention. The merged skill keeps only judgment: when to notice, the canonical question pair (magic wand + "what did you have to infer that the harness should have proved?"), the session-end drain menu, and the long-horizon harvest. Token waste becomes legible: a recurring cluster in the harvest view is the same inference being re-paid every session until someone encodes it.

## Goals

- **One skill, whole lifecycle**: a single merged skill owns in-flight capture guidance, session-end drain, and long-horizon harvest — simpler to discover, teach, and keep aligned, without watering down any existing behavior (the preserved-behaviors inventory in AC-14 enumerates exactly what survives).
- **The strong signal**: the simple-mode Rule 5 question pair — the magic wand and *"What did you have to infer that the harness should have proved?"* — asked verbatim both as the headline in-flight capture trigger (with worked friction examples) and as an explicit beat in the session-end drain.
- **Deterministic capture**: a `harness observe` CLI verb that validates and persists one observation per call — CLI-assigned IDs, timestamps, path, schema enforcement, agent-identity resolution. The agent brings the noticing; the harness brings everything else.
- **Lossless across compaction**: observations live on disk the moment they're noticed; after any context loss, a zero-context agent can both capture and drain knowing only `npx harness instructions`.
- **Storage classes with enforced hygiene**: committed records (`.harness/records/` — team memory) vs transient observations (`.harness/temp/` — session scratch, never committed). The existing nested-gitignore mechanism (`ensureTemp()`) fires at capture time, not just record time; doctor proves the protection is in place. No prose-prompted gitignore guidance needed in setup, and no repo-root `.gitignore` mutation.
- **Token-leak legibility** (secondary but explicit): the harvest view frames recurrence as cost — a cluster recurring across sessions is an inference being re-paid until encoded into the environment as team memory.

## Non-Goals

- **No change to the universal retro schema** (v1.0) — no new entry kinds, no new statuses; missing-proof entries keep using existing kinds + targets (`project-sensor` etc.).
- **No token measurement or telemetry** — the token goal is framing and recurrence visibility, not counting tokens.
- **No auto-encoding** — drain/harvest still stage diffs for human review; nothing auto-applies (the human chooses what matters).
- **No repo-root `.gitignore` writes** — the transient class is protected by the nested `.harness/temp/.gitignore` (existing mechanism); root-gitignore entries remain a per-repo courtesy, never CLI-mutated.
- **No changes to `eng-harness-1-boot` / `eng-harness-2-backpressure`** beyond reference updates; no harvest engine redesign (clustering/prioritization logic stays; only labeling/framing changes).
- **Out-of-repo skill copies are follow-up, not this plan**: the global `~/.claude` SDD pipeline skills, the-flow's alias table (`/harness-3` → `harness-3-observe`), and any target repos that already installed the pack. (Same posture as plan 014's deferred global-skills update.)
- **No minih runtime changes** (the `wait_for_any` issue is minih#40, separate).
- **No GitHub installer / distribution changes** — the pack ships as it does today.

## Target Domains

> This repo has no `docs/domains/` registry; domains below are the repo's informal areas (same framing as plan 014).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli core (`harness/cli/src`) | existing (informal) | **modify** | New `observe` core verb (agent-identity resolution → validate → assign ID/timestamp → append to transient buffer; `--list --json` read-back; `--clear`); `observe` added to `RESERVED_NAMES`; `ensureTemp()` invoked at capture time; doctor convention check for the transient protection; core instructions briefing teaches the verb |
| harness skills (`skills/eng-harness-loop/`) | existing (informal) | **modify** | Merge `eng-harness-3-observe` into `eng-harness-4-retro` (one friction-lifecycle skill, < 703 lines, preserved-behaviors inventory honored); question pair elevated in-flight + at drain; token-leak framing in harvest; remove the observe skill folder; update `eng-harness-flow` references **and its dispatch table** (mid-build observe row re-pointed or removed, documented) |
| setup skills (`skills/eng-harness-setup/`) | existing (informal) | **modify** | Light touch (verified: no existing gitignore prose to remove): optionally add a one-line pointer to the doctor convention check; concrete file list decided in /plan-3 |
| repo docs & config refs (`README.md`, `INSTALL.md`, `.minih.json`, `docs/how/`, `skills/README.md`) | existing (informal) | **modify** | Update all live references to the retired skill slug; update `docs/how/record-and-record-types.md` for the two storage classes + capture verb; regen `docs-content.ts` via `gen:docs` |

## Testing Strategy

- **Approach**: Hybrid — Full TDD (RED/GREEN pairs) for all CLI behavior (observe verb incl. identity resolution, validation, ID assignment, transient placement + nested gitignore, list/clear, doctor check, instructions briefing content); manual/dogfood verification for skill prose (a real capture → drain → record session in this repo).
- **Rationale**: identical split to plan 014 — CLI core is deterministic and fully testable through fake ports; SKILL.md prose has no deterministic sensor (a recorded back-pressure gap) and is validated by use.
- **Focus Areas**: write-time validation rejects bad entries without corrupting the buffer; ID sequencing under repeated calls (including malformed-entry tolerance); first-use bootstrap (dir + nested gitignore) idempotency; doctor degraded/ok transitions; identity-resolution fallback chain; drain end-to-end against real captured entries.
- **Excluded**: harvest clustering internals (unchanged); minih-dependent flows.
- **Mock Usage**: fakes only via existing ports (`FsPort`, `ClockPort`, proc/env) per constitution P3 — no mocking frameworks; integration tests may use the real CLI via the established fixture pattern. (All AC-1..AC-7 checks are coverable by `FakeFs`'s `exists`/`readText`/`writeText`/`mkdirp` — confirmed at validation.)

## Documentation Strategy

- **Location**: `docs/how/` only — update `record-and-record-types.md` (two storage classes, capture verb, drain materialization) and regen `gen:docs`; no new README sections beyond reference fixes.
- **Rationale**: the CLI's own `instructions`/`help` surfaces are the primary teaching channel (014 thesis); `docs/how/` carries the depth.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=0, T=1 → P=5
- **Confidence**: 0.85
- **Assumptions**: the record contract's reserved `placement?` hook (or an equivalent service-level mechanism — /plan-3 decides) suffices for the transient class; the per-agent buffer file remains the storage location (format may change — see Workshop Opportunities); envelope/exit-code mapping follows P4–P6 exactly as in 014; **the buffer is not file-locked** — the rare capture-during-drain race is accepted under the per-agent single-session model and documented in the merged skill (validation finding, accepted).
- **Dependencies**: plan 014 landed (instructions act, doctor convention pattern, folder extensions) — all merged-to-branch and green (317/317).
- **Risks**: see § Risks & Assumptions.
- **Phases**: single phase expected (Simple); /plan-3 confirms.

## Acceptance Criteria

1. **Capture happy path**: `npx harness observe "<description ≥10 chars>" --kind difficulty --target tooling --severity degrading [--workaround …] [--suggested-encoding …]` exits 0 with an `ok` envelope and appends one schema-valid entry to the calling agent's transient buffer — with a CLI-assigned per-kind sequential ID and an ISO timestamp. The agent supplies no path, no ID, no timestamp. The `observe` name is added to `RESERVED_NAMES` so extensions cannot shadow it.
2. **Agent identity is CLI-resolved, never demanded** (D-11): the buffer bucket resolves as `--agent <slug>` flag → `HARNESS_AGENT` env var → the deterministic default bucket (`agent`). Capture never fails on identity — identity is provenance labeling, not routing ceremony. Agents that opt in with different slugs get separate buckets.
3. **CLI-owned ID sequencing**: two consecutive captures of the same kind receive consecutive IDs (e.g. `DL-001`, `DL-002`); counters are independent per kind; all seven schema kinds are accepted. Malformed/unparseable entries already in the buffer are skipped by the ID scan (append-only preserved — the CLI never rewrites existing buffer content).
4. **Validation at write**: an unknown `--kind`/`--severity` or a too-short description is rejected (per P4–P6: `unconfigured`, exit 2) with the allowed values named in `next_action`, and the buffer is unchanged. A wholly unreadable buffer yields an `error` envelope (exit 1) with a named error code — never silent data loss. A repo with no `.harness/` returns `unconfigured` (exit 2) with `next_action` naming harness setup (014 record-act precedent).
5. **Transient guarantee at capture time**: every capture invokes the existing `ensureTemp()` mechanism — `.harness/temp/` is created if absent and carries its nested self-`.gitignore` (idempotent; **no repo-root `.gitignore` writes**); after a capture in a fresh repo whose root `.gitignore` lacks any entry, `git status` shows no new tracked files.
6. **Doctor convention check**: `.harness/temp/` exists without its nested `.gitignore` → doctor reports a convention complaint with `next_action` and overall `degraded` (exit 0, matching the E144 precedent); protection present (or no temp dir yet) → the layer reads ok. (Sensor = `FsPort.exists` on the nested file — trivially fake-testable.)
7. **Structured read-back + clear** (D-12 defaults, vetoable): `harness observe --list --json` returns pending observations verbatim (including `suggested_encoding`, timestamps, kind/target/severity) as structured envelope data — **across all buckets by default**, each entry annotated with its bucket, `--agent <slug>` narrowing to one; `harness observe --clear` truncates what `--list` would return (all buckets by default, `--agent`-scopable; files kept) and returns `ok`. The drain consumes these instead of hand-parsing markdown — sweep-complete by default, so no bucket is ever silently stranded.
8. **Compaction resilience, end to end**: knowing only `npx harness instructions`, a zero-context agent learns the capture verb (identity optional — the default bucket just works) and the drain flow (core briefing updated); an observation captured before a simulated context wipe is returned by `--list` after it.
9. **Drain integration**: the merged skill's `--drain` reads pending observations via `--list --json` (all buckets — the sweep), presents the `[s/t/p/e/d/a]` menu, materializes saved entries via `harness record retro` (using the returned `data.path` — paths never hard-coded in prose), and clears via `--clear` — proven by one real dogfood session in this repo.
10. **The question pair, verbatim** (wording locked in D-13): the merged SKILL.md carries both canonical questions — the magic wand and *"What did you have to infer that the harness should have proved?"* — (a) as the headline in-flight capture trigger (its own named section, not item #7 of a list) with ≥3 worked friction examples (boot dance re-derived; architecture rule eyeballed; endpoint behavior inferred with no smoke path), and (b) as an explicit beat inside the drain's session-end soft prompt, using the same locked wording. Both placements are grep-verifiable strings.
11. **Token-leak legibility**: the harvest cluster view labels recurrence with cost framing (a recurring cluster = the same inference re-paid each session until encoded) — display wording only; schema, statuses, and clustering logic unchanged.
12. **Merge complete, smaller surface**: `skills/eng-harness-loop/eng-harness-3-observe/` is removed; the merged `eng-harness-4-retro/SKILL.md` totals **fewer than 703 lines**; `grep -r eng-harness-3-observe` over live surfaces (everything outside `docs/plans/`) returns zero hits — README, INSTALL, `.minih.json`, `skills/README.md`, `docs/how/record-and-record-types.md`, regenerated `docs-content.ts`, and the `eng-harness-flow` skill including its **dispatch table** (mid-build observe row re-pointed to the merged skill or removed — the choice documented in the merged skill or flow skill).
13. **No overclaim**: every CLI behavior the merged skill describes is provably implemented (the capture-time `ensureTemp()` guarantee makes the old skill's first-record-use claim true at first-capture too; prose matches code).
14. **Preserved-behaviors inventory** (the "without watering down" proof — each item present in the merged SKILL.md, verified by review checklist):
    (a) calibration targets (≤1 self-prompt / 5 min, ≤5 entries/session, soft);
    (b) task-boundary heuristic (self-prompt only when the buffer is empty);
    (c) cross-session leftover check at auto-firing skill start (now bucket-sweeping via `--list`'s all-buckets default);
    (d) drain menu `[s/t/p/e/d/a]` semantics incl. selective save, `/plan-5 --fix` + `/plan-1b` emission, encode staging with the mandatory Validation footer, dismiss;
    (e) harvest lifecycle ops `[r]esolved` / `[w]ontfix` / `[s]tale` (in-place status mutations);
    (f) three-tier encoding-hint generation (entry field → kind/target templates → fallback);
    (g) plan-id detection rules (cwd → branch → null);
    (h) harvest clustering/prioritization, stale thresholds, `--json` contract, prune dry-run;
    (i) buffer-non-empty advisory at harvest start.
15. **Suite green**: full suite passes from both `harness/cli` and the repo root; all new CLI behavior covered by TDD pairs using fakes; existing `record`/`retro` tests unaffected.

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Legacy buffer entries (pre-merge YAML written by the old skill) confuse the new read path | Medium | Medium | /plan-3 decides: read both formats or document a one-time manual drain before upgrade; never silently drop entries |
| Capture-during-drain race loses an entry (buffer not file-locked) | Low | Low | Accepted under the per-agent single-session model; trade-off documented in the merged skill (validation finding, accepted) |
| Out-of-repo copies (the-flow alias table, global `~/.claude` skills, repos that installed the pack) still reference the retired slug | High | Low | Explicit non-goal + flagged follow-up (014 precedent); in-repo references all updated (AC-12) |
| `.minih.json` worker prompts reference the observe skill — workers could brief stale | Medium | Low | In the AC-12 reference sweep; dogfood drain (AC-9) exercises the real flow |
| Merged skill drifts back toward mechanics prose over time | Low | Medium | AC-13 (no overclaim) + the <703-line bar + AC-14 inventory give review concrete checks |

**Assumptions**: the universal retro schema v1.0 stays frozen; `harness record retro` remains the sole materialization path for committed retros (records land under `.harness/records/retro/<date>/<NNN>-<slug>.md` — the dated-subdir layout; the old skill prose's flat-path example is stale and dies with the rewrite); bucket isolation is opt-in provenance, not a routing requirement (D-11); CLI-owned single-process appends make concurrent capture safe; the buffer is not file-locked (race accepted, above).

## Open Questions

None blocking. Defaults D-5, D-6, D-11, D-12, D-13 are recorded with rationale and may be vetoed before /plan-3; everything else open is explicitly assigned to /plan-3 (D-7 mechanism route, buffer storage format).

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Transient buffer storage format | Storage Design | Current buffer is append-only YAML blocks in markdown; CLI-owned writes could prefer JSONL for parse safety | Keep YAML-in-md (drain-compatible, human-readable) or move to JSONL (machine-safe)? Migration/coexistence for legacy entries? *(Optional — likely resolvable as a /plan-3 design decision)* |

*(A second candidate — the observe verb's CLI contract — was resolved at validation: flag shapes locked as D-12 defaults.)*

## Clarifications

### Session 2026-06-10

All Round 1/Round 2 items were settled from repo precedent and the pre-flow design discussion recorded in `original-ask.md`, per the user's instruction ("answer from that discussion record where it already settles them; only surface genuinely open user decisions"). D-11..D-13 were added at validation. Each is user-vetoable before /plan-3.

- **Q: Workflow Mode** → **A: Simple.** CS-3, single repo, one expected phase — identical shape to plan 014 (also Simple/CS-3 with a CLI-core + skills + docs spread).
- **Q: Testing Strategy** → **A: Hybrid.** Full TDD for CLI core (constitution P3 fakes-only, RED/GREEN pairs — the 014 pattern); manual/dogfood for skill prose (its lack of a deterministic sensor is a recorded back-pressure gap in `.harness/engineering-harness.md`).
- **Q: Mock Usage** → **A: Fakes only via ports** (FsPort/ClockPort/proc), no mocking frameworks — constitution P3, unchanged from 014.
- **Q: Documentation Strategy** → **A: docs/how/ only** (update `record-and-record-types.md`, regen `gen:docs`) — 014 precedent; the CLI's `instructions`/`help` surfaces are the primary teaching channel.
- **D-5: Merged skill slug** → **default: keep `eng-harness-4-retro`** (capture guidance folds in; `eng-harness-3-observe/` removed). Stability for every pipeline skill that auto-fires `--drain`/`--harvest` outweighs a tidier name. The numbering gap at 3 is honest: loop stage 3 is *do work and observe* — the work itself, supported by the CLI verb, not a skill. **User may veto.**
- **D-6: Capture verb name** → **default: `harness observe`** — matches the loop-stage language used across the foundations docs; name reserved in `RESERVED_NAMES`. **User may veto.**
- **D-7: Transient mechanism** → outcome fixed by this spec (CLI-owned transient class under `.harness/temp/<agent>/`, nested-gitignore guaranteed at capture time, doctor-checked); the implementation route (record contract's reserved `placement?` hook vs a dedicated service) is a /plan-3 design decision. This is the spec's answer to the original ask's "do we need a new record type?": the underlying need (frictions tracked as we go, harvested into retros, never lost, never committed) is met by a **verb + transient storage class**, not a new schema kind — committed records stay the team-memory class, transient observations stay session scratch.
- **D-8: Agent harness readiness** → harness exists at **L3** (`.harness/engineering-harness.md`); sufficient for this feature — this plan *is* an Improve-beat of that loop.
- **D-9: Schema posture** → universal retro schema v1.0 untouched; no new kinds; missing-proof entries keep `kind: difficulty` + targets like `project-sensor`.
- **D-10: Token goal scope** → framing + recurrence visibility only; no token counting or telemetry.
- **D-11: Agent identity resolution** *(added at validation as the spec's one CRITICAL gap; softened by user veto same day)* → **`--agent <slug>` flag → `HARNESS_AGENT` env var → deterministic default bucket (`agent`). Capture never fails on identity.** The strict form (error when undeterminable) was vetoed: "the agent" is almost always the one coding agent in use; minih workers operate in cloned target repos, and companions have their own feedback channel (inbox/farewell). Identity is provenance labeling, not routing ceremony — the real risk was never collision (CLI-owned appends serialize) but *stranded buckets*, which D-12's all-buckets sweep closes.
- **D-12: Read-back / clear flag shapes** *(added at validation — AC-7/AC-9 needed a locked contract)* → **default: `harness observe --list [--json]` and `harness observe --clear` — both operate across all buckets by default, `--agent <slug>` scopes.** Locked now so the merged SKILL.md prose can name exact commands; /plan-3 may add sugar but not rename. **User may veto.**
- **D-13: Canonical question wording** *(added at validation)* → locked verbatim: *"If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or higher quality?"* and *"What did you have to infer that the harness should have proved?"* (simple-mode Rule 5). The old skill's longer paraphrase ("Could I have proven this task's success…") may appear as supporting prose but the locked strings are the grep-verifiable contract (AC-10).

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Turn the agreed pre-flow direction (`original-ask.md`) into a buildable contract for /plan-3: one friction-lifecycle skill, CLI-owned compaction-proof capture, the inference-vs-determinism question as a strong signal, token-leak legibility.

**Value claim**: Friction capture becomes deterministic, lossless across compaction, and cheaper; the skill surface gets simpler without losing existing behavior.

**Artifact promise**: /plan-3 can architect directly from this spec without re-asking the user; every open choice is either decided (D-1..D-13) or explicitly assigned to /plan-3.

**Intended beneficiaries**: the 015 /plan-3 run, the implementing agent, zero-context agents using the harness, pipeline skills auto-firing `--drain`/`--harvest`.

**Proof target**: Contract.

**Evidence standard**: ACs testable; factual claims grep/source-verified; decisions traceable to `original-ask.md` and the foundations docs.

**Thesis source**: `docs/plans/015-observe-retro-merge/original-ask.md` (not inferred).

**Thesis verdict**: Advanced (post-fix; pre-fix "Partially" — preservation claims were prose, now AC-14).

**Main thesis risk** (from the Thesis agent, pre-fix): preservation scope creep uncaught at spec time — the merged skill could silently drop calibration targets, encoding hints, and harvest lifecycle ops. Addressed by AC-14's enumerated inventory.

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Clarity & Accuracy | Factual Accuracy, Technical Constraints, Hidden Assumptions, Concept Documentation | Evidence Sufficiency | 2 MEDIUM — both fixed | ⚠️ → ✅ |
| Completeness & Edge-Case | Edge Cases, System Behavior, Integration & Ripple, Deployment & Ops | Downstream Usefulness | 1 CRITICAL + 4 HIGH + 4 MEDIUM/LOW — fixed (1 race accepted + documented) | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, Value Preservation | Learning Compounding | 1 HIGH + 4 MEDIUM/LOW — fixed via AC-14, AC-10, D-13 | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compat, Contract Drift, Lifecycle Ownership, Test Boundary | Implementation Readiness | 1 HIGH (dissolved — see note) + 4 MEDIUM/LOW — fixed | ⚠️ → ✅ |

**Notable correction**: the FC agent's P2-violation finding (AC-4 repo-root `.gitignore` write) dissolved the issue at its root — it surfaced that `ensureTemp()` already implements a nested-gitignore mechanism, which also **corrected a false drift claim in this spec's own Research Context** (item 3). The spec now reuses the existing mechanism at capture time; no repo-root writes, no P2 deviation, simpler doctor sensor.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| /plan-3 architect (015) | Testable ACs + explicit deferred-decision list | contract drift | ✅ (post-fix) | D-11/D-12 lock identity + flag shapes; remaining deferrals (D-7 route, storage format) explicitly assigned |
| /harness-2-backpressure (optional) | ACs mappable to deterministic sensors | test boundary | ✅ | AC-1..AC-8 sensor-rich; AC-6 sensor = `FsPort.exists` on nested gitignore |
| Implementing agent | Reference inventory + 703 baseline + constitution fit | contract drift | ✅ (post-fix) | P2 concern dissolved (nested mechanism); P3 coverable by FakeFs (verified) |
| Pipeline skills (auto --drain/--harvest) | Slug + verb + read-path stability | shape mismatch | ✅ (post-fix) | D-5 slug locked; D-12 flags locked before SKILL prose authored |
| `harness record retro` materialization | Sole committed-record writer; real paths | lifecycle ownership | ✅ | AC-9 uses returned `data.path`; stale flat-path prose dies with the rewrite |

**Thesis alignment**: Value claim advanced at Contract level post-fix; main residual risk is preservation drift during implementation, now pinned by AC-14's review checklist.

**Outcome alignment** (echoed verbatim from the Forward-Compatibility agent): "The spec successfully turns the agreed direction from original-ask.md into a buildable contract for /plan-3: CLI-owned `harness observe` capture verb (transient gitignored storage, ID/timestamp/validation, structured read-back) with merged skill prose (notice → drain → harvest lifecycle). However, three design decisions are deferred (AC-4 gitignore target, AC-5 sensor, AC-8 buffer-clear mechanism, AC-6 flag shape) and one constitution violation (P2 boundary on repo-root `.gitignore` edit in AC-4) requires a Deviation Ledger entry. The contract is sound if these gates are resolved before implementation; otherwise, AC-8/AC-9 prose will be authored without knowing the flag shape or clear mechanism." — *All four named gates were resolved in this revision (D-11/D-12 lock the mechanisms; the P2 concern dissolved with the nested-gitignore correction).*

**Standalone?**: No — downstream /plan-3 consumer named.

Overall: **VALIDATED WITH FIXES**

> **Post-validation revision (same day)**: the user vetoed strict identity (D-11) in favor of default-bucket capture + all-buckets `--list`/`--clear` sweep (D-11/D-12 reworded; AC-2/AC-7/AC-8/AC-9/AC-14c adjusted). The CRITICAL's substance — identity must be deterministic and no bucket may strand — is preserved by different means: a deterministic default instead of an error, and a sweep-complete drain instead of per-caller routing.
