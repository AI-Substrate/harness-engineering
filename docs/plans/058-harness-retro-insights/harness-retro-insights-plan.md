# Cross-plan retro insights — `harness retro insights` + the flow surface
**Mode**: Full
**Plan Version**: 1.1.0 — validation findings V-01…V-04 folded in (2026-07-12)
**Created**: 2026-07-12
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

📚 Incorporates findings from research-dossier.md

### Research Context

The dossier established: this command is the **anticipated offline recurrence analysis** the disposition design (plan 056) was built to feed; the closest existing capability (`retro --harvest`) is skill-side inference re-paid in tokens every run; plan 048 locked the architectural template (deterministic generators compute every number, the LLM narrates prose only); the retro schema v1.2 and the five lifecycle hooks are frozen; output must be a recompute, never a committed ledger (KISS D4). The corpus is real: 35 records, 182 entries, 22 plans, 133 entries still `open` (as of 2026-07-12 — live numbers the verb recomputes).

### Summary

Add a deterministic CLI verb — **`harness retro insights`** — that scans committed retro records (canonical + legacy paths) across one plan, N plans, or all plans, clusters observations by `(kind, target)`, ranks clusters by the frozen harvest doctrine (recurrence → severity → back-pressure leverage → age), and emits an honest, schema-versioned report of the most valuable engineering-environment improvements to work on next. Then repoint the eng-harness-flow retro verb's `--harvest` mode to *consume* this verb (the skill narrates; the CLI computes), and expose the ad-hoc surface as an `at=insights` routing alias. This moves the harvest's scan/cluster/prioritize work out of tokens into deterministic substrate — Rule 6 applied to the loop's own reflection step.

### Goals

- One command answers "what should we fix next to make engineering here better?" across any plan scope, from real recorded evidence.
- Every number in the report is computed deterministically; agent narration only restates and phrases judgement (048 epistemic contract).
- Recurring frictions, long-open clusters, proof-gap targets, and repeatedly-declined/deferred items become visible, ranked, token-free signals.
- The retro `--harvest` skill procedure stops re-deriving clustering by inference every invocation and becomes a thin consumer of the verb.
- The dangling `compound-value` machine-consumer seam (plans 012/020) is closed by this verb.

### Non-Goals

- No committed dashboards, ledgers, rollups, or index files (workshop 006 §D4 KISS — the report is a recompute).
- No new retro entry kinds, statuses, or schema fields (plan 015 freeze); no schema migration of existing records.
- No HTML report in v1 (the consumer is an agent at a seam, not a browser; the 048 HTML pattern remains available for a later increment).
- No contributor/agent ranking, ever (048 anti-goal — aggregate over work units only).
- No sixth lifecycle hook; no change to the `--hooks` manifest or the drain (`post-coding`) path.
- No automatic encoding of improvements — the verb reports; routing improvements to encoding stays with the flow's improve step.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli-core | existing | **modify** | New `retro` act + pure services (record reader, insights engine) following ports/adapters |
| eng-harness-flow-skill | existing | **modify** | `--harvest` becomes a consumer of the verb; `at=insights` routing alias; doctrine references updated |

*(This repo has no `docs/domains/` registry; these are the two established informal surfaces every prior plan uses.)*

### Testing Strategy

- **Approach**: Hybrid — TDD for all CLI changes (record reader, insights engine, act: vitest, house style, fakes over mocks per constitution P3); lightweight for skill prose (grep assertions + `skills-check`); one live validation pass over the real 35-record corpus recorded in the execution log.
- **Rationale**: matches the repo convention (plan 056 verbatim); the pure services are exactly the code TDD pays for.
- **Focus Areas**: tolerant parsing of the mixed-schema corpus; deterministic ranking; scope filtering; envelope honesty.
- **Excluded**: no browser/UI tests (no HTML in v1); no minih/companion runs.
- **Mock Usage**: fakes over mocks — `FakeFs` seeded with an authored fixture corpus; no mocking libraries; clock injected (`generatedAt` is a parameter, never read).

