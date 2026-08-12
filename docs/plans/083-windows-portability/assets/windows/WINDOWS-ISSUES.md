# Windows test failures — the authoritative listing

**Written** 2026-08-11 by `pij-respectable-clam`, for work that starts AFTER a compaction.
**Self-contained on purpose.** If you are reading this with no memory of the session, everything
you need to start is here; the raw evidence is in `docs/plans/083-windows-portability/assets/windows/vm-082/`.

---

## THE HEADLINE: ONE FIX CLEARS ROUGHLY 78 OF THE 112

```
RUN 1  branch as committed, NO edits        112 failures / 24 files   <- TRUE PRE-FIX BASELINE
RUN 2  THREE sites patched + rebuild         37 failures / 17 files
       of which 3 were induced by the probe itself
       -> GENUINE RESIDUAL                   34
```

**The honest one-liner is "112 pre-patch, 34 genuine post-patch, plus 3 induced by the probe" —
NOT "112 → 37".** Two thirds of the Windows suite is one defect.

> **A DISPUTED CLAIM, SETTLED BY RECOMPUTING — the timing rows were NOT "previously masked".**
> `pij-mid-wilson` reported that 3 timing failures *appeared* in run 2 having been absent from
> run 1, on the reasoning that they had died fast on the null-device error before reaching the 30s
> wall. `pij-used-narwhal` reported the 3 appeared rows as all being in the null-device test file.
> The two accounts cannot both hold, so the PM recomputed the set difference by test identity
> directly from the two JSON files:
>
> ```
> cleared 78   persisted 34   appeared 3
> appeared: ALL THREE in exec-remote-telemetry-git-null-device.test.ts
>
> timing family, failing rows      run 1  ->  run 2
>   exec-remote-telemetry-git.int    14        1
>   composed-command.int              8        1
>   journal-race.int                  2        1
> ```
>
> **The timing family was failing in run 1** — 24 rows across the three files — and *reduced* to 3.
> Nothing appeared. What changed is the **manifestation**: en-masse null-device errors in run 1, a
> single timing row per file in run 2. Narwhal's mechanical set difference stands; wilson's (b) is
> withdrawn. The related arithmetic `81 + 13 + 6 + 5 + 7 = 112` is also unsound — it removes the
> timing rows from run 1's composition when they were present in it. **The sound decomposition is
> `112 = 78 cleared + 34 persisted`.**
>
> **Wilson recomputed independently and withdrew (b) itself**, including naming how the error
> happened — worth more than the correction:
>
> > *"I compared MESSAGE SHAPES across the two console logs — grep 'Test timed out' gives 0 in
> > run 1 and 3 in run 2 — and read that as set membership. A message-shape count is not an
> > identity comparison. The rows were there the whole time wearing a different error."*
>
> **A count of error strings is not a set of tests.** The rows never moved; their error text did.
>
> **One true statement survives from the withdrawn claim, and it matters to whoever fixes the
> residual**: those 3 timing rows **persisted through** the null-device patch. So the null device
> was never their cause, and removing it does not fix them — they sit squarely inside the residual
> 34. Their load-sensitivity at the 30s wall (consistent with #108's own correction on
> `composed-command` at 28.3s) describes **how they now fail**, not **whether** they were failing.
>
> The lesson is the cheap one: **diff by identity, don't reason about mechanism.** Both seats
> described a real thing; only the set difference could say which rows they were.

> **CORRECTION 2026-08-11 — "ONE constant changed" WAS WRONG.** This document said run 2 changed a
> single constant. `pij-mid-wilson` produced the runs and has published the probe verbatim
> (`vm-082/patch-probe.ps1`). It was **three sites plus a rebuild** — two test sites and one
> product site:
>
> | # | file | kind |
> |---|---|---|
> | 1 | `test/support/hermetic-git.ts` | test |
> | 2 | `test/adapters/git/exec-remote-telemetry-git.int.test.ts` | test |
> | 3 | `src/adapters/git/exec-remote-telemetry-git.ts` | **product** |
>
> Each `win32 ? 'NUL' : devNull` → the **literal `'/dev/null'`**, then
> `npx tsc -p harness/cli/tsconfig.json` — the rebuild is required because `verbs-e2e` drives the
> real bin via `dist`.
>
> **Substituting `os.devNull` will not reproduce run 2.** On win32 `os.devNull` is `\\.\nul`,
> measured at exit 128 — equally broken. The literal is the fix.
>
> This matters beyond bookkeeping: **the three-site shape is the fix's true scope.** A product-only
> change does not reproduce this result.

> **RUN 1 IS CONFIRMED AS THE TRUE PRE-FIX STATE** (`pij-mid-wilson`, 2026-08-11): clean shallow
> clone @ `695a3056`, robocopied to local disk, `npm ci`, build, `scope=all`, **no edit of any kind
> before run 1**. So **112 is the baseline and the ~78–81 is what a fix has yet to earn** — it is
> not already banked.
>
> *Disclosed caveat, present in BOTH runs equally*: `npm ci`'s prepare step regenerates three
> generated files (`services/docs/docs-content.ts`, `dd/docs/docs-content.ts`,
> `flow/schemas-content.ts`) non-canonically, because biome's formatter fails on Windows. Checked
> against the failing set: it manufactured **zero** test failures. It is a property of "the branch
> as committed, installed on Windows", not an introduced change.

