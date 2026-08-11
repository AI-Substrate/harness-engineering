# Phase 3 execution log — doctor integration, the LIVE install, and the artifact Jordan runs

Plan 082. Seat `pij-cautious-firefly`.

**This phase touches the real home directory.** Every earlier phase was fenced away from it on
purpose. The fence comes down here, deliberately and once — and the task order *is* the safety
property, which is why task one is not the install.

**No independent review stands behind phase 2.** Three consecutive pij spawns wedged identically
across two harnesses (copilot twice, codex once), so the cross-model pass that reviewed phase 1
never ran on phase 2. Phase 2 had the PM's review — which found the vacuous corroboration row, the
copilot ownership defect and the sequential-not-concurrent row — but not another model's. Recorded,
not a reason to stop. The working consequence is written into this phase: **mutate more than usual,
because there is nobody coming behind.**

---

## tk-0001 — the backup was not a restore point, and it could not be made into one by reversing it

### The claim under test

Phase 2 stated, and phase 3's task text repeats, that `backupAgentConfigs` is **write-only**: it
flattens each path into one directory by substituting `__` for `/`, and no code anywhere reverses
the mapping. The task offered two acceptable resolutions — implement the reverse mapping, or use a
copy-tree that preserves relative paths — and one unacceptable one: an unproven restore.

I did not choose between them by reasoning. **The reverse mapping cannot be implemented**, and the
first thing this task produced was the measurement that says so.

### MEASURED — the flatten is not injective (macOS 26.0 arm64, real filesystem, 2026-08-10)

A throwaway int test drove the **real `backupAgentConfigs`** through the **real `NodeFs`** against a
real temp home, with `CLAUDE_CONFIG_DIR` pointing at a directory whose own name carries the
separator — which is an ordinary thing for a user to have, not a contrived one, because the variable
takes an arbitrary path.

```
COPIED  : [
  "/var/folders/mv/.../measure-flatten-qwPpkv/cfg__a/settings.json",
  ".cursor/hooks.json"
]
ON DISK : [
  ".cursor__hooks.json",
  "__var__folders__mv__...__measure-flatten-qwPpkv__cfg__a__settings.json"
]
  INVERSE of .cursor__hooks.json
     -> .cursor/hooks.json                                  <- correct
  INVERSE of __var__..__cfg__a__settings.json
     -> /var/.../measure-flatten-qwPpkv/cfg/a/settings.json  <- A DIFFERENT FILE
```

Two facts, and the second is the one that shaped the work:

1. **The inverse writes to a path that never existed.** Restoring through it would leave the damaged
   original in place and create a stranger beside it — and report success.
2. **`.cursor/hooks.json` round-trips perfectly.** The path this machine actually has, the path any
   demonstration would naturally reach for, is in the subset where the broken mapping works. A
   restore proof built on the paths we expect would have gone green against a mapping that cannot
   restore.

That is the ninth instance of one shape in this plan, in a new place: *the working case is available,
defensible, and one question away from being caught.* Here the question was **which path**, not
whether a round trip happened.

### What was built

The flatten is gone. It was not replaced with a cleverer encoding — it was replaced with **not
encoding at all**.

- **Copies keep their path verbatim**, in two namespaces so the two cannot collide:
  `files/home/<rel>` for a home-relative source, `files/abs/<path>` for an absolute one. A directory
  named `cfg__a` is stored in a directory named `cfg__a`.
- **`manifest.json` is authoritative.** It records the ABSOLUTE source beside its stored location, so
  `restoreAgentConfigs` never parses a filename. No encoding is reversed, so no encoding can be
  reversed wrongly. It carries a `version`, and an unrecognised one refuses.
- **Injectivity is checked, not assumed.** The construction is injective, so the collision branch
  should be unreachable — and it is still there, pushing to `failed` (which blocks the install at the
  call site) rather than overwriting one copy with another. A backup that silently clobbers its own
  copy is worse than no backup.
- **Absences are recorded.** A source that does not exist is not copied — there is nothing to copy —
  but it IS written to the manifest with `existed: false`, because our own installer *creates* config
  files, and for a file we created the restore is to **delete** it. This closes a gap phase 2 could
  only see through the installer's own `created: true` flag.

`copied` / `failed` / `undeclared` / `dir` keep their phase-2 semantics exactly; `absent` is
additive. The phase-2 row asserting that an absent source appears in neither `copied` nor `failed`
still holds and still passes — its stale doc comment (`created: true` is *the only thing* that can
distinguish this case) has been corrected rather than left to rot.

### The demonstration — dw-0001 to dw-0004

`test/services/doctor/collector/backup-restore.int.test.ts`, six rows, **against `NodeFs` in a real
temp tree** (dw-0002). Not a FakeFs: this is the path whose whole purpose is to work when something
has already gone wrong, and the defect that motivated the task was a real-path defect.

| row | assertion |
| --- | --- |
| capture → **mutate** → restore | dw-0001. Byte-identical, compared as a `Buffer`. The fixture carries a JSONC comment, CRLF line endings, a tab, trailing spaces and no trailing newline, so "byte-identical" means more than "same JSON". |
| a path with `__` in its own name | dw-0003. Restores to **itself** — asserted on the path as well as the bytes, plus an explicit assertion that the wrong path the old inverse produced was **not** created. |
| a file that did not exist | dw-0004. The absence is in the manifest; the restore **deletes** the file the install created, asserted on the filesystem. |
| a second restore | Idempotent. An operator already in trouble runs recovery twice; a recorded-absent file that is already gone is `alreadyAbsent`, not a failure. |
| a directory with no manifest | Refused with a reason, never "restored 0 files". The harm this module names is the CLAIM. |
| an unrecognised layout version | Refused. Old directories stay on disk looking restorable; reading one through the wrong reader is how you write the right bytes to the wrong path. |

### PROVEN BY REFUSAL — six mutations, six RED

Green rows prove nothing. Each mutation was applied by **exact-string replacement with a loud abort
on anchor mismatch** — the phase-2 near-miss rule, where biome had reformatted an anchor, the
replacement silently no-opped, and the suite printed "12 passed", which is indistinguishable from
blind tests and resolves in the flattering direction.

| # | mutation | result |
| --- | --- | --- |
| M1 | **the pre-task design restored**: flatten the copy, and decode the FILENAME instead of reading the manifest | RED |
| M2 | restore does not write, but still reports success | RED |
| M3 | the backup stops recording absences (phase-2 behaviour) | RED |
| M4 | restore rewrites an absent entry as an empty file instead of deleting | RED |
| M5 | a missing manifest reported as a clean restore of zero files | RED |
| M6 | an unrecognised manifest version restored anyway | RED |

**M1 is the one worth reading, and it is not the pass/fail that matters but the split:**

```
Tests  1 failed | 5 passed (6)

FAIL  a path with __ IN ITS OWN NAME round-trips — the case the old flatten broke (dw-0003)
- Expected  "/var/.../harness-restore-oVw2pA/cfg__a/settings.json"
+ Received  "/var/.../harness-restore-oVw2pA/cfg/a/settings.json"
```

Under the old design **five of six rows stay green**, including the capture→mutate→restore row and
the delete-an-absent-file row. Only the `__` row dies. So the row dw-0003 asked for is not a
completeness nicety — it is the **only** row in the file that can see the defect the task exists to
fix, and it was named in the task text before I measured anything. That is the assertion earning its
place.

### One collateral change, and why it is not a literal any more

`auto-install.test.ts` injected its write failure at the hard-coded flattened name
`<backup-dir>/.claude__settings.json`. That path no longer exists, so the row stopped injecting
anything and went red — correctly. It now resolves the destination through `storedPathFor`, so the
injection follows the layout instead of silently ceasing to probe when the layout moves. A literal
there would have been a row that quietly stopped testing while staying green.

### What this does NOT deliver — stated now, not discovered in tk-0003

- **Only the agents we enumerate are covered.** Unchanged, and still declared in the backup's own
  detail line: git-ai also installs for agents we do not detect, and those are not backed up.
- **Windows paths are not addressed.** The namespace split tests `startsWith('/')`, which is the
  repo's logical-POSIX convention; a `C:/…` source would be classified home-relative-or-absolute by
  that same test as before. This is not a regression — the classification is the one the module
  already used — but it is not a Windows claim either.

---

## tk-0001 (continued) — `harness hooks restore`, because a library function is not a delivery

### The ruling, and why it is the same defect as phase 2's

I finished the library, raised the missing verb as a question rather than adding surface nobody
asked for, and the PM ruled: **add it** — using an argument I had made myself earlier in the plan.

