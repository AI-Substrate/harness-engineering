# How the Windows investigation was actually run — method, tooling, and traps

**Plan 082 · Windows arm · 2026-08-10**
Written so the next person can reproduce this without rediscovering the environment.

This is the **method** record. The findings live beside it:

- [`hook-parse-observable-brief.md`](./hook-parse-observable-brief.md) — the UTF-8 BOM defect and
  the blind-journal fix
- [`same-file-mixed-commit.md`](./same-file-mixed-commit.md) — first same-file mixed commit
- [`ordering-experiment.md`](./ordering-experiment.md) — order/adjacency ruled out
- [`knownhuman-attestation-decides-attribution.md`](./knownhuman-attestation-decides-attribution.md) — the headline
- [`machine-and-method-facts.md`](./machine-and-method-facts.md) — reusable machine facts
- [`deploy-runbook.md`](./deploy-runbook.md) — build → pack → deploy → verify

---

## 1. The environment

A **Parallels Desktop** VM on the macOS host, named `"Windows 11"`. Everything below was driven
from the Mac; nobody typed into the guest except to drive Cursor itself.

| component | version / value |
|---|---|
| Windows | 11, Parallels VM `"Windows 11"` |
| git | 2.55.0 |
| node | 22.21.0 |
| Cursor | 3.15.6, model `gpt-5.6-terra` |
| harness | `0.13.0` (version never changed across builds — see §5) |
| git-ai | 1.6.21 daemon, pinned; source read at 1.6.22 |
| trace2 ingress | `\\.\pipe\git-ai-7e23ac9630ec3d08-trace2` (**named pipe**, not `af_unix`) |
| probe repo | `C:\src\cursor` |
| throwaway repos | `C:\src\parseprobe`, `C:\src\guardprobe`, `C:\src\relayprobe`, `C:\src\deadprobe` |

## 2. How commands were executed in the guest

Two mechanisms, and the split matters.

### 2a. `prlctl exec` — the control channel

```bash
prlctl list --all                      # "Windows 11"; resume if suspended
prlctl exec "Windows 11" --current-user powershell -NoProfile -ExecutionPolicy Bypass \
  -File \\\\Mac\\Home\\substrate\\harness-engineering\\scratch\\win\\<script>.ps1
```

**`--current-user` is mandatory.** Without it the command runs as `NT AUTHORITY\SYSTEM`, whose
profile, `PATH` and npm prefix are a different universe from the interactive user's — an install
performed there is **invisible to Cursor**. SYSTEM's npm prefix is
`C:\WINDOWS\system32\config\systemprofile\AppData\Roaming\npm`.

### 2b. The Parallels share — how scripts got into the guest

The Mac home directory is mounted in the guest as `\\Mac\Home`. So
`~/substrate/harness-engineering/scratch/win/foo.ps1` on the Mac is
`\\Mac\Home\substrate\harness-engineering\scratch\win\foo.ps1` in Windows.

**Every instrument was authored on the Mac and executed from the share by path.** Nothing was
typed into the guest. That is what made ~20 scripts practical to iterate on.

The `\\\\Mac\\Home\\…` quadrupling in the bash command above is bash escaping collapsing to the
`\\Mac\Home\…` UNC path Windows needs.

### 2c. THE QUOTING RULE — put everything in a `.ps1`, never inline

Quoting across `prlctl exec` breaks **three ways**: quotes are stripped, `$_` is expanded
host-side by zsh before it ever reaches Windows, and backslashes are eaten. Short read-only
one-liners (`Get-Content <path>`) are usually survivable. **Anything with a variable, a pipeline,
a regex or nested quotes goes in a `.ps1` on the share, and only the share path is passed.**

Two failures during this work came from ignoring that: a `Select-String` pipeline whose quoting
was mangled, and a pipe-namespace listing whose backslashes were eaten
(`Could not find a part of the path 'C:\pipe'`).

### 2d. Traps that cost real time

