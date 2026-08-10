# BRIEF — the hook's parse failure is unobservable, and that is the bug

**Plan**: 082 · **From**: `pij-used-narwhal` · **To**: `pij-respectable-clam` (for coder dispatch)
**Date**: 2026-08-10 · **Status**: cause PROVED by measurement; fix design proposed, not implemented

---

## HEADLINE — defect (b): the journal cannot see its own parse failure

`harness hooks fire` runs under an **exit-0, always, and silent** contract, because it executes
inside an agent's tool loop. That contract is correct and must stay. It is paid for by a single
promise, written into the verb's own docstring:

> *"the exit code carries no information, so nothing may assert on it; the journal
> (`~/.harness/hooks/fires.jsonl`) is the observable."*
> — `harness/cli/src/acts/hooks.ts:62-67`

**The journal is the only observable, and it has exactly one blind spot: a payload it could not
parse.** On that path the hook returns *before the journal object is ever constructed*, so it
exits 0 and writes nothing at all. An agent invoking the hook and an agent never invoking it
produce byte-identical evidence.

That blindness — not the Cursor prefix below — is what cost **three sessions and ~58 hook
invocations** of investigation. The prefix is merely what walked into the blind spot first. **If
Cursor fixed their end tomorrow, defect (b) would still be there, waiting for the next malformed
payload**, on any agent, on any platform.

This is the same defect class the whole plan has been about: *an observation and its negation
were indistinguishable*.

### The exact path, verified in source

`harness/cli/src/services/hooks/hook-payload.ts:43-46`

```ts
try {
  parsed = JSON.parse(raw);
} catch {
  return EMPTY;          // repoRoot: null, command: null, toolName: null
}
```

`harness/cli/src/acts/hooks.ts:238-249`

```ts
const raw = opts.hookInput === 'stdin' ? await readStdin() : null;
const payload = parseHookPayload(raw);

if (!couldBeCommitBearing(payload.toolName)) return;   // toolName null -> TRUE, falls through
if (!looksLikeRepo(deps.fs, payload.repoRoot)) return;  // <-- EXITS HERE, repoRoot is null
const repoRoot = payload.repoRoot as string;

const dir = hookStateDir(home);
const journal = new FileHookJournal(...);               // <-- never reached
```

**Line 245 is the exit.** The journal is constructed at line 249. There is no code path on which
an unparseable payload can be recorded.

### The decision that caused it was a good one, half-finished

The parser's docstring reasons carefully and correctly:

> *"Anything unparseable is an EMPTY payload, never a partial guess: a repo path inferred from a
> malformed document could point the state store at the wrong repository, and mis-attributing to
> the wrong repo is worse than not firing."*

**Do not guess** is right and should not change. What is missing is its other half: **say that you
could not parse.** The file header even names the risk — *"it is the one input this runtime does
not control"* — and then handles that input without recording that it was unhandleable.

---

## The trigger — defect (a): Cursor prepends a UTF-8 BOM on Windows

> **CORRECTED TWICE. Read this box before anything below it.**
>
> **Correction 1** said Cursor prefixes *every* hook payload. Wrong — see § *The differential*.
>
> **Correction 2 (final, and it supersedes Correction 1 entirely):** the prefix bytes are
> **`EF BB BF` — a UTF-8 BOM** — **not** the ASCII `n++` reported earlier. `n++` was an artifact
> of *my own instrument*: the wrapper reads stdin as **text** and writes it to a log, so the hex
> I measured was the result of a PowerShell decode plus a file round-trip, not the wire.
> **Capstone test: feeding known `EF BB BF` bytes through the same wrapper reproduces
> `head=[n++{"con] hex=6E 2B 2B 7B` exactly.** `n++` was never on the wire.
>
> **This is a KNOWN, PUBLISHED Cursor defect.** A public bug report describes a UTF-8 BOM on
> Cursor's Windows hook stdin breaking standard `JSON.parse` and causing guards to *silently
> degrade* — the same silent-failure class as our defect (b), independently discovered.

**Cursor on Windows prepends a UTF-8 BOM (`EF BB BF`, `\uFEFF`) to the hook payload.**
`JSON.parse` rejects a leading BOM, so our hook throws and takes the silent path above.

