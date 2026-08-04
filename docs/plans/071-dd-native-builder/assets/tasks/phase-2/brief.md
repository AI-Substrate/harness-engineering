# Phase-2 coder brief — plan 071 dd-native builder

**For**: pij-sole-snipe (phase coder) · **From**: pij-related-koala (orchestrator)
**Phase**: ph-7102 "Wire the flow — check-kind gate + dd-native authoring"
**Corpus note**: the plan was RENAMED 070→071 at the phase-1 boundary (prime's
ordinal ruling). All ids are 71xx now (tk-7028→tk-7128 etc.); re-read the
corpus, never trust remembered 70xx ids. Baseline for attribution: `eab1e69a` (post-validate-v2 fixes).

## Mission

Implement the 13 tasks of ph-7102 (`tk-7131..7135`, `tk-7141..7147`,
`tk-7169`) against ACs `ac-7109, ac-7110, ac-7111, ac-7113, ac-7115,
ac-7116, ac-7117, ac-7118`. This phase makes the flow itself dd-native: the
check-kind departure gate, template/expander-authored gates, dd-native
plan/task authoring (1b/5/6/6a), prompting at both layers, legacy retention,
and refusal evidence into telemetry.

## Read first (in order)

1. `../../../plan.dd.md` — the phase-2 section, ACs above, and Key Findings
   (design bindings; F004/F007 sanitize discipline, static template finding,
   63-markdown-refs finding, refusal-evidence triple loss).
2. `tasks.dd.md` (this folder) — 13 tasks, 18 done_when assertions with
   their pressure instruments. The assertions ARE the done bar.
3. `../../../backpressure.dd.md` — bp-7109..7118 probes.
4. `../phase-1/brief.md` + its Fence amendment 1 — the discipline carries
   forward.

## Task order

`tk-7131` (DdLink check-variant model FIRST — everything gates through it) →
`tk-7132` (evaluator + act wiring) → `tk-7134` (barrel/seam + dep-cruiser) →
`tk-7133` (template/expander gates) → `tk-7135` (render/orient/rail) →
`tk-7141`/`tk-7142` (1b plan / 5 tasks dd-native authoring) → `tk-7143`
(6/6a state mutation via dd verbs) → `tk-7144`/`tk-7145` (prompting: baked
instructions[], stage modules) → `tk-7146` (legacy retention + detection
test) → `tk-7169` (refusal evidence → telemetry, lock-step resolvers) →
`tk-7147` LAST (joint-exit dry-run — THE PHASE EXIT; the phase does not
close without it green).

## Hard constraints

- **Fence (allowed paths)**: `harness/cli/src/services/flow/**`,
  `harness/cli/src/acts/flow.ts`, `harness/cli/src/services/dd/**`,
  `harness/cli/src/acts/dd/**`, `harness/cli/src/acts/plan/**`,
  `harness/cli/src/services/telemetry/**`, `harness/cli/src/acts/telemetry.ts`,
  `harness/cli/src/output/error-codes.ts` (E4xx), `harness/cli/test/**`,
  `.dd/schemas/builder/**`, `skills/builder/**` and `skills/the-flow/**`
  (template + stage modules, tk-7133/7144/7145), `.dependency-cruiser.cjs`
  (flow/dd rules only, per phase-1 Fence amendment 1),
  `docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md`
  (manifest rows only). A file outside this list that a task genuinely
  needs → STOP and send a fence question; do not improvise.
- **Forbidden absolutely**: `docs/plans/071-dd-native-builder/**` (the plan
  corpus is the orchestrator's), any `the-flow.json`/`the-flow.md`/
  `.the-flow-state.json` ANYWHERE (tk-7133/7147 create their own flows in
  test fixtures/temp dirs — never this plan's), any push, any `npm link` or
  global-binary mutation (the machine-global harness is under a prime
  fence; build with `just build` ONLY if you need the local dist, and say
  so in your report).
- **Doctrine-parity**: skills/ prompting edits that touch mirrored blocks
  must keep both copies byte-identical (`check:doctrine-parity` gates it).
- **Writer contract** (phase-1 law): mutating verbs validate-BEFORE-write,
  sibling rebuilt same operation, failure = refusal with source untouched
  (`writeDocumentWithSibling`, not `autoRegenerateSibling`). The flow.ts
  `autoRenderSibling` defect (DF-016) is IN SCOPE via tk-7143/tk-7169's
  neighbourhood if your work touches those callsites — fix the shape there
  the same way if you touch it; otherwise leave it and note it.
- **Surface discipline**: every new E-code/verb/rel/gate-kind = manifest
  row in the SAME commit; `dd-surface.test.ts` pin adjusted deliberately.
- **Control discipline**: every new ERROR/WARN/refusal class gets a
  planted-bad fixture that FIRES (tested, not demonstrated). The reviewer's
  Dim-0 will mutate your controls first.
- **Untrusted reading** (F004/F007): gate evaluation never executes or
  trusts document-supplied text; findings are quoted, not interpreted.
- **Commits**: explicit pathspecs, no --no-verify on your own commits, `just
  fix` before each, measure the checks baseline BEFORE your first commit and
  quote it (warn trio at `6c6cfccb`: arch 2, markdown 196, windows 6).
- **Known flake**: `exec-remote-telemetry-git.int.test.ts` (~50% under full
  suite load) — rerun alone before attributing; NOT yours (DL-008).

## Report shape (pij send to pij-related-koala, pointer to a file)

Line 1 `PHASE2 COMPLETE` (or a fence question / blocker as it arises —
early, not at the end). Then: tasks done, commits (shas + one-line each),
proof per AC with reproduced counts, per-assertion evidence mapping
(dw-000x → test/command), design calls worth the reviewer's eye,
out-of-fence sightings (NOT touched), observations captured via
`harness observe` (leave the buffer undrained — draining is the
orchestrator's journey act).
