# Research Dossier: harness consume-upgrade to standalone @ai-substrate/dd

**Generated**: 2026-08-09T01:35:00Z
**Query**: "Upgrade harness to consume the standalone @ai-substrate/dd SDK (git-sha route) in place of the in-repo dd implementation"
**Effort**: Quick (lead-only — synthesizes two verified trial rounds + a fresh consumability POC; every carried claim re-verified this session at a named basis)
**Evidence**: 10 current sources · 4 historical sources
**dd basis for every dd-side claim**: `7e570bccdd34fddd275cfa35b38fde438f76a55b` (the current pin). Harness-side claims: worktree `s080-dd-consume-upgrade` @ `ee8f37fb`.

## The Ask

Harness contains a vendored dd implementation (`services/dd`, plus the `acts/dd` verb
layer). dd has been extracted to a standalone repo and published surface
(`@ai-substrate/dd`), and Jordan has ruled that harness becomes its first consumer:
take the SDK as a dependency and delete the in-repo implementation, sourcing the
dependency from dd's work branch by pinned git sha (the npm registry is proxied with a
1-week delay and is not usable for this loop). One question gates the shape of the whole
plan: dd's `./plan` subpath is deliberately unpublished (**OQ-2, ruled "held"**), and
whether dd's *public* primitives suffice to re-implement harness's plan semantics is
decided by a trial **inside this plan** — the answer belongs to this plan, not dd.

## Answer

1. **The SDK is consumable — proven, not assumed.** A fresh bare consumer installs
   `github:AI-Substrate/dd#<sha>` in 9s with no registry access for dd itself, the
   install packs (catches exported-but-not-shipped), all 13 runtime exports load, the
   dependency-injection construction harness needs builds from public exports alone, and
   strict `tsc` accepts consumer-owned ports across the boundary (F-01).
2. **The consume surface is 4 surviving files; 12 more leave with the port.** Everything
   the 4 survivors import **except the 9 plan-semantics symbols** has a verified public
   home at the pin (F-02..F-04).
3. **The plan-semantics gap is the whole risk concentration**: `./plan` is unpublished;
   its implementation is 6 files / 1,091 lines importing 7 modules that are *also* not
   public — so "sufficient primitives" is genuinely open, and the round-3 trial with the
   dated-prediction discipline decides it (F-05, F-06).
4. **The rewire itself is demonstrated**: 2 of the 4 files were rewired in round 2 —
   typecheck exit 0, 423 tests green (H-01/F-09) — so the mechanical risk is low; the
   open risks are semantic (plan), procedural (fork-drain before deletion), and
   architectural (the retired boundary, F-07).
5. **Four decisions are open and shape the phases** (see Planning Handoff); one of them
   (the insufficiency pre-decision) must be made **before** the trial runs.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | POC green at pin `7e570bc`: install 9s/3 pkgs; packed tree only (`bin dist LICENSE package.json README.md`); 9 root + 4 `./node` runtime exports; deep path refused (`ERR_PACKAGE_PATH_NOT_EXPORTED`); foreign-port injection ok + memoized; `tracked===null` (A-2 fixed); D7 address resolution clean; strict nodenext `tsc` exit 0 | POC `scratchpad/poc-d941ece/probe.{mjs,ts}` (session artifact); durable record `s065 scratch/dd-080-resume.md` § POC | Phase 1 (take dep + rewire) can start on proven ground | High |