> **THE 78-vs-81 DISCREPANCY IS RECONCILED — BOTH NUMBERS WERE RIGHT.** Resolved 2026-08-11 by
> `pij-used-narwhal`, recomputed from both artifacts (each 393 files / 6038 collected):
>
> ```
> cleared    (in run1, gone in run2)   78
> persisted  (in both)                 34      112 - 78 = 34
> appeared   (only in run2)             3      34 + 3  = 37
> ```
>
> **81 = 78 cleared + 3 appeared** — every row the change *touched*. **78 = rows that cleared.**
> One seat counted **movement**, the other counted **improvement**. Neither was wrong; they were
> answering different questions. Say which you mean: *"78 cleared, 81 touched."*
>
> **All 3 appeared rows are in `exec-remote-telemetry-git-null-device.test.ts`** — the residual
> went *up* inside the family being fixed. That is expected, not a regression: it is the file that
> currently passes by never executing the win32 branch, and it is the file the fix rewrites.

> **STILL OPEN — WHAT DISTINGUISHES RUN 1 FROM RUN 2.** Nothing in the artifacts records the
> change that produced run 2; this document asserts "one constant changed" from the measuring
> seat's prose, **not** from the evidence. It matters: if run 2 already carries a null-device
> workaround, then 112 is the true pre-fix baseline and the 78 is what a fix has **yet to earn** —
> but if run 2 is a different build, the baseline is 37 and the 78 is already banked. Confirmation
> requested from `pij-mid-wilson` 2026-08-11. **Do not quote a delta against this baseline until it
> lands.**

## Provenance — what produced these numbers

- Parallels **Windows 11 build 26100**, local disk `C:\082`, **not** the network share
- clean shallow clone of `s077/suite-portability` @ **`695a3056`** (now merged to `main` as `a26e663c`)
- `npm ci` exit 0, build succeeded, **`HARNESS_TEST_SCOPE=all`**, JSON reporter
- **git 2.55.0.windows.3** — the git version is load-bearing, see below
- 393 test files (367 cli + 26 extension), 6038 collected

**Three different totals exist for one sha**: the remote agent's 5997 collected, our Mac's 6015,
our VM's 6038. Nobody has reconciled them. Do not treat any as canonical.

---

## DEFECT 1 — the null device. ~78 failures, ONE line, and it is on `main`

`GIT_CONFIG_GLOBAL` is set to a Windows null device, and **Git for Windows refuses to run at all**.
Measured directly outside vitest, four verbs × three values, with a positive control:

```
GIT_CONFIG_GLOBAL=NUL        -> exit 128  "fatal: unable to access 'NUL': Invalid argument"
GIT_CONFIG_GLOBAL=\\.\nul    -> exit 128  same
GIT_CONFIG_GLOBAL=/dev/null  -> exit 0, isolated, works
```

`ExecRemoteTelemetryGit` is therefore **inoperative on that machine** — every telemetry git call
exits 128.

**The two branches were broken by DIFFERENT VALUES**, which is why a casual check disproves nothing:

| | value emitted | source |
|---|---|---|
| `main` (pre-merge) | `\\.\nul` | `os.devNull` passed straight through |
| the 082 branch | `'NUL'` | `nullDeviceForPlatform()` |

Both measured at 128. **A reader who greps `main` for `NUL`, finds nothing, and concludes the
report was wrong has disproved nothing.**

### THE FIX IS `/dev/null`, AND MY EARLIER STEER TO THE CONTRARY WAS WRONG

I briefed a coder that `/dev/null` "works only because git treats a missing file as no config — a
behaviour, not a device", and pushed toward a guaranteed-empty temp file. **That was wrong.** git's
own `Documentation/git.adoc`, under `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM`:

> *"Can be set to `/dev/null` to skip reading configuration files of the respective level."*

It is a **documented contract of the variable**. Combined with the positive-controlled measurement
on the target box, it is the only candidate that is both documented upstream *and* measured on
Windows. The temp file is neither, and would add fs I/O, a lifecycle, cleanup-on-crash, an injected
seam and a new failure mode (tmpdir unwritable) inside the security-critical isolation path — a
subsystem replacing a constant, for less certainty.

**Consistency evidence already in the tree**: `exec-git-write.int.test.ts:167` and
`services/flow/archive-move.test.ts:65` already use literal `/dev/null` on both platforms, each
with a comment giving this reasoning. **The product is the outlier.**

Worth doing with it: **rename `nullDeviceForPlatform`** for intent — it is no longer a null *device*
at all, and the old name is half the reason this went wrong.

### Why it survived, and the part worth learning

`exec-remote-telemetry-git.ts` carries a doc comment recording a measurement table **attributed to
a third party** — *"the downstream consumer of #108, with a positive control"* — asserting
`NUL → exit 0 ISOLATED`. Product code was built on it, and a unit test
(`exec-remote-telemetry-git-null-device.test.ts`) asserts the same value **and passes**, because on
Linux the win32 branch is never executed. **Our own suite defends the broken constant.** Nobody
re-measured, because a positive control had already been cited.

Any fix must make the test **exercise the win32 branch on every platform** (the platform is already
injectable), or it will pass by not being run — exactly how the original survived.

### Two untouched siblings emit the rejected value

- `test/support/hermetic-git.ts:85` — `GIT_CONFIG_GLOBAL: win32 ? 'NUL' : devNull`
- `exec-remote-telemetry-git.int.test.ts:199` — `win32 ? 'NUL' : '/dev/null'`

A product-only fix leaves both behind. **Leaving a sibling behind is the defect shape this plan
keeps hitting.**

---

## DEFECT 2 — the dd gate anchors documents to the WRONG REPOSITORY. 5 failures

`src/acts/flow.ts`, `docRepoRoot()`:

```js
for (let hops = 0; hops < 64; hops += 1) {
  if (deps.fs.exists(posixJoin(dir, '.git'))) return dir;   // tested BEFORE the fixpoint check
  const parent = posixDirname(dir);
  if (parent === dir) break;
  dir = parent;
}
```

POSIX stops at `/` and falls back to cwd. **Windows walks through the drive root**: `C:/Users/x`
→ `C:` → `posixDirname("C:")` → `"."`. The loop then tests `exists("./.git")`, which resolves
against `process.cwd()` — the harness repo — finds it, and **returns `"."`**.

