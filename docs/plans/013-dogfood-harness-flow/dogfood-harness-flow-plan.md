# validate-harness-flow Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-09
**Spec**: [dogfood-harness-flow-spec.md](./dogfood-harness-flow-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` left; 5 open questions resolved by recorded defaults |
| G2 | Constitution | PASS | Verb uses `ctx` ports + Envelope (P2/P4), honest `unconfigured`/`degraded` (P5), wraps `minih`/`git` not rebuilds (P8); no `node:*` imports. Mirrors accepted `validate-harnessability.ts` |
| G3 | Architecture | PASS | New files are a repo-local `.harness/extensions/` dogfood + an `agents/` minih def + `docs/`; **no `harness/cli/src` core changes** — stays within the extension seam (architecture.md §5) |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required Simple-mode sections present |
| G6 | Testing Alignment | PASS | Lightweight (spec); validation/smoke tasks present (T006, T008, T009) |
| G7 | Domain Completeness | PASS | No formal domain registry; informal Target Domains + Domain Manifest below cover every file |

## Summary

Add a second dogfood extension, `harness validate-harness-flow`, that mirrors `validate-harnessability.ts` but whose per-repo `minih` worker runs the **full harness setup flow** on a freshly-cloned public repo — install → harnessability assessment → hand-written `engineering-harness.md` governance → author + validate a `boot` extension → record a retro — firing **3 in parallel** and returning immediately. A `--collect` mode waits for the children to reach terminal states and aggregates their records + reports into `docs/plans/013-dogfood-harness-flow/runs/`. We then **dogfood the same flow on this repo**, record our own retros, and report all collected records back. Retros are surfaced, **never auto-implemented** (the only corrective change allowed mid-work is repairing a broken record-write path).

## Target Domains

> No `docs/domains/registry.md` — domains are informal. This feature fits existing structure (no new formal domain).

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `.harness/extensions/` (dogfood extensions) | existing | create | Add `validate-harness-flow.ts` |
| `agents/` (minih agent defs) | existing | create | Add `agents/validate-harness-flow/` |
| `docs/plans/013-…/runs/` (collection sink) | NEW (artifact dir) | create | Aggregated child records + rollup |
| `eng-harness-*` skills + `references/governance-doc.md` | existing | consume | Driven by the worker; not modified |
| `harness record` / `.harness/records/retro/` | existing | consume | Children + we record retros here |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `.harness/extensions/validate-harness-flow.ts` | dogfood extensions | internal | The orchestrator verb + `--collect` mode (fork of `validate-harnessability.ts`) |
| `agents/validate-harness-flow/agent.json` | agents | internal | minih manifest (fork of `install-and-validate-test-extension`) |
| `agents/validate-harness-flow/prompt.md` | agents | internal | Worker mission = the autonomous recipe + frontmatter (permissions/timeout) |
| `agents/validate-harness-flow/instructions.md` | agents | internal | Rules: drive skills, independent verification, throwaway, capture friction |
| `agents/validate-harness-flow/input-schema.json` | agents | contract | Worker inputs (`targetRepo` required, `harnessSource`, `keepTarget`) |
| `agents/validate-harness-flow/output-schema.json` | agents | contract | Worker report (AC-6 fields) — consumed by `--collect` rollup |
| `docs/how/dogfood-harness-flow.md` | docs | internal | The guide (AC-11) |
| `docs/plans/013-dogfood-harness-flow/runs/` (+ `ROLLUP.md`) | collection sink | internal | Created at runtime by `--collect` (AC-8) |

## Key Findings

> From `research-dossier.md` (already validated) — no fresh research subagents needed.

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `eng-harness-flow` is an **interactive** print-then-offer router (SKILL.md:222-234) — it cannot be "run" headless | Worker **drives the child setup skills directly** in order (`assess` → governance → `add-extension` → `boot --validate` → `record retro`), the `install-and-validate-test-extension` pattern. The flow skill is reference only |
| 02 | High | `harness init` (governance writer) is **not shipped** (`app.ts` registers no `init`) | Worker **hand-writes** `.harness/engineering-harness.md` from `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` (8 BIO fields). The gap is itself a logged dogfood finding |
| 03 | High | No-auto-implement is **already guaranteed** by `eng-harness-4-retro` (SKILL.md:165-167, 223-225, 471-478) | Inherit it. The ONLY corrective change we make mid-work is repairing a **broken record-write path** (e.g. `harness record` errors) — never a retro-sourced change |
| 04 | High | Two near-perfect templates exist (`validate-harnessability.ts`, `agents/install-and-validate-test-extension/`) | Build by **fork + adapt**, not from scratch. Reuse the temp-dir clone loop, `lastRunId`/`captureNewRun`, detached `nohup "$@"` fire, immediate `ctx.ok/degraded/error` return |
| 05 | Medium | Worker drives skills from **two** sources (`skills/eng-harness-setup` + `skills/eng-harness-loop`) using the `eng-harness-0-*` skill names; runs from `$MINIH_PROJECT_ROOT` (this repo) on a `targetRepo` param | Fire with explicit `--skill-source path:skills/eng-harness-setup --skill-source path:skills/eng-harness-loop --skill eng-harness-0-harnessability-assessment --skill eng-harness-0-add-extension --skill eng-harness-4-retro` (and confirm vs `.minih.json`) |
| 06 | Medium | Collection can race still-running children (validation finding) | `--collect` polls each `runId` to a terminal state (`output/report.json` has terminal `verdict`, or `minih status` terminal) before copy; classifies `DONE`/`TIMED_OUT`/`MISSING_REPORT` |

## Implementation

**Objective**: Ship `harness validate-harness-flow` (+ its `minih` worker + `--collect` rollup + a guide), then dogfood the flow on this repo and report all collected records.
**Testing Approach**: Lightweight — the extension + agent are validated by **real end-to-end smokes** (`doctor`/`help`/`--help`, a single-worker run, and the culminating 3-parallel run), mirroring `validate-harnessability.ts` (no unit tests). Any extracted pure helper gets a fake-based unit test per repo convention (Constitution P3).

> **Dogfooding is continuous (not end-loaded).** Throughout T001–T012 we **use our own harness skills as we work** — `eng-harness-3-observe` to capture friction at the moment it happens, `harness record retro` to author our own retros at task/phase seams, and `eng-harness-flow`/`harness doctor` for orientation — exactly as a real user would. This is the point: we test the actual harness flow by living in it while we build the thing that automates it. (Requires the reloaded harness/skills to be available; if a record-write path is broken while doing this, fix it — the one allowed carve-out, Finding 03.)

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Scaffold the worker agent folder by forking `install-and-validate-test-extension`: write `agent.json` (name/desc/tags), `input-schema.json` (`targetRepo` required; `harnessSource` local\|github default local; `keepTarget` bool) | agents | `agents/validate-harness-flow/{agent.json,input-schema.json}` | `minih list` shows `validate-harness-flow`; input schema validates | Fork *shape* from `agents/install-and-validate-test-extension/`, but this input-schema is **NEW** and intentionally differs from the source's (`verbName`/`variant`/`keepTempRepo`) — keep it mutually consistent with the prompt (T003) and the orchestrator `-p` params (T006). Finding 04 |
| [x] | T002 | Write `output-schema.json` with the AC-6 contract: `targetRepo`, `harnessabilityGrade`, `axisTuple`, `abandoned`+`abandonReason`, `governanceWritten`, `bootAuthored`, `bootRuns`, `retroRecorded`, `retroRecordPaths[]`, `verdict` (PASS\|FAIL\|ABANDONED), `summary`, dual-layer `retrospective{workedWell,confusing,magicWand,magicWandTarget(project\|minih),difficulties[]}` | agents | `agents/validate-harness-flow/output-schema.json` | `minih check validate-harness-flow <sample>` validates a hand-written sample report | Must carry every field the `--collect` rollup consumes (AC-6); Finding 06 |
| [x] | T003 | Write `prompt.md` (mission + frontmatter: `model`, `timeout` ≥1800, `permissions` read-only + overrides shell/write/network, `allowedRoots` extend `/tmp`,`/private/tmp`,`/var/folders`) encoding the **autonomous recipe**: `cd $MINIH_PROJECT_ROOT`; install harness into `targetRepo`; run `eng-harness-0-harnessability-assessment`; read `verdict.final_grade`+axis tuple; **abandonment gate** (D/F or lowest Operate-Today band ⇒ `verdict: ABANDONED`, stop); else hand-write `.harness/engineering-harness.md` (8 BIO fields from `references/governance-doc.md`); author `boot` via `eng-harness-0-add-extension`; validate it boots; `harness record retro` and fill it; emit `output/report.json` | agents | `agents/validate-harness-flow/prompt.md` | `minih run validate-harness-flow -p targetRepo=/tmp/x --dry-run` previews a coherent prompt that names each recipe step | Findings 01, 02, 05; embed the BIO field list + the assessment→report field mapping inline |
| [x] | T004 | Write `instructions.md` rules: **drive the setup skills, don't bypass them**; **independent verification mandatory** (re-check via `harness doctor`/`harness boot`, don't trust skill self-reports); prefer `--json`; **throwaway writes only** (the clone + `/tmp`); **capture friction at the moment of friction** (numbered `VF-NNN`, layer-tagged `project`\|`minih`) | agents | `agents/validate-harness-flow/instructions.md` | `minih inspect validate-harness-flow` shows instructions composed; skills resolve | Mirrors `install-and-validate` instructions |
| [x] | T005 | Verify the worker is wired before building the orchestrator: `minih skills doctor` / `minih inspect validate-harness-flow` lists the `eng-harness-0-*` + `eng-harness-4-retro` skills as available from both sources | agents | — | All required skills resolve for the agent; no mis-wire | Finding 05; if a skill is missing, fix the `--skill-source`/`.minih.json` before T006 |
| [x] | T006 | Author the orchestrator extension by forking `validate-harnessability.ts`: temp dir, `git clone --depth=1` loop (per-repo de-dup), detached injection-safe `nohup "$@"` fire of `minih run validate-harness-flow -p targetRepo=<dest> [-p harnessSource=github] [-m model] <skill flags>`, `lastRunId`/`captureNewRun`, immediate `ctx.ok/degraded/error` with `next_action` poll+collect prompt. Options: `--repo <urls...>`, `--keep`, `--model`, `--github`, `--collect` | dogfood extensions | `.harness/extensions/validate-harness-flow.ts` | `harness doctor` lists it `loaded`; `harness help` shows it; `harness validate-harness-flow --help` renders all options (AC-1) | Findings 04, 05; **param contract**: always pass `-p targetRepo=<dest>`; `--github` ⇒ add `-p harnessSource=github` (default omits ⇒ worker uses local). The template only passes `targetRepo` — this verb adds `harnessSource`, so the worker prompt (T003) must read it. No `node:*`, all I/O via `ctx.exec`, never throws (Constitution P2) |
| [x] | T007 | Implement the `--collect` mode in the extension: for given/last run IDs, **poll each to terminal** (`output/report.json` terminal `verdict`, or `minih status … terminal`) with a wait cap; classify `DONE`/`TIMED_OUT`/`MISSING_REPORT`; copy each `DONE` child's `.harness/records/retro/*.md`, `.harness/reports/harnessability/latest.{md,json}`, `output/report.json` into `docs/plans/013-dogfood-harness-flow/runs/<repo>/`; write `runs/ROLLUP.md` listing every run + state + merged counts/clusters; idempotent; never mutates child records | dogfood extensions | `.harness/extensions/validate-harness-flow.ts` | `harness validate-harness-flow --collect` on finished runs produces `runs/<repo>/` dirs + `runs/ROLLUP.md` (AC-8); re-running is a no-op-safe refresh | Finding 06; **ownership boundary**: `--collect` reads each child's CLONE dir (disjoint from THIS repo's `.harness/records/retro/`), so it never races our own self-dogfood writes (those are snapshotted once in T012). AC-8/AC-9 (no auto-implement in the rollup) |
| [ ] | T008 | **Single-worker real smoke** (AC-5): fire one well-known small repo and let the worker complete the recipe end-to-end | dogfood extensions | `agents/validate-harness-flow/`, `.harness/extensions/validate-harness-flow.ts` | One worker's `output/report.json` is schema-valid with `verdict: PASS`; on disk: harness installed, harnessability report present, `engineering-harness.md` has 8 BIO fields, a `boot` extension that returns honest `ok`, a retro recorded | If `harness record` itself errors here, **fix that record-write path** (the one allowed carve-out, Finding 03) |
| [ ] | T009 | **Culminating 3-parallel smoke** (AC-12): run the default 3 targets (Node/Python/Go) concurrently, wait for terminal, then `--collect` | dogfood extensions | `.harness/extensions/validate-harness-flow.ts`, `docs/plans/013-…/runs/` | All 3 fire; after terminal, `--collect` yields three `runs/<repo>/` dirs + `runs/ROLLUP.md`; ≥1 PASS, abandonment path exercised if any repo scores poorly | Default pool: `expressjs/express`, `pallets/click`, `spf13/cobra` (alternates held for re-fire on ABANDONED) |
| [ ] | T010 | **Dogfood the flow on THIS repo, continuously** (AC-10): as we build (across T001–T012) use the harness loop ourselves — `eng-harness-3-observe` to capture friction live, `harness record retro` to author our own retros at task/phase seams, `eng-harness-flow`/`doctor` for orientation; collect our own records alongside the children's | harness record | `.harness/records/retro/`, `docs/plans/013-…/runs/` | ≥1 `.harness/records/retro/*.md` authored by us **during** the build (not only at the end); included in the final rollup/report | Continuous process task; uses the reloaded harness/skills; **our own records are snapshotted once in T12 (after build tasks cease), not via a mid-flight `--collect`** — avoids racing in-flight writers; retros surfaced, never auto-implemented (AC-9) |
| [x] | T011 | Write the `docs/how/` guide (AC-11): what the extension does, the recipe, the `--collect`/rollup flow, the no-auto-implement guarantee | docs | `docs/how/dogfood-harness-flow.md` | Guide present, links the extension + agent + `runs/ROLLUP.md`; pointer added from `README`/`skills/README` if a discoverability gap exists | Matches existing `docs/how/` guides |
| [ ] | T012 | **Report back** (AC-10 culmination): summarize the children's + our own collected records (counts, key magic-wand/difficulty clusters), present improvement options — **do not implement them** | collection sink | `docs/plans/013-…/runs/ROLLUP.md` | A final summary presented to the user; options surfaced for the user to optionally pursue deeper; nothing auto-applied | Closes the loop; AC-9 |

### Acceptance Criteria

- [ ] AC-1 — `harness validate-harness-flow` registered (`help`/`doctor` loaded; `--help` renders). *(T006)*
- [ ] AC-2 — Clones default 3 (Node/Python/Go), fires one detached worker per clone, returns immediately with runIds + `next_action`. *(T006, T009)*
- [ ] AC-3 — Options `--repo`, `--keep`, `--model`, `--github`, `--collect`; never throws; every non-ok carries `next_action`. *(T006, T007)*
- [ ] AC-4 — Worker agent folder defines all 5 files with the specified frontmatter/rules. *(T001–T004)*
- [ ] AC-5 — One worker completes the recipe end-to-end (install→assess→governance(8 BIO fields)→boot boots→retro), schema-valid report + on-disk artifacts. *(T008)*
- [ ] AC-6 — Report carries the full field set incl. the fixed assessment→report mapping. *(T002, T008)*
- [ ] AC-7 — Abandonment path: poor harnessability ⇒ `verdict: ABANDONED` + reason, reported not FAILed; operator re-fires via `--repo`. *(T003, T009)*
- [ ] AC-8 — `--collect` waits for terminal children, classifies DONE/TIMED_OUT/MISSING_REPORT, copies records/reports into `runs/<repo>/`, writes `runs/ROLLUP.md`; never mutates child records. *(T007, T009)*
- [ ] AC-9 — No auto-implement anywhere; only a broken record-write path may be fixed mid-work. *(T007, T008, T012)*
- [ ] AC-10 — We dogfood the flow on this repo, record our own retros, and report all records back. *(T010, T012)*
- [ ] AC-11 — `docs/how/` guide documents extension + recipe + collection/report. *(T011)*
- [ ] AC-12 — Culminating 3-parallel fire-and-collect smoke proves the full path. *(T009)*

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Worker can't finish a full setup within timeout/model limits | Medium | High | `timeout` ≥1800; small repos; library/CLI boot (build+test) is the cheapest proof; abandonment path covers "no good boot" |
| Skill mis-wire (both sources / `eng-harness-0-*` names) | Medium | Medium | T005 verifies `minih skills doctor`/`inspect` resolve before building the orchestrator (Finding 05) |
| Governance must be hand-written (no `harness init`) | High (known) | Low | BIO template embedded in `prompt.md`; the gap is a logged dogfood finding (Finding 02) |
| Collection races still-running children | Medium | Medium | `--collect` polls to terminal + classifies states before copy (Finding 06) |
| Chosen repo clones need auth / exotic toolchain | Low | Medium | Curated public pool (Node/Python/Go) with obvious build/test; alternates held for re-fire |
| Parallel runs interfere on shared paths | Low | Medium | Per-repo temp dirs + per-repo run dirs (copied de-dup logic from `validate-harnessability.ts`) |

## Agent Harness Strategy

Not applicable as a build gate for **this** repo — there is no `docs/project-rules/engineering-harness.md` here, and provisioning one is **out of scope** (the deferred `harness init` writer). Note: T010 *dogfoods* the harness loop on this repo as a deliberate exercise (recording our own retros), but that is feature scope, not a Phase-0 readiness gate. The harness-loop scaffolding rows are therefore omitted from the task table.

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: Give `/plan-6` enough to BUILD the dogfood extension + worker + `--collect` + smokes + continuous self-dogfood + report, so the harness setup flow is proven on real repos and friction is collected to improve the system.

**Value claim**: The build can proceed with minimal clarification; both halves (the parallel-dogfood machinery AND our own continuous use of the harness) are first-class and verifiable.

**Proof target**: Implementation.

**Thesis source**: `dogfood-harness-flow-spec.md` + `original-ask.md`.

**Thesis verdict**: Advanced (Implementation target met; Strong evidence).

**Main thesis risk**: The single load-bearing assumption — one agent run can complete a full autonomous setup within timeout — is surfaced in Risks; abandonment + smokes contain it.

---

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence + Completeness + CS-challenge | Edge Cases, Hidden Assumptions, Deployment & Ops, Evidence Sufficiency, Proof-Level Fit | 0 | ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Technical Constraints | 1 HIGH + 2 MEDIUM, all fixed | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6` build | buildable file targets + real `-p`/skill flags | shape mismatch | ✅ (fixed) | T001/T006 now state the NEW input-schema differs from the fork source + the explicit `-p targetRepo`/`--github⇒harnessSource` param contract |
| minih worker runtime | prompt/input-schema/passed params agree | shape mismatch | ✅ (fixed) | T001↔T003↔T006 consistency note added |
| `--collect` rollup | reads every emitted field; only after terminal; no race | lifecycle ownership | ✅ (fixed) | T007 ownership boundary: child clone dirs disjoint from our repo records; our records snapshotted once in T012 |
| `/plan-8` merge | clean committed `.harness/` state | lifecycle ownership | ✅ (fixed) | T010/T012: our own records snapshotted after build tasks cease |

**Thesis alignment**: Value claim advanced at Implementation proof level with strong evidence; the one load-bearing assumption is surfaced and contained.

**Outcome alignment**: "running the agents in parallel (3 repos at once please) and collecting all their outputs and records when finished so we might improve the system." — the plan advances it; the schema/argv contract and the `--collect` lifecycle boundary are now explicit.

**Standalone?**: No — downstream consumers (`/plan-6`, the worker runtime, `--collect` rollup, `/plan-8`) exist.

Overall: ⚠️ VALIDATED WITH FIXES → Status remains **READY**