Phase 2's most important finding was that `install`, `status` and `list` had been built, asserted
against directly, and checked off while **none of them was registered on the CLI**. A capability that
cannot be invoked has not been delivered. `restoreAgentConfigs` was that same defect wearing
different clothes: six rows, six red mutations, and no way for a person at a terminal to run it.

The asymmetry is what settles it. Everyone who needs this verb is, by definition, someone for whom
something has **already** gone wrong — possibly at three in the morning, possibly with a broken
editor config, possibly not the person who wrote it. Every other verb in this family exists for
convenience; this one exists for recovery, which is exactly when *"write a script against the
library"* stops being an answer.

Recorded as the PM's correction of their own task text, not as scope I took.

### What was built

`harness hooks restore [--from <dir>] [--json]`.

- **Newest by default.** Backup directories are named from an ISO timestamp with `:` and `.`
  replaced, which sorts lexicographically in the same order as chronologically — so "newest" is the
  last name, not a `stat`. Only directories carrying a `manifest.json` are candidates.
- **Operator-facing, so it fails loudly.** It is the **only** verb in this family that sets an exit
  code. `fire`'s exit-0-and-silent contract binds `fire` alone, because `fire` runs inside an agent's
  tool loop; this runs at a terminal, and a restore that fails silently is the worst verb in the
  family — the operator walks away believing their configs are back.
- **It is inside the registration guard**, which now asserts `['fire','list','status','install','restore']`.
  Being registered is no longer something this verb could quietly lose.

### PROVEN BY REFUSAL at the VERB level — four mutations, four RED

The library mutations do not transfer: they prove the mechanism, not the delivery, which is the
distinction that produced this whole exchange. Each of these rebuilds `dist`, because the real bin
runs the build, not the sources.

| # | mutation | result |
| --- | --- | --- |
| V1 | the verb swallows the refusal (no exit code set) | RED — 2 failed \| 7 passed |
| V2 | **the verb is BUILT but never REGISTERED — phase 2's defect, replayed** | RED — 4 failed \| 41 passed |
| V3 | no backup at all reported as a clean restore of zero files | RED — 1 failed \| 8 passed |
| V4 | `ok` not derived from failures — always true | RED — 1 failed \| 8 passed |

**V2 is the one that matters.** The defect that shipped undetected in phase 2, replayed deliberately,
is now caught by four tests across two files — the registration guard in `app.test.ts` plus the three
end-to-end rows. The guard I wrote after finding that gap by accident has now been demonstrated
refusing the thing it was written for, rather than merely existing.

The refusal rows assert **exit code AND reason together**, because either alone is survivable by the
wrong implementation: a non-zero exit with no reason leaves the operator guessing, and a reason with
exit 0 is invisible to a script.

The end-to-end rows take their backup from the **real `backupAgentConfigs`**, never a hand-built
fixture directory — a fixture would prove the restore against a layout only the test believes in.

### Still not delivered

- **No human-readable renderer.** `--json` is the only shaped output; the flag is accepted and
  ignored, exactly as `list`/`status`/`install` do today. Consistent, and stated rather than implied.
- **Restore does not consult the installer.** It puts back what the backup recorded; it does not
  reason about what an install did. That is the design — the manifest is the record — but it means a
  restore after two installs restores to the state before whichever backup is chosen, not "before
  our hook".

### Verification

- `HARNESS_TEST_SCOPE=all npx vitest run test/services/doctor/collector/ test/services/hooks/` —
  **36 files, 692 tests, all passing** (the fast scope skips `provocation.int` and
  `live-daemon-note.int`, both of which are in this range, so the scope is named deliberately).
- `npx tsc --noEmit` clean; biome clean.
- The verb rows additionally require a `npm run build` first — `verbs-e2e.int` drives `bin/harness.js`,
  which runs `dist`. The first run of these rows failed for exactly that reason, which is a small
  reminder that the end-to-end surface and the source can disagree.

---

## The sweep's question was wrong, and the phase-2 review is what proved it

Recorded here rather than as another instance, because anyone re-running the sweep with the old
question will miss the same class again.

I swept the checked phase-2 tasks asking of each: **do its rows call an internal function, or drive
the deliverable?** That found three instances. The review found a fourth my sweep could not have
caught, because the row **does** drive the real bin — for the fire — while reading the result through
`fireSummary()`. Half the chain being end-to-end is exactly what makes a row look finished.

> **A test can be end-to-end in its SETUP and layer-beneath in its ASSERTION, and only the assertion
> decides what it proves. The question has to be asked of the assertion, not of the test.**

---

## tk-0002 — doctor installs our hooks, and survives us

### The failure posture is the task; the install is the easy half

A doctor that dies on our optional step is worse than one that never had it: the operator ran doctor
to diagnose something else, and every other row is what they came for. So a hook-install failure is
a **warning**, doctor still **exits 0**, and every other row still prints.

But warn-only is worthless if the warning is not emitted. A swallowed failure means the machine now
differs from what the operator believes and **nothing said so** — that is the defect, not the safe
default. Hence every row asserts on the OUTPUT: an exit code of 0 is equally consistent with
*installed fine* and *gave up silently*, so it cannot carry the claim by itself.

### What was built

- `autoInstallHooks` in the hooks service — never throws, never changes an exit code, returns
  `action` + `detail` + `warnings`.
- Doctor's call site composes through the hooks act's **own `hooksDeps`**, never a second copy.
  Doctor building its own would be free to resolve a different binary path or home, and the config
  written on first run would then differ from the one `harness hooks status` reads back — the
  divergence class that produced `detectId` and `configPathsFor`.
- **Both surfaces.** The text render prints the announcement beside the collector's; the JSON
  envelope carries `data.agentHooks`. An agent reads `doctor --json`, and a warning that exists only
  in the text render is swallowed for exactly the reader most likely to act on it.
- Carried **beside** the report rather than as a doctor LAYER, deliberately: a failing layer flips
  the envelope to `degraded`, and our optional step must not change the verdict on the machine's
  readiness. Same never-break-the-command posture as exit 0, applied to the envelope.

### The opt-out, and why `0` is the value that proves it (dw-0008)

`hooksDisabled` is **the verb's own predicate**, called by doctor — one predicate, one answer, so the
call site and the verb cannot disagree about what a value MEANS. **Any non-empty value opts out**,
including `0` and `false`, because someone exporting `HARNESS_NO_HOOKS=0` is reaching for the off
switch and a variable named NO_HOOKS that installs when set to `0` is a trap.

This is a live risk, not a hypothetical: **the neighbouring collector opt-out in the same call site
tests `=== '1'`**. A hooks call site copying that pattern would install for someone who declined. The
row asserts the same string — `0` — writes nothing through **doctor** and nothing through the
**verb**, on the filesystem rather than on a message, because a message is what a broken
implementation prints while writing anyway.

**RULED, not left decided-by-implementation** (PM, mid-task). Presence-based semantics are kept —
declining is the recoverable direction — but the surprising case is made **observable**. The decline
always names the variable **and the value that caused it**, and when the value is one a user
plausibly wrote meaning *no, do not disable* (`0`, `false`, `no`, `off`) it adds the correction:
*any non-empty value declines; UNSET the variable rather than setting it to "0"*.

The alternatives each fail on one property. A second convention (`0` means proceed) leaves
`HARNESS_NO_HOOKS=` ambiguous. A blunt README line only reaches the reader who went looking. This is
the only option where **a user who got it wrong finds out** — do the safe thing, and make it
observable rather than silent, which is the shape this plan keeps reaching for.

The corrective line fires **only** for the surprising values: `=1` gets the plain notice, asserted
by its own row. Otherwise every declining user reads a warning aimed at a mistake they did not make,
which is how a message stops being read.

The two variables stay separate on purpose: declining telemetry collection and declining
editor-config writes are different decisions. A discriminator row proves it — `HARNESS_NO_COLLECTOR=1`
(which every other row sets for hermeticity) still installs hooks. Without it, "nothing was written"
could have been satisfied by the collector opt-out disabling our step too, and every assertion would
have passed for a reason unrelated to `HARNESS_NO_HOOKS`.

### A comparison, not a spot-check — and the confound it exposed

"Every other row still printed" is a claim about the **whole** report. A spot-check for a `git:` line
would be satisfied by a doctor that dropped three others, so the row runs the same doctor with and
without the broken config and requires the layer list to match **exactly, name and verdict** — which
also proves our step cannot silently DEGRADE a layer, not merely that it cannot remove one.

The first attempt compared two runs in ONE home and reported **13 layers against 12**. The difference
had nothing to do with the hook failure: **doctor's first run changes the machine it is reporting
on** — it installs, it writes state, and the second run legitimately sees more. A control has to
differ from its subject in one respect, and sequential runs in a shared home differ in two. Fixed
with an independent control home. Measured, not foreseen.

### PROVEN BY REFUSAL — four RED, and one deliberate GREEN

