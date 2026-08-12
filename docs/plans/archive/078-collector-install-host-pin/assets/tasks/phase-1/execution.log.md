# Execution log — Phase 1: Drop the host pin and prove the happy path

Plan 078 · issue #124 · branch `s078/collector-install-pin`.

## tk-0001 — the failing positive test, first

Added `downloadAndVerify — GitHub's real redirect SUCCEEDS` to
`download.test.ts`: a fake 302 to `release-assets.githubusercontent.com`,
asserting `ok: true`, the digest, the rename, and `redirects: 1`.

Run against **unfixed** code — `1 failed | 12 passed`:

```
AssertionError: expected { ok: false, reason: 'redirect', …(1) }
              to match object { ok: true, …(3) }
```

It failed for the *right* reason — the host guard firing on a redirect to the
real CDN host — not on a typo or a fake-shape mismatch. A positive test that
went red incidentally would look identical in a summary and prove nothing.

## tk-0002 — the removal, at four sites

`ac-0001` named three; the fourth was accepted into scope by the plan's author
rather than logged as creep.

| site | what went |
| --- | --- |
| `pin.ts` | the `release_host` declaration + its doc line |
| `regenerate.ts` | the `release_host` line + its comment in `renderPinSource` |
| `install.ts` | `expectHost: manifest.release_host` at the call site |
| `download.ts` | the `expectHost` field, `hostOf()`, the guard, and the now-dead `'redirect'` failure reason |

`expectHost` was **deleted, not made optional**. An optional parameter nobody
passes is dead configuration — free to disagree with reality — which is the same
defect class in a different costume. The dead `'redirect'` reason and `hostOf()`
went for the identical reason.

`download.ts`'s header now states that there is deliberately **no** host check
and why, so the next reader files this as a decision rather than an omission and
re-adds the outage.

### The deleted test, stated loudly

`download.test.ts`'s `"a redirect off the pinned host is refused BEFORE the
digest is consulted"` (faking `cdn.example.com`) is **gone**, replaced in place
by a comment recording:

- it asserted a guard that no longer exists, removed because it could never be
  satisfied on the happy path;
- what is no longer checked — a redirect to an unexpected host is not refused;
- what checks integrity in its place, as it always did — the pinned SHA-256,
  verified against bytes read back off disk before anything is placed.

## tk-0003 — the digest is not coupled to the host check

Added `still refuses a bad digest AFTER a redirect to the real CDN host`: the
same CDN redirect as the happy path, only the bytes differ. Asserts
`digest-mismatch`, nothing on disk, no rename, temp dir removed. Existing digest
tests untouched and passing. So "we deleted the host check" cannot be read as
"redirects are now unchecked".

## tk-0004 — and the finding that outgrew the task

The task was "add an assertion that fails if regenerate stops emitting a pinned
field". Mutation-testing it in two steps found something larger.

**Step 1** — drop `expect_schema_version` from `renderPinSource` only:
the new named test fails, and so does the pre-existing byte-for-byte test.
Reads as adequate coverage. This is where it is natural to stop.

**Step 2** — also drop it from `pin.ts`, *which is what happens the moment
anyone re-runs the regenerator*:

```
✓ reproduces the CURRENT pin.ts byte-for-byte from its own data   <-- GREEN
× emits `expect_schema_version` into the generated manifest        <-- still red
```

The byte-for-byte guard **self-heals**. It compares the generator's output to
the generated file; when both lose a field they still match. A
security-relevant pinned field can leave the codebase entirely with the suite
green and nothing in the diff to review.

So the accurate framing is not "`release_host` lacked a test" — it is *the test
that looked like it covered this could not have caught it*. Same shape as the
half-injected seam on #124: a control that passes by examining nothing.

**Therefore the new test's field list is hardcoded, deliberately.** Deriving it
from the pin's own keys is the more elegant implementation and would have
inherited the identical self-heal — reproducing the bug inside the fix for it.
The comment in the test says so at length, because a future contributor will see
a hardcoded list beside a machine-generated file and try to derive it.

