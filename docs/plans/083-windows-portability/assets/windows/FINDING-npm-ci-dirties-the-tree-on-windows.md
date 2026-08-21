# FINDING — `npm ci` dirties the tree on Windows ARM64, and the gate that should catch it compares the generator against itself

**Found** 2026-08-11 by `pij-used-narwhal` from a clean clone at `858f9a0c`, using the
before/after `git status --porcelain` control. **Diagnosed to root cause** the same day.
**Reported, not fixed.**

> **This file was substantially rewritten after diagnosis.** Two claims in the first version were
> wrong and are retracted in place below (§ Retractions) rather than quietly deleted — the wrong
> version was relayed to another seat, so the correction has to be findable where the claim was.

## The observation

```
clone           -> CLEAN
after npm ci    -> DIRTY, 3 entries
   M harness/cli/src/services/dd/docs/docs-content.ts
   M harness/cli/src/services/docs/docs-content.ts
   M harness/cli/src/services/flow/schemas-content.ts
```

## Root cause — measured, and matching a published upstream regression

`biome format --write` **does not fail on Windows ARM64 — it crashes.**

```
exit code   -1073741819  =  0xC0000005  STATUS_ACCESS_VIOLATION
stdout      EMPTY
stderr      EMPTY
```

Isolated by the VM lane, generator entirely out of the picture:

| invocation | result |
|---|---|
| JS wrapper `--version` | exit 0, `Version: 2.5.2` |
| raw `biome.exe --version` | exit 0 |
| raw `biome.exe --help` | exit 0, full text |
| raw `biome.exe format` | **0xC0000005, silent** |

So it is not the JS wrapper, not the invocation path, and not the target file. **The binary faults
only once it begins analysis work.**

The correct platform package **is** installed: `node_modules/@biomejs` holds exactly `biome` and
`cli-win32-arm64`; the PE image header of `biome.exe` reads machine type `0xAA64` — genuine
ARM64, 62.7 MB. `cli-win32-x64` is absent and *should* be: the host is ARM64 (Parallels on Apple
Silicon).

This matches **biomejs/biome#11242** on every observable: a regression **starting at 2.5.2** on
`win32-arm64`; `0xC0000005` as soon as analysis begins; `--version` and `rage` still working; no
output on either stream; the x64 binary fine under emulation; 2.5.1 and earlier unaffected.
`package.json` declares `^2.5.0` and the resolved version is **exactly 2.5.2** — the first
affected release.

## Retractions — two claims from the first version of this file

**1. "Unattributable by construction because all three call sites use `stdio: 'ignore'`."**
The premise is true and the conclusion does not follow. The VM lane captured **both streams in
full, by hand, with the generator out of the picture — and stderr is still empty.** There is no
message being discarded. Repairing the stdio plumbing at those three call sites would have
yielded exactly nothing. The general point survives (a swallowed stderr *would* hide a cause that
existed); it was simply not the limiting factor here, and acting on it would have cost an
afternoon for no information.

**2. "A Windows fix is already present here and it is not enough."** Wrong — it is **orthogonal,
not insufficient.** Plan 017 Finding 05 addressed **invocation**: run the package's `bin/biome` JS
via `process.execPath`, because `node_modules/.bin/biome` is an sh shim that cannot
`execFileSync` on Windows. That fix is correct and it works — the wrapper runs and returns 0 for
`--version`. This is not an invocation failure. Same platform, different mechanism. A second
invocation fix would fix nothing.

## Why "it breaks no test" must not be read as "it is harmless"

The VM lane checked rather than assumed, and reported that from **both** baseline runs the drift
suites are green: `dd-docs-drift` 4/0, `docs-content` 16/0, `flow-node-fields-drift` 3/0. That
is correct, and it is the right thing to have checked — the crash dirties three files and breaks
no test, so it is **not** a contributor to the 112 or the 34 and will not contaminate the control
run. That conclusion stands.

**But the gates are structurally incapable of seeing this, so their silence is not evidence.**
Two independent mechanisms, both the compare-against-itself shape this plan already named in
`toBe(nullDeviceForPlatform())`:

**1. The unit gate normalises the baseline away first.** `dd-docs-drift.test.ts:71` runs the
generator **once to overwrite the committed module**, and only then asserts no drift:

```js
await runGate(stage);          // <- overwrites the baseline with THIS generator's output
const result = await runGate(stage);
expect(result.drifted).toBe(false);
```

Its own comment states why: *"the shipped module is biome-formatted and the staged tree has no
`node_modules`, so the baseline has to be whatever THIS generator produces, or the comparison
would report a formatting difference as documentation drift."* Honest, deliberate — and it means
the test compares the generator to itself and **cannot** detect that the generator's output has
diverged from the committed bytes. (Its other three cases are real: they perturb the input and
prove the gate fires. The first case is the one that cannot fail.)

**2. The real gate compares pre-write to post-write on the same machine.** `check:dd-docs`
captures the file as it is, regenerates, and diffs the two — **it never compares against `git
HEAD`**. `npm ci` has already run the generator by the time any check runs, so both sides of the
comparison are the same platform's output. On Windows they agree perfectly while both differ from
the committed bytes. The gate is **order-dependent**: once the generator has run, it can no longer
fail.