| # | mutation | result |
| --- | --- | --- |
| D1 | doctor's opt-out restated as `=== '1'` — the neighbouring collector's pattern | RED — 1 failed \| 6 passed |
| D2 | doctor never installs hooks at all | RED — 4 failed \| 3 passed |
| D3 | the failure is swallowed — installed, no warning printed | RED — 2 failed \| 5 passed |
| D4 | the JSON envelope drops `agentHooks` (text-only visibility) | RED — 3 failed \| 4 passed |
| D5 | `installHooks` throws again — **doctor must SURVIVE it** | **GREEN, as required** — 7 passed |

**D5 IS THE FIRST MUTATION IN THIS PLAN ASSERTED TO SURVIVE, and that is a different property from
every other one tonight.** Every mutation so far has been asked to go RED — which tests that the
rows are *sensitive*. A mutation asserted to survive tests that they are not **over-constrained**:
that they pin BEHAVIOUR rather than implementation. A suite where every conceivable mutation goes
red is not maximally rigorous, it is brittle, and nothing in this plan had checked that until here.

**D5 is not a refusal and is labelled as one that must not be.** It removes the per-agent catch so
the install throws, and asks whether doctor still finishes. It does — `autoInstallHooks`'s outer
catch is what holds — so green is the pass here. Stating the expected direction *before* running it
is what stops a green being read as proof of whatever the reader hoped.

**A discarded mutation, recorded because the discard is the point.** My first D5 was
`if (true) throw err;` inside the catch, and it reported RED — but the build had failed. **A red for
a compile error is not a refusal**; it is the same ambiguity as a green under an unapplied mutation,
pointing the other way. It was replaced with one that compiles.

### The forcing instrument

Failures are forced by making `~/.cursor/hooks.json` a **DIRECTORY**. Chosen over a `chmod` because
it fails on every platform including Windows, and because a permission bit is **bypassed by running
as root** — which CI containers routinely do, so a chmod-based row would silently stop failing there
and pass for the wrong reason.

### Verification

`npx vitest run test/services/hooks/doctor-hooks.int.test.ts` — 7 rows, all through the real bin.

---

## INCIDENT — tk-0002 wrote to a real developer's editor configs, on every gate run

**2026-08-10, ~04:32 local.** Caused by me, in `cb90d388`, ninety minutes before it was found.
Recovered fully. Recorded here in full because the interesting part is not the bug.

### The line

`harness/cli/src/acts/doctor.ts` — the tk-0002 wiring:

```ts
const hooks = !autoInstall ? null : autoInstallHooks(hooksDeps({ fs, clock, env }));  // WRONG
```

`fs` and `env` there are **doctor's own composition-root adapters**, not the injected
`collectorOverride`. `hooksDeps` resolves `env.home()`, so it found the **real** home regardless of
what a caller injected, and `embedBinaryPath(process.argv[1])` — inside a vitest worker — wrote
`…/node_modules/vitest/dist/workers/forks.js` into six real config files. That binary path in a live
config is what the PM spotted.

### The trigger is the test written for this exact bug

`test/acts/doctor.test.ts` → `runWith(true)`. Its own doc comment, which I did not read carefully
enough before adding a line to the function it guards:

> Had the auto-install defaulted ON, `vitest` would have fetched a git-ai release and run
> `install-hooks` machine-wide on whatever box ran it — … **an install-sized blast radius**.

Plan 077 fixed that with **two** things: an opt-in **flag** and an injection **seam**. My line
honoured the flag and ignored the seam. **So the one test that deliberately opts in, in order to
prove the seam works, became the vector.**

### Blast radius: every gate run, not one bad run

`test/acts/doctor.test.ts` is in the **fast** scope, so it runs on every `just checks`. I ran the
gate four times after that line landed. Each one reinstalled.

### THE CORRECTION THAT MATTERS — I reported the reassuring version of my own artifact

In my incident report I wrote: *"every entry is `createdFile:false, createdKeys:[]`. Nothing was
created and no event key was created, so the damage is strictly two appended array entries per
file."*

**That was false, and the file I was quoting said so.** I ran `head -20` on the install record, saw
three benign entries, and generalised. The record actually contained:

```
/Users/jordanknight/.copilot/hooks/harness.json    createdFile: TRUE
/Users/jordanknight/.codeium/hooks.json            createdKeys: ["PreToolUse","PostToolUse"]
/Users/jordanknight/.codeium/windsurf/hooks.json   createdKeys: [...]
```

Had the PM acted on my summary, a created file and two created keys would have been left behind on a
machine reported as clean. **This is the same shape this plan has been cataloguing for two days —
a probe that cannot see the opposite of what it asserts — arriving in an incident report, which is
where it is most expensive.** `head -20` on evidence is a probe with a horizon, and I did not state
the horizon; I stated the conclusion.

### A SECOND DEFECT, found BY the recovery

After the clean-up, the install record still held one entry: the config the PM had restored **by
hand**. Uninstall found no marker, correctly reported it `untouched` — and never pruned its record,
because pruning was keyed on **what we removed** rather than on **whether the file is still ours**.

That is my own softest claim from tk-000a instantiated, by a route I did not predict: not "a user
deletes a config by hand" but **the recovery path itself**. Fixed — `unmarked` is the positive
statement that a file carries nothing of ours, which is exactly when our record of it is obsolete.

### The fixes, and the mechanism

