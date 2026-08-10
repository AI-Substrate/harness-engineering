# ROOT CAUSE — the extension spawns a bare `git-ai` that is on no PATH

**Found 2026-08-10 by `pij-immediate-newt`, probed jointly on the Windows VM and a macOS control.**
This is the cause of the missing `KnownHuman` attestations described in
[`knownhuman-attestation-decides-attribution.md`](./knownhuman-attestation-decides-attribution.md).

---

## The chain, end to end

1. git-ai's VS Code extension records a `KnownHuman` checkpoint **on document save**, debounced
   500ms (`out/known-human-checkpoint-manager.js`).
2. To do that it spawns `getGitAiBinary()` — which in **production** is literally the string
   `"git-ai"`. `out/utils/binary-path.js` resolves a real filesystem path **only** in
   `ExtensionMode.Development`.
3. So the spawn depends entirely on the **extension-host process PATH**.
4. On the Windows box, **`git-ai` is on no PATH at all**:

   ```
   Get-Command git-ai                        -> nothing
   where git-ai / where git-ai.exe           -> "Could not find files for the given pattern(s)"
   user PATH contains .git-ai\bin            -> False
   machine PATH contains .git-ai\bin         -> False
   C:\Users\<user>\.git-ai\bin\git-ai.exe    -> EXISTS
   ```

5. Every save therefore spawns `git-ai` → **`ENOENT`**, logged only to the extension-host console.
   **No `KnownHuman` checkpoint is ever recorded** — 0 across 28 checkpoints on that machine.
6. At commit time, `should_recover_remaining_as_known_human()`
   (`attribution_recovery.rs:661`) returns **false** whenever an AI attestation landed and no
   `h_` exists — so the human sweep is skipped, and the human's lines fall through to the agent
   session.

**Why macOS differs:** macOS Cursor resolves the user's login-shell environment into the
extension host, so the bare `git-ai` resolves and `KnownHuman` records are written (16 of them on
the macOS probe repo). Windows GUI hosts do not inherit a login shell that way.

**No `cfg(windows)` gate exists anywhere in the `known_human` path.** The Rust is
platform-neutral; the divergence is entirely in how the binary is located.

## ONE FAULT, NOT TWO — a correction, recorded because the retraction is the useful part

An intermediate finding claimed a **second, independent** fault: that the binary itself does not
record `known_human` on Windows, evidenced by a full-path invocation returning `exit 0` and
writing nothing.

**That was refuted, and the refuting control is the lesson.** `pij-immediate-newt` ran the
*identical* payloadless invocation **on macOS**, where `KnownHuman` demonstrably works, and got
the *same* empty result. The source explains it: with no `--hook-input`, `git_ai_handlers.rs`
synthesizes a payload from CLI file arguments, and the `known_human` branch — unlike `human` —
does **not** discover dirty files. No file arguments means `edited_filepaths = []` and the preset
checkpoints nothing, **by design, on every platform**.

**The probe could not observe the opposite.** It was the same error this plan documents five other
instances of: a stimulus constructed by the prober, measuring the prober's model rather than the
machine.

**The positive control that settles it**, run on the Windows box in a throwaway repo:

```
git-ai.exe checkpoint known_human --hook-input stdin   (with a real JSON payload)
  -> exit 0
  -> working log KnownHuman records: 1
  -> daemon log: "checkpoint start kind=KnownHuman repo=C:\src\khprobe … status=ok"
```

**The binary, the preset, and the CLI-to-daemon named-pipe leg all work on Windows.** There is
exactly one fault, and it is the spawn.

## The fix — CONFIRMED BY MEASUREMENT

> **Prediction, registered before the fix:** add `%USERPROFILE%\.git-ai\bin` to the **user** PATH,
> restart Cursor, save a file in a repo. A `KnownHuman` checkpoint should appear in the daemon log
> within roughly one second (save + the 500ms debounce).

**Applied 2026-08-10** by `pij-immediate-newt` (`scratch/win/path-fix-gitai.ps1` — appends to the
user Path only, idempotent, no other entries touched), then **verified from a fresh process:**

```
USER Path contains .git-ai\bin   -> True   (read from the registry, not the session env)
where git-ai                     -> C:\Users\<user>\.git-ai\bin\git-ai.exe
git-ai --version                 -> 1.6.21
```

**Then confirmed end to end.** Cursor restarted, one hand edit and save in the probe repo:

```
before:  checkpoints = 31   KnownHuman = 0
after:   checkpoints = 32   KnownHuman = 1
```