Three faults at once: the fallback is never reached, the returned root is **relative** so it means
something different per caller, and it is **confidently wrong** rather than an error. Symptom:
`E441 DD_GATE_TARGET_INVALID` where a verdict is expected; a healthy plan orients `unevaluable`.

The function's own docstring warns about precisely this class — *"worse than an error: it is a
refusal the reader can only clear with `--force`, for a document that was never incomplete."*
**On Windows the guard it describes is what misfires.**

Fix: recognise a drive root as terminal (`"/"`, `"C:/"`, **and `"C:"`** — the walk reaches the root
spelled `C:`, and `posixJoin("C:", ".git")` is `"C:/.git"`, so `C:` must still be *tested* and then
*terminate*; also `//server/share`). Regression tests must run the **win32 path shape on every
platform**.

---

## DEFECT 3 — the windsurf rows: ONE product line, not six test bugs. 6 failures

`agent-matrix.ts:319` joins with `/` deliberately (the data layer must not import `node:path`), so
on Windows the product hands `fs.writeText` a **mixed-separator** path:

```
C:\Users\jk\AppData\...\harness-composition-x/.codeium/windsurf/hooks.json
```

(home from `mkdtempSync` = backslashes; the rest POSIX-joined.) The fakes compare that against a
`node:path.join()` value, which is all-backslash:

- `:186` `if (p === second()) throw …` → never matches → **the fake never refuses**
- `:894` `if (p.endsWith('windsurf/hooks.json'))` → hardcoded POSIX separator

**When the fake never refuses, the failure under test never happens** — the row asserts a failure
path that did not execute. That is why all six sit in one file.

**The test is the wrong side**: Windows accepts forward slashes, and the field evidence stands —
on the real box `hooks install` wrote **both** `~/.codeium` paths and `hooks status --probe`
reports windsurf `executionState: runs`. So F010 holds as product. Replace the `endsWith` with a
path-comparison helper, which is **stricter than what it replaces**, not a relaxation.

**Third defect, reported not fixed**: those mixed-separator paths reach the operator — the failure
`reason` string and `install-record.json` will render `C:\Users\jk/.codeium/hooks.json`.

---

## DEFECT 4 — path-separator assertions. 13 failures

Assertions comparing a Windows path (`C:\…`) against a POSIX-shaped expectation. **Green on Linux
by construction** — both sides are POSIX there, so the assertion is vacuously true and can only
ever be red on a real Windows filesystem.