1. **One resolved deps object, both installers.** Doctor now composes hooks from
   `collectorOverride ?? realCollectorDeps(...)`, through a new `hooksDepsFor(fs, home, env)` whose
   escapable inputs are **arguments**. `binary` still comes from the running process (the path
   written into a user's config *is* the running binary) and `env` only reads variables — neither can
   write outside a fence. `fs` and `home` can, so both are injected.
   **This is `detectId` and `configPathsFor` for the third time: two independent answers to "where is
   home" is the defect** — and I reintroduced it in the one place where the cost is a real machine.
2. **The guard that did not exist.** A row that seeds a detected agent *inside* the injected fs, runs
   doctor opted-in, and asserts both directions: the config **was** written into the injected
   filesystem at the injected home (positive — a negative-only guard is satisfied by an install that
   never ran, and vacuity is how this class survives), and **no** written path is under the real
   `homedir()`.
3. **Prune on not-ours**, with a row for the out-of-band case.

### Proven by refusal, safely

Reverting fix 1 and rerunning: **RED — 2 failed | 5 passed**. The mutation was run with `HOME`
redirected into a sandbox, and the sandbox assertion confirms **the escape was reproduced there**
(`…/escape-sandbox-2fd7Iz/.cursor/hooks.json` was created) — so the RED is the guard seeing the real
defect, not a red for some other reason, **and no real config was touched to prove it.** The real
home was verified clean before and after: zero marker residue in all five, `~/.copilot/hooks/`
holding only `git-ai.json`, no install record.

Prune fix: **RED — 1 failed | 14 passed**.

### The fence held under the heaviest load anyone has put on it — measured by ABSENCE

Two hours after the incident, and by accident rather than by design, the escape fix got the strongest
test it will ever get.

At **07:36** a full `HARNESS_TEST_SCOPE=all` suite ran on this machine — hundreds of processes, the
hooks rows spawning real `git` in temp repos, the doctor rows driving the real auto-installer. At the
same time the PM was capturing the live baseline for the Cursor run-9 validation, and the **run 9 that
followed produced exactly six journal entries: three pre/post pairs, every one with `repoRoot
/Users/jordanknight/temp/attrib-probe`.**

**Not one entry from the suite. Nothing written to the real journal, nothing to the real configs.**

That is a different grade of evidence from the guard's own row. The row asserts its fence and passes;
this is the fence **not being crossed** by a full suite it was never specially prepared for, verified
from *outside* by counting what arrived in a real user's journal. A guard that asserts its own
correctness and a guard whose absence of effect is observed downstream are not the same claim, and
only the second one rules out the fence being satisfied vacuously.

It was offered to the PM as a **caveat** — "if your counts look off by a small amount, that run is a
candidate cause worth ruling out". It came back as a **positive control**. Worth noticing that the
honest hedge and the strongest available evidence were the same act: naming a possible contaminant
before the measurement is what let its absence mean something afterwards.

### The uninstall verb performed a real recovery on real damage

Worth stating plainly: the PM cleaned five contaminated configs and one created file with
`harness hooks uninstall` — provenance-driven, deleting a file it had created and stripping entries
from files it had not. **Four hours after we argued about whether an operator-facing recovery verb
was worth building, an operator needed it.** The argument for it was that everyone who reaches for
it already has a problem; the person who had the problem was us.

### The transferable lesson, which is about guards and not about care

Plan 077's protection had two halves and **only one of them is visible in the function signature**.
I satisfied the visible half. Independently, the PM verified my `restore` verb by looking for
`restore` in a command list where `uninstall` was missing four lines above it — checking for the
expected item rather than auditing the list.

> **A guard whose two halves are not both visible at the point of use will be half-satisfied by a
> competent person in a hurry. That is a property of the guard, not of the person.**

Hence fix 2 is a *mechanical* assertion of the seam rather than a comment asking the next person to
remember it — and the doctor call site now carries the wrong version of itself in a comment, so the
next reader sees the trap and not just the rule.

---

## tk-0003 — the LIVE install

The fence comes down, deliberately and once. Authorised only after the escape fix, and after the PM
verified on the real machine that a full `just checks` — the exact suite that reinfected the box four
times — left all seven configs **UNCHANGED**. That is a refusal test on the real target rather than a
fixture, and it is the precondition that mattered.

### Step 1 — the pre-install baseline, recorded BEFORE anything ran

**MEASURED 2026-08-10 ~04:55 local, macOS 26.0 arm64.** Two independent baselines exist by design,
not by redundancy: the PM holds byte copies **outside the repo**, and these are mine.

```
sha256                                                            bytes  path
8c975630ec2f5f25eb3340ddcab8e8dbfad77c2ef6b856825002807ad705217d   1230  ~/.claude/settings.json
ae2cd4fde0cabc189ede00993a5d9aa0433c24d86603b89b7e2dc5c047c76315    959  ~/.cursor/hooks.json
c2d9b9ed9a39efa9bb23dd9b29f2cf47e6b0950da668a65bb3ece32dd4f6347e    754  ~/.gemini/settings.json
cfcc739eb0624d4c5ffd0166279409a58a0b207b4e17a9ff1e1323efe6af4661    555  ~/.factory/settings.json
f15a52e28c324541bd0cb3a9faf6278ab2eb9523ee0720ef5d565014c221b954    926  ~/.codeium/hooks.json
f15a52e28c324541bd0cb3a9faf6278ab2eb9523ee0720ef5d565014c221b954    926  ~/.codeium/windsurf/hooks.json
ABSENT                                                                -  ~/.copilot/hooks/harness.json
```

`~/.cursor/hooks.json` at **`ae2cd4fd…`** independently matches the digest the PM restored it to after
the escape — two parties, two instruments, one number.

**Full bytes are in `scratch/082-live-install-baseline/`, which is gitignored, and the choice is
deliberate.** Digests are the verifiable baseline and belong in the log; the bytes are a restore point
and belong somewhere I control but do not publish, because these are a developer's personal editor
settings. Nothing sensitive was found in them (the only secret-shaped key is gemini's
`auth.selectedType: "oauth-personal"`, a *type* and not a credential) — the point is that "no secret
today" is not a reason to commit someone's settings.

**Two facts worth recording before the install, both of which could have been surprises later:**

1. **`~/.copilot/hooks/harness.json` does not exist and WILL BE CREATED.** Expected — it is the same
   path the escape created, and the install record then said `createdFile: true` for it. Uninstall's
   symmetry for a file we create is deletion, so this is the one path where the reverse is a delete.
2. **`~/.codeium/hooks.json` and `~/.codeium/windsurf/hooks.json` are byte-identical** (same digest,
   926 bytes) **but are NOT links** — distinct inodes, 698763768 and 698763769. So windsurf's two
   declared paths are two real files that must each be written, and a writer that followed a link
   would silently do half the work. Checked because an identical digest is exactly what a symlink
   looks like, and `writeThroughSymlink` exists precisely for that case.

### The assertion target — the POC chain that must survive byte-identical

`~/.cursor/hooks.json` carries **four** pre-existing entries, not two. Both pairs are evidence base:

```
[preToolUse][0]  len=253
python3 …/scratch/attrib-probe/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/cursor-hook-pre.jsonl | /Users/jordanknight/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin 2>>/tmp/cursor-hook-err.log

[preToolUse][1]  len=103
node …/scratch/attrib-probe/harness-commit-hook.mjs PRE

[postToolUse][0] len=255
python3 …/scratch/attrib-probe/hook-probe.py POST >/dev/null 2>&1; tee -a /tmp/cursor-hook-post.jsonl | /Users/jordanknight/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin 2>>/tmp/cursor-hook-err.log

[postToolUse][1] len=104
node …/scratch/attrib-probe/harness-commit-hook.mjs POST
```

The `git-ai checkpoint` invocation is a **pipeline stage inside a chained command** — which is why
this machine has no standalone git-ai entry, and why phase 1's only end-to-end measurement depends on
these exact strings. **None of the four carries our marker**, so `classifyOwnership` reads every one
as `not-ours` and uninstall may never touch them.

### Step 2 — the install, for real

```
installed: 7 files   created: ~/.copilot/hooks/harness.json
refused:   pi — "strategy C is not implemented"
failed:    []
```

The cut line is visible on a **real detected agent**, not a fixture: `pi` is genuinely present on this
machine and is refused **by name** with a reason.

### Step 3 — the POC chain, asserted specifically

All **four** pre-existing cursor entries, each checked individually rather than inside a whole-file
claim:

```
[preToolUse][0]  len=253  BYTE-IDENTICAL   <- git-ai checkpoint pipeline stage
[preToolUse][1]  len=103  BYTE-IDENTICAL
[postToolUse][0] len=255  BYTE-IDENTICAL   <- git-ai checkpoint pipeline stage
[postToolUse][1] len=104  BYTE-IDENTICAL
```

**Ours landed at index 2 in both arrays — appended AFTER, never inserted between.** Position is
asserted as well as content, because a writer that prepended would leave every string byte-identical
and still change what runs first.

### Step 4 — status, and THE THING THAT STOPPED THE TASK

All six report `installed: true`, `binaryState: resolves`. And the path is

```
…/harness-engineering-worktrees/s077-suite-portability/harness/cli/bin/harness.js
```

**a WORKTREE — which is ephemeral.** dw-000c asked for the *installed* binary rather than a dev path;
I installed a dev path. The verb did nothing wrong: `hooksDeps` derives from `process.argv[1]`, which
is correct for whatever binary a user invokes. I invoked the wrong one.

Stopped before step 5 and asked, because a reinstall would have baked in an answer the PM had not
given. **RULED: option 2** — keep the worktree path for the Cursor validation, then uninstall as a
*mechanical* step. The reasoning is the ruling: installing via the stable global path would validate
a binary that **does not contain the feature** (the global `harness` is an npm link to the main
checkout, which has no hooks verbs until this merges), and installing after the merge would run the
validation after the decision it exists to inform. Only option 2 puts *this* code in front of Cursor.

**Consequences, carried forward rather than remembered:** the cleanup is a task step with its own
`done_when` row in tk-0004; `CURSOR-PROMPT-8.md` states the temporary state in plain words *near the
top*; and the phase close records it as a delivered limitation.

### Step 5 — the round trip, on real files

The verb has **no per-agent selector** — uninstall is all-or-nothing — so the round trip covered all
seven paths. That is a superset of what was asked and is what a user would actually run; stated
rather than quietly narrowed.

```
removed  claude-code   2 entries        removed  windsurf  2 entries (×2 files)
removed  cursor        2 entries        deleted  github-copilot — the file WE created
removed  gemini        2 entries        untouched [] · refused [] · failed []
removed  droid         2 entries        unsupported: pi
```

Then every path compared against **the digests recorded in step 1**:

```
.claude/settings.json          8c975630 -> 8c975630   BYTE-IDENTICAL
.cursor/hooks.json             ae2cd4fd -> ae2cd4fd   BYTE-IDENTICAL
.gemini/settings.json          c2d9b9ed -> c2d9b9ed   BYTE-IDENTICAL
.factory/settings.json         cfcc739e -> cfcc739e   BYTE-IDENTICAL
.codeium/hooks.json            f15a52e2 -> f15a52e2   BYTE-IDENTICAL
.codeium/windsurf/hooks.json   f15a52e2 -> f15a52e2   BYTE-IDENTICAL
.copilot/hooks/harness.json    ABSENT   -> ABSENT     RESTORED (deleted)
```

**WHOLE-FILE BYTE EQUALITY, ON ALL SEVEN — AND THAT IS MORE THAN dw-002f CLAIMS.** The claim stays as
written: byte equality is *not* guaranteed, because `jsonc-parser` normalises the internal whitespace
of any container it edits. It was *achieved* here because these files already carried the expanded
formatting the writer emits, so the normalisation was a no-op on this input. **A stronger result on
one input is not a stronger guarantee** — recording it as a measurement, not a promotion.

Reinstalled with the worktree binary. The four POC entries survived **install → uninstall →
reinstall**, three writes, all byte-identical, ours back at index 2.

### The measurement the PM asked for: the `unresolvable` branch, on the real verb

Previously exercised only against fixtures. Driven through the real `harness hooks status --json` on a
scratch home:

```
binary PRESENT    installed=true   binaryState=resolves       binaryResolves=true
binary DELETED    installed=true   binaryState=unresolvable   binaryResolves=false
never installed   installed=false  binaryState=absent
```

`installed: true` holds across the first two, which is exactly what makes an inert hook discoverable:
the entry is there and the target is gone, and those are different facts from "we never installed".
This is the instrument Jordan will use to find a dead hook after this worktree is removed, so it is
proven on the real verb before the README relies on it.

**A fixture error worth recording, because it produced a PLAUSIBLE answer rather than an error.** My
first attempt hand-wrote the scratch config with cursor's event key as `beforeShellExecution`. Cursor's
actual keys are `preToolUse`/`postToolUse`, so nothing was found and status reported
`installed=false, binaryState=absent` — a perfectly reasonable-looking result that answered a
different question. Caught by checking the key against the matrix rather than by anything in the
output. Same shape as the `--hook-owner` fixture in phase 2: **a wrong fixture does not announce
itself; it answers.**

### The instrument failed first, again — mine this time

My first digest-comparison script mis-parsed `DIGESTS.txt` (the field layout is
`digest  N bytes  path`, and a naive three-field read put `"bytes  <path>"` into the path variable).
It printed `*** MISMATCH` for **all six** files. Alarming, confident, and entirely an artifact.

The PM's own first comparison script had failed the same way an hour earlier — `cut` lost from `PATH`
inside a process substitution, every digest compared against an empty string, seven-for-seven MOVED
and a "SOMETHING STILL WRITES" verdict. **Two people, two independent instruments, the same failure
mode, within the hour.** Neither was caught by anything in the output; both were caught by the shape
of the answer being implausible.

The rewrite parses with an anchored regex and **asserts loudly** — `assert m` on every line and
`assert len(rows)==7` — so a parse failure is an exception rather than a MISMATCH. That is the same
rule as the mutation harnesses: *a broken instrument must fail, not report.*

### Two independent baselines agreed

`~/.cursor/hooks.json` = `ae2cd4fd…` from **the PM's byte snapshot taken hours earlier outside the
repo**, and from **my digest taken minutes earlier inside it**. It is the only corroboration in this
plan that is not same-source, and it is what makes the round-trip comparison above mean something.

---

## tk-0004 — `CURSOR-PROMPT-8.md`

A draft existed and its body was sound. Finalising it turned up **two defects that would each have
produced a false negative in the operator's hands**:

1. **The scoring command read the wrong ref.** It said `git notes --ref=git-ai show HEAD`. On this
   machine `refs/notes/git-ai` **does not exist** — the ref is `refs/notes/ai`. The wrong ref prints
   nothing, and "no note" is precisely the total-loss signature the whole exercise is looking for. An
   operator following the draft would have concluded the feature failed. Verified both directions
   before writing: `--ref=ai` returns a note on HEAD, `--ref=git-ai` returns nothing.
2. **The validation repo did not exist.** The draft opened "You are working in
   `~/temp/hooks-validate`", which was never created. The file now carries the setup commands.

The prompt is **self-contained**: no mention of this plan, the workshop, or any file outside the
validation repo. Structure is state → setup → prompt → expectations → scoring → cleanup.

**Section 0, before any instruction, states the state the machine is in** — that the hook points at a
temporary worktree, that removing the worktree stops the hook **silently** (it exits 0 by design, so
dead and working look identical), that `harness hooks status --json` reports `unresolvable`, and that
`harness hooks uninstall` is how to finish. Not a footer: an operator who is not told the shape of the
thing cannot act on it.

**Identity, never a count** — sha, file, line ranges, and actor kind read from the note's own body,
with the reason stated inline: any unsandboxed commit anywhere in the repo moves a count, so a count
passes or fails for reasons unrelated to the run.

**Expected outcome AND failure signature are stated before the scoring**, as four distinct failures
rather than one, because "no note" and "a note that omits the agent's own file" are different
diagnoses and only one of them is the thing this work exists to prevent.

**The attribution split is an observation with its numbers** — 1 agent to 4 human across five runs on
this machine — so a human-attributed note reads as *data* rather than as failure, with the honest
instruction to record which kind appeared and add it to a tally. One run cannot distinguish "wrong"
from "the 4-in-5 case".

Every factual claim in the file was verified against the live machine before it was written: the six
agent names, the created-file path (`~/.copilot/hooks/` now holding both `git-ai.json` and our
`harness.json`), both note refs, and the three `binaryState` values.

## tk-0005 — the README

Rewrote the `harness doctor` note. It previously said doctor "installs the git-ai collector … and
installs its agent hooks", which was true of **git-ai's** hooks and is now ambiguous, because doctor
installs **ours** as well. The two are now numbered, separate, with separate opt-outs.

Per dw-0013 the config paths are **named, per agent, in a table** rather than described as "agent
configs" — including both windsurf files, the copilot file we **create**, and the two env overrides
with their asymmetry stated (`CLAUDE_CONFIG_DIR` is the directory **verbatim**; `GEMINI_CLI_HOME` is a
home root with `.gemini` appended). The four unsupported agents are named.

`HARNESS_NO_HOOKS` is documented with **the same value semantics the code enforces** — any non-empty
value declines, including `0` and `false`, and the way to re-enable is to **unset** it.

The backup section says what the backup **is and is not**: covered agents are only the detected ones,
and `install-record.json` has no garbage collector — with the direction of that error stated, since a
stale entry can only ever make an uninstall remove a key we *did* create, never one of the user's.

---

## PHASE 3 CLOSE — what shipped, what did not, and what is still open

### Delivered

| surface | state |
|---|---|
| `harness hooks fire\|list\|status\|install\|uninstall\|restore` | delivered, each driven through the real bin in tests |
| `harness doctor` installs our hooks | delivered, warn-only, both text and JSON surfaces |
| Strategy A — 7 agents | delivered |
| Backup **and restore** | delivered; round trip proven on the real filesystem |
| Live install on a real machine | **done**, and reversed and redone once under observation |

### NOT delivered — in one place, so nobody has to assemble it from twenty commits

- **Strategies C and D are CUT.** `amp`, `opencode`, `pi`, `cline` are **unsupported by name**. `pi` is
  genuinely detected on this machine and still reports `supported: false` with a reason, which is what
  makes this a cut rather than an omission.
- **Strategy B (codex TOML) remains DEFERRED.** Its sha256 trust state embeds positional indices that
  go stale, and whether its hash matches what Codex computes is unresolved from the source.
- **Windows is EXPECTED-UNVERIFIED**, with three specific named questions for a Windows agent, not a
  general caveat: (1) does copilot require a `type` field? (2) does it need `powershell` rather than a
  bare command? (3) **does gemini require `tools.enableHooks` for hooks to fire at all** — which is not
  only a Windows question: if it is required, Strategy A is inert for gemini everywhere.
- **The live install used a WORKTREE path, deliberately.** `…/harness-engineering-worktrees/s077-…/harness/cli/bin/harness.js`
  is what is written into six configs today. It was chosen over the stable global binary because the
  global `harness` is an npm link to a checkout that **does not contain these verbs** until this
  merges — validating it would have validated a binary without the feature. **The durable install is
  `harness doctor` after merge.** Until then: when this worktree is deleted, those hooks go inert,
  `harness hooks status --json` will say `unresolvable`, and `harness hooks uninstall` is the exit.
  This is stated so that "installed and validated on a real machine" is not read as "shipped and
  stable".
  - **AND THE SHARPER HALF, learned when it happened (F004).** The hazard is not only that the file
    will one day vanish. **While the worktree exists, the binary's CONTENT is mutable by our routine
    work.** Rebuilding `dist/` during the F004 fix silently moved the live install from *broken* to
    *working* — no config touched, no install run, nobody asked. The same mechanism can move it the
    other way: any `just build` on a half-finished change is, for as long as this install stands, a
    change to the operator's live hook behaviour underneath him. A config pointing into a development
    tree does not name a fixed artifact; it names whatever that tree last compiled.
- **Byte equality on uninstall is not CLAIMED**, though it was ACHIEVED on all seven live files.
  `jsonc-parser` normalises the internal whitespace of any container it edits, so a container that
  arrived compact comes back expanded. It happened not to bite here because these files already
  carried the expanded shape. A stronger result on one input is not a stronger guarantee.
- **`install-record.json` has no garbage collector.** Lifetime unmeasured; direction safe.
- **The Cursor end-to-end validation HAS NOW BEEN RUN — see the RUN 9 section.** The hook fired three
  times on real agent traffic, stayed silent twice for the right reason, and emitted once on the
  commit. **Run 10 then closed the narrower question that was hidden inside this bullet — whether the
  relay was NECESSARY** — by removing the competing relay and measuring the sandbox for that run: shell
  REFUSED on both sockets, one channel-2 relay, we emitted, the note landed. See the RUN 10 section.

### Two proofs that live outside the default test scope

`test/services/hooks/provocation.int.test.ts` and `live-daemon-note.int.test.ts` are in `SLOW_TESTS`,
so `just test` and `harness checks` **do not run them**. CI sets `HARNESS_TEST_SCOPE=all`. A local
green is a smaller claim than a CI green, by design and by declaration.

### Every claim, labelled

| claim | label | machine / invocation |
|---|---|---|
| Strategy A installs for 7 agents | **MEASURED** | macOS 26.0 arm64 · `harness hooks install --json`, live |
| The POC git-ai chain survives install | **MEASURED** | live `~/.cursor/hooks.json`, 4 entries byte-identical across install→uninstall→reinstall |
| Uninstall returns files to prior bytes | **MEASURED** | 7 paths, sha256 against a baseline recorded before the install |
| `binaryState` distinguishes 3 states | **MEASURED** | real verb, scratch home, binary deleted underneath |
| The journal is loss-free across processes | **MEASURED** | phase 2, real OS processes |
| Linux | **MEASURED** | native arm64, 26 files / 469 tests |
| Windows | **EXPECTED-UNVERIFIED** | three named questions above |
| A sandboxed Cursor commit gets attributed | **MEASURED** | run 10 · head `5ac3eaa` · sandbox `seatbelt`, both sockets REFUSED · one relay |

---

## PHASE 3 REVIEW FIXES — F001 and F002

Cross-model review: **REQUEST_CHANGES, two confirmed HIGH**
(`assets/tasks/phase-3/reviews/review.phase-3.md`). Both attack the same guarantee — the one the
live install was authorised on: *fully reversible with `harness hooks uninstall`*. Both produce the
same end state: **a config file we created, left behind after an uninstall the user believes cleaned
up.** Both are in provenance; the review's mutations found the escape fence and the recovery path
clean.

### The concentration the review exposes, stated once

**The install record is the single point of truth for what uninstall may delete, and both findings
are failures to WRITE or MERGE it.** A design where *no record* is indistinguishable from *we
created nothing* fails toward leaving cruft — the safe direction, chosen deliberately (see
`install-record.ts`) — but the corollary was never written down: **every record-write bug degrades
cleanup silently.** There is no signal at uninstall time that provenance was ever expected. F001 is
that corollary arriving as a defect, and F002 is it arriving as an untested invariant.

### Both findings reproduced INDEPENDENTLY before any code was changed

Neither was taken on the reviewer's report.

**F001 — install ignored `recordInstall` returning false.** Real bin, `~/.harness` occupied by a
regular file:

```text
install  → "installed": [{ "agent": "cursor", … "created": true }],  "failed": []
uninstall→ "removed": [{ … "entries": 2, "deleted": false }]
after    → /tmp/f001-home/.cursor/hooks.json  STILL EXISTS  {"hooks":{"preToolUse":[],"postToolUse":[]}}
```

The original state was **no file at all**. The install reported success for a write that did not
happen — the shape named in this plan's own doctor work: *naming a backup you did not take is the
harm*.

**F002 — the merge-across-installs guarantee had no assertion.** The reviewer's own mutation
(`createdFile: outcome.created` / `createdKeys: [...outcome.createdKeys]`, replacing the OR and the
union) applied to `install-record.ts`, rebuilt, then:

```text
targeted hooks suite, HARNESS_TEST_SCOPE=all: Test Files 23 passed · Tests 383 passed (383)
real bin, install → install → uninstall: "deleted": false · hooks.json SURVIVES
```

**383 green under a mutant that leaves a file we created on the user's disk.** This is not the
deliverable-vs-layer shape the phase-2 sweep was built to catch, and it is worse: there was **no row
at all**. The property was described precisely — *"merged rather than replaced; installing twice must
not forget that the FIRST install created the key"* — implemented correctly, and never asserted. The
existing second-install row asserts the **config bytes** do not change, which is idempotency; the
provenance lives in a different file that row never opens.

**Why the second install is the dangerous one:** it finds our entry present, creates nothing, and its
own outcome is honestly empty. Only the merge with what the FIRST install recorded remembers that the
file is ours. An overwrite is invisible in every artifact except the one nobody was reading.

### F001, fixed with two mechanisms — and why both

1. **`ensureRecordWritable` — asked BEFORE the first config is touched.** An idempotent round trip
   (read the record, write it back) rather than a probe file, so a failure leaves no litter. If it
   fails, every detected+supported agent is reported in `failed` **by name** with the record path,
   and **nothing is written**.
2. **The return value of `recordInstall` is now checked**, and on failure the entries this run wrote
   are **compensated** through the real `uninstallStrategyA` — using the in-memory outcomes, which
   are the only provenance that exists at that moment and are exactly what uninstall would have read.

The probe alone cannot cover a disk that fills between the probe and the write. The compensation
alone leaves a **window**: the config is written, and a process killed before the undo leaves the
orphan F001 is about. Compensation touches **only what this run wrote** — an `alreadyPresent` file
belongs to an earlier run whose record probably did persist, and removing its entry to compensate for
our bookkeeping failure would be a worse error than the one being compensated.

### The gap I found in my own fix, by asking what would still pass

**Delete the probe entirely and the real-bin F001 row still passes.** Install writes the config, the
record write fails, the compensation undoes it, and the observable end state — named failure, config
absent — is *identical*. Two mechanisms, one visible outcome, and the review's own finding was a
mechanism nothing could distinguish. So the probe got the row that distinguishes it: **assert on the
writes ATTEMPTED**, which is the only place "never written" and "written, then un-written" differ.

### Five mutations, five RED

Anchor-checked, rebuilt each time, restored after each — including on build failure.

| # | mutation | result |
|---|---|---|
| M1 | the reviewer's own: merge → replacement in `recordInstall` | **RED** — 2 failed (both new F002 rows) |
| M2 | the pre-flight probe branch deleted | **RED** — `attempts NO config write at all…` |
| M3 | `recordInstall`'s return value discarded again (the original defect) | **RED** — 2 failed |
| M4 | compensation over-reaches into an earlier install | **RED** — `leaves an EARLIER install alone…` |
| M5 | the probe always says yes | **RED** — same row as M2 |

**M2 and M5 fail ONE row, not two** — the real-bin F001 row stays green under both. That is the
defence-in-depth result stated as a measurement rather than a hope: the two mechanisms are genuinely
redundant on the end state, which is exactly why the write-attempt row had to exist.

### My mutation harness reported the wrong answer first — the third instrument failure of the night

The first run printed `M1: !!! SURVIVED !!!` while the output beneath it read `Tests 2 failed | 52
passed`. Two bugs, both mine: the RED detector grepped `Tests +[0-9]+ failed` against **ANSI-coloured
output**, and the build-failure branch `return`ed *before* `restore`, so M3's broken source stayed on
disk and M4 and M5 "failed to build" against code they never touched.

Both halves reported confidently. That is the PM's lost `cut`, and my earlier mis-parse of
`digest N bytes path`, arriving a third time in the same evening — **a broken instrument reports its
answer in exactly the format a working one uses**. The tell was structural, not textual: a mutation
"surviving" a suite that says `2 failed` is not a plausible shape.

### A cosmetic residue, measured while writing the F002 row and NOT hidden

Install → install → uninstall on a config that had `"hooks": {}` returns a file that **parses equal**
to the original with **no key of ours surviving** — but is not byte-identical: removing the last key
leaves the surgical writer's `{\n  }` where the user wrote `{}`. That is whitespace inside a
container we legitimately edited; the writer is textual precisely so it preserves comments and every
byte it did not touch, and collapsing the brace would mean reformatting on the user's behalf. The row
therefore asserts the true claim (parse-equal, keys gone, **whitespace-only** difference) rather than
a byte claim it would have had to weaken later. This is consistent with the phase-3 close, which
already declined to claim byte equality on uninstall.

### Rows added

| row | file | proves |
|---|---|---|
| install, install, uninstall — a file WE created is still deleted | `verbs-e2e.int.test.ts` | F002, real bin, three separate OS processes |
| install, install, uninstall — event keys WE created still disappear | `verbs-e2e.int.test.ts` | F002's `createdKeys` half, over a user's own file |
| refuses BY NAME and leaves the config exactly as it found it | `verbs-e2e.int.test.ts` | F001, real bin, `~/.harness` a regular file |
| the record write fails AFTER the probe passed | `hooks-verbs.test.ts` | the compensation path |
| leaves an EARLIER install alone when this run wrote nothing | `hooks-verbs.test.ts` | the compensation's own stated invariant |
| attempts NO config write at all when provenance is unwritable | `hooks-verbs.test.ts` | the probe, distinguished from the compensation |

Targeted hooks suite: **383 → 389 tests, all green** (`HARNESS_TEST_SCOPE=all`).

### Softest claim on this fix

**The compensation has never run on a real filesystem failure, only on an injected one.** Every row
that exercises it makes `writeText` throw from a wrapper around `NodeFs`; the probe's refusal is
proven against a genuinely occupied `~/.harness` on the real bin, but the *race* the compensation
exists for — a disk filling between the probe and the write — is reasoned, not measured. Its direction
is safe (it can only remove entries this run wrote, and it reports `stranded` when it cannot), and
that is an argument about the shape of the error, not evidence that it fires.

---

## F004 — THE SHIPPED HOOK HAD NEVER FIRED, ON ANY MACHINE

Found by Jordan running the live Cursor validation. Not a regression: it was true from the moment
phase 2 composed its first command, on every install, on every agent, everywhere.

### The defect, measured on the real bin BEFORE anything was changed

```text
$ node harness/cli/bin/harness.js hooks fire cursor --phase pre --hook-input stdin \
    --hook-owner ai-substrate-harness-hook-v1
error: unknown option '--hook-owner'
{"command":"harness","status":"error", … "code":"E108" …}
EXIT=1
```

`install-strategy-a.ts` composed `… --hook-input stdin --hook-owner <marker>`. `acts/hooks.ts`
registered `--phase` and `--hook-input` and nothing else. Commander rejected the flag **before the
action ran**, so the hook died in argument parsing having reached no line of our code.

Two consequences, and the second is worse than the first:

1. **Nothing was ever journalled.** Corroborated on the live machine: `~/.harness/hooks/` held
   `install-record.json` and **no `fires.jsonl`**. Jordan's run-8 agent-attributed note came from
   git-ai's own checkpoint chain, still entry `[0]` in his config. Our entry contributed nothing.
2. **The exit-0 contract was violated on every single tool call.** Exit 1 with a line on stderr —
   the one invariant the whole design rests on, broken by the command we ship, in the one place it
   was supposed to be absolute.

### Why nothing caught it — structural, not careless

Every test that **executed** `fire` typed its own argv:

| file | argv |
|---|---|
| `hooks-verb.int.test.ts:36` | `['hooks','fire','cursor','--phase',phase,'--hook-input','stdin']` |
| `journal-race.int.test.ts:110` | the same shape, no marker flag |

Every test that examined the **installed** command treated it as a *string*: matched the marker in
it, stat'd the binary named by it, asserted byte idempotency on it. **Nobody ever executed the string
the installer produces.** Producer and consumer of one contract, each asserted against its own idea
of that contract. Phase 1 built `fire`; phase 2 invented the flag; nothing forced them to meet.

**A test that retypes the argv proves the argv you typed.** That sentence is the whole finding.

### The fix — three mechanisms, and they are deliberately distinguishable

| # | mechanism | what it alone would leave open |
|---|---|---|
| 1 | `--hook-owner [marker]` registered on `fire`, accepted and ignored | the next flag |
| 2 | `fire` given `.allowUnknownOption()` / `.allowExcessArguments()` | our own drift, now silent |
| 3 | `composed-command.int.test.ts` — execute the string read back out of the config | — |

Mechanism 2 makes the exit-0 contract *true* rather than nearly true: a config written by another
version of this binary, or hand-edited, now degrades to an ignored word instead of an aborted agent
turn. Tolerating is the safe direction — an ignored flag is inert, a rejected one is fatal.

`--hook-owner` takes an **optional** value (`[marker]`, not `<marker>`), so a truncated config
carrying a bare `--hook-owner` still parses. The exit-0 contract does not get to depend on a config
file being well-formed.

The option set is now declared **once, as data** (`src/services/hooks/fire-options.ts`) with three
readers: the act registers commander options from it, `statusHooks` checks installed commands against
it, and the test re-derives the contract independently from `hooks fire --help` and from the config
the real installer wrote.

### The measurement that mattered: tolerance MASKS the execution row

Mechanism 2 can hide the defect mechanism 3 exists to catch. That was not reasoned — it was measured.
Un-registering `--hook-owner` while leaving tolerance **on**:

```text
✓ executes the installed string verbatim: exit 0, silent, and a journal entry
× emits no option `fire` does not register — checked flag by flag
✓ treats the marker as PROVENANCE, not behaviour
```

The end-to-end row **goes green with the bug present**. Only the static flag-coverage row sees the
drift. Had the tolerance been added without that row, the fix would have looked complete and the
installer could have gone on emitting flags nobody accepts — the same defect, quieter. This is the
F001 lesson arriving again: *delete a mechanism and ask what still passes.*

### Refusal evidence — the new rows RED against current main

Before any source change, all three original rows failed, row 1 reproducing the PM's stderr verbatim:

```text
× executes the installed string verbatim … → received "error: unknown option '--hook-owner'"
× emits no option `fire` does not register … → preToolUse: `fire` must register --hook-owner
× treats the marker as PROVENANCE … → expected 1 to be +0
```

### The fixture was cursor-only, and widening it found a second thing

The existing suite's habit — install into a fenced home with only `.cursor` present — meant the new
rows would have proven **one agent of seven**. The hook ships for **seven agents / eight config
files**; the defect broke all of them. Widening the fixture to create every marker directory raised a
count mismatch (**14 commands where 16 were expected**), which was a bug in the fixture's path list,
not the product: it took copilot's path from the **detection** table (`.copilot/hooks/git-ai.json` —
the file whose presence *detects* copilot) rather than the file we **write**
(`.copilot/hooks/harness.json`). Two adjacent files, one of them somebody else's. The count assertion
is the only reason it surfaced; a `toBeGreaterThan(0)` would have passed.

