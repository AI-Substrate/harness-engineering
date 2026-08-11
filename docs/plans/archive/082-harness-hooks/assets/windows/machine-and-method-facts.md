# ADDENDUM — reusable facts from the Windows/Cursor diagnostic (plan 082)

**From**: `pij-used-narwhal` · **2026-08-10** · Companion to
`BRIEF-082-hook-parse-failure-is-unobservable.md`

Things learned during the diagnostic that are **not** about the defect and would otherwise be
lost when the Windows thread closes. Each is stated with what it costs you if you do not know it.

---

## 1. VM TRAP, NEW — non-ASCII in a `.ps1` on the Parallels share kills the parser

The handover documents quoting breaking three ways across `prlctl exec`. This is a fourth trap,
and it presents as a **lie**:

```
The string is missing the terminator: '.
    + CategoryInfo : ParserError ... TerminatorExpectedAtEndOfString
```

The reported line and character are **not** where the problem is. In both cases I hit, the cause
was **non-ASCII characters** (em dashes in comments) in a `.ps1` read off `\\Mac\Home\…`. Quotes
were balanced; the error names quoting anyway.

**Rule: scripts staged on the Mac share for guest execution must be ASCII-only, including
comments.** Cost of not knowing: two rounds of hunting a quoting bug that does not exist, at
20–90s per `prlctl` round trip.

## 2. `git-ai`'s checkpoint debug log is a STRONG POSITIVE and a WEAK NEGATIVE

`~/.git-ai/checkpoint-debug-logs/<date>.log` records a verbatim `hook_input` — but only **after a
successful preset parse** (`orchestrator.rs:195` parses with `?`, `:226` logs), and **only when
the `checkpoint_debug_log` feature flag is on** (`orchestrator.rs:221-227`).

- An entry **proves** git-ai parsed that payload.
- **An empty or absent log proves nothing** — it is equally consistent with "never fired" and
  "flag off".

Cost of not knowing: reading an absent log as evidence of a dead hook. I nearly did.

## 3. Discriminating git-ai's HOOK channel from its VS CODE EXTENSION channel

Both channels write checkpoints into the same working log, so the file alone will not tell you
which produced a record. Two discriminators, both verified on the machine:

| signal | meaning |
|---|---|
| `agent_metadata.tool_use_id` present | came through `CursorPreset` (`cursor.rs:140`) |
| `agent_id.tool == "cursor"` | same |

And the extension, measured in `~/.cursor/extensions/git-ai.git-ai-vscode-<v>/out/`:

| check | count |
|---|---|
| references to the `cursor` preset | **0** |
| emissions of `tool_use_id` | **0** |
| presets it DOES invoke | `ai_tab`, `known_human`, `human` |

**So a checkpoint carrying `tool_use_id` came from the hook, not the extension.** This is
platform-independent and reusable on macOS.

> The extension also self-suppresses: *"VS Code 1.109.3+ supports built-in Copilot hooks, so our
> extension should stop emitting legacy before_edit/after_edit checkpoints to avoid duplicate
> attribution"* (`out/utils/vscode-hooks.js`). Worth knowing before attributing a missing
> checkpoint to a broken extension.

## 4. What Cursor's hook payload actually contains on Windows

Measured, Cursor 3.15.6, `postToolUse` (field names only — values omitted deliberately; the real
payload carries `user_email` and `transcript_path` and must not be pasted into tracked files):

```
conversation_id · generation_id · model · tool_name · tool_input{command,cwd,timeout|file_path,content}
tool_output · duration · tool_use_id · cwd · session_id · hook_event_name · cursor_version
workspace_roots[] · user_email · transcript_path
```

Two notes that cost time if unknown:

- **`tool_use_id` can contain a literal newline** (`call_…\nctc_…`), so a line-oriented log
  reader will split one payload across two lines. Mine did.
- **`workspace_roots` uses `/c:/src/cursor` form** while `tool_input.cwd` uses `C:\src\cursor`.
  git-ai normalises the former (`normalize_cursor_path`); our parser reads `tool_input.cwd`
  first, so it never depended on the difference — but anything reading `workspace_roots[0]` does.

## 5. Windows platform status is no longer "EXPECTED-UNVERIFIED" for the hook path

`gitai-06-two-channel-model.md` records the Windows install path as **EXPECTED-UNVERIFIED**
("it has not yet been run on a real Windows machine"). That is now out of date for Channel A:

| link | Windows status, measured 2026-08-10 |
|---|---|
| Cursor invokes the configured hook command | **VERIFIED** — 10 invocations captured |
| stdin payload delivered | **VERIFIED** — 673–962 bytes, both phases |
| git-ai's hook parses and writes checkpoints | **VERIFIED** — BOM stripped, checkpoints written |
| **our** hook parses | **VERIFIED** since `46b0dd00` — was BROKEN (BOM not stripped, silent) |
| **our** hook journals a truthful outcome | **VERIFIED** — `strippedBom: true` on every entry |
| **our** relay detects a commit and emits | **VERIFIED** — `{"kind":"emitted","head":"51769645…"}` |
| trace2 named-pipe transport reachable | **VERIFIED** earlier (`net.connect` → CONNECTED) |
| a note is produced for an agent commit | **VERIFIED** — note written for `5176964` |
| **attribution is CORRECT for a same-file mixed commit** | **FAILS** — see `FINDINGS-082-same-file-mixed-commit-windows.md`. Not ours: git-ai attribution semantics |