**The product asymmetry underneath them**, verified: `binary-path.ts` declares as property 4 that
embed and extract are inverses (*"EXTRACTABLE AGAIN"*). They are not — `normaliseBinaryPath` does
`\`→`/` on the way **in**, and nothing reverses it on the way out. `stat()` tolerates the
forward-slash form so `status` still reports `installed`, which is why it survived. Any caller
string-comparing against a native `path.join()` result mismatches.

**Two of the 13 are not path-shaped at all** and were mis-filed into this family by the remote
agent: `acts/doctor.test.ts` "envelope has 13 layers, test pins 12", and "injected ingress probe
returns `[]`, expects 1". A count pinned at 12 when the envelope has 13 is **staleness**, not
portability. Triage them separately or the fix hides them.

### THE TRAP — the single most important rule for this work

Thirteen assertions currently encode POSIX expectations. The cheap fix is to rewrite each to
whatever Windows printed. **That produces a test which PASSES A REVERT and FAILS A CORRECT FIX** —
the exact inverse of what a test is for. For each row decide *which side is wrong*. Where an
assertion is genuinely platform-shaped, prefer a **path-semantic comparison** over a literal, so
the test stops being platform-dependent rather than becoming Windows-dependent instead.

---

## DEFECT 5 — timing. 3 failures, and one may be a real race

| file | observation |
|---|---|
| `adapters/git/exec-remote-telemetry-git.int.test.ts` | passes in isolation — contention only |
| `hooks/journal-race.int.test.ts` | **records 14 lines where 8 are expected under load** |
| `hooks/composed-command.int.test.ts` | flaky at the boundary (28.3s against a 30s budget) |

**14-where-8 is a COUNT, not a timeout.** A timeout says "too slow"; a wrong count says the
concurrent journal wrote more records than the contract allows. The contract is confirmed as one
record per fire process (`acts/hooks.ts:310` returns early, mutually exclusive with
`commit-intercept.ts:91`), so 8 processes must produce 8 lines. Three candidates, distinguishable
by the **per-run vector**, which nobody has captured:

- **H1 accumulation** — the K-loop's `rmSync(recursive+force)` fails on Windows (`force` only
  suppresses ENOENT; `maxRetries` defaults to 0, so EBUSY/EPERM is not retried), so run 2 counts
  run 1's lines. Signature: vector grows monotonically, run 1 == 8. *Fixture defect.*
- **H2 double-record** — signature: run 1 already > 8. *Product race.*
- **H3 genuine interprocess duplication.** *Product race.*

**Do not "raise the timeout".** That is how a real race gets buried. Instrument first: dump the
per-run vector and the parsed entries, and stop `journalLines()` swallowing read errors into `[]`
(an unreadable journal is currently indistinguishable from an empty one).

**Carry this caveat**: in RUN 1 this family was **invisible** — zero timeouts — because all three
rows died fast on the null-device error before reaching the 30s wall. **A confound hides failures
as well as manufacturing them.** Once the null device is fixed, this family's baseline moves.

---

## DEFECT 6 — symlink EPERM. 7 failures + 1 file that never ran

Unprivileged Windows cannot create symlinks. Six assertions plus **`dd-schema-fs.test.ts`, which
fails at COLLECTION** — its tests are not passed, not failed, not skipped: **absent**. Every
reported number stays self-consistent while the suite silently shrinks.

Two parts, and the second matters more:
1. Decide the handling — a Windows skip **with a reason visible in the counts**, a Developer-Mode
   precondition (makes the suite unrunnable for most Windows devs), or a test that needs no
   symlinks. The suite proves a real-fs property no fake can witness, so a fake defeats its purpose.
2. **A file that fails to collect should be impossible to overlook.** Today it costs one line in a
   log.

---

## Why our CI never saw any of this

`.github/workflows/windows.yml` ran bare `vitest run`, taking `vitest.config.ts`'s **`fast`**
default — **349 files** — and is report-only (`exit 0` regardless). Five runs, all `success`.
Fixed in `5e1aa48a` (now on `main`): the scope is explicit and printed with the results.

**Verify fixes at `scope=all`. `fast` will lie to you exactly as it lied to us.**

## Cross-check against the independent report

A remote agent on a different Windows box measured **23** failures on a pristine clone of the same
sha. We reproduce **22 of their 23** — Family A matches file-for-file, Family B exactly, and we
fall short by one timing row. Their "Family A = 17" is a header typo; their table enumerates 13,
and 13+6+4 = 23, their own total.

**They never saw the null device.** The likely discriminator is **git version** — ours is
2.55.0.windows.3. If theirs predates the change rejecting device paths as config, both reports are
correct for the box that produced them. **This was asked of them (#108 comment 5240065040) and the
answer had not arrived when this was written.**

## Evidence

- `docs/plans/083-windows-portability/assets/windows/vm-082/vitest-results.json` · `vitest-results2.json` — raw, both runs
- `docs/plans/083-windows-portability/assets/windows/vm-082/vitest-console.log` · `vitest-console2.log`
- `docs/plans/083-windows-portability/assets/windows/vm-082-measurement.md` — the measuring seat's write-up (**note: its "the fix is NOT
  /dev/null" section is superseded above**)
- `docs/plans/083-windows-portability/assets/windows/PLANS-SALVAGE.md` · `docs/plans/083-windows-portability/assets/windows/remote-23-failures.md`
- Briefs, reusable: `STREAM-CONTEXT.md`, `BRIEF-S1-product.md`, `BRIEF-S2-paths.md`,
  `BRIEF-S3-tests.md`, `BRIEF-FINAL-REVIEW.md`

---

# FULL PER-TEST LISTING

Generated mechanically from the raw JSON — not transcribed from a summary. A file marked
*(cleared…)* had **every** one of its failures disappear when the single null-device constant
changed; a file marked **[STILL FAILS in RUN 2]** has genuine work in it.

## RUN 1 — branch as committed: 112 failures across 24 files

### `test/services/hooks/provocation.int.test.ts` — 32 *(cleared once the null device was removed)*
- provocation — the POSITIVE control (dw-000a) EMITS for a genuine agent edit committed inside the bracket
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'checkout of another branch'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'reset --hard backwards'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'rebase onto a diverged branch'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'amend'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'a no-op — nothing at all happened'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'detached HEAD'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT for 'a MULTI-COMMIT fast-forward pull — HE…'
- provocation — class (a): HEAD did not advance by exactly one (dw-0009) stays SILENT when there is NO prior recorded state — POST without a PRE
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — merge --squash th…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — cherry-pick -n th…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — revert -n then co…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — git apply --index…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — checkout REF -- p…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — restore --source …'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'MEASURED DEFEATER — read-tree -m -u t…'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'single-commit fast-forward pull'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'a --no-ff merge commit'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'cherry-pick (committing form)'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'revert (committing form)'
- provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008) stays SILENT for 'git am'
- provocation — the defeater INSIDE one bracket (tk-000d, dw-001e) stays SILENT when the bracket command chains merge --squash with the commit
- provocation — the defeater INSIDE one bracket (tk-000d, dw-001e) stays SILENT when the bracket command chains cherry-pick -n with the commit
- provocation — the defeater INSIDE one bracket (tk-000d, dw-001e) stays SILENT when the bracket command chains checkout REF -- path with the commit
- provocation — the defeater INSIDE one bracket (tk-000d, dw-001e) stays SILENT when the bracket command chains read-tree with the commit
- provocation — the defeater INSIDE one bracket (tk-000d, dw-001e) stays SILENT when the bracket command chains a heredoc whose body is visible with the commit
- provocation — KNOWN BLIND: the command scan NARROWS, it does not close (dw-0020) EMITS when the defeater is obfuscated by a shell script wrapper — KNOWN BLIND
- provocation — KNOWN BLIND: the command scan NARROWS, it does not close (dw-0020) EMITS when the defeater is obfuscated by a shell alias — KNOWN BLIND
- provocation — KNOWN BLIND: the command scan NARROWS, it does not close (dw-0020) EMITS when the defeater is obfuscated by a Makefile target — KNOWN BLIND
- provocation — concurrency (dw-000b) two racing POST fires produce AT MOST ONE emit
- provocation — what an OVER-EMIT actually costs is UNMEASURED records the observed daemon behaviour for an over-emit, or SKIPPED without a daemon
- provocation — KNOWN BLIND (dw-000c) EMITS for a human committing inside the bracket — the limitation, documented not hidden

### `test/adapters/git/exec-remote-telemetry-git.int.test.ts` — 14 **[STILL FAILS in RUN 2]**
- ExecRemoteTelemetryGit — HTTPS credential discovery RED cluster A preserves helper chain/reset/include/order/scoped fields and excludes forbidden config
- ExecRemoteTelemetryGit — HTTPS credential discovery RED cluster A accepts the exact helper, username, URL-subsection, and 64-entry boundaries
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED admits 'configured username under an scp-styl…' without matching applicability
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED admits 'helper under a provider-style scope' without matching applicability
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED admits 'safe punctuation, Unicode letters, an…' without matching applicability
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED admits 'the exact opaque subsection byte bound' without matching applicability
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED preserves provider records, an empty reset, and the following helper chain in query order
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED retains prior strict host-bearing URL admission for https://example.invalid
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED retains prior strict host-bearing URL admission for https://example.invalid:8443/team/path
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED retains prior strict host-bearing URL admission for custom://example.invalid/team/path
- ExecRemoteTelemetryGit — HTTPS credential subsection correction RED keeps an unrelated opaque helper private and lets Git decide it is not applicable
- repair RED 5 — scoped and unscoped credential value Unicode controls preserves safe Unicode/spaces, empty helper reset, and exact lowercase bool
- ExecRemoteTelemetryGit — HTTPS credential lease RED cluster B uses private 0700/0600 materialization, HTTPS-only network env, and complete cleanup
- ExecRemoteTelemetryGit — HTTPS credential lease RED cluster B cleans partial materialization failure before network without exposing writer input

### `test/services/hooks/hooks-verb.int.test.ts` — 9 *(cleared once the null device was removed)*
- hooks fire — every failure path exits 0 and stays silent (dw-0018, dw-0019) survives an UNREACHABLE socket, and the journal records the failure AND its cause (dw-001a)
- hooks fire — every failure path exits 0 and stays silent (dw-0018, dw-0019) writes its state OUTSIDE the observed repository — the hook leaves no trace in the tree
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) a BOM-prefixed payload is UNDERSTOOD — the Cursor-on-Windows shape (defect a)
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) a GENUINELY MALFORMED payload journals `unparseable` rather than nothing (defect b)
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) records the failure WITHOUT the payload body — it carries user_email and a transcript path
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) cannot split a journal line — a payload newline is escaped or hexed, never raw (dw-newline)
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) an encoding we do NOT decode (UTF-16LE, the PowerShell 5.1 default when it redirects or pipes) still NAMES ITSELF in the record
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) an encoding we do NOT decode (UTF-16BE) still NAMES ITSELF in the record
- hooks fire — a payload it cannot parse is VISIBLE, not silent (plan 082 F009) does NOT journal a fire that simply had no stdin — the guard must not become a firehose

### `test/services/hooks/composed-command.int.test.ts` — 8 **[STILL FAILS in RUN 2]**
- the command the INSTALLER composed is a command `fire` can actually RUN (F004) executes the installed string verbatim: exit 0, silent, and a journal entry
- the command the INSTALLER composed is a command `fire` can actually RUN (F004) emits no option `fire` does not register — checked flag by flag
- the command the INSTALLER composed is a command `fire` can actually RUN (F004) treats the marker as PROVENANCE, not behaviour: same outcome with and without it
- the command the INSTALLER composed is a command `fire` can actually RUN (F004) survives an option it does NOT declare: still exit 0, still silent, still journals
- `hooks status` can see that the ARGUMENTS are rejected, not just that the binary is there reports `accepted` for a command this binary can parse
- `hooks status` can see that the ARGUMENTS are rejected, not just that the binary is there NAMES the option when a config carries one this binary does not declare
- the silent contract survives an environment we do not control (plan 082 F010 F5) prints NOTHING with both NO_COLOR and FORCE_COLOR set — the pair Node warns about
- the silent contract survives an environment we do not control (plan 082 F010 F5) still REACHES our code under that environment — silence is not the only property

### `test/adapters/git/cat-file-batch.int.test.ts` — 6 *(cleared once the null device was removed)*
- ExecGitRead — batched flat-tree reads (plan 067) round-trips multi-byte + empty blobs byte-exactly (the batch framing tripwire)
- ExecGitRead — batched flat-tree reads (plan 067) reads a 150-entry tree in a BOUNDED number of git subprocesses
- ExecGitRead.refsWithBlob — batched shape probe (plan 067) classifies rolled vs old-shape refs in ONE git subprocess
- ExecGitRead.refsWithBlob — batched shape probe (plan 067) agrees with a full tree read about every ref (the probe is not a guess)
- ExecGitWrite.readRefTree — batched, still fail-closed (plan 067) reads the same bytes the READ adapter does, and null for an absent ref
- ExecGitWrite.readRefTree — batched, still fail-closed (plan 067) leaves the working tree byte-identical (read-only by construction)

### `test/services/hooks/composition-boundaries.test.ts` — 6 **[STILL FAILS in RUN 2]**
- F2 — a failure on the SECOND file must not strand the first reports and commits at the SAME UNIT — a failed agent leaves no installed file
- F2 — a failure on the SECOND file must not strand the first never reports windsurf as INSTALLED when one of its two files failed
- F2 — a failure on the SECOND file must not strand the first RECORDS and NAMES a file it could not roll back — never silently held
- F2 x F3 — a rollback must not revert a PEER agent sharing the file leaves the PEER’s committed entry in place when its own second file fails
- F2 x F3 — a rollback must not revert a PEER agent sharing the file the PROVENANCE compensation obeys the same rule — pinned after a mutant survived
- F2 x F3 — a rollback must not revert a PEER agent sharing the file REFUSES to restore — and says so — when the file moved under it

### `test/acts/flow-check-gate-orient.test.ts` — 3 **[STILL FAILS in RUN 2]**
- dw-0008 — orient surfaces a check gate live prints the check by name, the verdict, and every finding
- dw-0008 — orient surfaces a check gate live --json carries the findings structurally, for an agent that parses
- dw-0008 — orient surfaces a check gate live a GREEN plan orients as open, with no findings — the good twin

### `test/adapters/fs/node-fs.test.ts` — 3 **[STILL FAILS in RUN 2]**
- NodeFs — bounded no-follow text reads (P063 T003) distinguishes missing, symlink, non-file, and oversize paths without following them
- NodeFs — bounded no-follow text reads (P063 T003) rejects a regular transcript reached through an ancestor symlink outside its root
- NodeFs — bounded no-follow text reads (P063 T003) rejects every symlink component even when its target remains inside the root

### `test/adapters/git/fake-git.test.ts` — 3 *(cleared once the null device was removed)*
- ExecGit handles no-repo, unborn, and detached repositories without guessing provenance
- ExecGit — the reflog read against REAL git (plan 082 tk-0002) reads real reflog subjects, including the squash-merge that reads as an authored commit
- the index-state read (plan 082 tk-0003) ExecGit maps real git exit codes: 0 clean, 1 already-staged, otherwise unknown

### `test/services/hooks/verbs-e2e.int.test.ts` — 3 **[STILL FAILS in RUN 2]**
- `harness hooks restore` — the recovery verb, through the real bin restores a real backup end to end, chosen as the NEWEST with no --from
- `harness hooks status` carries a REAL failed fire (phase-2 review F002) a real failed fire is visible in the DELIVERED status payload, with its cause
- provenance is pruned on NO-LONGER-OURS, not on WE-REMOVED-IT a config cleaned OUT-OF-BAND has its record entry dropped

### `test/services/doctor/collector/backup-restore.int.test.ts` — 3 **[STILL FAILS in RUN 2]**
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) capture, MUTATE, restore — the file comes back byte-identical (dw-0001, dw-0002)
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) a path with __ IN ITS OWN NAME round-trips — the case the old flatten broke (dw-0003)
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) restoring a file that did NOT exist means DELETING it (dw-0004)

### `test/acts/doctor.test.ts` — 2 **[STILL FAILS in RUN 2]**
- registerDoctorAct json mode emits an envelope with data.layers (incl. extensions) and exits 0
- registerDoctorAct — CI hermeticity (plan 074 · ac-000a, review F006) the INJECTED probe answers the ingress — no real socket is ever reached

### `test/adapters/fs/fake-fs.test.ts` — 2 **[STILL FAILS in RUN 2]**
- NodeFs confined copy REFUSES an out-of-tree symlink — CWE-59 exfil guard, one op (plan 031 AC-03)
- NodeFs publishes byte-exact sibling directories without following target symlinks

### `test/services/hooks/config-writer.test.ts` — 2 **[STILL FAILS in RUN 2]**
- writing through a SYMLINKED config path (dw-0007) leaves the symlink intact and updates its TARGET
- writing through a SYMLINKED config path (dw-0007) the RENAME-based atomic write DESTROYS the symlink — the hazard, executable

### `test/services/hooks/install-strategy-a.test.ts` — 2 **[STILL FAILS in RUN 2]**
- the ABSENT-FILE case — one situation, three consequences (dw-0011, dw-0012) creates the file AND its parent directories, with a defined skeleton
- windsurf writes BOTH files — half-working is the failure mode (dw-0014) creates and populates both ~/.codeium paths

### `test/services/hooks/journal-race.int.test.ts` — 2 **[STILL FAILS in RUN 2]**
- hook journal — interprocess append is LOSS-FREE (dw-003b) records exactly 8 lines for 8 concurrent processes, 5 times out of 5
- hook journal — interprocess append is LOSS-FREE (dw-003b) every record survives INTACT — no torn or interleaved lines

### `test/services/hooks/legacy-command-form.test.ts` — 2 **[STILL FAILS in RUN 2]**
- the reader handles BOTH forms a legacy one-token command still yields its script, and NO interpreter
- the reader handles BOTH forms status reports a legacy install as INSTALLED, and stats its script

### `test/services/hooks/status-and-fires.test.ts` — 2 *(cleared once the null device was removed)*
- status surfaces a FAILED FIRE from the journal (dw-002b, dw-002c) a REAL fire against an unreachable socket is visible here (dw-002c)
- status surfaces an UNREADABLE PAYLOAD, in its own list (plan 082 F009) a REAL unparseable fire reaches the SURFACE, not just the journal file

### `test/services/telemetry/git-read.test.ts` — 2 *(cleared once the null device was removed)*
- ExecGitRead — real-git round-trip + read-only invariant (T006/T008, KF-06/AC-08) reads a committed shard back byte-identical, leaving the working tree untouched
- ExecGitRead — real-git round-trip + read-only invariant (T006/T008, KF-06/AC-08) listRefHistory + readTreeAtCommit recover segments buried in non-tip commits (F-03)

### `test/services/telemetry/refusal-evidence.test.ts` — 2 **[STILL FAILS in RUN 2]**
- dw-0011 — the refusal lands in telemetry, and the flow stays untouched a refused `flow nav set` yields command_exit carrying the gate E-code
- dw-0012 — SessionEvidence exposes the refusal the evidence type carries `refusals` as a code histogram

### `test/services/hooks/binary-path.test.ts` — 1 **[STILL FAILS in RUN 2]**
- a home directory containing a SPACE (dw-0015) installs a command whose binary path is quoted and recoverable

### `test/services/hooks/command-runs.test.ts` — 1 **[STILL FAILS in RUN 2]**
- executionState — the check that would have caught this (row 3) probes the INTERPRETER AND SCRIPT PAIR that is actually configured

### `test/services/hooks/hook-state.test.ts` — 1 *(cleared once the null device was removed)*
- HookStateStore — against a REAL filesystem and REAL git (plan 082 tk-0003) records index-clean vs already-staged, and the value SURVIVES the commit that follows

### `test/services/hooks/live-daemon-note.int.test.ts` — 1 *(cleared once the null device was removed)*
- live-daemon note fixture — the PAIR (plan 082 tk-0006) negative: a commit whose trace2 is DISCARDED gains no note; positive: the same commit gains one once our events reach a live daemon


## RUN 2 — null-device confound removed: 37 failures across 17 files

### `test/services/hooks/composition-boundaries.test.ts` — 6
- F2 — a failure on the SECOND file must not strand the first reports and commits at the SAME UNIT — a failed agent leaves no installed file
  - `AssertionError: expected [] to include 'windsurf' at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/expect/dist/index.js:1319:15) at Proxy.<an`
- F2 — a failure on the SECOND file must not strand the first never reports windsurf as INSTALLED when one of its two files failed
  - `AssertionError: expected [ { agent: 'windsurf', …(3) }, …(1) ] to deeply equal [] at C:/082/harness/cli/test/services/hooks/composition-boundaries.tes`
- F2 — a failure on the SECOND file must not strand the first RECORDS and NAMES a file it could not roll back — never silently held
  - `AssertionError: expected '' to contain 'C:\Users\JORDAN~1\AppData\Local\Temp\…' at C:/082/harness/cli/test/services/hooks/composition-boundaries.test.`
- F2 x F3 — a rollback must not revert a PEER agent sharing the file leaves the PEER’s committed entry in place when its own second file fails
  - `AssertionError: expected [Function] to throw an error at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/expect/dist/index.js:1552:16) at Proxy`
- F2 x F3 — a rollback must not revert a PEER agent sharing the file the PROVENANCE compensation obeys the same rule — pinned after a mutant survived
  - `AssertionError: expected 'install provenance could not be writt…' not to contain 'rolled back' at C:/082/harness/cli/test/services/hooks/composition-b`
- F2 x F3 — a rollback must not revert a PEER agent sharing the file REFUSES to restore — and says so — when the file moved under it
  - `AssertionError: expected [] to deeply equal [ Array(1) ] at C:/082/harness/cli/test/services/hooks/composition-boundaries.test.ts:632:22 at file:///C:`