Mutation reverted; verified by re-run.

## tk-0005 — end-to-end, and the boundary

### Proven by live probe (real network, real bytes, this machine)

The **real production adapters** — `NodeDownload`, `NodeHash`, `NodeFs`,
`NodeExecutableBit` — ran `downloadAndVerify` against the actual pinned asset,
into a temp destination (`scratch/e2e-078.mjs`):

```json
{ "ok": true, "digest": "78990a0929d1eb97243c3f1ce8db415442dfc72c3960fe328aa1c144d6c3f0d2",
  "bytes": 14578176, "executable": true, "redirects": 1 }
```

The digest equals the pin's `macos-arm64` value. The placed file is a
`Mach-O 64-bit executable arm64` that reports `1.6.21` when run.

**The same live download against the pre-fix code fails**, empirically — the
removed guard was reinstated into the built `dist/` and re-run:

```
{ "ok": false, "reason": "redirect",
  "detail": "... redirected to https://release-assets.githubusercontent.com/... ,
             off the pinned host github.com" }
```

That is the `E130` from #124, reproduced live, then fixed — not inferred.
(`dist/` restored afterwards and rebuilt by `just checks`.)

Also probed directly: `curl -sI` on the pinned asset → a single `302` to
`release-assets.githubusercontent.com`, final `200`. One hop, matching the fake.

### Proven by fake (unit tests)

Disk behaviour that must not be exercised for real: atomic rename semantics,
temp-file cleanup on every abort path, short/interrupted writes, the
executable-bit ordering, and digest refusal leaving nothing behind — including
after a CDN redirect.

### Still unverified — and it is not empty

- **`harness doctor --install-collector` itself was never run.** The proof
  covers `downloadAndVerify` with real adapters, not the surrounding
  orchestration: the collector state file, the config write, the agent hook
  wiring, and the already-current short-circuit. Those remain fake-only.
- **A real install to the real destination** (`~/.git-ai/bin/`) was deliberately
  not performed — this is a shared machine and the path already holds a binary.
  Everything was placed in a temp dir instead.
- **Five of the six platforms are unproven end-to-end.** Only `macos-arm64` was
  downloaded and executed. The other five are covered by the manifest probe
  (all six assets `302`) and by unit tests, not by a real install.
- **Nothing here proves the *next* GitHub change is survivable.** It proves the
  current redirect works.

"The tests pass" is not "the install works". The tests passed before this plan,
and the install had never worked.

## Gate

`just fix` clean on the changed files; `just checks` — every hard gate `ok`
(tests, biome, typecheck, check:docs/flows/telemetry-fixtures/doctrine-parity/
dd-docs, root-invocation-smoke, dd doctor, skills-check). Three warn-launch
gates report `degraded` and all are **pre-existing**: `arch-check`'s two
violations are in `services/telemetry/`, `windows-check`'s first is in the
`html-snap` extension, and `markdown-lint`'s 210 findings are repo-wide — none
in a file this phase touched.

Collector suite: 252 passed / 10 files.

## Discoveries & Learnings

| # | Tag | What |
| --- | --- | --- |
| 1 | Noteworthy | A byte-for-byte "generator reproduces the generated file" test **self-heals** and cannot catch a field being dropped. Proven by two-step mutation. Likely present wherever this pattern is used, not just here — the wider sweep is out of scope and belongs on #124. |
| 2 | Noteworthy | Fourth removal site (`download.ts`'s `expectHost` + guard) was outside `ac-0001`'s stated three. Accepted into `ac-0001` by the plan's author rather than becoming a new AC. |
| 3 | Noteworthy | A test was **deleted** on a security-relevant path. Called out here, in the test file, and in the commit body — a silently deleted test is how coverage rots. |
| 4 | Deferred | `harness doctor --install-collector` end-to-end, and five of six platforms, remain unverified by a real install. See the boundary above. |