### Lesson for the instrument, not just the bug

A text-mode instrument cannot faithfully report bytes. The wrapper answered the question it was
built for — *is stdin delivered at all* — and then was trusted for a question it could not
answer: *what bytes exactly*. **Any future byte-level probe must write raw bytes to a `.bin` and
hex-dump the file**, with no text decode between the wire and the measurement.

This is what made `hooks.json` look correct while nothing was ever recorded — and it is why
prefixing `node` in `hooks.json` (`ec5fa9e`) did not help. **That fix was real and necessary: it
repaired *invocation*. The payload was never the shape we parse, so the run stayed silent
anyway** — one defect masking another, which is why the earlier fix looked like a failure.

### The constancy measurement — right all along, and it pointed at the answer

The prefix was **constant at exactly 3 bytes across payloads ranging 673–962 bytes**. The `head`
and `hex` columns below are my instrument's *rendering* of the BOM, not the wire bytes (see the
correction box above) — but the **width** is faithful, and the width is what carried the
reasoning:

```
declared=85  logged=83  head=[{"tool_n]  hex=7B 22 74 6F 6F 6C 5F 6E   <- hand-piped, CLEAN
declared=681 logged=679 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=752 logged=750 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=858 logged=856 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=962 logged=960 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=673 logged=671 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=743 logged=741 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=789 logged=787 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=959 logged=957 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=681 logged=679 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
declared=794 logged=792 head=[n++{"con]  hex=6E 2B 2B 7B 22 63 6F 6E   <- Cursor
```

**Constant width across a 289-byte spread in payload size rules out a length prefix or a framing
header** — and **a UTF-8 BOM is always exactly 3 bytes.** The inference was correct and it was
pointing at the answer the entire time, even while the bytes themselves were misread.

Had the leading bytes been a length or a frame, discarding them would have been wrong — you
would be throwing away the envelope you are supposed to read. They are not.

The `delta=2` column is the wrapper's own CRLF, present on every row including the clean one, and
is not part of the finding.

---

## THE A/B EVIDENCE — verbatim

Same bytes, same hook, same machine, one difference.

```
### 3. TEST A - EXACTLY what Cursor sent (cwd retargeted only)
journal lines before: 4
node exit=0
journal lines after A: 4  DELTA=0

### 4. TEST B - CONTROL, same bytes from the first { onward
first brace at index: 3  (stripping 3 leading chars)
node exit=0
journal lines after B: 5  DELTA=1
```

**Delta 0 versus delta 1 on identical bytes is the whole proof.** Note that both exited 0 — the
exit code distinguishes nothing, exactly as the contract says.

### Three parent-process controls — why "Cursor prepends it" is a measurement, not a suspicion

The wrapper that captured the prefix is a PowerShell script, so PowerShell had to be cleared as
the source before the prefix could be attributed to Cursor. Known-clean JSON was fed to the
**same wrapper** from three different parents:

| parent | head received | hex |
|---|---|---|
| hand-pipe (PowerShell native) | `{"tool_n` | `7B …` |
| **node**, real OS pipe, no shell | `{"conver` | `7B …` |
| **cmd.exe**, `type file \| powershell -File` | `{"conver` | `7B …` |
| **Cursor**, ×10 | `n++{"con` | `6E 2B 2B …` |

Only Cursor's invocations carry it. The wrapper is faithful; PowerShell and the OS pipe do not
manufacture it.

### Control on the unwrapped path

```
### TEST 3 - CONTROL: the UNWRAPPED path, node -> harness.js directly
journal before: 6
node exit=0
journal after : 7  DELTA=1
```

The path Cursor originally used — `node harness.js hooks fire …`, no wrapper — journals correctly
on clean JSON. **Nothing is wrong with the invocation, the install, the PATH, or the transport.**

---

## THE LESSON THAT OUTLASTS THE FIX

Three separate probes on this problem measured a fiction. All three were *carefully* built. The
pattern is worth more to the record than the defect:

### 1. A wrong hypothesis does not make you overlook evidence — it makes you file evidence as irrelevant

`strip_utf8_bom` was **located, quoted, and passed between two agents in writing**, in the very
message that reported the read site: *"read_to_end then decode_hook_input_bytes then
strip_utf8_bom. BOM ONLY, no trim, no brace scan."*

