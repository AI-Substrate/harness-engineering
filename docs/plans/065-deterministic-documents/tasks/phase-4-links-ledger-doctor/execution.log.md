# Phase 4: Links, ledger & doctor — Execution Log

**Plan**: [deterministic-documents-plan.md](../../deterministic-documents-plan.md) § Phase 4
**Tasks**: [tasks.md](./tasks.md) (T001–T008)
**Runs in parallel with Phase 3** in the same worktree — every commit lands by explicit pathspec (`git commit --only`), and `test/acts/dd.test.ts` is touched only inside a PM-granted custody window.

---

## RESERVED-row renegotiation — PM ACK (before landing)

Proposed to `pij-related-koala` before any body was filled; **ACK'd all four** (that
message is the citation for rulings T007 a–d). Zero command renames, zero frozen
positionals touched, zero E-code additions, E44x untouched.

| RESERVED row | Outcome | Note |
|---|---|---|
| `dd link verify-basis` mutation semantics | ADD `--update <doc>` | PM caveat: `--update` refreshes the recorded sha **only** — an entry's `live`/`pinned` mode must never change as a side effect; asserted by test |
| `dd doctor` scope/options | ADD `--path <dir>` | scopes the root set, never the radius |
| `dd graph` emit/scope options | ADD `--path <dir>`, no `--emit` | `--json` already carries nodes/edges/mermaid; a second emit switch would be a synonym |
| `dd address validate --resolve` classification | **no new option** | pure semantic ruling (shape-directed classification) |

Landing protocol agreed with the PM: message `LANDING <option>` per option, and the
PM commits the one-line `dd-surface.md` RESERVED-row grant in the same window, so
`dd-surface.test.ts` never reddens in either direction.

---

## T001 — Fixture corpus

**Status**: complete. `harness/cli/test/services/dd/links/fixtures/**` — 24 `.dd.json`
documents laid out as a miniature repository (`repo/docs/`, `repo/docs/nested/`,
`repo/node_modules/`), two schemas, and a `README.md` mapping every fixture to the
class it proves.

Corpus is mounted in tests at the synthetic root `/repo` rather than read through
its real path. That is deliberate: the real path contains `test/.../fixtures/`,
which the sweep-exclusion contract skips, so a sweep test rooted there would prove
nothing. Mounting elsewhere lets the exclusion be exercised *on purpose*, by the
fixture that opts out and by a path chosen to look like a fixture.

Every class has a bad fixture and a good twin (README carries the table):
four `link-unresolved` reasons, `link-type-mismatch`, five WARN path/target
classes, `basis-stale`, finding-ownership (broken neighbour + clean citer),
sweep exclusion, and the loop set — `cycle-a` ↔ `cycle-b` plus `self-cycle`
(two loops, one of them a self-reference).

## T002 — Resolver engine, corpus scan, traversal

**Status**: complete. `src/services/dd/links/{model,resolver,scan,traverse}.ts`.

**Shape-directed segment classification** (the T007(d) ruling, exercised here):
P1's parser alternates `name`/`id` by index, which is a hint only. `#meta/owner`
puts a shape part at an odd index; an object nested in an object puts parts at
every index. The resolver asks the schema shape and the data instead — array ⇒
the segment is an instance id, object ⇒ the segment is a declared part, anything
else ⇒ the address descends into a leaf. Positional guessing cannot be made
right; shape-directed classification cannot be made wrong.

**No duplicated findings.** The resolver emits only what is unreachable without
*following* an address (`link-unresolved`, with `reason` as the discriminator).
Cell-level path WARNs and cross-document target/basis findings already belong to
dd-core's `validateDocument`/`validateWalk`; the doctor composes both layers, so
repeating them here would report every one twice.

**Loop breakers — mutation-proved, bounded.** `traverseCorpus` carries the visited
set. Because "it hangs" is a terrible test failure, it also carries a *derived*
tripwire: with the breaker in place a document can be popped at most once, so pops
can never exceed `seeds + distinct documents loaded`. The bound comes from the
corpus, not from an invented ceiling (P2 DL-006), and cannot fire on a well-formed
run at any repository size.

