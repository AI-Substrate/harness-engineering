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
