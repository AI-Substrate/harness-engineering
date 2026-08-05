# FX003 — execution log (coder: pij-alright-muskox)

**Branch**: `s065/fx003-flow-eval-instrument` (from `be49dd32`) · **Dossier**: `FX003-flow-eval-instrument-honesty.md`
**Rulings honoured**: Ruling #1 (Q1 confirmed option A; Q2 approved + unknown-type condition; Q3 redirected to a third state; the D1 discriminator hole).

## Baseline (before any change)

The worktree was fresh — no `node_modules` — so `npm install && npm run build` ran first.
**`just build` was deliberately NOT used**: it runs `npm link`, which would repoint the
machine-global `harness` shim. Everything below used `node harness/cli/bin/harness.js`.

```
arch-check 2 · markdown-lint 196 · windows-check 6
tests ok · biome ok · typecheck ok · check:docs ok · check:flows ok ·
check:telemetry-fixtures ok · check:doctrine-parity ok · check:dd-docs ok ·
root-invocation-smoke ok · dd doctor ok · skills-check ok
status degraded, exit 0
```

**Exit gate — byte-identical**: `arch-check 2 · markdown-lint 196 · windows-check 6`,
re-run *after* the `instructions.md` edit (markdown-lint reads authored docs, so the
first post-fix run would not have proven it).

`package-lock.json` drift was incidental `npm install` noise and was reverted, not committed.

## The Dim-0 mutation gate

Six mutations, each reverting ONE defect's logic to its pre-fix form, against the
36 controls in `fx003-instrument-honesty.test.ts`. Every mutation fires its own
controls and no unrelated ones (M2/M6 overlap only where both assert the same
axis-null property):

| Mutation | Controls fired |
|---|---|
| M1 `gateRefused` returns a boolean | 3 |
| M2 axis fold returns `0` | 7 |
| M3 base-ref string inequality | 3 |
| M4 no `corpus-floor` type | 7 |
| M5 placeholder plain `unknown` | 2 |
| M6 unknown type silent | 2 |

### Verbatim pre-fix output (D1 — the live regression)

```
FAIL … > FX003 D1 … > CONTROL: evidence PRESENT + refusals EMPTY + lane never demonstrated ⇒ unknown (pre-fix: fail)
AssertionError: expected 'fail' to be 'unknown' // Object.is equality

Expected: "unknown"
Received: "fail"

 ❯ …/fx003-instrument-honesty.test.ts:81:23
     80|     const r = await resolveAssertionDetailed(a('gate-refused', { min: …
     81|     expect(r.verdict).toBe('unknown');
       |                       ^
```

Two further D1 controls fire identically (`'fail'` vs `'unknown'`) for the named-code
case and for the `source: 'buffer'` case.

## Per-defect

**D1 (HIGH) — `gateRefused` accused the subject on its own blind spot.**
The reviewer's catch was correct and changed the design: `evidence.source` is *not* a
sufficient discriminator. `source: 'buffer'` rules out FX001 · D2 (the OTLP roll eating
`command_exit.code`) but says nothing about FX001 · D4, where a failing Bash tool_result's
`Exit code N` prefix meant **no `command_exit` was emitted at all** — and every refusal
exits non-zero. Both defects yield a byte-identical empty map, both fixes are prospective,
and per Ruling #2 neither bumped `scope_version`, so nothing on the wire dates the binary.

Final rule — a **capability proof**, not a date proof: the lane must have *demonstrated it
can record* (any coded `command_exit` in the session). Meets the bar ⇒ `pass`; short of the
bar on a demonstrated lane ⇒ `fail`; empty ⇒ `unknown` with a note. `source` is reported in
the note for diagnosis and trusted for nothing.

**Stated plainly, not hidden**: a *bare* `gate-refused {}` over an empty map is now
`pass`-or-`unknown` and can never `fail`. That is the honest reading. `fail` stays reachable
wherever the lane proved itself (a named `code`, or a `min`, the demonstrated lane did not
reach) — proven by its own guard control.

**D2 (HIGH) — three implementations of "is this axis measured", and the wrong one was the source.**
`report.md` was already honest (`unmeasured`) and the ledger already wrote `null` — both by
*re-deriving* measured-ness from the result rows, which is precisely how the scorer's wrong
answer survived and why `report.json` still read `process: 0`. Per Ruling #1 option A the
scorer is now the single source (`number | null`), and `report.ts` + `ledger.ts` **consume**
it; the local `scorable()` and `axisMeasured()` re-derivations are deleted. The overall
`score` had the identical defect and is fixed with it. `ledger-view.ts` was the fourth
consumer and **needed no change** — it already rendered `number | null` as `—`.

Nothing coerces `null → 0` on the way out: `renderMarkdownFromReportJson` reads via a
`scoreOrNull` that never falls back to `0`. **Historic `report.json` rows carry a numeric `0`
for unmeasured axes and cannot be corrected retroactively** — the number is all the file has.
They are read back as-is, and a reader must not treat an old `process: 0` as measured. The
fix is prospective, exactly like FX001's D2/D4.