Daemon log, both `KnownHuman` records ever produced on that machine:

```
07:30:16Z  checkpoint start kind=KnownHuman repo=C:\src\khprobe   <- the manual positive control
07:41:17Z  checkpoint start kind=KnownHuman repo=c:\src\cursor    <- THE EXTENSION'S OWN SPAWN
           checkpoint done  kind=KnownHuman duration_ms=212  status=ok  trace t_79a0a2b7a7b228
```

**That second record is the first extension-originated `KnownHuman` ever produced on this box**,
and it arrived within a second of a save, exactly as predicted. The lowercase drive letter
(`c:\src\cursor`) distinguishes the extension's spawn from the hand-run control.

**The prediction was published before the fix and confirmed after it. One spawn, one PATH entry,
one line of evidence.**

### This is an installer defect, and the report is evidence-complete

**git-ai's Windows installer places the binary at `%USERPROFILE%\.git-ai\bin` and never adds that
directory to PATH. Its own VS Code extension then spawns the bare name `git-ai` in production and
cannot find it.** Every document save fails `ENOENT` into the extension-host console, no
`KnownHuman` attestation is ever recorded, and human-authored lines are subsequently claimed for
the agent session on any agent-run commit.

Clean, one-line, reproducible, with a verified fix — and on a platform the vendor already labels
experimental and explicitly solicits feedback on. See
[`vendor-support-status-non-wsl-experimental.md`](./vendor-support-status-non-wsl-experimental.md).

### CLOSED — the acceptance run passed

**Commit `03a81310f7eaa8544ea148f803985b0e01e8c24d`**, `C:\src\cursor`: hand edits **and** agent
edits to `seed.mjs`, **commit run by the agent**. The note:

```
seed.mjs
  h_c6c79ed115e5e7                    19-21,63    <- THE HUMAN
  s_f1a6225dd0dc49::t_ed02d59ed5c4d0  64-67       <- the agent
  s_f1a6225dd0dc49::t_6c1ca1cf96e0b8  62          <- the agent
---
"humans":   { "h_c6c79ed115e5e7": { … } }
"sessions": { "s_f1a6225dd0dc49": { agent_id: { tool: "cursor", … } } }
```

**Both prefixes, same file, same commit, agent-run — the macOS counterexample reproduced on
Windows.** The note carries a `humans` block *and* a `sessions` block, which no Windows note in
this investigation had ever done.

**The defect is closed at all three layers:**

| layer | before | after |
|---|---|---|
| checkpoint | `KnownHuman` never recorded (0 of 31) | recorded on save, one second after |
| the `:661` gate | skipped the human sweep — no `h_` existed | landed `h_` flips it via the early return |
| outcome | human lines claimed for the agent | **human lines correctly attributed** |

**Nothing in the harness changed to achieve this.** One PATH entry, on a defect that was git-ai's
installer the whole time.

## The instrument that should have been used first

`~/.git-ai/internal/daemon/logs/<pid>.log` records **every** checkpoint the daemon receives:

```
INFO checkpoint received into bounded ingress   receipt_seq=10 retained_bytes=2231
INFO checkpoint prepared for family admission   trace_id=t_ce29c95ff2bf87 family=…\.git
INFO checkpoint start kind=Human repo=C:\src\cursor
INFO checkpoint done  kind=Human duration_ms=197
INFO checkpoint processing completed            status="ok"
```

**Kind, trace id, repo, duration and status, per checkpoint.** It answers "did a `KnownHuman`
ever arrive?" directly, and it existed for the whole investigation. Alongside the Cursor
**Output → Hooks** channel, these are the two vendor-supplied instruments this plan should have
opened before building any of its own.

## Still needing a human at the GUI

1. **Cursor → Help → Toggle Developer Tools → Console**, filter `[git-ai]`, save a file — expect
   `Save queued`, `Firing known_human checkpoint`, then a spawn **`ENOENT`**. Now
   **confirmation-only**, since the PATH probe already establishes the cause.
2. **Is the Cursor window native or WSL-remote?** (bottom-left indicator.) Relevant because both
   vendors treat WSL2 as the supported Windows path — see
   [`vendor-support-status-non-wsl-experimental.md`](./vendor-support-status-non-wsl-experimental.md).

## Artifacts left on the box

`C:\src\khprobe` and `C:\src\kh-payload-newt.json` — the positive-control repo and payload.
`C:\src\cursor` counts were deliberately left untouched by that control.