| F-02 | Exactly 4 surviving consumers: `acts/flow.ts`, `acts/plan/index.ts`, `acts/plan/pr-body.ts`, `acts/plan/fence.ts`; 12 files under `acts/dd/` import `services/dd` and leave with the port | `harness/cli/src/acts/flow.ts:13-14,80` · `acts/plan/index.ts:20-38` · `acts/plan/pr-body.ts:1-2` · `acts/plan/fence.ts:1` · grep count 12 | The rewire touch set is small and enumerable; `acts/dd` deletion is a separate, bigger set | High |
| F-03 | The injection construction is the library-mandating property: harness passes its own `FsPort` into `ConventionSchemaResolver` and `MemoizingDocLoader(new FsDocLoader(deps.fs, new NodeHash(), null))` — and `FsDocLoader` is imported from `./dd/shared.js` (the **departing** half) | `acts/flow.ts:121-126` (construction), `:80` (import) | The rewire maps it to the package's `./links` (dd re-exports `FsDocLoader` there — fr-0010 closed); CLI-shelling would be a redesign, not a swap | High |
| F-04 | Every non-plan symbol the survivors import has a **verified public home** at the pin: 13 subpaths in the exports map; `resolveMapSeed`/`traverseCorpus` in `./links` (`src/links/index.ts:52,81`), `escapeCell`/`headingSlug` in `./render/renderer` (`renderer.ts:105,113`) | dd @ `7e570bc` `package.json` exports; `git show` probes this session | No dd-side export work is needed for the non-plan rewire | High |
| F-05 | The plan gap: `acts/plan/index.ts` imports `buildPlanIndex, itemKey, PlanDocument, ReadyReading, readPlanCheck, readPlanReadiness` and `pr-body.ts` imports `PlanEdge, PlanIndex, PlanItem` from `services/dd/plan` — **no public home exists** (`./plan` deliberately absent, OQ-2 held) | `acts/plan/index.ts:30-37`, `pr-body.ts:1`; dd exports map @ `7e570bc` | These 9 symbols are the round-3 trial's exact target | High |
| F-06 | dd `src/plan` at the pin: **6 files, 1,091 lines**, importing 13 internal modules of which **7 are not publicly reachable** (`core/constants`, `core/derive`, `core/rel`, `core/value`, `links/map`, `links/model`, `shared/posix-path`) | `git show 7e570bc:src/plan/*` import scan this session | Sizing evidence (NOT a verdict) that re-implementation on public primitives may hit gaps; the trial must run honestly against this | High |
| F-07 | Both harness boundary guards skip non-relative specifiers, so once dd is a package **no control in the repo polices the flow→dd boundary** | `test/services/flow/flow-dd-sdk-seam.test.ts:137`, `test/architecture/dd-core-isolation.test.ts:26` (both: `if (!spec.startsWith('.')) …`) | Decision 4: accept-and-document vs build a package-aware guard — either way it goes in the plan explicitly | High |
| F-08 | The fork being deleted is **45 files / 8,173 lines** (`services/dd`), ~13% of `src` | `find`/`wc` this session | Deletion is the irreversible half; stage it behind its own review gate, never in the rewire commit | High |
| F-09 | Round-2 rewire evidence: `acts/flow.ts` + `acts/plan/fence.ts` rewired onto the packaged SDK — `tsc -p harness/cli --noEmit` exit 0, **423 tests / 21 files green**, registry-free | local branch `trial/dd-consume-round2` @ `0e49d325` (unpushed) | The mechanical rewire pattern is proven; phase 1 repeats it at the current pin for all 4 files | High |
| F-10 | 080's flight plan carries **no `dd_link` gates** (created from a pre-ac-7110 template), and the s080 worktree has **no `node_modules`/`dist`** — nothing harness-runnable in-tree yet | `grep dd_link the-flow.json` (empty); `ls` probes | Environment prep (install + `just build`) is a phase-1 precondition; gate absence means departures aren't dd-gated (note, not a defect) | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | **fr-0010**: `FsDocLoader` was load-bearing but unexported (in the departing half); found by the round-1 trial, fixed by dd moving it beside its decorator in `links/loader.ts` | s065 `scratch/dd-trial-acceptance-bar.md` § the hole; dd `src/links/loader.ts` @ pin | Direct | The trial method (installed package + foreign port + negative control) finds real gaps; keep it for round 3 |
| H-02 | **The basis incident**: a defect report was filed against dd from a bare clone sitting on dd's *diverged* `main`; three seats hit the same trap in one hour | s065 `scratch/dd-080-resume.md` § retracted D7 | Direct | Every dd probe in this plan names the sha in the command and the finding; ancestry claims require `merge-base --is-ancestor` |
| H-03 | **Deferred-fix / byte-identical-fork hazard** (#108 family): a fork diffs clean precisely where upstream deferred a fix; conversely, harness-main fixes to `services/dd` landed *after* the fork (e.g. D7 `3d1e4692`/PR #133) | memory `byte-identical-fork-hides-the-deferred-fix`; PR #133 | Direct | **Before deleting `services/dd`, drain the fork**: enumerate harness-main commits touching `services/dd`/`acts/dd` since dd forked and confirm each is present in dd (the `dd-fork-divergence` chore watches ongoing drift) |
| H-04 | Round-2 finding: dd's `./node` tier membership was an **artifact, not a decision**; dd added a membership gate (13 subpaths / 190 symbols) after the report | s065 `scratch/dd-trial-acceptance-bar.md` § round 2 | Partial (gate now exists upstream) | Consumer-side: our own import list is the contract to assert — don't rely on dd's gate alone (agreement is not corroboration) |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Primitives insufficient for plan semantics | F-05, F-06 | Flips the plan from "harness re-implements" to "dd exports more" (another repo's cycle) — the phase-1 boundary re-plan | Round-3 trial with dated prediction + per-primitive falsifier (sufficient ⇒ name the case that would have refuted it AND that it ran; else UNPROVEN) |
| Ports with **no importable type** invite wrong consumer fixtures | `SchemaFs` not re-exported (dd escalation in flight); 2 wrong port-shape guesses this plan (`sha256Hex`, `SchemaFs`) | A wrong port constructs fine and silently finds nothing (resolver case) | dd o-prime is deciding whether `type SchemaFs` joins the barrel; until then, read `dist/*.d.ts`, never guess |
| Fork-drain gap at deletion time | H-03 | Deleting `services/dd` while it carries a harness-main fix dd lacks silently regresses the consumer | A named drain checklist in the deletion phase: commit-enumerate + confirm-in-dd, shas cited |
| Upstream branch is mid-PR and moving | crab: branch red→fixed this session (`d941ece`→`7e570bc`); sourcing rule is branch-by-sha | A finding measured at one sha may not hold at the next | Re-pin explicitly per phase; never float; re-verify the POC trio (pack/injection/A-2) on each re-pin |
| The retired flow→dd boundary | F-07 | Silent architectural erosion post-upgrade | Decision 4 (workshop) |
| Self-reference during transition | 080's own plan will be authored/validated by harness's dd code while that code is being replaced | Mid-rewire breakage could take out the plan tooling being used to drive the work | Do the rewire on the package first (F-09 pattern), keep the fork intact until the last phase; F-10 env prep first |

## Planning Handoff

- **Preserve**: the envelope contract of every `harness` verb the rewire touches; the
  injection property (harness's own `FsPort` flows inward — F-03); the 423-test green
  (F-09) as the rewire's bar; branch-pinned sourcing with shas named in findings.
- **Change carefully**: `acts/plan/index.ts` (also the file `fr-0002/6/7`+`#119` are
  sequenced behind — tell prime when the touch set is fixed); the deletion of
  `services/dd`/`acts/dd` (irreversible half — own phase, own review, fork-drain first).
- **Likely files/symbols**: the 4 survivors (F-02); `package.json` dep at pinned sha; the
  9 plan symbols (F-05) re-implemented or re-exported per the trial; test estate touching
  `services/dd` (guards F-07 + suites in `test/services/dd/**`).
- **Decisions still required** (all four pre-date this dossier; recommendations recorded
  in `original-ask.md`):
  1. delete `acts/dd` vs rewire-only — staging;
  2. fate of `harness dd *` verbs (user-facing);
  3. **pre-decided insufficiency answer — needed BEFORE the trial**;
  4. boundary: accept-undefended vs package-aware guard.