**D3 (MED) — the base-ref check compared string lengths.** Both sides now resolve to full
oids (`git rev-parse --verify <ref>^{commit}`, which also peels tags), with a hex-prefix
fallback when the declared ref will not resolve. Per the Q3 redirect there are **three**
states, not two: no finding / **unpinned** / drift. A literal `HEAD` — what `scaffold` writes
by default — is the *absence* of a pinned base, so it now reports that the run is not
reproducible instead of installing a check that could never fire.

**D4/D5 (MED) — a non-vacuity floor, and a caution the dossier's own fix direction tripped over.**
New `corpus-floor` type (fs lane, capability axis): `min_items`, `min_files`, and
`require_field` (EVERY row must carry the key). `require_field` is the precise answer to D4 —
`file-content-matches "pressure"` passed when one row anywhere carried it.

**The dossier suggested coverage ("every AC served by ≥1 task") — I did not implement it, and
that is deliberate.** `plan validate --complete` already refuses exactly this as its
`orphan-claim` check (`semantics.ts`: *"has no incoming satisfies — no task accounts for it"*).
Implementing it here would have created the second source of truth the dossier's own standing
caution forbids, and that A3 exists to catch one level up. What the validator has *no* opinion
on is SIZE — a one-AC, one-task plan is perfectly valid and fully covered — so the floor is
cardinality + per-row field presence only. A control asserts no assertion carries a `coverage` param.

Scenario wiring: A5/A6 become `corpus-floor` with `require_field` `pressure`/`satisfies`;
new required A9a/A9b give A9's `dd doctor` a corpus to be clean *about* (D5 — it passed in a
run where the subject authored no dd documents at all).

**D6 (LOW) — an unresolved placeholder now says so.** Rather than a fourth verdict value
(which would break the ledger's lane enum), resolvers may return `{verdict, note}`. The note
rides to the result row, `report.json` and the `RunRecord` lane (`additionalProperties: true`,
no schema bump). It distinguishes an unfilled **run parameter** from missing **subject
evidence** — the confusion that cost A11 twice. The same channel carries D1's reason.

**Ruling condition — unknown assertion type.** `resolveAssertionDetailed` resolves an
unrecognised `type` to `unknown` with an explanatory note: never a crash, never a pass, so an
older scorer meeting a newer scenario degrades honestly. Control + guard included.

## Honest boundaries — things I could not see through

1. **The refusal lane cannot be probed, only observed.** There is no way from the evidence
   object to prove the lane *could* have recorded a refusal that did not happen. The only
   capability proof available is a refusal that *did*. A real probe would need a CLI-side
   signal (e.g. a `gaps` marker for refusal capture, or exposing uncoded `command_exit`
   counts) — `harness/cli/**` is fenced and PR #95 is frozen, so I did not pursue it. **This
   is the one place a future fix could restore a failable bare `gate-refused`.**

2. **`fetchEvidence` discards `degraded` envelopes entirely.** `extension.ts` returns `null`
   unless `env.status === 'ok'`, and `telemetry get` returns `degraded` whenever token
   coverage is not `measured`. So a session with perfectly good skill/verb/refusal evidence
   scores every telemetry lane `unknown` because a *token* field was incomplete. It errs
   toward `unknown`, so it is not in FX003's "reports what it did not reach" class — but it
   is why the D1 regression only bites when token coverage is measured. Not fixed: out of the
   dossier's six, and it is a semantic change to the evidence gate.

3. **The `SessionEvidence` lock-step guard is dead** (routed to prime, accepted).
   `harness/cli/test/extensions/flow-eval/session-evidence-lockstep.test.ts` claims a field
   added to one decl and not the other "fails to COMPILE". It cannot: `tsc` runs
   `-p harness/cli/tsconfig.json` whose `include` is `["src"]`, and vitest transpiles without
   typechecking. Proved with a throwaway tsconfig (deleted) — its `SAMPLE` already omits four
   required `CliEvidence` fields (`token_evidence`, `refusals`, `source`, `ref_checked`) and
   nothing notices. Consequence for this fix: my additions to the extension's re-declared
   shape (`source?`, `ref_checked?`) are **unguarded** against CLI drift. I declared them
   optional deliberately — the shape is parsed from an arbitrary core's JSON, and a pre-FX001
   core does not send them, so `undefined` is a genuinely different fact from any of the three
   surfaces. Forbidden path, not touched.

4. **I did not re-score anything.** No live eval, no ledger row, nothing read from
   `.harness/live-testing/**` as input — those are RESULTS. Every claim above rests on the
   controls and the mutation gate.

5. **`corpus-floor` reads dd documents structurally** (`sections[].value`, tolerating both the
   array and object-of-arrays shapes). It does **not** resolve dd links or use the dd services —
   an extension cannot import CLI internals. So it counts rows; it does not verify that a
   `satisfies` link *resolves*. That remains `plan validate`'s job, deliberately.
