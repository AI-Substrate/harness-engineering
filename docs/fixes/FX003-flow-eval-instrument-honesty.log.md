# FX003 — execution log (coder: pij-alright-muskox)

**Branch**: `s065/fx003-flow-eval-instrument` (from `be49dd32`) · **Dossier**: `FX003-flow-eval-instrument-honesty.md`
**Rulings honoured**: Ruling #1 (Q1 confirmed option A; Q2 approved + unknown-type
condition; Q3 redirected to a third state; the D1 discriminator hole) and **FX003-R1**
(the zero-count predicate; the blind cast at the evidence seam).

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

## R1/R2 — the predicate that has now been wrong four ways

`refusalLaneDemonstrated` is the single load-bearing predicate of D1, and review has
corrected it four times. All four were **the same mistake: taking the presence of a
structure for evidence of the thing.**

| round | what it read | why it was wrong |
|---|---|---|
| 1 | a **boolean** where three states were needed | a shortfall was reported as a subject failure (the original D1) |
| 2 | `source: 'buffer'` as a **date** proof | blind to FX001 · D4 — it rules out the roll eating the code, never a capture that never fired |
| 3 | a **KEY** where a positive COUNT is the evidence | `{ E440: 0 }` — a key minted with no occurrence behind it — licensed a `fail` on an absent `E443` |
| 4 | a **well-formed-LOOKING** key/value where a VALID one is the evidence | `parseSessionEvidence` type-checks `refusals` as "an object of finite numbers", so `{ malformed: 1 }` and `{ E440: 0.5 }` both survived the seam and both licensed a `fail` |

**Round 4 had a second face the review did not name, and it is the worse one.** With no
`code` param `gateRefused` SUMS the map, so `{ malformed: 5 }` gave `observed = 5 >= min = 1`
and resolved **`pass`** — the instrument certifying that a gate stopped the subject when
nothing did. A false fail gets argued with; a false pass gets believed. Both polarities are
controlled; the false-green control is the one this log would have been wrong to omit.

The predicate now asks about **a REAL entry — shape and magnitude together**, decided in one
helper (`refusalCount(key, v)`: a key matching `REFUSAL_CODE` carrying a positive INTEGER)
used by *both* the observed sum and the demonstrated test, so the two can never disagree
about what a refusal is. Zero, `NaN`, negative, `Infinity`, fractions and unrecognised keys
all license nothing. Splitting key-validity from magnitude-validity is exactly how the same
bug got in twice, so they do not live apart.

**The closed set is declared, not accidental.** `REFUSAL_CODE = /^E\d{3}$/` matches all 116
codes in `harness/cli/src/output/error-codes.ts` with no exceptions, but the PRODUCER is
looser — `session-evidence.ts` keys `refusals` by any non-empty `command_exit.code`. So the
narrowing happens on read, and a code shape we did not anticipate is silently discarded: it
stops counting toward `observed` and stops licensing a `fail`. That direction is safe (it can
only push a genuine `fail` down to `unknown`, never manufacture a verdict) and it is the
stated decision, with the comment beside the regex naming it — FX001's first defect was a
closed set nobody declared.

**An invalid entry is EXCLUDED, never grounds to reject the envelope.** Refusing the whole
payload over one unreadable refusal key would throw away the good skill/verb/checks evidence
beside it — the same over-claiming corrected in R1b, running the other way. There is a guard
control for exactly this.

**For the fifth reader**: the question this predicate must answer is *"did a refusal actually
get recorded?"* — never *"is there a place where one would have gone?"* That sentence is in
the code beside it.

### Residual boundary (stated, not fixed)

Entry-level validity is decided in `refusalCount`, but `parseSessionEvidence` still requires
`refusals` to be an object of *numbers* — so `{ E440: 'lots' }` refuses the whole envelope
rather than excluding one entry. That is the pre-existing R1b type contract on the wire (with
its own accepted control), and relaxing it would widen `SessionEvidence.refusals` to
`Record<string, unknown>`, a type change reaching a FORBIDDEN file's fixtures. It errs toward
`unknown`, so it is not in FX003's class — but it is the one place "exclude, do not reject"
is not yet fully honoured, and it is the orchestrator's call whether that matters.

### R1 — the evidence seam no longer casts

`fetchEvidence` did `env.data as SessionEvidence` straight out of `JSON.parse`: an
assertion about data nobody checked, in the function that feeds every other check its
input. It now validates through `parseSessionEvidence`, and the required/optional
split is drawn on this fix's own question — *would getting this wrong invent a
conclusion?*

