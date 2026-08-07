# Execution log — Phase 1: Converge the managed block on the mode union

**Plan**: `docs/plans/076-commit-guidance-convergence`
**Branch**: `s076/commit-guidance-block` (cut at `5dae6e9c`)
**Coder**: `pij-immediate-pennyroyal` · **PM**: `pij-respectable-clam`

---

## tk-0001 — the `CommitMode`-keyed guidance table (TDD-first)

**RED first.** The new assertions were written and run before any source change:
`6 failed | 24 passed`. The most important RED was `readAgentsBlock` returning
`current` for the verbatim pre-075 bytes — i.e. the fixture proved the block had
not yet moved, so the migration test could not have been tautological.

**What landed** in `harness/cli/src/services/instructions/commit-guidance.ts`:

- `CommitOutcome` — one reader-facing outcome: `label`, `promise`, `remedy`, and
  `nudge: 'drains-this' | 'not-the-remedy'`. The nudge disposition is DATA because
  getting it wrong *is* the defect: the pre-075 block sent every reader to
  `telemetry-nudge`, which refuses on a Windows named pipe.
- `COMMIT_OUTCOMES` — the three outcomes (`verified`, `buffered`, `unverified`).
- `CommitOutcomeGuidance` — `{ outcome: CommitOutcomeId; when: string }`.
- `COMMIT_OUTCOME_GUIDANCE` — `as const satisfies Record<CommitMode, CommitOutcomeGuidance>`,
  importing `CommitMode` type-only from `commit-service.ts`.

**Design note — why two levels, not one flat table.** The task text reads "each entry
declares the label, the promise, and the remedy". A flat `Record<CommitMode, …>` would
have meant the two buffered modes each carrying their OWN copy of the same promise and
remedy prose — two hand-maintained copies, which is the exact defect one level down.
Entries instead name a shared outcome *object*, so a collapsed outcome is literally the
same strings, and a mode whose promise genuinely differs cannot be folded in. The
`satisfies Record<CommitMode, …>` totality — the thing ac-0002 asks for — is unchanged
by the indirection, as the Dim-0 transcript below shows.

**No behaviour changed.** `commit-service.ts` has a zero-line diff; the only coupling is
a type-only import in the other direction.

## tk-0002 / tk-0003 — both surfaces render from the table

`commitOutcomeLines()` renders the list ONCE and both surfaces embed it verbatim. Modes
are walked in table order and grouped by declared outcome, so a collapsed outcome names
every condition that reaches it rather than describing one mode and implying the other.

- `commitGuidanceBlock()` — the hand-written two-outcome sentence is gone, replaced by
  "tells you WHICH outcome you got. The outcomes are:" + the rendered list.
- `COMMIT_INSTRUCTIONS` — the three hand-written bullets under "The two safe shapes" are
  replaced by the same rendered list.