**Both of us read that line and classified it as the wrong KIND of tolerance** — because the
hypothesis in our heads was ASCII junk, and a BOM stripper is irrelevant to ASCII junk. The
answer was not missed. It was **read and dismissed**, twice, by two agents, one of whom had
written it down for the other.

### 2. A probe that constructs its own stimulus can only measure your model of the world

I fed git-ai's binary literal ASCII `n++` — a string Cursor never sends, invented by my own
instrument's rendering — and recorded its refusal as *"git-ai has no tolerance; no precedent
exists."* **It refused a fiction.** On the real input it behaves correctly and *is* the precedent.

Same class as the earlier bare-word-`node` control (which tested an unquoted form we do not ship)
caught by `pij-controlled-vrell`. **Three instances in one day, from three directions.**

### 3. A text-mode instrument cannot report bytes

The wrapper answered the question it was built for — *is stdin delivered at all* — and was then
trusted for one it could not answer: *which bytes exactly*. Its PowerShell decode rendered
`EF BB BF` as `n++`, and that rendering became a "measurement" that survived for hours.

**Rule: byte-level questions get raw bytes to a `.bin` and a hex dump of the file.** No text
decode between the wire and the claim.

### 4. An orchestrator's confirmation is the least-audited claim in a fleet

*(Recorded by `pij-respectable-clam`, about its own conduct.)* A finding was correctly labelled
**PRELIMINARY** by the agent who found it. The orchestrator upgraded it to *"CONFIRMED, twice
over"* on a grep that never reached the read site it had already been handed. **A careful hedge
became a premise — and premises stop being checked.**

### 5. The instrument control is what closed it

The retraction did not rest on the published bug report. It rested on feeding **known
`EF BB BF`** through the **same wrapper** and getting the same `n++` back. That is what turns
"my bytes might be wrong" into "my bytes are wrong, and here is exactly how."

---

## PROPOSED FIX — two parts, and part 2 is the one that matters

### 1. Strip the UTF-8 BOM — precisely, and NOT by tolerating anything

In `parseHookPayload`: strip a leading BOM before parsing, matching git-ai's `strip_utf8_bom`.

```ts
const text = raw.replace(/^\uFEFF/, '');
```

**Explicitly NOT scan-to-first-brace.** That was the original instruction in this brief and it is
**withdrawn**: it was designed for ASCII junk of unknown shape, and now that the cause is a known
BOM it is both imprecise and actively harmful — it would **silently swallow genuinely malformed
payloads that defect (b) exists to make visible.** A precise strip plus a recorded failure is
strictly better than tolerating anything that happens to precede a brace.

**Still record it.** A stripped BOM should leave a trace, so a *change* in what arrives is
visible the first time rather than the fiftieth. Bounded: a `strippedBom: true` flag, or
`skipped_len` plus capped hex. Do **not** journal the payload body — it carries `user_email` and
`transcript_path`.

### 2. Make the parse failure observable

Construct the journal — or at minimum a journal write — **before** the guards at
`hooks.ts:244-245`, so an unparseable payload produces a line instead of nothing. Proposed shape,
consistent with the existing `{"kind":"silent","reason":…}` vocabulary:

```json
{"at":"…","phase":"post","repoRoot":null,
 "outcome":{"kind":"unparseable","reason":"payload-not-json","rawLen":794,"skippedHex":"6E 2B 2B"}}
```

**Performance caveat — do not turn the journal into a firehose.** The `couldBeCommitBearing` guard
exists because the hook fires on *every* tool call (~38 per 19-tool-call run) and Node starts
slowly. The fix must journal **only the parse failure**, which is rare and actionable — not every
skipped read tool.

### 3. Regression test

Feed `\uFEFF{…}` — a real BOM, not a hand-typed stand-in — to `fire` and assert **a journal line
exists**. Assert on the journal, never the exit code: the contract forbids the latter, and it is
precisely that forbidding which made this invisible.

Add a second case with genuinely malformed JSON (no BOM) and assert it produces an
**`unparseable`** journal line rather than silence. That is the case scan-to-first-brace would
have swallowed.

---

## STATUS — FINAL

