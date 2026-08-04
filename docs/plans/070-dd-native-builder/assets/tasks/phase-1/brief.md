# Phase-1 dispatch brief — plan 070 dd-native builder

**For**: the phase-1 coder (copilot claude-opus-5, effort high)
**From**: pij-related-koala (orchestrator). Report completion to me by pij
send — first line = status, then delta + proof pointers (wire discipline).

## Mission

Implement **every task** of Phase 1 — "dd core: relations, buckets, and the
semantic validator" — in one run. The authoritative task list with per-task
evidence assertions is `tasks.dd.md` **in this folder** (source:
`tasks.dd.json`). 13 tasks, `tk-7028` **FIRST** (Jordan's explicit ruling —
build the dd writer verbs before everything else, then *use them* for the
rest of the phase).

## Read first (in order)

1. `../../plan.dd.md` — the plan: ACs `ac-7001..ac-7008` + `ac-7019` are
   yours; Key Findings 01–03, 07, 10, 11 bind design choices.
2. `tasks.dd.md` (this folder) — your tasks + evidence assertions (the
   done-when bar per task).
3. `../../backpressure.dd.md` — the proof selection per AC (`bp-70xx` rows);
   your fixtures land where those probes point.
4. `../../assets/dogfood-log.md` — DF-002 (prefix registry), DF-007/008 (JIT
   + id minting), DF-012 (why tk-7028 exists). These are constraints, not
   history.
5. `docs/how/dd/` + the surface manifest
   (`docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md`)
   — the frozen surface you are renegotiating (rels + E45x + get/set/add/rm
   rows: add them, adjust the 50-code pin in `dd-surface.test.ts`
   deliberately).

## Task order

`tk-7028` (writer verbs + mint) → `tk-7011` (rel parse — pin the OD-8
allow-list at the parse layer FIRST) → `tk-7012..7015` (manifest row, bucket,
graph labels, builder schema upgrades) → `tk-7027` (synthetic corpus factory)
→ `tk-7021..7026` (semantic layer: contradiction engine, summary line,
--complete, --address, E450–E459, dd-validate regression pin).

## Hard constraints

- **Fence (allowed paths)**: `harness/cli/src/services/dd/**`,
  `harness/cli/src/acts/dd/**`, `harness/cli/src/acts/plan/**`,
  `harness/cli/src/output/error-codes.ts` (E45x block only),
  `harness/cli/test/**`, `.dd/schemas/builder/**`,
  `docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md`
  (manifest rows only). Nothing else. If a task seems to need a file outside
  the fence, STOP and report — do not improvise.
- **Forbidden absolutely**: `docs/plans/070-dd-native-builder/**` (the plan
  corpus is the orchestrator's), any `the-flow.json` / `the-flow.md` /
  `.the-flow-state.json`, `skills/**`, any push. Never hand-edit a generated
  `.dd.md` (build regenerates them).
- **dd-core isolation**: `services/dd/core/**` imports no output/, no acts,
  no node-* adapters — dep-cruiser + arch tests enforce; extend seams via
  barrels deliberately, never reach past one.
- **Frozen surfaces**: every new E-code, verb, and rel lands as a surface
  manifest row in the same commit as its code; `dd-surface.test.ts` count
  adjusted deliberately (never loosened).
- **Control discipline**: every new ERROR/WARN class gets a planted-bad
  fixture proving it FIRES plus a good twin. A check demonstrated only on
  good input is not tested.
- **Regression pins**: `dd validate` stays byte-for-byte mechanical on
  existing corpora; absent links-bucket renders byte-identical (goldens).
- **Commits**: small, conventional (`feat(dd): …`), explicit pathspecs
  (`git commit --only <paths>`), `--no-verify` NOT allowed, no push — the
  orchestrator pushes. Run `just fix` before your final commit.
- **Proof at the end**: `just test` green (full), `just checks` exit 0,
  and the per-AC probes from `backpressure.dd.md` green. Quote counts in
  your report, never "all green" bare.
- **Friction**: `harness observe "<what>" --kind difficulty` the moment
  anything makes you guess, retry, or read source to learn a surface.

## Design bindings (do not re-litigate)

- rels: frozen five (`pressure` `proven_by` `satisfies` `derives` `ref`);
  unknown rel = accepted, behaves as `ref`. Semantics on the rel, never the
  field name. Builder schemas DECLARE their rels (`done`→`derives`).
- `pressure` mandatory on done_when assertions; literal `not-applicable` is
  the explicit out; missing = ERROR.
- `satisfies` always-array; non-array = validation error.
- `--complete` green = strict zero warnings; orphan ACs warn only there;
  mid-flight = one summary info line, zero per-row warns.
- `--address` scope = reachable closure + incoming satisfies for AC rows;
  always per-row; phase gate itself stays on the cheap completion read.
- Writer verbs (`dd get/set/add/rm`): schema-validate BEFORE write, rebuild
  sibling in the same operation, `add --mint <prefix>` yields the next
  collision-free four-hex id. E-codes from the E45x block where semantic,
  existing blocks where mechanical.
- E45x: the NEXT free block is E450–E459 (E43x and E44x are both full).

## Report shape (pij send back to pij-related-koala)

Line 1: `PHASE1 COMPLETE` or `BLOCKED: <one line>`. Then: tasks done (ids),
commits (shas + subjects), proof counts (suite/checks/probes), evidence per
AC (one line each), observations captured, anything out-of-fence you needed
and did NOT touch.
