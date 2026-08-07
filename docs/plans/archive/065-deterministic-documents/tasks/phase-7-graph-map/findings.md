# Phase 7 findings — operating `dd graph map` as a user

The inference lens for T007(b): the command driven by hand against the **live
exemplar corpus**, not against a fixture, and written down as experienced rather
than as intended. The deterministic lens is
`harness/cli/test/acts/dd-graph-map-live.test.ts` (T007a) plus
`test/services/dd/links/map-exemplar.test.ts`, which pins the same corpus.

Every run below was from the repository root, per FU-4.

---

## What worked, first time

**The question the phase exists for is answered in one command.** Seeding at
`plan.dd.json#acceptance_criteria/ac-0201` returns that row's `pressure` and
`proven_by`, then the log entry's own citation of `bp-0201` at two hops, and — on
the inbound arm, in the same answer — the four rows across two other documents
that cite the AC. Before this phase the same address returned the whole file,
`$.sections[meta].value.backpressure` included.

**A whole-document seed is unexpectedly the better demo.** Not a designed
outcome. `dd graph map <path>` with no interior shows the seed as
`[~] 7/10` — derived progress on the document itself, computed through
`deriveItems` — with the corpus fanned out around it. "Is this plan done?" reads
as a picture rather than a number, which is the argument for deterministic
documents in one screen.

**The diamond drew itself correctly.** `ac-0201 → lg-0201 → bp-0201` while
`ac-0201 → bp-0201` directly: the second path renders as
`↩ … (already shown)` rather than repeating the subtree. I expected to have to
fix this and did not.

---

## What was confusing, and what I expected and did not get

### F1 — A missing `#` reports the symptom, not the cause (captured: `CONF-002`)

```
$ harness dd graph map "…/plan.dd.json/acceptance_criteria/ac-0201"
dd graph map: address target is missing: /…/plan.dd.json/acceptance_criteria/ac-0201
  → Check the target with `harness dd links <target>`, then fix …
```

Literally true and completely unhelpful. Without a `#` the argument is a PATH, so
the loader is asked for a file that does not exist and answers honestly. But the
actual mistake is a forgotten file/interior boundary, and the `next_action`
sends the reader to `dd links <target>` — which will fail the same way.

I expected: *"that looks like an address with no `#` — did you mean
`plan.dd.json#acceptance_criteria/ac-0201`?"*

**Not fixed here, deliberately.** The seed resolves through `resolveMapSeed`,
whose bare-path branch is shared reasoning, and the `next_action` comes from
`nextActionFor` in `acts/dd/shared.ts` — a **stood-off file**. Proposed rather
than edited: a `no-boundary` reason for a bare path that contains `.dd.json/`,
carrying its own next action. It would improve `dd links` and `dd link resolve`
at the same time.

### F2 — The 80-column budget is spent on the part that never changes

The first working render put a full repo-relative path on every line:

```
├─<- [x] docs/how/dd/exemplar/tasks/phase-2/tasks.dd…
```

136 columns, no room for the claim text, and forty characters of it identical on
every row. Fixed inside T005: addresses are shown relative to the **seed's own
folder**, the same document collapses to its bare interior (`#rows/bp-0201` —
which is how the link was authored), and the header states the folder once. The
labels only became visible at all after that change.

An address is still never truncated or wrapped. Half an address is not a shorter
address, it is a wrong one.

### F3 — FU-4 is immediately reachable from ordinary use

```
$ cd docs && harness dd graph map "plans/…/plan.dd.json#acceptance_criteria/ac-0201"
dd graph map: schema "builder/plan" was not found in any discovery root
  (…/docs/plans/…/exemplar, …/docs/.dd, …/docs/.harness/.dd, ~/.dd)
```

`repoRoot` comes from `process.cwd()`, so from `docs/` the discovery roots move
with it and a perfectly good corpus becomes unresolvable. This is **FU-4, not a
defect of this phase** — reported, not compensated for. Worth noting that it is
one `cd` away from a first-time user, and that the error names schema discovery
rather than the actual cause.

### F4 — `NO_COLOR` "not working" is Node's warning, not ours

```
(node:89757) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
```

A genuine ten-second scare while checking rule 2. It is Node's own warning about
its internal colour handling; `resolveUseColor` gives `NO_COLOR` precedence
regardless, and the output was plain. Measured rather than assumed:

| invocation | escapes |
|---|---|
| human, piped, no `FORCE_COLOR` | 0 |
| human, piped, `NO_COLOR=1` | 0 |
| human, piped, `FORCE_COLOR=3` | 224 |
| `--json`, `FORCE_COLOR=3` | **0** |

The third row is correct precedence, not a leak: an explicit `FORCE_COLOR`
outranks the pipe, exactly as it does for commander's own help.

### F5 — Two mutations survived a fully green suite (captured: `DL-008`)

Not a usability finding, but the most valuable thing this phase produced.

1. **The probe aimed at the wrong trap.** I wrote a test asserting that row `[1]`
   cannot claim row `[10]`'s links, and removing the boundary check from
   `isWithinLocation` left it green — because `]` already terminates an index.
   The real trap is a sibling FIELD whose name extends another's:
   `…value[0].pressure` IS a textual prefix of `…value[0].pressure_note`. The
   test now uses that shape and the mutant dies.
2. **`reachableFrom` had no test at all.** Replacing its whole body with
   `return new Set([seed])` left all 690 tests green. It is the doctor's
   component-skip optimisation; gutting it costs correctness of nothing the suite
   observes, only work. Since I refactored it onto `boundedWalk`, I added direct
   coverage for it. That the *doctor-level* consequence is still unobserved is a
   coverage finding I am reporting rather than expanding into.

---

## What I would still change

- **`dd links` should say what it is answering about.** Now that a row-scoped
  answer exists, `dd links <row-address>` returning the document's edges is not
  merely coarse, it is misleading — it accepted an address it did not honour.
  Either it should scope like `map` does, or it should say "this address names a
  row; edges are reported per document — use `dd graph map` for the row."
- **`--depth 3` is the wrong default for the inbound arm on a dense corpus.**
  Outbound three hops is a proof chain; inbound three hops is every evidence row
  in the phase. The exemplar hits `--max-nodes 20` on the inbound arm alone. The
  bound holds and says so, which is the contract — but a reader's first run is
  more often truncated than not.

---

## Observations captured

| id | kind | what |
|---|---|---|
| `CONF-002` | confusion | A seed missing its `#` reports a missing file; `next_action` cannot help (F1) |
| `DL-007` | difficulty | The P4 links layer had no mapping between an address interior and an edge location — the root cause of the document-scoped answer |
| `DL-008` | difficulty | Two mutants survived a green suite (F5) |
| `MW-001` | magic-wand | The injected-palette pattern: one render path, plain golden and coloured run identical modulo the palette, `--json` structurally unstylable |

Buffer: `.harness/temp/agent/session-buffer.md`.