**The diagnostic is closed.** Cause identified, mechanism confirmed at source and on the machine,
instrument error found and proven, differential resolved. **No Cursor run is required. No
`hooks.json` change is required.** The staged quote falsifier
(`scratch/win/install-quote-test.ps1`, `hookwrap-v2.ps1`) was never installed and should not be.

**Ready for coder dispatch.**

---

## THE DIFFERENTIAL — RESOLVED: git-ai strips the BOM, we do not

> **This section originally concluded that Cursor delivered clean bytes to git-ai's entry and
> prefixed bytes to ours, and proposed a leading-quote mechanism. THAT CONCLUSION IS WITHDRAWN.**
> The differential is real, but its cause is BOM handling in the receiver — not differential
> delivery by Cursor. **The leading-quote hypothesis is dead and its falsifier is unnecessary:
> no Cursor run, no `hooks.json` change.** The reasoning is kept below because the retraction is
> the useful part.

### The resolution, measured on both receivers with real BOM bytes

| receiver | input | result |
|---|---|---|
| **git-ai** | `EF BB BF` + JSON | **silent — parsed fine** |
| **our hook** | `EF BB BF` + JSON | **journal DELTA=0 — silent death** |
| **our hook** | same JSON, no BOM | **journal DELTA=1 — works** |

git-ai's read site strips it explicitly — `strip_utf8_bom` at `git_ai_handlers.rs:421`, after
`decode_hook_input_bytes` handles UTF-16 BOMs. **Both hook entries always received the same
BOM-prefixed payload. git-ai strips it; we choke on it.** That is the whole differential.

### RETRACTED: "git-ai has no tolerance, so no precedent exists"

**This was my worst error and it is worth naming.** I fed git-ai's binary **literal ASCII
`n++`** — a string Cursor never sends, invented by my own instrument's rendering — and it
refused. I recorded that refusal as "git-ai is equally broken; there is no precedent to copy."

**It refused a fiction.** On the real input git-ai behaves **correctly**, and it *is* the
precedent: `strip_utf8_bom` is precisely the fix.

The failure mode is the one this whole investigation is named for: **a control that did not test
the thing it was believed to test.** It is the same class of error `pij-controlled-vrell` caught
in the bare-word-`node` arm. Twice in one day, from two directions.

### What the checkpoint evidence actually showed

The `tool_use_id` match — session checkpoint byte-identical to our wrapper log at 12:54:17 — is
still correct and still useful. It proved git-ai's **hook** produced that checkpoint (the
extension references the `cursor` preset **0** times and emits `tool_use_id` **0** times, and
those fields are `CursorPreset`-only, `cursor.rs:140`). What it does **not** show is a delivery
difference. git-ai's hook succeeded because it strips BOMs, not because it was handed cleaner
bytes.

### What survives, and it is the load-bearing half

- **Defect (b) is untouched** — and is now corroborated by an unrelated party hitting the
  identical silent-degradation class in a published report.
- **The constancy argument was sound and pointed the right way.** A length or framing header
  would have varied across a 673–962-byte spread; it did not, because a UTF-8 BOM is always
  exactly 3 bytes. The reasoning survived the misidentification of the bytes.

---

## PRE-REGISTERED PREDICTION — WITHDRAWN, NOT RUN

The leading-quote falsifier below was designed, staged, and **never run**, because the BOM result
made it unnecessary. It is retained only as a record of the design.

**Its prediction was registered before the run and is now moot:** the hypothesis it would have
tested is already refuted by a cheaper measurement that needed no Cursor turn at all.

<details>
<summary>Original falsifier design (not executed)</summary>

**Registered 2026-08-10, before any run, so the result cannot be read backwards.**

| condition | prediction |
|---|---|
| entry **with** a leading quote | payload arrives as `n++{…}` (hex `6E 2B 2B 7B`) |
| entry **without** a leading quote | payload arrives as `{…}` (hex `7B`) |

**Either outcome is informative, and BOTH-PREFIXED IS A REAL POSSIBILITY, not a formality.** A
clean unquoted read confirms the hypothesis and moves the fix into the installer. `n++` on *both*
refutes it outright, and sends the search to the command's *content* — at which point the next
suspects are the `-File` form and the `.ps1` target, not the quoting.

