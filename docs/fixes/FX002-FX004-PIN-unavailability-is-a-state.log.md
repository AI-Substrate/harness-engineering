# FX002 · FX004 · the 2.7 pin — execution log

**Branch**: `s065/fx003-flow-eval-instrument` (rides PR #97) · **Coder**: `pij-alright-muskox`
**Dossier**: [`FX002-FX004-PIN-unavailability-is-a-state.md`](./FX002-FX004-PIN-unavailability-is-a-state.md)

Labelling convention adopted from **Ruling #3.3**: every mechanism claim below is marked
**ESTABLISHED** (probe cited) or **INHERITED — UNVERIFIED**. Nothing is asserted because
it was handed over confidently.

## Baseline (before any change)

`node harness/cli/bin/harness.js checks` — all hard gates ok, warn trio
**arch 2 / markdown 196 / windows 6**. Matches the dispatch baseline exactly.

## Status summary

| Item | State |
|---|---|
| **FX004** | **complete** — both faces fixed, 7 mutations fire, guards both directions |
| **FX002** | **complete** — read-time resolution, 5 mutations fire, never fabricates |
| **Pin** | **built and gated, BLOCKED on a product ruling** (frozen-corpus collision) |
| Registry-shape control (#3.1) | **already existed** — reported, not duplicated |
| Discard proof | **complete** — fires, and proven inert in the live tree |

## FX004 — the mechanism in the dossier was wrong, and I probed before building

**ESTABLISHED.** Four probes, all `node harness/cli/bin/harness.js`:

| # | cwd | result |
|---|---|---|
| 1 | `/tmp/fx004-norepo` (no repo, no `.harness`) | `checks` → E108; `checks --help` → **top-level usage, exit 0** |
| 2 | `<worktree>/harness/cli` (**inside** a harness repo) | `checks` → E108 |
| 3 | `<worktree>/docs` (**inside** a harness repo) | `checks` → E108 |
| 4 | `/tmp/fx004-fake` — **not a repo**, `.harness` symlinked in | `checks --help` → **works** |

Verbatim pre-fix output, probe 1:

```text
error: too many arguments. Expected 0 arguments but got 1: checks.
{"command":"harness","status":"error","error":{"code":"E108",
 "message":"error: too many arguments. Expected 0 arguments but got 1: checks."},
 "next_action":"Run `harness help` for usage."}
```

```text
$ harness checks --help          # second face, pre-fix
Usage: harness [options] [command]
The agent-friendly front door to this repo's engineering harness.
… exit 0
```

The dossier's stated variable — inside-vs-outside a repo — is **contradicted**: probes 2/3
fail *inside* a repo, probe 4 succeeds *outside* one. The real discriminator is
`<cwd>/.harness/extensions/` holding a loadable extension (`discovery.ts:63`, cwd-relative,
never walks up). Git is irrelevant in both directions.

The wrong theory survived three tellings because every case anyone tried held
*is-a-repo* and *cwd-has-extensions* **together** — the repo root is where
`.harness/extensions` lives. The dossier's own guard (inside vs outside) could not
break that confound. Probes 2/3 break it one way; probe 4 the other.

**The fix.** A **pre-parse** guard (`app.ts` · `noExtensionContextEnvelope`). Pre-parse
is load-bearing: `checks --help` never reaches an error path at all, so mapping
commander's error after the fact would fix one face and leave the other lying more
quietly. New code **E149** (`EXTENSION_CONTEXT_ABSENT`) — E108 means "you typed it
wrong" and the entire defect is that they did not. `E149` matches `/^E\d{3}$/`, which
FX003 requires (see the discard proof below).

The message asserts only what was established, and **never says "not in a harness
repo"** — that sentence is false from `<worktree>/harness/cli`. Per **Ruling #3.2** the
remedy is *found and verified* (`findExtensionAncestor` walks up and confirms via
`discoverExtensionsAt` before naming a directory), and when there is none it **says so**
rather than falling back to a guess:

```text
No extensions are loadable from …/harness/cli — `checks` is not a core command, and no
extension verbs are registered. Extensions are discovered only in
`<cwd>/.harness/extensions/`, which is not searched upward. A directory above this one
does hold loadable extensions: …/fx003-flow-eval-instrument — run the command from there.
next_action: cd …/fx003-flow-eval-instrument && harness checks
```

**Guards, verified live**: at the repo root `checks --help` still prints the verb help;
a genuine typo (`harness bogusverb`) still returns **E108**; probe 4 still works; bare
`harness`, `--version`, `help`, `doctor` are never intercepted.

## FX002 — an adopted seat's identity, resolved without ever fabricating one

**ESTABLISHED**: `selectCapturedEnv` (`capture-service.ts:204`) reads
`CURRENT_CAPTURED_ENV_KEYS` **from the environment**, so an adopted seat — which never
had `PIJ_SESSION_ID` set — captures none, and the join key is absent with no error and
no marker.

**Design decision, stated because the dossier reads capture-time.** The marker resolves
at **READ** time, not capture time. A capture-time marker needs a new `Segment` field;
this repo's convention bumps `SEGMENT_SCHEMA_VERSION` when the field set moves (the 2.7
note in `segment.ts`), so the marker would make new records **2.8** — and a **2.7 read
pin would refuse every segment this build writes**. The instrument would stop reading
its own output: the packet's defect class, produced by the interaction of two of its own
items. Read-time resolution also works **retroactively** on adopted-seat segments already
captured (exactly the exemplar we cannot score) and reuses the existing `pij-registry`
substrate rather than writing a second reader.

`pij-identity.ts` resolves `env → registry → unresolved`, where unresolved carries a
reason: `registry_unavailable`, `no_descriptor_match`, or `ambiguous` (with candidates).

**A real finding, and why the resolver does not use the obvious index**:
`pij-registry.ts:117` builds `by_harness_session` **first-wins** (`!…has(id)`), so a
genuine collision is *invisible* through it. Ambiguity is the thing FX002 must see, so
`descriptorsClaiming` scans `by_pij` instead. The registry is **not modified** — other
consumers keep the behaviour they were written against.

`pij_session_id` is filled **only** from a genuinely resolved identity; every unresolved
shape leaves it `null` and carries no `pij_id`.

## The 2.7 pin — built, gated, and BLOCKED on a product ruling

**Built** (`segment.ts`): `SEGMENT_SCHEMA_PIN = '2.7'` (deliberately separate from
`SEGMENT_SCHEMA_VERSION`: one says what we WRITE, the other what we READ, and collapsing
them hides the moment they differ); a **declared** `KNOWN_SCHEMA_VERSIONS` closed set;
and `decodeSegmentDetailed` returning a discriminated result with three reasons.

The third reason is not decoration: a **2.8** record is *above* the pin, so calling it
`below_pin` would assert a relation this build cannot establish — the same defect, in the
fix. It resolves `unsupported_version`.

`decodeSegmentDetailed` is **total** and contains no `catch → null` (**Ruling #1.2**).

### Caller audit (Ruling #1.1) — every caller enumerated

`decodeSegment` had exactly **two** call sites:

| # | Caller | Disposition |
|---|---|---|
| 1a | `ref-source.ts` · `segmentsFromBlobs` | **PROPAGATES** — per-reason tally → `RefSegmentsRead.refused` |
| 1b | `ref-source.ts` · `tokensFromBlobs` | **DECLINES, stated in-code** — it answers "how many tokens did this ref commit"; a refused record contributes none whatever the reason, and the same blobs are counted by 1a, so propagating here would double-report |
| 2 | `session-export.ts` · `readSessionSeqs` | **PROPAGATES** → `summary.segments_refused` |

`decodeLooseSegment`'s own `catch` now **names** `malformed` instead of returning `null`
— the precise hazard Ruling #1.2 warns about, in the function that supplies every other
check its input. `RefSegmentsRead.skipped` survives as a **derived sum** computed at one
site, so it can never disagree with the tally it summarises (the FX003 · D2 lesson).

`summary.segments_refused` is **always present**: an all-zero tally is the positive claim
"I refused nothing", which an omitted field cannot make.

### The collision — why the pin is not landed

**ESTABLISHED.** Applying the pin fails **11 tests in 4 files**, every one tracing to the
real-capture corpus: 4 of its 5 instances are **schema_version 2.4**
(claude, cursor-checks-walkthrough, copilot-cli, copilot-vscode); the fifth is 2.7 and
passes. Under a 2.7 pin the four are `below_pin` and **not read**.

This is not test rot — the freeze is deliberate, documented, and **enforced in code**:

- `otlp-golden.ts:209-218` — *"The committed real-corpus goldens are permanently frozen
  Segment-2.4 / OTLP v0.1 compatibility evidence"*, and `REGEN_GOLDEN` **throws**:
  `legacy telemetry goldens are frozen; regeneration is disabled`.
- `real-capture.e2e.test.ts:119,245,370` — *"matches the frozen Segment-2.4 golden"*.
- `docs/plans/066-…-plan.md:69` — the 2026-08-03 instance was minted at the CURRENT
  schema *"tighter than the frozen 2.4/v0.1 corpus"*: an old tier and a current tier, on
  purpose.

The corpus exists to prove this build can still **read** a 2.4 record; the pin abolishes
that. Both cannot stand. Rewriting the goldens' `schema_version` was **disqualified** —
it would assert a 2.4 capture was a 2.7 capture, i.e. falsifying recorded evidence.

Precisely which proof dies: `real-capture.e2e.test.ts` still **passes** (it compares
producer *output* to the golden and never decodes it). What breaks is every test that
**reads a golden back in**. The pin kills the read-back compatibility proof only.

**Blast-radius correction, on the record**: the dossier said the pin narrows
2.4/2.5/2.6/2.7. `decodeSegment` **also** accepted `1.1` and `2.0–2.3`
(`segment.ts:830-836`). The narrowing is larger than stated.

Options B′ (pin hard, delete the ~200 lines of legacy decoder, retire the read-back
proof) and C (pin as a stated *policy* with a production default, corpus tests decoding
at an explicitly declared legacy pin) are with prime for Jordan. **The pin work above
stands either way** — the reason channel and the caller propagation are settled; only the
accept-set scope is open.

## The registry-shape control (Ruling #3.1) — already present, not duplicated

`harness/cli/test/output/error-codes.test.ts` already asserts
`expect(code).toMatch(/^E\d{3}$/)` across `Object.values(ErrorCodes)` — exactly the
requested control, covering every future code. Adding a second would be a second source
of truth. **E149 was added to the exhaustive registry snapshot in the same file**, which
is the declared-registry gate doing its job.

## The discard proof — and its inertness in the LIVE tree

`\.harness/extensions/flow-eval/packet-code-shape-discard.test.ts` — a **new test file
only**; no existing flow-eval file was modified.

It drives the **real lane** (`resolveAssertionDetailed`) and proves both halves:
a code outside `/^E\d{3}$/` is discarded so it cannot license a `fail` **or** a
false-green `pass`; a valid code still licenses both; a malformed sibling does not
poison a good entry (exclude, not reject); and **every code in the CLI registry —
including E149 — is counted, not discarded.**

**Non-vacuity proven, not assumed.** Transiently widening `REFUSAL_CODE` to `/^.*$/`
made the suite go **2 failed | 3 passed**; `resolvers.ts` was restored and
`git diff` on it is **empty before and after** (byte-identical).

**Inertness proof, with Ruling #4's positive control.** `doctor --json` **BEFORE**
listed 12 loaded entries and **contained** flow-eval's `entryPath`
(`.harness/extensions/flow-eval/extension.ts`, `loaded`) — so the probe is populated and
correctly keyed, and an unchanged list afterwards means something. **AFTER**: the list is
**byte-identical** (`diff` empty), and `flow-eval --help` hashes identically
(`c52636fa4f4eea8c93667aa529e8368bf0d5ab6b`) both sides.

## The Dim-0 mutation gate — 16 mutations, ALL FIRE

Every mutation restores a **pre-fix behaviour**, not merely broken code. Runner:
`/tmp/packet-mut.py`.

| Mutation | Failures |
|---|---|
| FX004-M1 guard disabled entirely (pre-fix E108 / silent `--help`) | 4 |
| FX004-M2 claims absent context even when extensions ARE loadable | 1 |
| FX004-M3 message reverts to the retracted "not in a harness repo" | 2 |
| FX004-M4 remedy names a dir without verifying it holds an extension | 5 |
| FX004-M5 "no ancestor" silently falls back to a guess | 4 |
| FX004-M6 `firstPositional` stops at the first token (flags hide the verb) | 2 |
| FX004-M7 E149 collapses back into E108 | 4 |
| PIN-M1 below-pin refused as `malformed` (reasons folded) | 4 |
| PIN-M2 an ABOVE-pin version mislabelled `below_pin` | 3 |
| PIN-M3 `decodeLooseSegment` catch collapses its reason | 1 |
| PIN-M4 session export drops the refusal tally from the envelope | 2 |
| FX002-M1 adopted seat never consults the registry | 4 |
| FX002-M2 ambiguity resolved by first-wins GUESS (the false green) | 2 |
| FX002-M3 "no match" folded into "registry unavailable" | 1 |
| FX002-M4 registry OVERRIDES the seat's own env declaration | 2 |
| FX002-M5 uses the registry's lossy first-wins index | 2 |

**PIN-M3 was SILENT on the first run** and that is the gate earning its keep: my controls
exercised `session-export`'s error path but never `ref-source`'s, so ruling #1.2's claim
was unproven at one of the two callers. Adding the ref-surface controls made it fire.
This is the R1-M9 shape from the other side — a claim nothing exercises proves nothing.

## Honest boundaries — what I could not see through

1. **The pin's accept-set scope is not mine to choose.** "We decline 2.4" and "we can no
   longer read 2.4" are different products. Blocked, deliberately.
2. **`check:dd-docs FAIL — baked dd docs drifted from their sources`** appears in vitest
   output **both before and after** my changes, while the `check:dd-docs` gate itself
   reports **ok**. I did not chase it — it is pre-existing and outside this packet — but
   a gate reporting ok while its own output says FAIL is worth someone's attention.
3. **`tokensFromBlobs` declining to propagate is a judgement call.** I argued
   double-reporting; a reviewer could reasonably want the reason there too. It is stated
   in-code so the decision is visible rather than silent.
4. **The FX004 guard intercepts *any* unregistered name when no extensions are loadable**,
   not just names that would have been verbs. I cannot know whether `bogus` would have
   been a verb in a directory that has none, so the message asserts only the two facts I
   can establish (not a core command; no extension verbs registered here).
5. **I did not verify FX002 against a real adopted seat's live telemetry.** The controls
   use fakes end-to-end. The mechanism is established from source; the *end-to-end*
   recovery of a genuine adopted seat is not something I proved.

## Fence

`git status --short` touches only `harness/cli/src/**`, `harness/cli/test/**`,
`.harness/extensions/flow-eval/` (**one new test file**), and `docs/fixes/FX002-*`.
`package-lock.json` **unmodified**. Nothing pushed.
