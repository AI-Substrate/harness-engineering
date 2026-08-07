# Execution Log — Phase 1: Hook vocabulary + `--hook` alias

**Plan**: [harness-flow-hooks-plan.md](../../harness-flow-hooks-plan.md) · **Mode**: Full · **Date**: 2026-06-17
**Edit site**: `skills/eng-harness-loop/eng-harness-flow/SKILL.md` (single domain: `eng-harness-flow`)
**Companion**: `code-review-companion` (minih 0.2.1, Power-On-Mode, `read-only` preset, run `2026-06-17T02-18-28-773Z-e8b5`) — reviewed every commit live.

---

## T000 — Pre-implement harness seam (boot verdict)

- **Fired**: pre-implement seam against this repo (the worked example; S0+S2+S4 hold).
- **Mechanism**: `harness doctor` (deterministic CLI-health envelope, signal B) — chosen over the full `just test` coverage suite because Phase 1 touches only markdown prose, so the heavy boot is disproportionate. Advisory, never gates.
- **Verdict**: `degraded` — one failing layer `toolchain` (`missing tools: biome`; biome runs via `npx`, so its absence on PATH is benign). `cli-build` ok, `extensions` ok (4 loaded / 0 failed), `instructions` ok, `record-types` ok.
- **Decision**: proceed with note. The degradation is unrelated to this phase (no CLI/lint code touched).

---

## Tasks

### T001 — Lifecycle hooks subsection + seam→hook mapping · commit `8e1b4ed`
- Added `### Lifecycle hooks` to SKILL.md: a five-hook definition table (`pre-flight`/`pre-coding`/`coding`/`post-coding`/`post-flight`; `coding` marked **silent**) + the `--event → --hook` mapping table + two "load-bearing" callouts.
- Encodes **KF-01** (`pre-implement → pre-flight`, not pre-coding) and **KF-08** (`post-coding`/`post-flight` kept distinct). No child-skill slug appears in hook-name prose (the "routes to" column names activities/the `harness-boot` node type, not slugs).
- **Done-when**: ✅ all five hooks defined; mapping matches KF-01 + KF-08; `coding` silent; no child-skill slug named.

### T002 — call-site block rows · commit `f53b323`
- Added `pre-implement` (→ pre-flight) and `task-pause` (→ coding, silent) rows to the `## Called repeatedly…` integration block; the existing four rows kept **byte-identical**; added a one-line seam→hook pointer beneath the block so all six hooks stay discoverable.
- **Done-when**: ✅ all six seams represented; existing four unchanged (additive).

### T003 — `--hook` primary, `--event` permanent alias · commit `0b853dc`
- Added `[--hook <name>]` to the Parameter-contract usage line and a `--hook <name>` option entry as the **primary** invocation; reframed `--event` as a **permanent, transparent, never-deprecated alias** (zero-break for ~88 call sites). Slug-resolution map untouched. Also tagged the hint-validation bullet with `--hook` for accuracy.
- **Done-when**: ✅ `--hook` primary; `--event` explicitly a permanent alias; slug map unaffected.

### T004 — additive `hook` field on the `--json` envelope · commit `b55bf20`
- Added one field, `hook`, to the routing-envelope JSON; **no existing field reshaped or renamed** (`bypass_recommended`/`bypass_cause`/`rail`/`now`/`next` all untouched). Added a note locking **Shape A**: a routing call returns the envelope **plus** `hook` and never embeds a hooks manifest.
- **Done-when**: ✅ new field only; no existing field reshaped (checked against the current envelope incl. the plan-020 bypass fields).

### T005 — Validation (read-back) · no diff
- Verification task; produced no SKILL.md change. Confirmed by grep against the live file:
  - all six `--event` seams → **exactly one** hook each, matching T001 (`session-start`/`pre-implement` → `pre-flight`, `post-spec` → `pre-coding`, `task-pause` → `coding`, `phase-end` → `post-coding`, `plan-complete` → `post-flight`);
  - five hooks defined; `--hook` in the contract (usage line + option list); `hook` field present in the envelope; `--event` still present (8 occurrences — alias intact, zero-break).
- **Done-when**: ✅ each seam maps to exactly one hook; AC-05 (zero-break) holds; no seam unmapped.

---

## T0Z — Phase-end harness seam

