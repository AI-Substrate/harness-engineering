# Phase-2 execution log — Round-3 trial: plan semantics on public primitives

**Seat**: `pij-grotesque-diziet` (coder) · **Branch**: `s080/dd-consume-upgrade`
**Pin under trial**: `a37a20ecf12342275a9d81b4cf8835302de8e9e0` (dd `s002/sdk-build`)
**Prediction (pre-committed, `51558dbc`)**: [prediction.md](./prediction.md)

Every surface claim below is measured against the **INSTALLED**
`node_modules/@ai-substrate/dd/**` at the pin, never against memory or dd's working tree
(context.md tripwire 4).

---

## Recon (before any test or implementation) — a finding that reframes OQ-2

### What I expected to find, and did not

The prediction sizes OQ-2 as *"can harness re-implement plan semantics from dd's public
primitives"*, and leans **insufficient** on `#5 buildPlanIndex` / `#6 readPlanCheck`
because `core/derive`, `core/rel` and `core/constants` are not public.

The non-public part of that lean is **confirmed** (measured below). But the framing has a
larger hole in it: **dd already ships the entire plan-semantics layer, compiled, inside the
installed package — it is simply not exported.**

### Evidence 1 — the pack contains a complete `dist/plan/**`

```
$ ls node_modules/@ai-substrate/dd/dist/plan/
check.d.ts  index-plan.d.ts  index.d.ts  model.d.ts  ready.d.ts  semantics.d.ts   (+ .js/.js.map each)

$ ls harness/cli/src/services/dd/plan/
check.ts    index-plan.ts   index.ts    model.ts    ready.ts    semantics.ts
```

A 1:1 file correspondence with the fork tree this phase exists to retire.

### Evidence 2 — the shipped barrel exports all nine in-scope symbols

`node_modules/@ai-substrate/dd/dist/plan/index.d.ts` and the fork's
`services/dd/plan/index.ts` carry the **same barrel**, doc comment included. Per-module
exported-symbol-set comparison (source vs shipped `.d.ts`):

| module | result |
|---|---|
| `check` | symbol sets **IDENTICAL** (13 symbols) |
| `index-plan` | one fork-only symbol: `displayAddress` |
| `model` | symbol sets **IDENTICAL** (7 symbols) |
| `ready` | symbol sets **IDENTICAL** (11 symbols) |
| `semantics` | symbol sets **IDENTICAL** (2 symbols) |

All nine symbols the two consumers actually import are present upstream:
`buildPlanIndex`, `itemKey`, `PlanDocument`, `ReadyReading`, `readPlanCheck`,
`readPlanReadiness` (`acts/plan/index.ts:41-48`) and `PlanEdge`, `PlanIndex`, `PlanItem`
(`acts/plan/pr-body.ts:2`). `displayAddress` is fork-only and **not** consumer-facing, so
it is not part of this phase's surface.

### Evidence 3 — none of it is reachable (negative control, Node's own resolver)

Resolved through `createRequire`, which consults the package `exports` map with no bundler
in the way (the phase-1 lesson: a literal `import()` specifier is resolved by Vite at
transform time and cannot serve as a negative control):

```
BLOCKED  @ai-substrate/dd/plan               -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/plan/index         -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/dist/plan/index.js -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/constants     -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/derive        -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/rel           -> ERR_PACKAGE_PATH_NOT_EXPORTED
```

The `exports` map has 13 subpaths and **no wildcard**, so the deep-dist path is closed too.
The root barrel is deliberately empty of plan symbols — `dist/lib.d.ts` documents itself as
"a curated allowlist, not a re-export of whatever happens to be public", and directs
domain symbols to their subpath: *"A symbol that is merely useful goes to its domain
subpath (`./core/*`, `./links`, `./schema`, `./render/*`, `./node`)"*.

```
$ grep -nE "buildPlanIndex|readPlanCheck|itemKey|PlanIndex|readPlanSemantics" dist/lib.d.ts
NONE - barrel carries zero plan symbols
```

### What this means for the prediction (stated plainly, per hard rule 6)

- The prediction's **non-public claim is CONFIRMED**: `core/constants`, `core/derive`,
  `core/rel` are all `ERR_PACKAGE_PATH_NOT_EXPORTED` at this pin. Its `#5`/`#6` lean is
  measured-correct on the question as asked.
- The prediction's **framing is incomplete, not wrong**: it asks whether the semantics can
  be *rebuilt* from primitives, and never considers that dd might already *have* the
  finished layer sitting unexported in the pack. It does. So the cheapest true answer to
  OQ-2 may not be "dd exports three internals so harness can rebuild the layer" but
  "dd exports the layer it already ships".
- This does **not** pre-empt the trial. Symbol-set equality is **not** behavioural
  equality, and hard rule 5 sets the bar at an equal findings set on the same input. The
  tk-0007 falsifiers remain exactly the right instrument and are being authored regardless
  — they are what would catch a `dist/plan` that exports the right names and behaves
  differently.

### Routing (per hard rule 3 / the dispatch's STOP instruction)

`tk-0008` as written ("re-implement ... on PUBLIC primitives only") cannot start: every
route into the semantic core is a non-public surface, and the alternative — re-declaring
`BUILTIN_RELS` / `CLAIMING_RELS` / the terminal-state and completion-state lists
harness-side — is the pre-committed **INSUFFICIENT** call and a D-3 block, never a shim.

Reported to koala at recon time rather than at phase end, because the re-pin loop is fast
and the gap is on the critical path. `tk-0007` continues in parallel, unblocked.