### The run is READ-ONLY — so continuity costs nothing

The falsifier needs **tool calls, not commits**. The wrapper logs stdin *before* forwarding, so
the prefix appears or fails to appear on any tool call at all — a file read, a `git status`, an
`ls`.

So the run happens in `C:\src\cursor` (same workspace, same session shape, same
`workspace_roots` — a fresh repo would mean a new Cursor workspace, which is precisely the second
variable this design is trying to avoid), with a prompt that touches nothing:

> *"Run `git status --short` and report its output verbatim. Change no files, commit nothing."*

Both entries fire on that one call, giving both arms in a single turn — **continuity with every
prior run AND zero further perturbation of the recorded-head state.**

### Design — a WITHIN-RUN control, and only the quoting differs

Comparing against the previous session would confound the result with everything else that
changed between runs. Instead: **two `postToolUse` entries in one session, byte-identical apart
from the quote characters**, seeing the same tool calls seconds apart — the same shape that
exposed the differential in the first place.

That forbids telling them apart with a marker argument, because a marker is a second difference.
Instead the wrapper **identifies itself**, reading its own command line:

```powershell
$cmdline = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").CommandLine
```

So the two `hooks.json` entries differ in **nothing but the quotes**:

```
A: "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File C:\src\hookwrap.ps1 -Phase post
B:  C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe  -NoProfile -ExecutionPolicy Bypass -File C:\src\hookwrap.ps1 -Phase post
```

The System32 path contains no spaces, so the unquoted form is valid without shortening or
retargeting anything.

**Residual risks, named up front:** git-ai's entry is a bare `.exe` while both of ours invoke
PowerShell, so this tests *quoting* and not *interpreter shape*; and a second entry adds one more
hook execution per tool call, which is a load difference, not a delivery difference.

### The `harness.cmd` argument that rested on this — VOID, and it must not be left standing

Jordan asked earlier why we do not simply invoke the `harness` CLI command rather than a path to
an interpreter plus a script. While the quote hypothesis was live, this brief argued that his
question *was* the fix: npm's shim at `%APPDATA%\npm\harness.cmd` has no spaces, therefore needs
no leading quote, and resolves the interpreter itself.

**That argument is void.** It rested entirely on the leading quote being the trigger, and the
quote is not the trigger. Leaving the endorsement in place would be worse than never making it —
it would credit a real question with solving a problem it does not solve, and the next reader
would inherit a conclusion whose premise had been deleted underneath it.

**What remains true and separable:** the shim form may still be preferable on its own merits
(one fewer interpreter path to get wrong at install time). That is an open design question for
the installer, to be argued on its own evidence — **not** a finding of this diagnostic.

</details>

---

## WHAT THIS DOES NOT DEPEND ON

**The fix ships without any further knowledge of Cursor's behaviour.** Both defects are ours,
both are wrong regardless of what Cursor does, and we cannot fix their end. A coder can start
now.

## REPRODUCTION

```bash
prlctl exec "Windows 11" --current-user powershell -NoProfile -ExecutionPolicy Bypass \
  -File \\\\Mac\\Home\\substrate\\harness-engineering\\scratch\\win\\parse-test.ps1
```

Scripts (all in `scratch/win/`, all read-only against the probe repo):
`parse-test.ps1` (the A/B) · `split.js` + `run-split.ps1` (parent controls) ·
`split2.bat` + `run-split2.ps1` (cmd.exe control) · `log-heads.ps1` (hex dump)

**No state in `C:\src\cursor` was perturbed** — every hand fire was retargeted to a throwaway
`C:\src\parseprobe`, so the probe repo's recorded-head state remains as the real session left it.

## NOT MEASURED — do not report these as findings

- **What `n++` actually is at Cursor's end.** Their hook rows carry a `windows_temp_file` marker;
  a generated temp script is a plausible lead and nothing more. Bounded chase, next.
- **Whether other agents' payloads are affected.** Only Cursor-on-Windows was observed. Cursor on
  macOS was never seen to do this.
- **Whether the prefix is stable across Cursor versions.** One version (3.15.6), one machine, one
  session. This is exactly why the fix must *record* what it skips rather than assume `n++`.