- **Fired**: phase-end seam (`--event phase-end --plan-dir docs/plans/021-harness-flow-hooks`).
- **Buffer state**: `.harness/temp/agent/session-buffer.md` empty (no `harness observe` entries captured this phase — the phase's friction was logged to the Discoveries table above instead).
- **Verdict**: `noop` — nothing to drain. No cross-plan harvest run at a single mid-plan phase boundary. Advisory, never gates.

---

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-17 | T000 | insight | Pre-flight boot fired via `harness doctor` (not `just test`) — doctor reported `degraded`, but the only failing layer was `toolchain: biome` (benign; biome runs via `npx`). | Proceeded; the phase is markdown-only so the degradation is irrelevant. | `harness doctor` envelope |
| 2026-06-17 | T002 | decision | Done-when had mild tension: "each annotated with its hook" vs "existing four unchanged". | Kept the existing four rows byte-identical, annotated only the two new rows, and added a one-line seam→hook pointer so all six hooks remain discoverable. | SKILL.md call-site block |
| 2026-06-17 | T004 | decision | Wanted to avoid leaking plan-internal "Phase 2" wording into shipped skill prose for the manifest note. | Phrased neutrally ("never embeds a hooks manifest") — locks Shape A without referencing the plan. | SKILL.md envelope note |
| 2026-06-17 | — | insight | SKILL.md grew 347 → 387 (+40 lines). | Expected — Phase 1 adds vocabulary; the offsetting prose removal is Phase 2 (task 2.3), and the AC-03 line-count guard is a Phase 2/3 gate. | tasks.md Pre-Impl Check |

**Types**: `gotcha` | `research-needed` | `unexpected-behavior` | `workaround` | `decision` | `debt` | `insight`

---

## Domain updates

- No `docs/domains/registry.md` in this repo → no `domain.md`/registry/domain-map updates (per implement step 4, those apply only to domains-formalized repos). Single conceptual domain: `eng-harness-flow` (the router skill).

---

## Companion reconciliation

`code-review-companion` (run `2026-06-17T02-18-28-773Z-e8b5`, read-only Power-On-Mode) reviewed the full commit stream (T001–T004 + drain/T005). Run result `completed`/`degraded` — the *degraded* is the run's self-health (tied to the `MINIH_PROJECT_ROOT` config gripe below), **not** a review failure. **0 HIGH/CRITICAL.** Two MEDIUM contract-drift findings, both resolved:

| ID | Severity | File | Issue | Disposition |
|----|----------|------|-------|-------------|
| F001 | MEDIUM | SKILL.md (integration §) | Stale `/eng-harness-flow at=<seam>` example — `at=` takes stage hints, not seam strings; T003 made `--hook` primary | **FIXED** inline — commit `f115f15` (now leads with `--hook <name>`, mentions `--event` alias) |
| F002 | MEDIUM | research-dossier.md:79 | "soft-deprecation of `--event` 2–3 releases later" contradicts T003's permanent-alias decision | **FIXED** — annotated superseded (strikethrough + v1.2.0/T003 marker) |

- **Verdict**: clean after reconciliation — both MEDIUMs resolved, nothing outstanding. The companion reviewed every commit, so the post-hoc **review stage is superseded** (the flight plan's Graph carries that decoration).
- **magicWand** (target: `minih`): "Have `minih run` export a reliable `MINIH_PROJECT_ROOT` + a startup self-check that warns when it points at the run folder instead of the project root." → matches the known, already-planned minih fix; **not** filed as a new item.

---

## Phase status vs acceptance criteria

| AC | Statement | Status |
|----|-----------|--------|
| AC-01 | Five-hook vocabulary defined with correct mapping | ✅ new `### Lifecycle hooks` subsection (T001) |
| AC-05 | `--event` zero-break (all six seams still route) | ✅ verified T005; `--event` present 8× |
| AC-06 | Correct seam→hook mapping (incl. KF-01, KF-08) | ✅ verified T005 |
| AC-09 | `--json` envelope additive-only (no reshape) | ✅ only `hook` added (T004) |
| AC-08 | One-door (no child-skill slug in hook prose) | ⬣ upheld; formally *verified* in Phase 2 task 2.4 |
| AC-03 | Line-count net ≤ 0 | n/a in Phase 1 (Phase 2/3 gate); +40 lines expected |
