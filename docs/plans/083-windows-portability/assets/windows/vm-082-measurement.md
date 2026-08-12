# Windows suite at `HARNESS_TEST_SCOPE=all` — OUR measurement, on OUR VM

**Measured by** `pij-mid-wilson`, 2026-08-10, for plan 082 · brief from `pij-respectable-clam`.
**This is a measurement, not a repair.** Nothing was fixed. Nothing was committed. No assertion
was relaxed.

## 0. Provenance — what was run, where, on what

| fact | value |
|---|---|
| sha | `695a3056` (`s077/suite-portability`) |
| tree | clean shallow clone of the branch, **2611/2611 files verified present in-guest**, sha re-confirmed inside the VM |
| location | Parallels "Windows 11", guest build **26100**, **local disk `C:\082`** (not the `\\Mac\Home` share) |
| user | `jordanknight` (via `prlctl exec --current-user`), **non-elevated** |
| node / npm | v22.21.0 / 10.9.4 |
| **git** | **2.55.0.windows.3** ← load-bearing, see §2 |
| install | `npm ci` exit 0; `prepare`→`build` exit 0; `dist` present |
| scope | `HARNESS_TEST_SCOPE=all`, explicitly set |
| reporter | vitest **JSON reporter** (`--outputFile.json`), not scraped console text |
| raw artifacts | `docs/plans/083-windows-portability/assets/windows/vm-082/vitest-{results,console}{,2}.{json,log}` |

**Denominator, attached to every number below: 393 test files (367 cli + 26 extension),
6038 collected.** Our green `windows.yml` measured 349 files because it never sets the scope
and takes the `fast` default. The 44-file gap is exactly where all of this lives.

**Three collected counts now exist at one sha, and I am not reconciling them:**
theirs **5997** · our Mac **6015** · our VM **6038**.

## 1. Headline — we do not get 23. We get 112.

### Run 1 — the branch exactly as committed

```
Test Files   25 failed | 367 passed | 1 skipped   (393)
Tests       112 failed | 5891 passed | 35 skipped (6038)
Duration    101.45s     exit 1
```

24 files carry the 112 failed rows. The **25th file failed to COLLECT** and contributes
**0 rows** — see §5.

### Run 2 — the same suite with ONE confound removed (probe, uncommitted)

```
Test Files   18 failed | 374 passed | 1 skipped   (393)
Tests        37 failed | 5966 passed | 35 skipped (6038)
Duration    117.85s     exit 1
```

3 of those 37 are failures **my own probe induced** (the unit test that asserts the old
constant). **Genuine residual: 34.**

So **81 of our 112 failures are one environment defect**, and the 34 that remain are the
number actually comparable with their 23.

## 2. THE FINDING — a null-device constant that makes git refuse to run

`GIT_CONFIG_GLOBAL=NUL` does not isolate git on this box. It stops git working entirely.

Measured **outside vitest**, directly, 4 verbs × 3 values, in a real repo with a positive control:

| `GIT_CONFIG_GLOBAL` | `init` | `status` | `rev-parse` | `add` |
|---|---|---|---|---|
| `NUL` | **128** | **128** | **128** | **128** |
| `\\.\nul` | **128** | **128** | **128** | **128** |
| `/dev/null` | 0 | 0 | 0 | 0 |

Every 128 reports `fatal: unable to access 'NUL': Invalid argument`.

### This contradicts a measurement recorded in our own source

`harness/cli/src/adapters/git/exec-remote-telemetry-git.ts:100-124` carries a doc comment
attributing to the downstream consumer of #108, **with a positive control**, the table:

```
GIT_CONFIG_GLOBAL=NUL        exit 0    ISOLATED
GIT_CONFIG_GLOBAL=\\.\nul    exit 128
GIT_CONFIG_GLOBAL=/dev/null  exit 0    ISOLATED
```

On this box **row 1 is false**. Rows 2 and 3 reproduce exactly.

### It is product code, not test scaffolding — and BOTH branches are broken, by DIFFERENT VALUES

| where | value passed to `GIT_CONFIG_GLOBAL` on win32 | our measurement |
|---|---|---|
| **branch** `s077/suite-portability` | `nullDeviceForPlatform()` → `'NUL'` | 128 |
| **main** | `os.devNull` passed straight through → `\\.\nul` | 128 |
| test support (both) | `hermetic-git.ts:85` → `'NUL'` | 128 |

A reader who greps `main` for `'NUL'` finds nothing — `main` is broken by the *other* string.
My matrix covers both, which is why "main is affected too" holds even though the mechanism
differs. Two product call sites consume it: `safeGitEnvironment` and
`safeCredentialConfigEnvironment`. **`ExecRemoteTelemetryGit` is therefore INOPERATIVE on this
Windows box** — every telemetry git call exits 128. It fails loud, it does not leak.