### `test/acts/flow-check-gate-orient.test.ts` — 3
- dw-0008 — orient surfaces a check gate live prints the check by name, the verdict, and every finding
  - `AssertionError: expected '[gate] [ ◇ ]─◐ [ ◇ Ship ] · ◐ Review…' to contain 'dd gate (plan-validate)' at C:/082/harness/cli/test/acts/flow-check-gate-`
- dw-0008 — orient surfaces a check gate live --json carries the findings structurally, for an agent that parses
  - `AssertionError: expected undefined to be 'plan-validate' // Object.is equality at C:/082/harness/cli/test/acts/flow-check-gate-orient.test.ts:108:25 a`
- dw-0008 — orient surfaces a check gate live a GREEN plan orients as open, with no findings — the good twin
  - `AssertionError: expected 'unevaluable' to be 'complete' // Object.is equality at C:/082/harness/cli/test/acts/flow-check-gate-orient.test.ts:152:26 at`

### `test/adapters/fs/node-fs.test.ts` — 3
- NodeFs — bounded no-follow text reads (P063 T003) distinguishes missing, symlink, non-file, and oversize paths without following them
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-bounded-read-fY8mob\target.jsonl' -> 'C:\Users\JORDAN~1\A`
- NodeFs — bounded no-follow text reads (P063 T003) rejects a regular transcript reached through an ancestor symlink outside its root
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-bounded-read-gtvnbT\outside' -> 'C:\Users\JORDAN~1\AppDat`
- NodeFs — bounded no-follow text reads (P063 T003) rejects every symlink component even when its target remains inside the root
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-bounded-read-6fy2xX\selected-root\other-project' -> 'C:\U`

### `test/adapters/git/exec-remote-telemetry-git-null-device.test.ts` — 3
- null device for GIT_CONFIG_GLOBAL (win32 SIMULATED via injected platform) maps win32 to NUL and every other platform to os.devNull
  - `AssertionError: expected '/dev/null' to be 'NUL' // Object.is equality at C:/082/harness/cli/test/adapters/git/exec-remote-telemetry-git-null-device.t`