All **16** composed commands (8 files × 2 phases) are now executed for real, each asserted exit 0,
silent, and journalled — one journal entry per command, so a single silent death is visible.

#### The defect and its echo — the same shape, twice, and the second time inside the test that closed the first

This is worth naming as a **class** rather than filing as a footnote, because it has now been observed
twice in this plan, on the same two files:

| | the original | its echo |
|---|---|---|
| where | `hook-marker.ts` — Strategy A ownership | `composed-command.int.test.ts` — the fixture's path list |
| the two adjacent files | git-ai's entry vs ours, **in one config** | `.copilot/hooks/git-ai.json` vs `.copilot/hooks/harness.json`, **in one directory** |
| the mistake available | claim the whole entry as ours and delete somebody else's work | read somebody else's file and conclude ours was not written |
| what caught it | exact-token matching, decided before any writer assumed it | an exact **count** (16), not a `toBeGreaterThan(0)` |

**Two adjacent files, one of them somebody else's, and a name that does not distinguish them.** The
first time it threatened a user's config; the second time it silently narrowed a test — the *same*
test written to close the first. The echo is the more instructive of the two: the person who wrote it
had the original defect in mind, was actively widening coverage to avoid a related gap, and still
reached for the wrong path, because the detection table is where copilot's config path is *written
down* and it happens to be a different file from the one we write.