Mutation experiment (run, not asserted): removing `if (visited.has(path)) continue;`
from `traverse.ts` and running the bounded loop test —

```
 FAIL test/services/dd/links/traverse.test.ts > loop breakers > terminates the two-document loop
 FAIL test/services/dd/links/traverse.test.ts > loop breakers > terminates the whole corpus at radius infinity
      AssertionError: expected 6 to be 7   // a document was loaded twice
 Tests  2 failed | 2 passed | 7 skipped (11)
 Duration  146ms
```

Red in 146 ms, not a hang. Source restored and re-verified green immediately after.

**Proof**: `npx vitest run test/services/dd/links` → 3 files, 36 tests, green,
with Phase 3 absent.

---

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution |
|---|---|---|---|---|
| 2026-08-03 | T002 | Noteworthy | A bare-`#` address has no meaning without a containing document, and the CLI face has none. `dd link resolve` / `address validate --resolve` cannot invent one. | Ruled: report `link-unresolved` with reason `no-base-document` and a `next_action` naming the `<path>#<interior>` form — never guess a base. The bare-`#` form is proven resolvable *in context* (service level, with `fromPath`), which is where it is actually used. |
| 2026-08-03 | T002 | Noteworthy | A visited set cannot break a *symlink* cycle — each pass mints a genuinely distinct, longer path. | The corpus scan relies on the port failing honestly (`ELOOP`) and turns it into one `link-scan-failed`, exactly the distinction P2 F002 paid for. Asserted with a throwing `SchemaFs`. |

## T003 — Three faces over one engine

**Status**: complete. `src/acts/dd/{address,link}.ts`.

`dd address generate`, `dd address validate [--resolve]` and `dd link resolve` are
thin bodies over `resolveLink`. Generation assembles the address and then puts it
through the same parser every consumer uses, so a string this verb hands back can
never be one `dd address validate` would reject — which is the entire point of
having the verb (workshop 001 § Tooling contract: agents stop hand-assembling
addresses).

The Phase 4 composition context (`createLinkContext`) lives in `acts/dd/link.ts`
rather than `acts/dd/shared.ts`, because `shared.ts` is Phase 1's file and the
parallel phases may not touch each other's. One definition, five consumers.

## T004 — Pinned ledger and `verify-basis`

**Status**: complete. `src/services/dd/links/basis.ts`, exported from the layer's
`index.ts` as the typed SDK surface Phase 6's gate consumes.

`verifyBasis(address, recordedSha, deps, options) → fresh | stale` is deliberately
a pure question about two shas: a non-dd consumer records the same basis beside
its own `dd_link` and asks exactly the same question (workshop 001 § Basis).

## T005 — `dd links` and standalone `dd graph`

**Status**: complete. Mermaid is emitted directly from the links layer as a
string; the graph family never reaches the render layer. Enforced three ways:
four append-only dependency-cruiser rules (all `reachable: true`), an in-fence
transitive-import test that walks the real import graph, and a deliberate
violation case inside that test so the guard is proven to fail when it should.

**arch-check, per the PM's proof-line rider: 2 BEFORE, 2 AFTER — baseline held.**
Both are the pre-existing `services-ports-type-only` telemetry warnings
(`telemetry/ref-source.ts` and `telemetry/sync-service.ts` → `adapters/git/git-write-port.ts`).
The four new rules contribute zero violations.

## T006 — `dd doctor` at radius ∞

**Status**: complete. The engine is P1's — every document is validated by
`validateDocument` through `validateWalk` at infinite depth. The doctor adds the
three things that only exist when you look at the whole corpus at once: the
enumeration that produces the roots, the interior-resolution pass, and the render
layer's adapter gaps.