| trap | symptom | rule |
|---|---|---|
| **non-ASCII in a `.ps1` on the share** | `The string is missing the terminator: '.` — a **parser** error naming the **wrong line**, blaming quoting | **Scripts staged for the guest are ASCII-only, including comments.** Em dashes broke two scripts |
| **latency** | a call takes 20–90s | background it; **a quiet minute is not a hang** |
| **guest suspension** | host command hangs with no trace inside the guest | `--pause-idle off`, `--travel-enter never`, `--on-window-close keep-running` are applied |
| **no route to `registry.npmjs.org`** | `npm install` **hangs** rather than failing | `npm config set registry https://packagefeedproxy.microsoft.io/npm/` **first**, always |

## 3. How the harness was deployed and verified

```bash
# on the Mac, in the branch worktree
npm ci --no-audit --no-fund
npm run build          # NOT optional — `npm pack` does NOT build
npm pack --pack-destination …/scratch/win/
```

```powershell
# in the guest
npm config set registry https://packagefeedproxy.microsoft.io/npm/
Copy-Item '\\Mac\Home\…\harness-fix.tgz' C:\src\harness-fix.tgz -Force
npm install -g C:\src\harness-fix.tgz
```

**`npm install -g` does not rewrite `hooks.json`** — no postinstall touches agent configs.
**`harness doctor` does.** A bare `doctor` auto-installs the collector and can re-run the hook
installer. **Never run `doctor` between staging an experiment and reading its result** — see §6.

## 4. How Cursor was driven

Cursor itself cannot be automated from the host: **only a human can take an agent turn.** So the
loop was:

1. **Agent writes a prompt file** on the Mac (`scratch/win/WIN-PROMPT-N.md`)
2. **A script copies it into `C:\src\cursor\prompts\`** — written with an explicit
   `UTF8Encoding($false)` so **no BOM** is introduced (writing a BOM into a prompt file during a
   BOM investigation would have been its own joke)
3. **The operator `@`-references it in Cursor** and, where the design needs it, hand-edits a file
   in the editor between two prompts
4. **The agent scores it afterwards** from the guest, read-only

Multi-part experiments (`…A.md` then `…B.md`) run **in the same chat**, so it stays one agent
session with one `s_` id.

### The prompt discipline that mattered

- **Overrides go BEFORE the numbered steps.** An instruction placed *after* a numbered procedure
  is read as background, not instruction. Two macOS runs silently degraded to the easy case
  because the mixed-commit requirement was appended after the steps — the agent honestly reported
  *"existing unrelated changes remain uncommitted"* and did the easy half.
- **Forbid the agent from touching the collector.** *"A collector is being observed and touching
  it invalidates the run."*
- **Refusals are results.** *"Report the refusal verbatim and stop."*
- **Ask the agent to declare its own ground truth** — which line numbers it personally wrote —
  because the gap between its declaration and the note's claims *is* the measurement.

## 5. Verification discipline — behaviour, never version

**The package version is `0.13.0` before and after every change.** `harness --version` can never
tell you whether a fix is installed. Every deploy was therefore verified by an **A/B on the same
machine**:

```
BEFORE install: BOM payload -> journal DELTA=0     (blind)
AFTER  install: BOM payload -> journal DELTA=1     ("strippedBom": true)
```

and for the guard removal:

```
OLD build: dirty-index commit -> silent / index-was-not-clean
NEW build: dirty-index commit -> emitted
```

`npm pack` does not build, so a stale `dist` packs **silently** and you install yesterday's code
under today's version number with nothing anywhere contradicting you. The build output was
grepped for the change **before** packing, every time.

## 6. Keeping runs clean

- **Baseline the journal** (`~/.harness/hooks/fires.jsonl`) before every run — archived to
  `fires.jsonl.<stamp>.bak`, never deleted — so *"anything present afterwards came from the run"*
  is literally true.
- **Never perturb the probe repo with hand-fired hooks.** All hand fires went to throwaway repos.
- **The pre-scan must not modify the environment.** An early pre-scan called `harness doctor` and
  **rewrote `hooks.json` at 16:15:21, during the pre-check for a run** — same content, same byte
  length, but a write is a write. It was replaced with a strictly read-only scan that also avoids
  `git status` (which can write the index stat cache) in favour of `git diff-files` and
  `git ls-files --others`.
- **`git-ai await` before reading any note.** Otherwise you race the daemon and *"no note"* reads
  as total loss when it is really a queue.

## 7. How results were scored

Raw git only — `git notes --ref=ai show <sha>`, `git show --unified=0`, and the archived
checkpoint log at `.git/ai/working_logs/<parent>/checkpoints.jsonl`.

**The diagnostic that generalises:** a trace id present in the **note** but absent from the
**archived checkpoint log** was **minted by commit-time recovery**, not observed by any
checkpoint. That is how you separate *"the agent claimed it"* from *"the ladder claimed it for
the agent."*

**Two scoring traps, both hit:**

1. **Match trace ids only after `::`.** A bare `t_[0-9a-f]+` also matches inside
   `"git_ai_version"` (`git_ai` → `t_a`), inventing a trace id **and** scoring it as *observed*
   because the checkpoint logs contain the same string. Two agents printed it; one dismissed it as
   noise. Use `'::(t_[0-9a-f]+)'`.
2. **Distinguish the hook channel from the VS Code extension.** `agent_metadata.tool_use_id` is
   emitted **only** by `CursorPreset`, i.e. only by the hook. The extension references the cursor
   preset **0** times and emits `tool_use_id` **0** times. So a checkpoint carrying `tool_use_id`
   came from the hook.

`harness validate-attribution` was **not** used: it cannot load in the guest (`E149` — extensions
resolve only from `<cwd>/.harness/extensions/`, never searched upward), and its parser drops the
new `unparseable` outcome. Scoring stayed manual and deliberate.

## 8. Instrumentation lessons — five probes measured the wrong thing

This is the most transferable part of the record. **Every one of these completed successfully and
reported honestly.** None errored.

| # | probe | what it actually measured |
|---|---|---|
| 1 | fed git-ai literal ASCII `n++` | its refusal of a string Cursor never sends — a **fiction the instrument invented** |
| 2 | wrapper read stdin as **text** | its own PowerShell rendering (`n++`) of the bytes it existed to report (`EF BB BF`) |
| 3 | macOS mixed run, twice | the **easy** case — the agent honestly declined to commit work it did not write |
| 4 | trace-id regex over a note dump | an artifact inside `git_ai_version` |
| 5 | relay proof | nothing — arm A got a blanket `h_` note anyway, and arm B's relay never fired because the commit happened **before** the PRE hook |

**The rules that fall out:**

- **A text-mode instrument cannot report bytes.** Write raw bytes to a `.bin` and hex-dump the
  file; no decode between wire and claim.
- **A regex over a text dump is a text-mode instrument.** Match structurally.
- **A probe that constructs its own stimulus can only measure your model of the world.**
- **Before building a theory on an instrument, feed it a known input and check it renders that
  correctly.** That single control is what identified the BOM — feeding known `EF BB BF` through
  the wrapper reproduced `n++` exactly, proving the bytes had never been on the wire.
- **Ask what the probe's NEGATIVE result would look like** before running it. Three of the five
  above could not have produced an informative negative.

## 9. Where the artifacts live

- **Instruments**: `scratch/win/*.ps1`, `*.js`, `*.bat` — gitignored, and they reference the
  Parallels share path, so they must stay in the **main** worktree
- **Prompts**: `scratch/win/WIN-PROMPT-*.md`, copied into `C:\src\cursor\prompts\`
- **Findings**: this directory, in the plan folder
- **Machine state and the way back**: [`machine-and-method-facts.md`](./machine-and-method-facts.md)