- null device for GIT_CONFIG_GLOBAL (win32 SIMULATED via injected platform) site 1 of 2 — safeGitEnvironment falls back to the platform null device
  - `AssertionError: expected '/dev/null' to be 'NUL' // Object.is equality at C:/082/harness/cli/test/adapters/git/exec-remote-telemetry-git-null-device.t`
- null device for GIT_CONFIG_GLOBAL (win32 SIMULATED via injected platform) site 2 of 2 — safeCredentialConfigEnvironment(materializing) uses the same device
  - `AssertionError: expected '/dev/null' to be 'NUL' // Object.is equality at C:/082/harness/cli/test/adapters/git/exec-remote-telemetry-git-null-device.t`

### `test/services/doctor/collector/backup-restore.int.test.ts` — 3
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) capture, MUTATE, restore — the file comes back byte-identical (dw-0001, dw-0002)
  - `AssertionError: expected [ Array(1) ] to include 'C:\Users\JORDAN~1\AppData\Local\Temp\…' at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/ex`
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) a path with __ IN ITS OWN NAME round-trips — the case the old flatten broke (dw-0003)
  - `AssertionError: expected [] to include 'C:\Users\JORDAN~1\AppData\Local\Temp\…' at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/expect/dist/`
- the backup is a restore point, and the restore is DEMONSTRATED (tk-0001) restoring a file that did NOT exist means DELETING it (dw-0004)
  - `AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ] at C:/082/harness/cli/test/services/doctor/collector/backup-restore.int.test.ts:163`

