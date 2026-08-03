# Phase 6: Flow-spine gating (terminal) — Execution Log

**Plan**: [deterministic-documents-plan.md](../../deterministic-documents-plan.md) § Phase 6
**Tasks**: [tasks.md](./tasks.md) · **Coder**: pij-applicable-riss (Claude Opus 5) · **PM**: pij-related-koala
**Commit**: `0217b692` — 24 files, all inside the phase fence.

---

## What landed

The flow spine's first mechanical refusal. A node's `dd_link` names the dd address
whose items must be gate-terminal; leaving that node evaluates it and either lets
you go, refuses, or records a defended override.

| Task | Outcome |
|---|---|
| T001 | Gate-matrix fixture corpus — temp-dir factories, production dd wiring, never a tracked flow |
| T002 | `dd_link` field + documentary schema entry + `gen:flows` regen; opt-in contract regression-pinned |
| T003 | Departure gate in `setNow`; E440/E441/E442/E449; `--force` as a degraded, recorded override |
| T004 | `basis_sha` recorded at evaluation; drift warns at `orient`, never refuses; A1 residual folded into `walk.ts` |
| T005 | `orient` per-item block, `⚑ gate:` rail callout, `⛨n/m` render badge from the stored reading |
| T006 | Both lenses — a real-CLI journey suite, and a hand-walked operation of what was built |
| T007 | `docs/how/harness-flow.md` gate section; full validation; both baselines |

### The three decisions worth restating

**The gate evaluates on the node being LEFT.** Departure is the completion claim,
so the gate protects the position you are standing on; the node you move *to* is
gated when you later leave it. (PM ruling, 2026-08-04, in answer to a question
raised before any of it was built.)

**The recorded reading is never gate truth.** `dd_link.reading` exists only so the
pure renderer can badge a node without resolving an address. Every evaluation is
live, and both directions are pinned: a stale `complete` does not open a
now-incomplete gate, and a stale `incomplete` does not block a now-complete
departure.

**Forcing cannot look like success.** `--force` returns a **degraded** envelope
whose required `next_action` is the etiquette line, and writes a `dd-gate-override`
event naming every item that was open. An agent that forces a gate leaves a record
it can be asked about.

### The opt-in contract

The mitigation for putting a refusal into machinery every existing flow runs on is
that the gate is unreachable without `dd_link`. It is stated in its strongest
available form in `flow-dd-link-optin.test.ts`: a gate evaluator **that throws if
consulted** is wired in, and the output is asserted byte-identical to running with
no gate at all. The five committed render goldens moved by exactly one line each —
the legend — which is the same claim from the other side.

---

## 6.6(b) — findings note: operating it, rather than testing it

The deterministic suite (6.6a) was green before this walk started. Everything below
was found by *using* the thing, and none of it was visible to an assertion —
assertions compare exact values, and never read the output.

**1. `orient` contradicted itself in a single screen.** The rail line printed
`⚑ gate: Boot ⛨ not yet evaluated` directly above a block reading
`1/3 ✕ holds`. Both halves were individually correct — the rail reports the
*recorded* reading, the block resolves *live* — and the pair is unreadable. No test
could catch it: each half had its own passing test.
*Fixed*: `orient` now rails from a document carrying the reading it just computed.
The renderer stays pure and stays the single owner of the rail's shape; it is
handed the fresher document.

**2. The refusal named bare ids.** `not complete (dw-0002, dw-0003)` gives a reader
no way to tell "nobody has done this" from "someone is stuck" without opening the
file — and those send you to two different places. The gate already knew.
*Fixed*: `not complete (dw-0002 (unchecked), dw-0003 (blocked))`.

**3. The override event baked an absolute machine path into a committed file.**
`details.path` recorded `/private/var/folders/…/docs/tasks.dd.json`. Flow documents
are committed — this plan's own `the-flow.json` is live tracked state — so that is
per-checkout diff noise and a username leak, while the repo-relative `address` in
the same payload already identified the document portably.
*Fixed*: dropped the key; pinned with an assertion that no fixture root appears
anywhere in the event details.

**4. Drift printed two 64-character digests on one terminal row.** A wall a reader
skips.
*Fixed*: twelve-character prefixes for the human line; `--json` keeps the full
values for anything that needs them.

**5. A one-sided containment error** (`E303`) named the rejected path but not the
root it was compared against. On macOS `/var` symlinks to `/private/var`, so a
temp-dir path and the process's resolved cwd look identical to a reader and still
fail containment. Cost real minutes during 6.6(a).
*Fixed*: the message names both sides.