### Why nobody caught it

`test/adapters/git/exec-remote-telemetry-git-null-device.test.ts:49,63,68` **asserts `'NUL'` is
the correct win32 value, and PASSES** — on Linux, where the value is never exercised. A comment
recorded a measurement attributed to a third party; product code was built on it; a unit test was
written to assert the same constant. The suite now **actively defends the broken value**. Nobody
re-measured, because a positive control had already been cited. That is inherited evidence
hardening into product.

### The fix is NOT `/dev/null`

I used `/dev/null` as a **probe** only, to isolate the confound. It must not become the fix:
on Windows `/dev/null` is an **absent file**, not a null device. It works because git treats a
missing config path as "no config" — that is behaviour we would be *relying on*, not a device we
would be *using*. A real fix likely points `GIT_CONFIG_GLOBAL` at a guaranteed-empty temp file we
create, which states the actual intent — *no global config* — platform-neutrally. That is a
decision, not a substitution, and it is not mine to make in a measurement pass.

## 3. The residual 34, against their 23

**We reproduce 22 of their 23.** Their Family A header says 17 but its table enumerates **13**
rows; 13 + 6 + 4 = 23, which matches their own total exactly. So the `17` is the typo, and the
27-vs-23 discrepancy resolves in their favour — their arithmetic is otherwise self-consistent.

### Family A — path separator · ours 13 · theirs 13 (header says 17) · **EXACT MATCH**

Every row matched file-for-file and test-for-test.

| file | test | assertion signature |
|---|---|---|
| `acts/doctor.test.ts` | json mode emits envelope with `data.layers` | `expected [ …(13) ] to deeply equal [ …(12) ]` |
| `acts/doctor.test.ts` | CI hermeticity — INJECTED probe answers the ingress | `expected [] to deeply equal [ Array(1) ]` |
| `hooks/binary-path.test.ts` | home directory containing a SPACE (dw-0015) | `expected false to be true` |
| `hooks/command-runs.test.ts` | probes the INTERPRETER AND SCRIPT PAIR (row 3) | `expected { …(2) } to deeply equal { …(2) }` |
| `hooks/install-strategy-a.test.ts` | ABSENT-FILE case creates file AND parents | `expected 'C:\…' to be 'C:\…'` |
| `hooks/install-strategy-a.test.ts` | windsurf writes BOTH `~/.codeium` paths | `expected [ …(2) ] to deeply equal [ …(2) ]` |
| `hooks/legacy-command-form.test.ts` | legacy one-token command yields its script | `expected 'C:/…' to be 'C:\…'` |
| `hooks/legacy-command-form.test.ts` | status reports legacy install as INSTALLED | `expected 'C:/…' to be 'C:\…'` |
| `hooks/verbs-e2e.int.test.ts` | `hooks restore` restores a real backup end to end | `expected [ Array(1) ] to include 'C:\…'` |
| `hooks/verbs-e2e.int.test.ts` | provenance pruned on NO-LONGER-OURS | `expected [ Array(1) ] to include 'C:\…'` |
| `collector/backup-restore.int.test.ts` | capture, MUTATE, restore | `expected [ Array(1) ] to include 'C:\…'` |
| `collector/backup-restore.int.test.ts` | a path with `__` IN ITS OWN NAME round-trips | `expected [] to include 'C:\…'` |
| `collector/backup-restore.int.test.ts` | restoring a file that did NOT exist means DELETE | `expected [ Array(1) ] to deeply equal [ Array(1) ]` |

Their `embedBinaryPath()`/`extractBinaryPath()` asymmetry claim is **corroborated by shape**: the
two `legacy-command-form` rows are literally `'C:/…'` vs `'C:\…'`. I did not fix it, per brief.

### Family B — windsurf two-file composition · ours 6 · theirs 6 · **EXACT MATCH**

All 6 in `hooks/composition-boundaries.test.ts`, the F2/F3 rows — same file, same count, same
signatures (`expected [] to include 'windsurf'`, `expected [ { agent: 'windsurf', …} ] to deeply
equal []`, `expected '' to contain 'C:\…'`, `expected [Function] to throw an error`, provenance
still says `rolled back`, `expected [] to deeply equal [ Array(1) ]`).

### Family C — timing · ours 3 · theirs 4 · **we fall SHORT by one**

| file | theirs | ours |
|---|---|---|
| `adapters/git/exec-remote-telemetry-git.int.test.ts` | 1 | **1** ✓ `Test timed out in 30000ms` |
| `hooks/composed-command.int.test.ts` | 1 | **1** ✓ `Test timed out in 30000ms` |
| `hooks/journal-race.int.test.ts` | 2 | **1** ✗ we see one of their two |

