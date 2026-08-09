# Coder brief — plan 077, round five: our legibility fix produced the same uninformative sentinel (#108)

**PM**: `pij-respectable-clam` · **Worktree**: `s077-suite-portability` · **Branch**: `s077/suite-portability` @ `592abcc4`

## What happened

We shipped a fix (`f2d52729`) whose entire purpose was to make a spawn failure **legible** —
command, fence count, exit status/signal, stderr head. The consumer just hit the failure
again on Windows and pasted the **entire** message verbatim:

```
TEST: a parse failure comes back as DATA, never as a throw (the retry rests on this)

Error: STACK_TRACE_ERROR
    at task (…/@vitest/runner/dist/chunk-artifact.js:1784:27)
    at Object.<anonymous> (…chunk-artifact.js:1817:16)
    at Object.<anonymous> (…chunk-artifact.js:1563:28)
    at chain (…chunk-artifact.js:599:14)
    at …/test/services/flow/flow-renderer.test.ts:338:3
    at …chunk-artifact.js:1889:40
    at runWithSuite (…chunk-artifact.js:2258:8)
    at Object.collect (…chunk-artifact.js:1889:10)
    at Object.collect (…chunk-artifact.js:1893:54)
```

**No command, no fence count, no exit status, no stderr head.** Our handler is correct
and produced nothing.

## The three facts they established (evidence, not diagnosis — their words)

1. **The failing case is OUR NEW GUARD** — `:338` is
   `it('a parse failure comes back as DATA, never as a throw…')`, added in `f19bf0d1`.
   Not one of the three original parse proofs.
2. **`:338:3` is the `it(...)` REGISTRATION line**, not an assertion inside the body.
3. **The frames are `Object.collect` / `runWithSuite`** — the **collection** phase, not
   the run phase.

Reproduction: isolated 3/3 pass (10.9s, 12.3s, 12.9s); full suite on `592abcc4` FAIL;
full suite on `f19bf0d1` 3/3 pass. **One occurrence in seven full-suite runs.** Load
sensitive.

## The fork I want resolved — and do not assume either arm

**(a) The throw escapes before our catch can see it.** Their hypothesis: if it escapes
during collection, a `try/catch` around `execFileSync` inside `runMermaidOnce` never
applies. That would explain a correct handler that is silent.

**(b) Our catch fires, produces a good message, and vitest REPLACES it with the stored
sentinel.** You established last round that `STACK_TRACE_ERROR` is a vitest internal
constructed under `FIXTURE_STACK_TRACE_KEY` **to capture a definition-site stack**. A
sentinel created at registration time would naturally carry collection-phase frames and
the `it()` line — *exactly what they pasted* — regardless of what actually threw.

**(a) and (b) predict the same stack and have opposite fixes.** Under (a) we must move the
handler; under (b) the handler is fine and the message is being discarded downstream.
**Distinguish them with the fault-injection rig you already built**, not by reading.

## Also worth checking, because it should have left a trace

The retry announces itself on stderr. Their paste contains no such line. Determine whether
the retry fired at all — a retry that fired and was silent is (b); a retry that never
fired is (a) or a third thing.

## Constraints

- **Do not widen scope.** This is our own shipped fix failing to do its one job. Nothing
  else — not `#130`, not `#129`, not the remaining failures.
- **Their sign-off stands and #108 is closing.** They offered to track this separately and
  that may be the right outcome; if the honest answer is "we cannot fix this blind", say so
  and we file it rather than guessing.
- **Nobody here has a Windows box** and it did not reproduce on macOS in isolation. If you
  cannot reproduce it locally, say that plainly rather than fixing on a theory.
- Their claim that "consolidation reduced flake probability" **survives** — one occurrence
  in seven runs is not a regression. Do not retract that; it is rarer and still unexplained.

## Operational

`node harness/cli/bin/harness.js`. Never `just link`. Gate with `just checks`.
Commit `HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`, explicit pathspecs,
**do not push**. Baseline degradations: `arch-check` 2, `markdown-lint` 210,
`windows-check` 6.

Report the mechanism before you write a fix. Name your own softest claim.