### `test/acts/doctor.test.ts` — 2
- registerDoctorAct json mode emits an envelope with data.layers (incl. extensions) and exits 0
  - `AssertionError: expected [ 'toolchain', 'node-runtime', …(13) ] to deeply equal [ 'toolchain', 'node-runtime', …(12) ] at C:/082/harness/cli/test/acts`
- registerDoctorAct — CI hermeticity (plan 074 · ac-000a, review F006) the INJECTED probe answers the ingress — no real socket is ever reached
  - `AssertionError: expected [] to deeply equal [ Array(1) ] at C:/082/harness/cli/test/acts/doctor.test.ts:239:30 at processTicksAndRejections (node:inte`

### `test/adapters/fs/fake-fs.test.ts` — 2
- NodeFs confined copy REFUSES an out-of-tree symlink — CWE-59 exfil guard, one op (plan 031 AC-03)
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-exfil-xyjzgi\secret.txt' -> 'C:\Users\JORDAN~1\AppData\Lo`
- NodeFs publishes byte-exact sibling directories without following target symlinks
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-bundle-fs-VOPxND\outside' -> 'C:\Users\JORDAN~1\AppData\L`

### `test/services/hooks/config-writer.test.ts` — 2
- writing through a SYMLINKED config path (dw-0007) leaves the symlink intact and updates its TARGET
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-config-writer-Y3ivr8\dotfiles\hooks.json' -> 'C:\Users\JO`
- writing through a SYMLINKED config path (dw-0007) the RENAME-based atomic write DESTROYS the symlink — the hazard, executable
  - `Error: EPERM: operation not permitted, symlink 'C:\Users\JORDAN~1\AppData\Local\Temp\harness-config-writer-Ue5o1Y\dotfiles2\hooks.json' -> 'C:\Users\J`