**This family was INVISIBLE in run 1** — all three rows died fast on the null-device error before
they could reach the 30s wall. Run 1 recorded **zero** timeouts; run 2 recorded exactly 3. A
confound can *hide* failures as well as manufacture them, which is a good argument for the
two-run shape.

Their correction on `composed-command` — 28.3s against a 30s budget, flipping with machine load —
is consistent with what we see: it is at the boundary, not comfortably inside it.

## 4. Ours-only — failures they did NOT report

### C1 · null-device (§2) — **81 rows in run 1**
59 direct (`git init`/`hash-object` refusing), 7 downstream ("not a git repository", because the
repo was never created), 15 assertion-shaped (14 in `exec-remote-telemetry-git.int.test.ts`, whose
`kind: 'transport'` results are this defect wearing an assertion's clothes; 1 in
`cat-file-batch.int.test.ts`). Zero of these appear in their 23.

### C2 · symlink `EPERM` — **7 rows + 1 uncollected file**
`node-fs.test.ts` (3), `fake-fs.test.ts` (2), `config-writer.test.ts` (2) all fail with
`EPERM: operation not permitted, symlink …`. Unprivileged Windows cannot create symlinks without
Developer Mode. Our VM runs non-elevated; if their box has Developer Mode on, they never see this
family. **This is an environment discriminator, not a code difference.**

### C3 · the dd gate anchors to the WRONG REPOSITORY on Windows — **5 rows** — *a second product defect*

`flow-check-gate-orient.test.ts` (3) and `refusal-evidence.test.ts` (2). The gate returns
**`E441 DD_GATE_TARGET_INVALID`** where `E440 DD_GATE_UNSATISFIED` (or a real verdict) is
expected, and a healthy plan orients as **`unevaluable`** instead of `complete`.

Mechanism, **measured** by replaying `docRepoRoot`'s walk-up (`src/acts/flow.ts:130-155`) over a
Windows-shaped path:

```
C:/Users/…/Temp/fixture/plan → … → C:/Users → C:  → .  → FIXPOINT: .
```

On POSIX the walk terminates at `/`. On Windows it passes **through the drive root and lands on
`.`** — so `fs.exists('./.git')` is evaluated against **`process.cwd()`**, which during a test run
is the harness repo, which *does* have a `.git`. The function then **returns `.` as the document's
repository root**. It does not fall back; it confidently anchors the document to the wrong
repository. The file's own doc comment warns about exactly this class of error ("worse than an
error: a refusal the reader can only clear with `--force`, for a document that was never
incomplete") — on Windows the guard it describes is the thing that misfires.

This is a confident-wrong-answer defect, the family #108's own title names. **Not fixed here.**

## 5. The denominator hazard — one file never ran at all

`test/acts/dd-schema-fs.test.ts` fails at **collection**:

```
EPERM: operation not permitted, symlink '.' -> 'C:\…\dd-schema-fs-…\looped\.dd\loop'
```

It is the 25th failed file in run 1 and contributes **0 of the 112 rows**. Its tests are neither
passed, failed, nor skipped — they are simply **absent from the denominator**. Counted separately
from the 112 deliberately: this is how a suite quietly gets smaller while every number still
looks self-consistent.

## 6. Open question, already asked

Posted to #108 (comment `5240065040`): their `git --version`, plus the `GIT_CONFIG_GLOBAL=NUL`
+ `git init` probe. If `NUL` works on their git and not on ours (2.55.0.windows.3), then both
reports are correct for the box that produced them, and the 112-vs-23 gap is an environment
difference rather than a disagreement.

## 7. Side observations

- **biome's formatter fails on Windows** during codegen — `gen-docs`, `gen-flows`, `gen-dd-docs`
  each printed `biome format failed … emitted file may not be biome-canonical`. The build still
  exits 0, leaving 3 generated `*-content.ts` files formatted differently from their committed
  form. It manufactured **no** test failures here, but it means a Windows build is not
  byte-reproducible against a Mac/Linux one.
- **`git-ai` is installed on this VM** and `trace2.eventTarget` is a live named pipe. The suite's
  global `GIT_TRACE2*=0` is what contains it. The VM is therefore **not** a from-zero fixture,
  per the standing caution in `scratch/windows-vm-validation.md`.
- The `\\Mac\Home` share was used only to ferry scripts and artifacts; the suite ran entirely
  from the guest's local disk.

## 8. What I did NOT do

No fixes. No assertion relaxed. No commit, on any branch. `main` and every shared checkout
untouched — the clone lives outside the worktree tree at `~/win082/repo` and the probe edits
exist **only** inside the VM at `C:\082`. No GitHub Actions minutes spent.