**Consequence worth stating plainly.** `check:dd-docs` green means *"the file on disk matches what
this generator produces right now"* — trivially true after any generator run. It does **not** mean
*"the committed file is current."* On Mac those coincide only because biome succeeds, so the disk
file never diverges from HEAD in the first place. Platform-induced divergence is exactly the case
the gate is blind to.

**This also corroborates the biome causation rather than undermining it.** The unit test's comment
is independent in-repo evidence that raw generator output ≠ biome-formatted committed output — so
biome's pass is **not** a no-op, and removing it genuinely changes the emitted bytes. The chain
holds: crash → no format → non-canonical bytes → differs from HEAD.

## Proven by behaviour, with a positive control — 2026-08-11

The source reading above was confirmed by running the gates. Non-destructive contrast on the
already-dirty files; hashes and `git status` byte-identical before and after, printed both ways.
**Same machine, same defect, same minute, opposite verdicts:**

| gate | shape | result |
|---|---|---|
| `check:flows` | `gen:flows && git diff --exit-code <file>` — **compares to `HEAD`** | **exit 1, FAIL — fired correctly** |
| `check:dd-docs` | regenerate, diff against itself, never reads `HEAD` | **exit 0, PASS — green** |

**This is what makes the finding durable rather than a platform anecdote.** A sibling gate in the
same repo, on the same machine, detects the very defect the other misses — so the blindness is a
property of **the gate**, not an absence of signal. The positive control is what turns "it did not
fire" into "it cannot fire."

### The gate indicts itself inside one invocation

`check:dd-docs`, single run, stderr then stdout:

```
gen-dd-docs: biome format failed (Command failed: ...biome format --write...) — run `npm run fix`.
gen-dd-docs: wrote 2 docs → ...docs-content.ts
check:dd-docs OK — no drift
exit 0
```

**It printed `biome format failed` and then declared `OK — no drift`, and exited 0.** The gate
observed its own failure and reported success in the same breath. That is this investigation's
recurring shape — a step that completes, reports success, and does not do the thing — and here it
is inside *our* gate, not a vendor's.

### The repo already contains the fix shape

`check:flows` **is** the correct pattern, already written and already shipping. Remediating the
others is **adopting a sibling's shape, not inventing a mechanism** — the repo did not lack the
idea, it applied it **unevenly**. A consistency defect is cheaper and more durable to fix than a
novel one.

Sharper still: `gen-docs.mjs` names the right answer in its own header — *"the committed file is
lint-clean and byte-stable across regenerations — which is what makes the CI drift check (`git
diff --exit-code`) reliable"* — and then its `--check` path does `before === after` instead. The
correct shape is **cited in the file that does not use it**. Note also that its byte-stability
premise is explicitly conditional (*"when biome is available"*), and on ARM64 that condition
fails.

### All three gates classified, and a pre-registered prediction

Three generators write baked content, and each has a gate. The three dirty files map onto them
exactly, one to one:

| dirty file | gate | shape | status |
|---|---|---|---|
| `flow/schemas-content.ts` | `check:flows` | compares to `HEAD` | **measured RED** — correct |
| `dd/docs/docs-content.ts` | `check:dd-docs` | self-compare | **measured GREEN** — blind |
| `docs/docs-content.ts` | `check:docs` | self-compare (`before === after`, `gen-docs.mjs:96`) | **predicted GREEN** — untested |

**Prediction, registered before the run**: `check:docs` exits **0** on the VM while
`docs/docs-content.ts` is dirty. **If it exits 1, this classification is wrong** and the
self-compare reading needs revisiting.

**CONFIRMED 2026-08-11.** Verbatim from the run:

```
check:docs exit=0 while file DIFFERS-FROM-HEAD=YES

git diff --quiet <file>   -> exit 1   DIFFERS FROM HEAD
npm run check:docs        -> exit 0   GREEN
```

**The instrument here is stronger than the one that proved the first two, and it changes what the
proof rests on.** `check:flows` vs `check:dd-docs` established blindness by **sibling gate** — one
gate disagreeing with another. This run measured **ground truth directly**, with `git diff
--quiet` beside the gate's own verdict. So this green does not merely disagree with another gate:
**it disagrees with the disk**, confirmed by an independent instrument. The gate is not reporting
*"nothing to find"* — there **is** a difference, separately established, and it still says no
drift.

### Final tally — all measured, same machine, same defect, same session

| dirty file | gate | shape | verdict |
|---|---|---|---|
| `flow/schemas-content.ts` | `check:flows` | `git diff --exit-code` vs `HEAD` | **RED — fires correctly** |
| `dd/docs/docs-content.ts` | `check:dd-docs` | self-compare | **GREEN — blind** |
| `docs/docs-content.ts` | `check:docs` | self-compare | **GREEN — blind** |

**Two of three generate-then-compare gates are blind. The one gate that reads `HEAD` is the one
that works.**