Each of the five is `harness observe`d (`WIN-001`, `DL-002`, `CONF-001`), and each
was fixed inside this phase rather than filed. The lens earned its place: five
defects, none reachable by the suite that was already green.

### Friction captured for the drain

| Id | Kind | What |
|---|---|---|
| `DL-001` | difficulty | dd's `MemoizingDocLoader` caches per *command*; a fixture sharing one deps object silently spans what production treats as separate invocations, so a mid-test edit reads back the cached pre-edit sha with no error anywhere. Fixture now exposes `freshDeps()`. |
| `CONF-001` | confusion | The one-sided `E303` containment message (fixed, above). |
| `MW-001` | magic-wand | ~4.7s of every spawned CLI invocation is telemetry capture — 98% of a 4.8s call. `HARNESS_NO_TELEMETRY=1` in the child env took this phase's journey suite from **82s to 1.9s**. Nothing signposts it; `--no-extensions` is the obvious knob and buys nothing. |
| `DL-002` | difficulty | Absolute machine path written into a committed flow document (fixed, above). Suggests a general rule: nothing a mutation writes into a flow doc may be machine-specific. |
| `WIN-001` | win | The inference lens itself — five human-read defects invisible to a green suite. |
| `DL-005` | difficulty | **Machine-wide test isolation defect** (outside this fence): `test/adapters/git/exec-remote-telemetry-git.int.test.ts`'s credential cluster asserts on `credentialTempDirectories()`, which `readdirSync`s the **shared OS tmpdir** and filters by prefix. Any concurrent process on the box — a second vitest run, another pij peer running `just test` — makes it non-deterministic. Seen once inside `harness checks`; passes 91/91 in isolation, three times. This repo's operating model *is* concurrent peers, so the suite is structurally unable to hold. Fix shape: scope the enumeration to a per-run temp root. |
| `DL-003` | difficulty | Pre-existing flake in `test/integration/docs.test.ts` (outside this fence): default 5000ms timeout against a ~5.16s spawned command, ~4.9s of it telemetry. Reported to the PM rather than fixed across the fence; PM took it as `68d62225`. |

---

## Proof

### Suites

```
full `just test` (cd harness/cli && npx vitest run --coverage)
  Test Files  268 passed (268)
  Tests       3656 passed (3656)
  Statements 88.9% · Branches 79.5% · Functions 91.57% · Lines 91.36%

flow slice — npx vitest run test/services/flow test/acts/flow test/integration/dd-flow-gate.int.test.ts
  Test Files  20 passed (20)   Tests  373 passed (373)

gate matrix alone — test/services/flow/flow-dd-gate.test.ts
  26 passed
```

**The matrix was mutation-tested, not merely run.** Disabling the gate's entry
condition (`departureGate` → early `return null`) turned **16 of the 26** red;
restoring it returned all 26 green. A refusal that has never been watched to refuse
is not a tested control (P1–P5 lesson, carried).

### both-cwds — the new CLI-spawning suites, from each sanctioned invocation

```
cd harness/cli && npx vitest run test/integration/dd-flow-gate.int.test.ts test/acts/flow-dd-gate.test.ts
  Test Files  2 passed (2)   Tests  15 passed (15)
cd <repo root>  && npx vitest run test/integration/dd-flow-gate.int.test.ts test/acts/flow-dd-gate.test.ts
  Test Files  2 passed (2)   Tests  15 passed (15)
```

### Baselines — before/after (prime rider)

| Signal | Before | After |
|---|---|---|
| `harness checks` | degraded / exit 0 | **degraded / exit 0** |
| arch-check | 2 warn (`services-ports-type-only`) | **2** — unmoved |
| markdown-lint | 199 (197 lint · 1 links/anchors · 1 mermaid) | **199** — unmoved, identical split |
| windows-check | 6 hazards (WIN004×1, WIN007×5) | **6** — unmoved |
| tests gate (inside checks) | ok | ok |

`harness checks` was run three times across the phase. Two runs came back
`degraded / exit 0` with `tests:ok`; one intermittently failed two cases in
`test/adapters/git/exec-remote-telemetry-git.int.test.ts` — the shared-tmpdir
isolation defect recorded as `DL-005`, in a file this phase does not touch, which
passes 91/91 in isolation. The final run is the one recorded above. Both
intermittent failures met this phase (`DL-003`, `DL-005`) were measured, observed
and reported across the fence rather than fixed inside it.