A walk rooted anywhere in a connected component covers that whole component, so
components are walked once rather than once per document (`reachableFrom` over the
in-memory edge list); findings are deduped regardless, because components overlap
wherever two of them cite the same document.

**Adapter gaps are consumed by interface only.** Phase 3's aggregation had not
landed, so `DdAdapterGapSource` is defined in Phase 4's own fence and faked in
tests. No Phase 3 module is imported, and the arch rules make that mechanical.
Phase 5 wires the real implementation.

## T007 — Leaf rulings

Rulings (a)–(d) were proposed to the PM **before** any body was filled and ACK'd
in full; the PM landed the matching `dd-surface.md` RESERVED-row amendment in
`dd5e0c3f`. Those two messages are the citation for this section.

**(a) Re-verification verb name and mutation semantics** — RESERVED row 3.
The ruled name is `dd link verify-basis <address> --sha <sha> --update <doc>`.
There is **no separate re-verify verb**: a new verb would add a command row, which
the RESERVED contract does not permit, and re-verification's precondition *is* the
read — resolving the address and hashing the target is exactly the work the
mutation needs, so a second command would duplicate it and then have to agree with
it forever. `--update` names the **referencing** document, because the ledger lives
in the citing file and not in the target; one option therefore carries both "mutate"
and "whose basis moves", instead of a mutate flag plus a second flag to say where.

Three properties, each asserted by a test:

1. **Only `sha` changes.** The entry is rewritten by spread, so `mode` survives
   byte-identically in both directions (the PM's explicit caveat), along with any
   field an author added that no schema declares.
2. **It moves an entry; it never mints one.** A missing entry is reported as E435,
   not invented — adding a document to the ledger is authoring, and a
   re-verification verb may not author behind your back.
3. **A command-line address always anchors at the repository root**, whatever else
   is on the line. `--update` is *not* the address's base. The first implementation
   got this wrong and the live suite caught it: `verify-basis docs/evidence.dd.json#entries
   --update docs/plan.dd.json` anchored the address at `docs/` twice and resolved
   `docs/docs/evidence.dd.json`.

Documents are machine-authored JSON, so the file is re-serialized canonically
(two-space, trailing newline) rather than patched in place.

**(b) `dd doctor` scope** — RESERVED row 1. Added `--path <dir>`. It scopes the
**root set**, never the radius: the sweep still leaves the scoped subtree by link,
because radius ∞ is the definition of the verb and an option that quietly capped
it would be a different command wearing the same name.

**(c) `dd graph` scope/emit** — RESERVED row 2. Added `--path <dir>`, same word and
same semantics as the doctor's, deliberately. **No `--emit`**: the global `--json`
already carries nodes, edges and the mermaid string together, so a second emit
switch would be a synonym for an option that exists.

**(d) `--resolve` segment classification** — RESERVED row 4. **No new option** — a
pure semantic ruling. Each segment is classified against the resolved schema shape
and the data: array ⇒ instance id, object ⇒ declared part, anything else ⇒ the
address is descending into a leaf. P1's positional `name`/`id` kinds stay hints:
`#meta/owner` puts a shape part at an odd index, and nested objects put parts at
every index. Positional guessing cannot be made right; shape-directed
classification cannot be made wrong. Without `--resolve` the CLI reports
`classified: false` and returns bare segment values rather than handing back a
guess that reads like an answer.

**(e) E43x / E44x code names** — **zero additions**. Every code Phase 4 needs was
already named by P1 in `dd-surface.md`; the phase introduces none and touches no
E44x at all (that range stays Phase 6's flow gate). The mapping:

| Finding | Code |
|---|---|
| `link-unresolved` (all interior reasons) | E430 `DD_LINK_UNRESOLVED` |
| `address-path-escape` (doctor) | E433 `DD_LINK_PATH_ESCAPE` |
| basis moved, reported by `verify-basis` | E434 `DD_BASIS_STALE` (in `data`, status `degraded`) |
| `--update` could not re-verify/write | E435 `DD_BASIS_VERIFY_FAILED` |
| `dd links` scan failure / incomplete scan | E436 `DD_LINK_SCAN_FAILED` |
| `dd graph` scan failure | E437 `DD_GRAPH_FAILED` |
| doctor found ERROR-class findings | E438 `DD_DOCTOR_FINDINGS` |
| doctor could not enumerate the corpus | E439 `DD_DOCTOR_SCAN_FAILED` |
| adapter gaps repeated by the doctor | E423–E426, by the render layer's own kind |

**Further leaf rulings made inside Phase 4's own scope:**

- **A bare-`#` address is not resolvable from the command line.** It means
  "inside my own document", and the CLI has no containing document. `dd link
  resolve` / `address validate --resolve` report `link-unresolved` with reason
  `no-base-document` and a `next_action` naming the `<path>#<interior>` form —
  never a guessed base. The form is proven resolvable *in context* at the service
  level, which is where it is actually used.
- **`dd links` honours OD-1 in both directions.** The *target* was named on the
  command line, so it is a direct invocation and is never skipped; the *scan* for
  inbound edges is a sweep, so it honours the exclusions. Otherwise pointing the
  verb at an excluded document would answer "no links" when the truth is "I
  refused to look".
- **Edges are reported at document granularity** (D11). An address argument
  selects the document; the cell's own location is already carried on the edge.
- **The doctor keeps only interior reasons** (`section-unknown`, `part-unknown`,
  `id-not-found`, `not-a-container`). Missing/untracked targets and path escapes
  are WARNs that dd-core's validator and walk already report — repeating them
  would double-report, and reporting a missing file as an unresolved ERROR would
  contradict workshop 001's severity table outright.
- **The traversal's bound is derived, not invented** (P2 DL-006). With the visited
  set in place a document can be popped at most once, so pops can never exceed
  `seeds + distinct documents loaded`; exceeding it is structurally impossible
  unless the breaker is gone. No fixture is needed to "cross" it because no
  well-formed corpus can, at any size — the crossing case is the mutation
  experiment, which is recorded above.

## T008 — Validation & proof

| Proof | Result |
|---|---|
| Slice with Phase 3 absent — `npx vitest run test/services/dd/links` | **81 passed** (7 files) |
| Act-level live suite — `npx vitest run test/acts/dd-links-live.test.ts` | **12 passed** |
| Both-cwds proof — same suites from the **repo root** | **93 passed** (8 files) |
| Both-cwds proof — same suites from **harness/cli** | **93 passed** (81 + 12) |
| P1+P2 suites (`test/services/dd`, `dd-surface`, `dd`, `dd-live`, `dd-schema-fs`) | green — the freeze holds |
| Full suite (`vitest run --coverage`, the `just test` command) | **259 files, 3527 tests, 0 failures**; statements 88.85%, lines 91.3% |
| `harness arch-check` | **2 before, 2 after** — baseline held |
| biome on Phase 4 paths | clean |

### Recorded live transcripts (the real bin, `node harness/cli/bin/harness.js`, temp-dir corpus)

**1. Address round-trip (AC-05).**

```
$ dd address generate 'phases/ph-1a2b/tasks/tk-3c4d/title' --path docs/plan.dd.json
  ok  address=docs/plan.dd.json#phases/ph-1a2b/tasks/tk-3c4d/title  form=qualified
$ dd address validate 'docs/plan.dd.json#phases/ph-1a2b/tasks/tk-3c4d/title' --resolve
  ok  classified=true
      segments=[phases:section, ph-1a2b:instance, tasks:part, tk-3c4d:instance, title:part]
$ dd link resolve 'docs/plan.dd.json#phases/ph-1a2b/tasks/tk-3c4d/title'
  ok  value="Resolve an address end to end"  kind=part
```

**2. `verify-basis` fresh → stale → re-verified (AC-06).** Real sha256 digests.

```
$ dd link verify-basis 'docs/evidence.dd.json#entries' --sha <recorded>
  status=ok        state=fresh
  (upstream edit: a row is appended to the evidence list)
$ dd link verify-basis 'docs/evidence.dd.json#entries' --sha <recorded>
  status=degraded  state=stale  code=E434   exit=0
$ dd link verify-basis 'docs/evidence.dd.json#entries' --sha <recorded> --update docs/plan.dd.json
  status=ok  updated=true  mode=pinned  previous=7a5454216b7d -> sha=8427d7ea62bd
$ dd link verify-basis 'docs/evidence.dd.json#entries' --sha <new>
  status=ok        state=fresh
```

**3. Doctor on the cyclic corpus, and the exclusion contract (AC-07, AC-15).**

```
$ dd doctor                          # corpus contains cycle-a <-> cycle-b
  status=ok  discovered=4 swept=4 counts={error:0, warn:0}   real 4.4s   (terminates)
$ dd doctor                          # after adding a blocked-without-note document
  status=error  code=E438  errors=1  finding=(state-note-required, E408, broken.dd.json)   exit=1
$ dd doctor                          # same document, now dd.sweep_exclude=true
  status=ok  swept=4  counts={error:0, warn:0}                exit=0
$ dd validate docs/broken.dd.json --depth 0
  status=error  code=E408                                     exit=1
```

The last pair is AC-15 and OD-1 together: the sweep skips the opted-out document
while pointing the validator straight at it still fails — which is what lets a
repository keep a known-bad corpus committed and a green `harness checks`.

**4. `dd graph` over the cyclic corpus (AC-14)** — the loop is visible, and no
renderer was involved:

```
flowchart LR
  n0["docs/cycle-a.dd.json"]
  n1["docs/cycle-b.dd.json"]
  n2["docs/evidence.dd.json"]
  n3["docs/plan.dd.json"]
  n0 --> n1
  n1 --> n0
  n3 --> n2
  n3 --> n2
```

## Deferred & Noteworthy (this phase)

**Noteworthy**

- *Adapter-gap seam is Phase 4's declaration, not Phase 3's export.* `DdAdapterGapSource`
  was defined here against the declared shape because Phase 3's aggregation had
  not landed. Phase 5 must adapt Phase 3's real output onto it (or agree a shared
  shape). No Phase 3 module is imported, and an arch rule keeps it that way.
- *The doctor duplicates dd-core's issue-class → E-code map.* That map is private to
  `acts/dd/validate.ts` and the fence forbids editing Phase 2's file. TypeScript's
  exhaustive `Record` is the guard: a new dd-core issue class cannot be added
  without this map failing to compile. Worth collapsing to one exported map at
  fan-in.
- *`dd links` takes no options by design.* It is not a RESERVED row, so scoping it
  would have been a frozen-surface change. It always scans from the repository root.

**Environment (not the plan's code — both reproduced and proven)**

- *`just test` fails in this agent environment for an ambient reason.* The shell
  exports `GIT_CONFIG_KEY_0=safe.bareRepository` / `VALUE_0=explicit`, so git
  refuses implicit bare-repository discovery and
  `test/adapters/git/exec-remote-telemetry-git.int.test.ts` dies in `beforeAll` at
  `git config uploadpack.allowFilter true` with "fatal: not in a git directory".
  Reproduced outside vitest in three commands; the suite passes 91/91 with those
  variables cleared, and the full run is 3527/3527. Nothing to fix in the repo —
  but a CI or contributor environment carrying that variable would see the same
  false failure.
- *Two coders running `just test` in one worktree collide on `harness/cli/coverage/.tmp`*
  ("Something removed the coverage directory Vitest created earlier"). The custody
  protocol covers the git index and `dd.test.ts` but not the coverage directory.
  Worked around with `--coverage.reportsDirectory`; captured as a difficulty.

**Deferred**: none. No task skipped or blocked, no acceptance criterion unmet, no
`TODO`/`FIXME`/`HACK` introduced.