`check:telemetry-fixtures` and `check:doctrine-parity` are a different class — they compare two
existing artifacts and never regenerate, so this defect cannot apply. **Classified from source by
the PM, not measured**, and carried here with that label rather than folded into the measured
rows.

### The `check:docs` self-indictment is sharper than `check:dd-docs`'s

Same run, stderr then stdout:

```
gen-docs: biome format failed (...) — EMITTED FILE MAY NOT BE BIOME-CANONICAL (run `npm run fix`).
gen-docs: wrote 13 docs → docs-content.ts
check:docs OK — no drift
exit 0
```

`check:dd-docs` merely announced that biome failed. **This one names the exact condition that
invalidates its own comparison** — *the emitted file may not be biome-canonical* — and then
compares the emitted file to itself and reports no drift.

That completes the `gen-docs.mjs` observation above. The premise is stated conditionally in the
**header comment** (*normalised when biome is available*), the **runtime message announces the
moment that condition fails**, and the **check path proceeds as though it always holds**. The
premise was stated honestly in two places. The gate was built as if it were unconditional. So the
correct answer is not merely cited in the file that does not use it — **the file also announces,
at runtime, the instant its own premise breaks, and continues anyway.**

## Operational consequence — propagate before anyone runs the composite gate

**`harness checks` on this VM will go RED at `check:flows`**, for a reason with nothing to do with
the null-device work. Anyone who runs the composite gate here and reads red as *"the fix broke
something"* will be wrong: it is ARM64-biome, pre-existing, and orthogonal. Consistent with CI
staying green, since `windows-latest` is x64.

## Scope — a fixture artifact plus a forward risk, not a user-facing defect

- **CI is unaffected**: the `windows.yml` added in `858f9a0c` uses `runs-on: windows-latest` = x64.
- **It hits our VM** only because Parallels on Apple Silicon is ARM64.
- **Caveat worth recording**: GitHub's `windows-11-arm` runners **do** hit it — one of the upstream
  citations is precisely that CI failure. Moving the workflow to an ARM runner lands this.
- **Forward risk**: `package.json` declares `^2.5.0`, a **caret**. Every release from 2.5.2 up is
  broken on ARM64, so any lockfile refresh lands in the broken zone **and stays there**. Wants a
  pin at 2.5.1, or an added `cli-win32-x64` for emulation, if ARM64 dev boxes are to work.

### The forward risk is now measured, not projected — 2026-08-11

Upstream **biomejs/biome#11242 is still OPEN**, and **its title states the range outright** —
*"regression in 2.5.2, still present in 2.5.7"*; 2.4.16, 2.5.0 and 2.5.1 are clean. A linked PR
(#11254) exists but **no released version carries a fix.** Confirmed independently by two seats
reading the issue directly, 2026-08-11.

**Provenance, per claim, so a later reader can re-derive it**: `2.5.2` crashing is **ours,
measured on our own hardware**. The `2.5.2–2.5.7` range and the `2.4.16 / 2.5.0 / 2.5.1` clean set
are **upstream's**, read today, not measured by us.

**Mechanism named upstream**: `mimalloc` v3.3.1, pulled in via `libmimalloc-sys` 0.1.47 — shipped
**one day before** the fix landed in mimalloc itself. So the eventual biome fix is likely a
dependency bump rather than a code change, which suggests a pin at 2.5.1 is a **short interim**
rather than a long-term posture. Worth re-checking #11242 before doing anything elaborate.

**This decides what dependabot PR #157 means for us.** That PR bumps `@biomejs/biome` to
**2.5.7** — which is **inside the broken range**. So:

- Merging #157 would **not** fix this defect. It would carry it forward under a newer number,
  where the caret makes it look resolved.
- The caret risk is no longer a projection about future releases. **Every release currently
  available above 2.5.1 is broken on ARM64**, so there is no "wait for the next bump" path.
- #157 is presently blocked for an unrelated reason (the proxy has not synced 2.5.7 or its 8
  `cli-*` platform packages). **When that unblocks, this is still a reason to hold the biome
  portion** — and the two reasons must be kept distinct, or the feed sync will read as clearing
  both.

The remediation is unchanged and now better evidenced: **pin at 2.5.1**, or add `cli-win32-x64`
for emulation, until #11242 ships a fix.

## What is worth fixing here, in priority order

1. **The gate's blindness** — outlives this biome regression entirely, and is the reusable defect.
2. **The dependency pin** — a caret over a known-broken range.
3. **The generators' catch-and-continue** — a build step that reports success after its formatter
   died. Real, but the smallest of the three, and no longer the diagnostic bottleneck.

## Instrument failures recorded by the VM lane, because they nearly cost the diagnosis

1. The probe's **first run never executed**: PowerShell reported *"string is missing the
   terminator"* at **line 81**; the actual cause was an **em-dash on line 53**. That is the
   ASCII-only trap that lane wrote up yesterday, walked into anyway — and the parser blames the
   wrong line every time.
2. A `[uint32]` cast in its hex formatter threw on the negative exit code; the exit code still
   printed, the pretty hex did not.

Twice in one day an instrument failed while the thing it was measuring was fine.