The transferable rule is not "be careful with copilot". It is that **wherever we sit beside another
tool's artifact, the two names must be distinguished at the point of use** — and that an assertion on
an exact expected count is what turns "we checked the set" from a belief into a measurement. A
`toBeGreaterThan(0)` here would have reported success over seven-eighths of the surface.

### `status` reported six agents HEALTHY while none of them could run

`binaryState: 'resolves'` stats the **binary**. The binary existed. The arguments were rejected, and
status had no field that could express it. Added `commandState`:

| state | meaning |
|---|---|
| `absent` | no entry of ours |
| `accepted` | every option the command names is one this binary declares |
| `unknown-options` | the config and this binary disagree; the offending flags are **named** |

Checked across **every** entry of ours, not the first — windsurf writes two files and each agent gets
a pre and a post command, so a check that looked at one would report health for a set it had not
examined.

**What it does not prove, stated plainly**, because the failure it replaces was exactly a status field
read as more than it measured: this is a **static** check of option names against this binary's own
declaration. It does not execute anything. It cannot see a binary that is a different program, a
broken node install, or a runtime failure inside `fire`. For that the journal (`fires.recorded`) is
the only honest evidence — which is why `fireSummary` separates "never fired" from "fired and failed".

### Incidental finding: `hooks status` is NOT read-only — a NOTE, not this plan's job