### `test/services/hooks/install-strategy-a.test.ts` — 2
- the ABSENT-FILE case — one situation, three consequences (dw-0011, dw-0012) creates the file AND its parent directories, with a defined skeleton
  - `AssertionError: expected 'C:\Users\JORDAN~1\AppData\Local\Temp\…' to be 'C:\Users\JORDAN~1\AppData\Local\Temp\…' // Object.is equality at C:/082/harne`
- windsurf writes BOTH files — half-working is the failure mode (dw-0014) creates and populates both ~/.codeium paths
  - `AssertionError: expected [ …(2) ] to deeply equal [ …(2) ] at C:/082/harness/cli/test/services/hooks/install-strategy-a.test.ts:195:41 at file:///C:/0`

### `test/services/hooks/legacy-command-form.test.ts` — 2
- the reader handles BOTH forms a legacy one-token command still yields its script, and NO interpreter
  - `AssertionError: expected 'C:/Users/JORDAN~1/AppData/Local/Temp/…' to be 'C:\Users\JORDAN~1\AppData\Local\Temp\…' // Object.is equality at C:/082/harne`
- the reader handles BOTH forms status reports a legacy install as INSTALLED, and stats its script
  - `AssertionError: expected 'C:/Users/JORDAN~1/AppData/Local/Temp/…' to be 'C:\Users\JORDAN~1\AppData\Local\Temp\…' // Object.is equality at C:/082/harne`

### `test/services/hooks/verbs-e2e.int.test.ts` — 2
- `harness hooks restore` — the recovery verb, through the real bin restores a real backup end to end, chosen as the NEWEST with no --from
  - `AssertionError: expected [ Array(1) ] to include 'C:\Users\JORDAN~1\AppData\Local\Temp\…' at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/ex`
- provenance is pruned on NO-LONGER-OURS, not on WE-REMOVED-IT a config cleaned OUT-OF-BAND has its record entry dropped
  - `AssertionError: expected [ Array(1) ] to include 'C:\Users\JORDAN~1\AppData\Local\Temp\…' at Proxy.<anonymous> (file:///C:/082/node_modules/@vitest/ex`

### `test/services/telemetry/refusal-evidence.test.ts` — 2
- dw-0011 — the refusal lands in telemetry, and the flow stays untouched a refused `flow nav set` yields command_exit carrying the gate E-code
  - `AssertionError: expected 'E441' to be 'E440' // Object.is equality at C:/082/harness/cli/test/services/telemetry/refusal-evidence.test.ts:103:42 at pr`
- dw-0012 — SessionEvidence exposes the refusal the evidence type carries `refusals` as a code histogram
  - `AssertionError: expected { E441: 1 } to deeply equal { E440: 1 } at C:/082/harness/cli/test/services/telemetry/refusal-evidence.test.ts:175:22 at proc`

### `test/adapters/git/exec-remote-telemetry-git.int.test.ts` — 1
- ExecRemoteTelemetryGit — HTTPS credential discovery RED cluster A accepts the exact helper, username, URL-subsection, and 64-entry boundaries
  - `Error: STACK_TRACE_ERROR at task (file:///C:/082/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27) at Object.<anonymous> (file:///C:/082/nod`

### `test/services/hooks/binary-path.test.ts` — 1
- a home directory containing a SPACE (dw-0015) installs a command whose binary path is quoted and recoverable
  - `AssertionError: expected false to be true // Object.is equality at C:/082/harness/cli/test/services/hooks/binary-path.test.ts:64:47 at file:///C:/082/`

### `test/services/hooks/command-runs.test.ts` — 1
- executionState — the check that would have caught this (row 3) probes the INTERPRETER AND SCRIPT PAIR that is actually configured
  - `AssertionError: expected { …(2) } to deeply equal { …(2) } at C:/082/harness/cli/test/services/hooks/command-runs.test.ts:133:22 at file:///C:/082/nod`

### `test/services/hooks/composed-command.int.test.ts` — 1
- the command the INSTALLER composed is a command `fire` can actually RUN (F004) executes the installed string verbatim: exit 0, silent, and a journal entry
  - `Error: STACK_TRACE_ERROR at task (file:///C:/082/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27) at Object.<anonymous> (file:///C:/082/nod`

### `test/services/hooks/journal-race.int.test.ts` — 1
- hook journal — interprocess append is LOSS-FREE (dw-003b) records exactly 8 lines for 8 concurrent processes, 5 times out of 5
  - `Error: STACK_TRACE_ERROR at task (file:///C:/082/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27) at Object.<anonymous> (file:///C:/082/nod`