- **One edit beyond tk-0003's letter**: the "What is and is not guaranteed" section
  carried a THIRD hand-maintained enumeration ("verifies the note landed, or names the
  buffer…, or states that attribution could not be verified"). ac-0003 says neither
  surface may carry an independently-maintained enumeration, so it now reads "reports
  which of the outcomes above it took". Every string the existing tests pin
  (`never SILENT about attribution`, `**NOT guaranteed**: delivery`) is preserved. All
  other prose — why the verb exists, the shapes to avoid, the Windows not-supported
  note — is untouched.

The two fence markers are byte-identical; a test now pins both literal strings and
asserts the pre-075 fixture still starts and ends with them, so a block already in the
wild is still found and refreshed rather than orphaned.

## tk-0004 — tests

New fixture `harness/cli/test/support/pre-075-block.ts` holds the pre-075 block captured
from `git show 5dae6e9c` — real historical bytes, never regenerated from
`commitGuidanceBlock()` (that would make the migration test tautological — F011).

| # | claim | where |
| --- | --- | --- |
| a | the block names the unverified outcome and does NOT offer the nudge as its remedy | `commit-guidance.test.ts` |
| a′ | the block no longer carries the two-outcome sentence | `commit-guidance.test.ts` |
| b | every table entry's label/promise/remedy — and every mode's `when` — appears in BOTH surfaces, iterating the TABLE | `commit-guidance.test.ts` |
| c | the mode→outcome mapping is pinned, so a future mode cannot be quietly folded in | `commit-guidance.test.ts` |
| d | the verbatim pre-075 block reads `stale`; doctor's row is not-ok, says STALE, names `--inject`, and mutates nothing | `attribution-surface.test.ts` |
| e | a refresh inside a file with user content on BOTH sides leaves both byte-identical; a second run is `unchanged` | `commit-guidance.test.ts` |

Result: `30 passed (30)` across the two files; full suite green under `just checks`.

## tk-0005 — this repo's own block

`node harness/cli/bin/harness.js instructions commit --inject` → `refreshed`.
`git diff AGENTS.md` is **11 lines, all between the two markers** (3 removed, 6 added,
verified by eye): three prose lines replaced by two prose lines, a blank, and the three
rendered outcome bullets. Nothing outside the fences moved.

## tk-0006 — evidence

### ac-0002 · Dim-0 mutation — the compile error is the deliverable

A fake fifth member was added to `CommitMode` in `commit-service.ts`:

```diff
   | 'ingress-unverified'
+  | 'dim0-fifth-mode';
```

`npx tsc --noEmit -p harness/cli/tsconfig.json` → **exit 2**:

```text
src/services/instructions/commit-guidance.ts:124:12 - error TS1360: Type '{ readonly 'direct-verified': …; readonly 'file-buffered': …; readonly 'harness-buffered': { ...; }; readonly 'ingress-unverifie...' does not satisfy the expected type 'Record<CommitMode, CommitOutcomeGuidance>'.
  Property '"dim0-fifth-mode"' is missing in type '…' but required in type 'Record<CommitMode, CommitOutcomeGuidance>'.

124 } as const satisfies Record<CommitMode, CommitOutcomeGuidance>;
               ~~~~~~~~~

src/services/instructions/commit-guidance.ts:139:31 - error TS7053: Element implicitly has an 'any' type because expression of type 'CommitMode' can't be used to index type '…'.
  Property 'dim0-fifth-mode' does not exist on type '…'.

139     const { outcome, when } = COMMIT_OUTCOME_GUIDANCE[mode];
                                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Found 2 errors in the same file, starting at: src/services/instructions/commit-guidance.ts:124
```

**The claim this proves, precisely**: both errors are in `commit-guidance.ts`, at the
guidance table (line 124) and its renderer (line 139). `commit-service.ts` compiled
CLEANLY with the fifth mode — so tsc's *only* objection to a new commit mode is that the
guidance has not described it. That is the guarantee ac-0002 asks for, and it is the
opposite of what a test asserting today's text would have given.

The mutation was reverted (`git diff harness/cli/src/services/commit/commit-service.ts`
→ empty) and `tsc --noEmit` re-run → **exit 0**.

### `just checks`

`tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok check:telemetry-fixtures:ok
check:doctrine-parity:ok check:dd-docs:ok root-invocation-smoke:ok arch-check:degraded
dd doctor:ok skills-check:ok markdown-lint:degraded windows-check:degraded`

Every hard gate green. The three warn-launch degradeds were confirmed **pre-existing and
untouched by this change**:

- `arch-check` (2× `services-ports-type-only`) — `telemetry/ref-source.ts` and
  `telemetry/sync-service.ts`. Neither is in this diff.
- `markdown-lint` (210 findings) — **zero** are in `AGENTS.md` (checked by filtering the
  findings for the path).
- `windows-check` (6 hazards) — all in `.harness/extensions/html-snap/`. Zero mention
  `commit-guidance`.

### doctor

`node harness/cli/bin/harness.js doctor` →
`{'name': 'commit-guidance', 'ok': True, 'detail': 'AGENTS.md carries the managed harness:commit-guidance block'}`

---

## Discoveries & Learnings

| # | tag | what |
| --- | --- | --- |
| D1 | Noteworthy | The task schema has no `in_progress` state — `harness dd set …/state in_progress` is refused by the schema (`E451`; allowed: `unchecked`, `checked`, `blocked`, `human-skipped`, `na`). The per-task "flip to `[~]` on start" ritual in the implement sub-skill has no representation in a dd-native plan. Not a blocker; states were flipped on completion with receipts. |
| D2 | Noteworthy | The "What is and is not guaranteed" section held a third copy of the outcome enumeration that no task named. Left alone it would have been the next thing to drift, so it was derived away (see tk-0003). Flagging it as a deliberate call a human might have made differently. |
| D3 | Noteworthy | The rendered outcome bullets are long single lines (not hard-wrapped to ~78 like the surrounding prose). Wrapping was considered and rejected: it would break the `toContain(promise)` assertions that prove both surfaces carry the same strings, and `markdown-lint` reports zero findings for `AGENTS.md` as-is. Legibility cost is a diff that shows one long line per changed outcome. |

## Deferred & Noteworthy (this phase)

No deferred work, no skipped or blocked tasks, no unmet acceptance criteria, no new
`TODO`/`FIXME`/`HACK` markers. Three `Noteworthy` rows above (D1–D3) — D2 is the only one
that changed a file beyond the letter of a task.

## Suggested commit message

```text
fix(instructions): converge commit guidance on the CommitMode union (plan 076)

The managed AGENTS.md block promised exactly two outcomes while CommitMode has
four, so a Windows agent was told to expect an outcome it cannot get and was
sent to a recovery command that refuses on that platform.

The words were wrong because the outcome contract existed twice, in two
hand-maintained prose copies with nothing forcing them to agree. Both surfaces
now render from one exported Record<CommitMode, CommitOutcomeGuidance> table in
src, so adding a fifth mode is a compile error at the guidance table — the third
application of the TRACE2_TARGET_POLICY / RETAINED_FIELD_RENDERING pattern.

No commit behaviour changes: commit-service.ts has a zero-line diff.
```