**The mechanism, named so nobody has to re-derive it:** `fireSummary` (`hooks-verbs.ts`) calls
`journal.compact()`, and `FileHookJournal`'s constructor `mkdirp`s its directory
(`hook-journal.ts:100`). So `harness hooks status` can create `~/.harness/hooks/` and can rewrite
`fires.jsonl`. It was therefore **not** run against Jordan's real home while investigating F004, under
the standing stop-and-tell constraint; the behaviour was confirmed in a fenced home instead.

Bounding the journal on a reader rather than on the fire path is a defensible design — the fire path
is the one that must stay fast and silent. But the consequence is a **footgun in precisely the moment
the verb gets used**: nobody runs `status` when things are fine. They run it when something is already
wrong, and the diagnostic then modifies the artifact being diagnosed — including truncating the very
journal entries that might explain the failure. Recorded as a note; the fix (compact on a writer, or
behind an explicit flag) belongs to whoever owns the journal's lifetime, alongside the
`install-record.json` GC that is also still unwritten.

### Rows added

| row | file | proves |
|---|---|---|
| executes the installed string verbatim | `composed-command.int.test.ts` | F004, all 16 commands, real bin |
| emits no option `fire` does not register | `composed-command.int.test.ts` | the static producer/consumer contract; survives tolerance |
| treats the marker as PROVENANCE, not behaviour | `composed-command.int.test.ts` | the flag is inert, so nobody later gives it meaning |
| survives an option it does NOT declare | `composed-command.int.test.ts` | the exit-0 contract as a class, not one flag |
| reports `accepted` for a parsable command | `composed-command.int.test.ts` | `commandState`, real bin |
| NAMES the option this binary does not declare | `composed-command.int.test.ts` | drift is visible on the user's machine, not only in a fixture |