The gate additions moved no baseline. `markdown-lint` staying at 199 across a
121-line addition to `docs/how/harness-flow.md` is worth noting rather than
assuming: the new section introduced no new finding.

### Live transcript — the 6.6(a) journey, run by hand once

```console
$ harness flow orient --path .harness/flows/walk.json
[walk] ◇─◇─[ ◇─◇ ]─◇─◇─◇  … ⚑ gate: Boot ⛨ 1/3

▶ Boot (boot)  run /eng-harness-flow --hook pre-flight
  dd gate: docs/tasks.dd.json#tasks  1/3 ✕ holds
    ■ dw-0001 (checked)
    □ dw-0002 (unchecked)
    □ dw-0003 (blocked)

$ harness flow nav set --path .harness/flows/walk.json --now backpressure
E440  node "boot" gates on "docs/tasks.dd.json#tasks": 2 of 3 items are not
      complete (dw-0002 (unchecked), dw-0003 (blocked)).
→ Complete or state the listed items in …/docs/tasks.dd.json (gate-terminal
  states: checked, human-skipped, na), then retry. If departing anyway is the
  human's decision, re-run with --force to record a defended override.
  Nothing was written.                                              exit=1

$ harness flow nav set … --now backpressure --force
status: degraded
→ Record why departing was the human's decision — an agent may not force a dd
  gate on its own judgment (workshop-002). `human-skipped` or `na` on the
  individual items is the legitimate way a gate passes without the work.

  event DDG-001 dd-gate-override  details: { node: boot, to: backpressure,
    address: docs/tasks.dd.json#tasks, incomplete: [dw-0002, dw-0003],
    terminal: 1, total: 3 }
  render badge: boot["Boot ⛨1/3"]

  # dw-0002 → checked, dw-0003 → na, then depart again:
$ harness flow nav set … --now backpressure                        status: ok

  # a row appended upstream, after the basis was recorded:
$ harness flow orient --path .harness/flows/walk.json
  dd gate: docs/tasks.dd.json#tasks  4/4 ✓ open
    ■ dw-0001 (checked)  ■ dw-0002 (checked)  ■ dw-0003 (na)  ■ dw-0004 (checked)
    ⚠ basis drift: …/docs/tasks.dd.json moved since this gate was last recorded
      recorded 7ccf159af9ef… → actual da38aed1897b…
```

The last block is the whole design in six lines: the verdict is recomputed against
the current file, the drift is reported beside it, and nothing is refused.

---

## Rulings honoured

- **ruled-values-need-pinning** (P5 DL-003) — the E44x codes are asserted against
  both the `ErrorCodes` symbol *and* the literal (`'E440'`), so neither a renamed
  constant nor a re-numbered block can pass silently. The refusal envelope, the
  default terminal set (`['checked','human-skipped','na']`), the `--force` event
  shape and the etiquette line are all pinned by value.
- **`--force` = defended override** (workshop-002, Jordan-ruled) — degraded
  envelope + recorded event + etiquette text, all asserted.
- **Opt-in, regression-pinned** — the throwing-evaluator byte-identity test.
- **A1 residual** — `walk.ts`'s basis-stale block now carries the rule it was
  waiting on, citing this dossier's § Rulings row.

## Deferred & Noteworthy

**Noteworthy**

- `harness/cli/src/services/docs/docs-content.ts` is in the diff. It is the
  *generated* sibling of the fenced `docs/how/harness-flow.md` (via `npm run
  gen:docs`), the same class of derived artifact as `schemas-content.ts` via
  `gen:flows`, which the fence grants explicitly. One line changed.
- The gate's dd wiring takes its filesystem from the **injected `FsPort`**, not
  `NodeSchemaFs` as the dd verbs do. The dd verbs need to tell "could not look"
  from "found nothing" and report `E416`; the gate does not, because both answers
  end in the same honest refusal (`E442`). The trade buys act-level testability
  with fakes, and is documented at the call site.
- The `dd_link.reading` key was added beyond the dossier's declared
  `{ address, gate, basis_sha }` trio — asked of the PM before building and
  approved with the "display-only, never gate truth" rider, which is itself pinned.
- `orient` deliberately evaluates live rather than reading the stored reading. It
  is the surface a weak model consults to decide what to do next, and answering
  that from a cache is how an agent works against a document that moved.

**Deferred** — none. No task skipped, no acceptance criterion unmet, no
`TODO`/`FIXME`/`HACK` introduced.