### Documentation Strategy

- **Location**: docs/how/ (new page for the verb) + the baked core briefing (`CORE_INSTRUCTIONS`) + commander `--help` descriptions. `npm run gen:docs` re-bakes `docs-content.ts` (drift guard `check:docs` enforces).
- **Rationale**: repo convention for CLI verbs — discoverable via `harness instructions` and `harness docs`, deep detail in docs/how.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=0, F=0, T=1
- **Confidence**: 0.85
- **Assumptions**: the retro schema stays frozen at 1.2 during this work; the harvest view/action-menu UX is preserved as-is.
- **Dependencies**: none new — commander + jiti only (constitution P10: **no YAML library**; the parser is hand-rolled on the `buffer-codec.ts` pattern).
- **Risks**: see § Risks & Assumptions.
- **Phases**: 2 (engine+verb, then flow surface) — a real dependency boundary: the skill can only consume a verb that exists.

### Acceptance Criteria

1. **AC-01 — the verb exists and is honest.** `harness retro insights --json` over the fixture corpus returns one envelope whose `data` carries `schema_version: "harness.retro-insights/v1"`, headline totals (records, entries, `system.compound.status` mix, open:encoded ratio, plans touched), and ranked clusters — and **every insight row carries `n` and a non-empty `caveat`** (rows that can't be caveated are structurally refused, 048 `makeRow` discipline). **Each cluster row additionally carries `members: [{record_path, retro_id, entry_id, status}]`** — the provenance the harvest lifecycle ops (`done`/`won't-fix`/`stale`, which mutate `system.compound.status` in-place in source records) need to act on a cluster without re-deriving the scan (V-01).
2. **AC-02 — scope selection.** `--plan <slug>` (repeatable), `--since <ISO date>`, `--kind <kind>`, `--agent <slug>` filter the scan; default is **all** records including legacy paths (`docs/harness/agents/**/*.retro.md`, `docs/retros/*.md`), with per-source scan counts in the output.
3. **AC-03 — deterministic.** Two runs over the same corpus produce byte-identical JSON apart from `generated_at` (asserted by test).
4. **AC-04 — tolerant, never silent.** Malformed records and unknown **major** schema versions are skipped and **counted** (`malformed_skipped`, `unsupported_versions[]`); non-standard `kind` values surface in a visible `other` bucket; the verb never crashes on the real corpus.
5. **AC-05 — ranking follows the frozen doctrine.** Clusters order by recurrence (count) → severity (`blocking` > `degrading` > `annoying` > none) → back-pressure leverage → age (oldest `first_seen_at` first); proof-gap clusters carry a `proof_gap: true` flag; stale flags use harvest thresholds (`open` > 4 weeks; `suggested` > 2 weeks without `resolved_by`). **Leverage is deterministic and two-signal**: primary = the 5-target "command route" set (`project-sensor`, `runtime-inspectability`, `architecture-fitness`, `security`, `schema`, retro.md:178) plus any `magic-wand` naming a check/diagnostic/command; secondary = the harvest recognizer's keyword heuristic (smoke/screenshot/log/trace/health/dependency-rule/CodeQL/schema mentions, "eyeballed"/"read manually" workarounds, retro.md:419) exposed as a `proof_gap_signal: "target" | "keyword"` field — `infra`/`tooling` clusters boost only via the keyword signal, resolving the doctrine's two-list ambiguity in code.
6. **AC-06 — the "no" signal is first-class.** A cluster with ≥2 `declined`/`deferred` dispositions carries `repeatedly_deferred: true` (the offline recurrence analysis the disposition design exists to feed).
7. **AC-07 — recompute, not ledger.** Default output is stdout (human view; `--json` for machine); the verb writes **nothing** to disk; entries' `system.compound.status` is read, never mutated.
8. **AC-08 — buffer advisory.** Pending observe-buffer entries are reported as a `buffer_pending` count (advisory only), never merged into cluster numbers.
9. **AC-09 — the skill consumes, the CLI computes.** `skills/eng-harness-flow/references/stages/retro.md` §--harvest **Steps 1–3** (scan / dedup / curate — retro.md:402-419) are replaced by one `harness retro insights --json` invocation; **Step 4's human view is retained as the narration template, rendered from the verb's JSON** (its old hand-computed `--json` contract block repointed at the verb's envelope); the action menu and lifecycle ops (`done`/`won't-fix`/`stale`, in-place status mutation) are **unchanged and consume `members[].record_path` from the cluster rows** (V-01/V-04); the module states explicitly that narration restates computed numbers and never computes its own.
10. **AC-10 — routed surface.** `skills/eng-harness-flow/references/00-routing.md` gains an `at=insights` hint routing to the retro verb's harvest mode with scope flags — **additive only**: the five hooks, the `--hooks` manifest, and every existing dispatch row are byte-unchanged.
11. **AC-11 — dangling seam closed.** All `scripts/compound-value.sh` / `just compound-value` references in retro.md are replaced by the real verb (resolves this session's DL-001 observation; closes fork Q-C from plan 020).
12. **AC-12 — discoverable.** `CORE_INSTRUCTIONS` names the verb; `docs/how/` carries its page; `gen:docs`/`check:docs` green; `harness retro insights --help` describes every flag.

### Risks & Assumptions

- **Schema drift**: future record versions could break parsing → version-tolerant reader with visible skip counters (AC-04); unknown majors rejected per the schema's own rule.
- **Harvest regression**: rewriting the harvest procedure could change user-visible behaviour → the view format, prompts, and lifecycle ops are pinned by AC-09 plus a live-run validation task.
- **Router contract**: 00-routing is a byte-stable public contract → additive-only edits, verified by grep assertions against the frozen sections.
- **Assumption**: `harness retro` is a safe new top-level act name (no extension in the wild claims `retro`; extensions load per-repo and conflicts are surfaced by doctor).

### Open Questions

None blocking — all design forks were resolved by recorded precedent (see Clarifications).

### Workshop Opportunities

None — every candidate topic (report schema shape, ranking function, verb delivery model, output posture) is locked by an existing frozen decision (048 insights contract, harvest doctrine, telemetry-insights act precedent, KISS D4). Workshopping them would re-litigate settled doctrine.

### Clarifications

#### Session 2026-07-12

Autonomous session — Round 1 answered from repo convention (recorded, not asked; user not present):

- **Q: Workflow Mode?** → **Full** (2 phases). Two surfaces with a hard dependency boundary (CLI verb must exist before the skill consumes it); matches how every multi-surface plan in this repo runs.
- **Q: Testing Strategy?** → **Hybrid** — TDD for CLI, lightweight grep/`skills-check` for skill prose (plan 056 convention verbatim).
- **Q: Mock Usage?** → **Fakes over mocks** (constitution P3): `FakeFs` + authored fixture corpus; no mock libraries.
- **Q: Documentation?** → docs/how/ + `CORE_INSTRUCTIONS` + `--help` (repo convention for CLI verbs).
- **Q: Verb namespace/delivery?** → **Core act** `harness retro insights` (subcommand under a new `retro` act, mirroring `harness telemetry insights`). Core because retro records are a core concept (`observe`/`record` are core acts) and consumer repos must get the verb without installing an extension. Briefing therefore lives in `CORE_INSTRUCTIONS` (reuse-scan F10).
- **Q: HTML output?** → Not in v1 (YAGNI; consumer is an agent at a seam). JSON shape mirrors 048 so an HTML renderer can be added later without schema change.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved by frozen precedent.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (F/H rows cited throughout) |
| workshops/*.md | n | no workshops — design locked by cross-plan precedent |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | no `[NEEDS CLARIFICATION]` markers; Round 1 recorded from convention |
| G2 | Constitution | PASS | P2 hexagonal honoured (ports-only services); P3 fakes; P10 no new deps (no YAML lib) |
| G3 | Architecture | PASS | new act/services follow the Entrypoint→Act→Service→Port layering; arch-check + architecture tests stay green |
| G4 | ADR Compliance | N/A | no docs/adr/ in this repo |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | TDD tasks precede implementation tasks in Phase 1; Phase 2 carries validation tasks |
| G7 | Domain Completeness | PASS | both informal domains mapped; manifest covers every touched file |

### Summary

Phase 1 builds the deterministic engine inside the CLI: a tolerant retro-record reader (hand-rolled frontmatter parser on the `buffer-codec` pattern — no YAML dependency), a pure insights service that clusters and ranks per the frozen harvest doctrine using the 048 row/section vocabulary, and a `harness retro insights` act with scope flags and an honest envelope — all TDD against an authored fixture corpus, then proven against the real 35-record corpus. Phase 2 repoints the eng-harness-flow surface: the retro module's `--harvest` consumes the verb instead of re-deriving the analysis by inference, the router gains the additive `at=insights` alias, and the dangling `compound-value` references are closed.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/acts/retro.ts` | harness-cli-core | internal | new act: composition root for `harness retro insights` |
| `harness/cli/src/services/retro/record-reader.ts` | harness-cli-core | internal | new: walk + tolerant parse of retro records (canonical + legacy) |
| `harness/cli/src/services/retro/insights.ts` | harness-cli-core | internal | new: pure clustering/ranking/report engine |
| `harness/cli/src/services/retro/fixtures.ts` (test helper) | harness-cli-core | internal | authored fixture corpus for FakeFs seeding (test tree) |
| `harness/cli/src/app.ts` | harness-cli-core | internal | register the new act |
| `harness/cli/src/services/instructions/core-instructions.ts` | harness-cli-core | internal | briefing mentions the verb |
| `harness/cli/test/services/retro/record-reader.test.ts` | harness-cli-core | internal | TDD suite (reader) |
| `harness/cli/test/services/retro/insights.test.ts` | harness-cli-core | internal | TDD suite (engine) |
| `harness/cli/test/acts/retro.test.ts` | harness-cli-core | internal | act-level tests (FakeFs walk + envelope + flags) |
| `docs/how/harness-retro-insights.md` | harness-cli-core | contract | user-facing verb doc (gen:docs input) |
| `skills/eng-harness-flow/references/stages/retro.md` | eng-harness-flow-skill | contract | harvest consumes the verb; compound-value refs closed |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-flow-skill | contract | additive `at=insights` alias row |
| `skills/eng-harness-flow/SKILL.md` | eng-harness-flow-skill | contract | one-line description touch (cross-plan insights surface) — only if needed |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | No YAML runtime dependency, by constitution P10; record bodies are never parsed by the CLI today (reuse-scan F1/F2) | Hand-roll the frontmatter+entries parser extending the `buffer-codec.ts` tolerant pattern; never add a YAML lib |
| 02 | Critical | The 048 epistemic contract is locked: the LLM never computes a number that appears in a report; every row carries `{n, caveat}` with an n-threshold (dossier H-01/H-02) | Copy `makeRow`/`suppressLowN`/`N_THRESHOLD` vocabulary into the new service; skill narration restates only |
| 03 | High | `observeConversion`/`dispositionMix` are telemetry-report-bound — they read pre-rolled totals, not records (reuse-scan F7) | Build parallel record-derived generators; do not call the telemetry ones |
| 04 | High | Harvest's ranking doctrine, stale thresholds, proof-gap target list, and legacy read paths are already specified in retro.md (dossier F-02) | Encode them verbatim as the deterministic scoring — consistency, not invention |
| 05 | High | The output posture is constrained: no committed ledger/rollup (KISS D4); the record dir is the browse surface (dossier H-06) | stdout + `--json` only; the verb writes nothing |
| 06 | Medium | `sweepBySuffix`/`walk` in acts/telemetry.ts is the reusable FsPort recursion (reuse-scan F3); `formatOk`/`exitWithEnvelope` are the kernel (F4) | Copy the ~15-line walk shape; import the kernel as-is |
| 07 | Medium | No fixture corpus of retro records exists (reuse-scan F9); the real corpus is mixed 1.0/1.1/1.2 with deviant kind values (dossier F-04) | Author the corpus deliberately: mixed versions, malformed file, unknown-major file, legacy-path files, declined/deferred streaks |
| 08 | Medium | Core acts have no per-verb `instructions.md` slot — briefings live in `CORE_INSTRUCTIONS` (reuse-scan F10) | Add the briefing there + rich commander `--help`; docs/how carries depth |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Deterministic engine + `harness retro insights` | harness-cli-core | The verb computes the cross-plan leverage report honestly and deterministically | None |
| 2 | Flow surface + doctrine reconcile | eng-harness-flow-skill | The harvest consumes the verb; `at=insights` routes; dangling refs closed | Phase 1 |

#### Phase 1: Deterministic engine + `harness retro insights`

**Objective**: Ship the CLI verb that scans, clusters, ranks, and reports — proven against fixtures and the real corpus.
**Domain**: harness-cli-core
**Delivers**: `services/retro/record-reader.ts`, `services/retro/insights.ts`, `acts/retro.ts`, tests, fixture corpus, docs.
**Depends on**: None
**Key risks**: parser tolerance vs the real mixed-schema corpus — mitigated by fixtures authored from real deviations plus a live-corpus run.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Author the fixture corpus (test helper): ≥6 records across ≥3 plans — schema 1.0/1.1/1.2 mixes, one malformed file, one unknown-major file, legacy-path files, declined/deferred streaks, proof-gap targets, a deviant `kind` value | harness-cli-core | Corpus module exports FakeFs `files`+`dirs` seeds used by all suites | Per finding 07 |
| 1.2 | TDD the record reader: failing tests first — frontmatter split, entries[] block parse, field tolerance, `retro_id` dedup precedence (canonical → agents → docs/retros), version skew (minor silent, major counted), malformed skip+count, legacy-path walk | harness-cli-core | Red suite covering AC-02/AC-04 paths | Per findings 01, 06 |
| 1.3 | Implement `record-reader.ts` (pure service, FsPort injected) to green | harness-cli-core | Reader suite green; no `node:*` imports (architecture tests stay green) | |
| 1.4 | TDD the insights engine: failing tests first — cluster key `(kind, target)`, ranking order per doctrine, two-signal proof-gap (`proof_gap_signal`), `repeatedly_deferred` + stale flags, **cluster `members[]` provenance (record_path/retro_id/entry_id/status)**, totals/dispositions sections, `makeRow` refusal (no `n`/`caveat` → throw), `suppressLowN`, determinism (byte-identical minus `generated_at`) | harness-cli-core | Red suite covering AC-01/AC-03/AC-05/AC-06 incl. member provenance | Per findings 02, 03, 04; V-01 |
| 1.5 | Implement `insights.ts` (pure, `generatedAt` injected; sections: totals, top_clusters **(each cluster carrying `members[]`)**, stale, disposition_mix_records) to green | harness-cli-core | Engine suite green; schema id `harness.retro-insights/v1` | Per finding 05; V-01 |
| 1.6 | Act + wiring: `acts/retro.ts` with `insights` subcommand (`--plan` repeatable, `--since`, `--kind`, `--agent`, `--json`), `buffer_pending` advisory (reads the observe buffer count, never merges), human stdout view, envelope via the kernel; register in `app.ts`; act-level tests | harness-cli-core | AC-01/AC-02/AC-07/AC-08 asserted at act level; `just test` green | Per finding 06 |
| 1.7 | Docs + discoverability: `CORE_INSTRUCTIONS` blurb, `docs/how/harness-retro-insights.md`, `npm run gen:docs`, `--help` text | harness-cli-core | `check:docs` green; AC-12 met | Per finding 08 |
| 1.8 | Live-corpus proof: run the built verb (`--json` and human) over this repo's real 35-record corpus; record output + any parser skips in the execution log | harness-cli-core | Real run recorded; zero crashes; skip counters explain every non-parsed file | |

#### Phase 2: Flow surface + doctrine reconcile

**Objective**: The eng-harness-flow surface consumes the verb; routing and references reconciled — nothing user-visible regresses.
**Domain**: eng-harness-flow-skill
**Delivers**: updated `retro.md`, `00-routing.md`, (possibly) `SKILL.md`; closed compound-value refs; live flow validation.
**Depends on**: Phase 1
**Key risks**: byte-stable router contract — additive-only edits verified by grep assertions.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Rewrite retro.md §--harvest **Steps 1–3** to one `harness retro insights --json` invocation (scan/dedup/curate move to the CLI); **retain Step 4's human view as the narration template rendered from the verb's JSON**; lifecycle ops consume `members[].record_path` from cluster rows; add the explicit "narration restates computed numbers, never computes" line; repoint the old `--harvest --json` contract block at the verb's envelope | eng-harness-flow-skill | AC-09 grep assertions pass; `skills-check` green | V-01, V-04 |
| 2.2 | Replace every `scripts/compound-value.sh` / `just compound-value` reference in retro.md with the real verb | eng-harness-flow-skill | AC-11: `grep -r "compound-value" skills/` returns no dangling refs | Resolves DL-001 |
| 2.3 | Add the additive `at=insights` hint to 00-routing.md (dispatch row + conflict-matrix row, with scope-flag pass-through). **Decided semantics (V-02): buffer non-empty → `route` with a drain *advisory* carried in the envelope — never `redirect`** (the ad-hoc read-only surface proceeds like harvest's own "proceed anyway" advisory, unlike `at=retro-harvest`'s redirect row); confirm the five hooks + `--hooks` manifest sections are byte-unchanged | eng-harness-flow-skill | AC-10 grep assertions on the frozen sections pass | V-02 |
| 2.4 | SKILL.md description touch only if discovery needs it (mention the cross-plan insights surface); keep ≤1024-char frontmatter limit | eng-harness-flow-skill | `skills-check` green | Skip if not needed |
| 2.5 | **Redeploy first, then** live validation: rebuild + redeploy the edited skill (`npm run build` + `just install-skills-local` — the session loads the *deployed* `~/.claude`→`~/.agents` copy, which diverges from `skills/` the moment 2.1–2.4 land; doctrine-parity WARNs until redeploy, V-03); then invoke the flow surface (`at=insights` / harvest) over the real corpus; verify the narrated report restates the verb's numbers; record in the execution log; run `just fix` + `harness checks` | eng-harness-flow-skill | Redeploy done; narrated run recorded against the NEW doctrine; checks green | V-03 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.4, 1.5, 1.6 | engine + act suites |
| AC-02 | 1.2, 1.3, 1.6 | reader + act suites |
| AC-03 | 1.4, 1.5 | determinism test |
| AC-04 | 1.1, 1.2, 1.3, 1.8 | reader suite + live-corpus run |
| AC-05 | 1.4, 1.5 | engine suite (ranking + flags) |
| AC-06 | 1.1, 1.4, 1.5 | engine suite (deferred streak fixture) |
| AC-07 | 1.6 | act suite (no writes; status untouched) |
| AC-08 | 1.6 | act suite (buffer advisory) |
| AC-09 | 2.1 | grep assertions + live validation 2.5 |
| AC-10 | 2.3 | grep assertions on frozen sections |
| AC-11 | 2.2 | repo-wide grep |
| AC-12 | 1.7 | `check:docs` + `--help` inspection |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Real-corpus deviations beyond the fixture set crash or silently skew the parser | Medium | High | Fixtures authored from observed real deviations; live-corpus run (1.8) with skip counters; tolerant-by-construction reader |
| Harvest UX regression when the skill becomes a consumer | Low | Medium | View/menu/lifecycle pinned by AC-09; live flow validation (2.5) |
| Router byte-stability broken by the alias edit | Low | High | Additive-only; grep assertions on the frozen hook/manifest sections (2.3) |
| `retro` act name collides with a repo-local extension somewhere | Low | Low | Doctor surfaces verb conflicts; name follows the core-concept precedent (`observe`, `record`) |