Hooks suite **389 → 395**. `harness checks` with `HARNESS_TEST_SCOPE=all`: `tests:ok biome:ok
typecheck:ok`, standing baseline `arch-check:degraded (2)`, `markdown-lint:degraded (211)`,
`windows-check:degraded (7)` — unchanged.

### Softest claim on this fix

**Nothing here proves the hook does its JOB on a real agent.** These rows prove the composed command
parses, exits 0, stays silent and reaches the journal — which is precisely the gap that was open, and
precisely no more. Whether Cursor invokes it, whether the payload it hands us has the shape we parse,
and whether the resulting trace2 emission produces an attributed note in a **sandboxed** agent's
commit remain unverified on any machine. The plan's central claim is still waiting on Jordan's run,
and the value of this fix is only that the run can now get past argument parsing.

A second, narrower one: the fixture's agent list is **hand-maintained**. It is pinned by a count, so a
newly supported agent fails the row rather than being silently skipped — but the failure will read as
a broken test rather than as "add the new agent here", and the person who meets it will be someone
else.

---

## RUNS 9 AND 10 — the guard discriminates on REAL agent traffic, and the relay is proven NECESSARY

Run by Jordan in Cursor, on the binary this worktree had compiled at **07:33:49** — the same bytes the
PM had independently verified accept `--hook-owner`, and unchanged across the docs commit and push
that followed (mtime proof, both sides). A build freeze was held for the duration precisely because
that binary is mutable by our routine work; run 9 is the first time the ephemeral-path hazard cost
anybody anything, and it cost a twenty-minute freeze rather than a result measured across two
different programs.

### What the hook did

| tool call | outcome | why |
|---|---|---|
| edited files, no commit | **SILENT** | `head-unchanged` |
| edited files, no commit | **SILENT** | `head-unchanged` |
| committed | **EMITTED** | head moved to `1cbdf0de` |

Three fires, one emission. The note anchors `AI6.md` 1–3 and `seed.mjs` line 7 to the agent session.

**This is the first time the discrimination has been exercised by an agent rather than by a fixture.**
The 32 provocation rows established that the guard stays silent for checkout, reset, rebase,
fast-forward pull and `read-tree -m -u` — all of them constructed. Run 9 is two genuine
file-editing tool calls that changed the working tree without moving HEAD, and the guard was silent
for the right reason and named it.

### RUN 10 SETTLES IT — and run 9 plus run 10 are a control pair

Run 9 left one thing open: **whether the relay was NECESSARY.** A note existed, but a note would also
exist if the sandboxed shell's own trace2 had reached the collector unaided, in which case the feature
relayed something nobody was losing.

Run 10 closes it, three minutes later, differing from run 9 in **exactly one material variable**.

| | run 9 (`1cbdf0de`) | run 10 (`5ac3eaa`) |
|---|---|---|
| shell sandboxed | `seatbelt`, both sockets `REFUSED` | `seatbelt`, both sockets `REFUSED` |
| channel-2 relays installed | **2** — the POC's `harness-commit-hook.mjs` and ours | **1** — ours |
| our hook | emitted for `1cbdf0de` | emitted for `5ac3eaa` |
| note | present, correct split | present, correct split |
| **verdict** | **INCONCLUSIVE** | **PASS** |

**Run 9 was confounded.** The POC's own relay does the same job as ours and fired for the same commit
**one second before it**:

```text
07:38:10  ~/.harness/commit-hook-state.json -> {"…/attrib-probe": "1cbdf0de…"}
07:38:11  ~/.harness/hooks/fires.jsonl      -> {"kind":"emitted","head":"1cbdf0de…"}
```

The note was real. Either relay could have caused it, and nothing in the note distinguishes them.

**Run 10 removed the POC relay**, and its state file is still frozen at 07:38:10 — it writes on PRE,
so it cannot have run. So: a sandboxed commit could not reach the daemon, nothing else could send the
commit signal, we sent it, and the note exists. **The relay was necessary and sufficient for that
commit.**

#### The two-channel conflation, recorded because it nearly voided both runs

Reviewing run 10, this seat argued that BOTH runs were confounded, on the evidence that
`git-ai checkpoint` demonstrably ran during both — proven from `checkpoints.jsonl`, which only
`git-ai checkpoint` writes. **That evidence was correct and the conclusion was wrong.** `git-ai
checkpoint` is CHANNEL 1: it records what the agent wrote and cannot produce a note on its own. The
relay removed between the runs was channel 2. **Proving "a relay ran" is not proving "a commit signal
was sent",** and the two are one grep apart.

The same seat then read `/tmp/hook-probe.log` — 130 lines, `control=OK trace2=OK sandbox=unset`, ten
hours, not one EPERM — and concluded the sandbox had never been engaged. That log measures the **HOOK**
context, which is **not sandboxed by design**: a hook-side OK is the PREMISE of the relay (it is where
we emit from), not evidence of an absent sandbox. The shell-side probe, which is the one that matters,
reported `CURSOR_SANDBOX seatbelt` and `connect(): REFUSED` on both sockets for **both** runs.

Both errors are the same shape: **an instrument read correctly, in the wrong context.** They are
recorded here because the phase-4 verb is built to make both impossible to repeat — it classifies
every relay by channel, and its probe prints `"context": "shell"` on its own face.

#### The precondition that was measured once and carried forward

Run 10's PASS was **provisional for twenty minutes**. Its shell-side probe had not been pasted; the
sandbox condition was inferred from run 9. Not a wrong measurement — an **un-repeated** one. That
inference was load-bearing: an unsandboxed shell would have reached the daemon unaided and produced
the same note without us. The probe (`DURING-COMMIT-RUN-E`) then landed and confirmed it.

That is the incident behind `validate-attribution --begin`'s refusal to certify a run without a
shell-side probe **for that run**. The rule has a real incident behind it rather than a principle.

### The claims table, corrected

| claim | label | evidence |
|---|---|---|
| A sandboxed Cursor commit gets attributed | **MEASURED** | run 9 · head `1cbdf0de` · note anchors `AI6.md` 1–3, `seed.mjs`:7 |
| The guard stays silent on real non-commit agent traffic | **MEASURED** | run 9 · 2 fires, `head-unchanged` |
| The relay was NECESSARY — attribution would have been LOST without it | **MEASURED** | run 10 · shell REFUSED on both sockets, exactly one channel-2 relay, we emitted, note landed |
| The fence holds under a full suite on a live machine | **MEASURED** | 07:36 `HARNESS_TEST_SCOPE=all` · 0 entries in the real journal; run 9's 6 entries all from `attrib-probe` |

Splitting the first two rows was the correction; run 10 is what then satisfied both. Carried inside
one row, "a commit gets attributed" would have been read as "the relay was needed" on the strength of
run 9 alone — which was confounded, and which nobody would have noticed from the note.

**What is STILL open**, so the close does not read as more than it is: this is one agent, one machine,
one commit. Windows is unmeasured; the mixed human+AI commit is known to over-count AI at commit
granularity and this changes nothing about it; and `--end` of the phase-4 verb has never scored a live
run.