- **Required** — lane fields whose absence would be read as "empty" and resolve `fail`
  (or throw): `skills`, `skill_order`, `flow_seams`, `harness_verbs`, `tools`,
  `checks`, `compactions`, `gaps`, plus identity. Defaulting an absent `skills` to
  `{}` fails `skill-called` over a field the core never sent.
- **Optional, type-checked when present** — fields whose consumers already degrade
  honestly: `refusals` (absent ⇒ undemonstrated ⇒ `unknown`, by D1),
  `harness_session_id`, `duration_s`, `files`, and the FX001 provenance. Refusing an
  older core over these would throw away good skill/verb evidence.

A refused payload is reported (`data.warnings`) rather than left as a bare
`telemetry.available: false`, and every telemetry lane resolves `unknown`.

**This also kept the fence intact.** A blanket presence rule broke
`harness/cli/test/extensions/flow-eval/e2e-md-to-pdf.test.ts` — a FORBIDDEN file —
whose fixture omits `refusals`, `harness_session_id` and `duration_s`. The right
answer was the better rule, not an edit to that file: it now passes untouched.

Two extension-side fixtures WERE completed (`extension.test.ts`), because they claimed
to be `telemetry get --json` payloads while omitting fields the CLI always sends. One
assertion there was also narrowed from "any `harness telemetry` call" to
`telemetry get`, since F4's cost snapshot is a legitimate second call the fetch-once
contract never covered.

## The Dim-0 mutation gate

Eleven mutations, each reverting ONE defect's logic to its pre-fix form, against the
54 controls in `fx003-instrument-honesty.test.ts`. Every mutation fires its own
controls and no unrelated ones (M2/M6 overlap only where both assert the same
axis-null property):

| Mutation | Controls fired |
|---|---|
| M1 `gateRefused` returns a boolean | 8 |
| M2 axis fold returns `0` | 7 |
| M3 base-ref string inequality | 3 |
| M4 no `corpus-floor` type | 7 |
| M5 placeholder plain `unknown` | 2 |
| M6 unknown type silent | 2 |
| R1-M7 `demonstrated` counts KEYS | 5 |
| R1-M8 observed count trusts raw values | 4 |
| R1-M9 `fetchEvidence` blind cast | 1 |
| R2-M10 refusal key shape ignored | 4 |
| R2-M11 a fractional count is an occurrence | 1 |

45 firings over 54 controls. M1/M7/M8 rose against R1's tally because the new R2
controls exercise the same predicate from both polarities — a mutation that was only
visible as a false RED is now also visible as a false GREEN.

R1-M9 is the reason the parse controls are not only unit tests: mutating the CALL SITE
is invisible to a control that exercises the validator directly, so there is an
end-to-end control that scores a malformed payload through the verb.

### Verbatim pre-fix output (R2 — both polarities, against the EXACT R1 predicate)

Not a synthetic mutation: `refusalCount` reverted to its committed R1 body (no key
check, `Number.isFinite`), which is the code the reviewer read.

```
 FAIL  …/fx003-instrument-honesty.test.ts > FX003 D1 … > R2 CONTROL: an UNRECOGNISED key is not a refusal — {malformed: 1} cannot license a fail (pre-fix: fail)
AssertionError: expected 'fail' to be 'unknown' // Object.is equality

Expected: "unknown"
Received: "fail"

 ❯ …/fx003-instrument-honesty.test.ts:147:99
    146|     const ev = evidence({ refusals: { malformed: 1 } });
    147|     expect((await resolveAssertionDetailed(a('gate-refused', { code: '…
```

And the false green — the face the review did not name:

```
 FAIL  …/fx003-instrument-honesty.test.ts > FX003 D1 … > R2 CONTROL (FALSE GREEN): a bare gate-refused over {malformed: 5} must NOT pass (pre-fix: pass)
AssertionError: expected 'pass' not to be 'pass' // Object.is equality

 ❯ …/fx003-instrument-honesty.test.ts:165:27
    163|     const ev = evidence({ refusals: { malformed: 5 } });
    164|     const r = await resolveAssertionDetailed(a('gate-refused', {}), rc…
    165|     expect(r.verdict).not.toBe('pass');
       |                           ^
```

All five R2 controls fired against that predicate; the three ruling guards
(`{E440:2}`+`E443` ⇒ `fail`, `{E440:2}` bare ⇒ `pass`, `{E440:0,E441:2}` ⇒ `fail` on
`E443`) passed both before and after, which is what makes them guards.

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
   capability proof available is a refusal that *did* — and after R1, one that actually
   occurred, not merely a key that exists. A real probe would need a CLI-side
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