**Channel A is closed end-to-end on Windows.** What remains broken is attribution *semantics* for
same-file mixing, which the kit already documents as trustworthy at **commit granularity** only.

The `buffer + nudge` recovery remains genuinely absent on Windows — that part of the doc stands,
and `harness commit` now has a live observation of the third outcome shape
(`ingress-unverified`) on the platform it was written for.

**Suggested edit belongs to whoever owns the doc's branch, not to me** — the file lives in the
`s077` tree and this is a scratch report.

## 6. What `harness doctor` says about that machine — quoted, because two rows are new

Run 2026-08-10 in `C:\src\cursor`, after the acceptance test (safe by then — before it, `doctor`
could have rewritten the config under test).

**`cursor-sandbox` — the macOS/Windows difference, finally written down:**

> `cursor-sandbox — cannot-tell: Cursor's terminal allowlist could not be read
> (C:/Users/jordanknight/.cursor/permissions.json does not exist), so whether `git` and `harness`
> run outside the sandbox is UNKNOWN — this is not a report that anything is wrong`

Every macOS run had `{ "terminalAllowlist": ["git","harness","node"] }` from run 1 onward. **This
Windows box has no `permissions.json` at all**, and Cursor's classifier errored on every git
command until auto-approve was set in the UI. **The row reports UNKNOWN rather than claiming
safe, which is the row behaving exactly as designed** — and it is the honest-absence pattern this
plan keeps rediscovering.

**`gitai-collector` — the documented warn case, behaving correctly:**

> `hooks-incomplete — hooks remain installed and collecting for 1 EVIDENCED agent(s) (cursor),
> but Copilot CLI is NOT instrumented — the automatic re-install was blocked because a global
> trace2 config was observed present`

Harness declines to delete a global `trace2` section it did not create. Working as specified.

**`attribution-at-risk`** names `df96cea8` as noteless — the pre-git-ai human seed, expected and
documented.

**`extensions: none`** — which is *why* `validate-attribution` gives E149 in the guest.

## 7. A REGEX OVER A TEXT DUMP IS A TEXT-MODE INSTRUMENT

*(Recorded jointly by `pij-used-narwhal` and `pij-respectable-clam` — we both hit it, from
different machines, on the same artifact.)*

Scoring trace ids with a bare `t_[0-9a-f]+` over a note dump **also matches inside
`git_ai_version`** (`git_ai` → `t_a`, stopping at the non-hex `i`). It reports a trace id that
does not exist, and — worse — scores it as **OBSERVED**, because the checkpoint logs contain the
same string.

Both of us printed `t_a`. One dismissed it as noise from a truncated pattern; the other chased
it. **Neither of us was careless; the artifact simply looked like noise.**

The generalisation, which is the same lesson as the BOM in a different costume:

> **A regex over a text dump is a text-mode instrument.** Match structurally — here, only after
> `::` in an author id — or you are measuring your pattern, not the data.

Fix: `'::(t_[0-9a-f]+)'`. Both scorings were re-run corrected.

## 8. The probe repo's state, for whoever runs next

### THE WAY BACK, if a deploy goes sideways mid-flight

**The box currently routes our two hook entries through `C:\src\hookwrap.ps1` (a diagnostic
wrapper). `~/.cursor/hooks.json.pre-wrap` IS THE RESTORE.** Copy it over `hooks.json` and restart
Cursor and the machine is back to the shipped configuration. `.pre-f008-manual` is the older
pre-wrapper state if you need to go further back.

Recorded here rather than only in a message, because a recovery path that lives in a chat log is
not a recovery path.

**Also: do NOT run `harness doctor` on that box while an acceptance test is set up.** A bare
`doctor` auto-installs the collector and can re-run the hook installer, silently rewriting the
config under test. `npm install -g` is safe — no postinstall touches agent configs — but `doctor`
is not.

### Everything else

- `C:\src\cursor` — **not perturbed by any of my fires.** Every hand fire was retargeted to a
  throwaway `C:\src\parseprobe`, which I created. Its recorded-head state is as the real session
  left it.
- The staged quote falsifier (`install-quote-test.ps1`, `hookwrap-v2.ps1`) was **never
  installed** and should not be.
- Artifacts left in the guest: `C:\src\parseprobe`, `p-bom.json`, `p-clean.json`,
  `payload.json`, `payload-gitai.json`, `split.js`, `split2.bat`, `hook-stdin.log`.
- **No route to `registry.npmjs.org` from that box.** `npm config set registry
  https://packagefeedproxy.microsoft.io/npm/` must precede any npm install, or npm **hangs**
  rather than failing fast — which reads as a slow install, not a broken one.

---

## The one instrument rule worth carrying to the next diagnostic

**A text-mode instrument cannot report bytes.** If the question is "which bytes exactly", write
raw bytes to a `.bin` and hex-dump the file — no decode between the wire and the claim. And when
an instrument produces a surprising reading, **feed it a known input and check it renders that
correctly** before building a theory on its output. That control is what closed this, and it
would have closed it two hours earlier.
