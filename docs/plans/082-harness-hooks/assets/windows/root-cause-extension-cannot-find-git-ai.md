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

## The falsifiable fix prediction

> Add `%USERPROFILE%\.git-ai\bin` to the **user** PATH, restart Cursor, save a file in a repo.
> A `KnownHuman` checkpoint should appear in the daemon log within roughly one second
> (save + the 500ms debounce).

**Not yet run.** If it holds, the whole Windows attribution failure reduces to an installer
defect — git-ai's Windows installer places the binary but does not put its directory on PATH, and
its own extension then cannot find it.

If it does **not** hold, the extension is failing for some further reason and the extension-host
console is the next evidence.

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
