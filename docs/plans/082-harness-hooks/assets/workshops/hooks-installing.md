# Workshop — how our hook installer will work

**Date**: 2026-08-09 · **Status**: AUTHORITATIVE design decisions for Phase 2 · **Basis**: a
full read of git-ai `~/github/git-ai` @ `7df7e206` (v1.6.22) by subagent raid, cited file:line
throughout the source notes below.

> **Version safety, established not assumed**: `git diff v1.6.21..HEAD -- src/mdm
> src/commands/install_hooks.rs src/commands/checkpoint_agent/` returns **empty**. The install
> and parse surfaces are **byte-identical** between the checkout and our pinned v1.6.21, so
> everything here applies to the pin with no caveat.

---

## 1. The decision this workshop exists to make

git-ai already installs hooks into 15 targets. We are not copying it — we are taking its
**shape** and fixing what it gets wrong. The raid found four cross-cutting behaviours we must
NOT reproduce, and they are the reason this is a workshop rather than a port.

| git-ai does | consequence | **we do** |
|---|---|---|
| **No backups anywhere** (`grep -rni "backup\|\.bak" src/mdm/` → zero matches) | `write_atomic` is atomic against a *crash*, not against git-ai being *wrong*. Prior content is gone. | **Always back up before first write** to a file we did not create, and name the backup in the output. |
| **Full re-serialization**, and `serde_json` is declared without `preserve_order` | `Value::Object` is a `BTreeMap`, so **every install alphabetically re-sorts the user's entire settings file**. Droid reads JSONC and writes plain JSON, destroying comments — its own code says so. | **Comment- and order-preserving writes.** git-ai has exactly one such writer (`utils.rs:747-786`, a `jsonc_parser` CST round-trip) — that is the pattern, applied everywhere. |
| **Ownership predicate is two substrings**: `cmd.contains("git-ai") && cmd.contains("checkpoint")` (`utils.rs:519-522`), used **bare** by Claude, Gemini, Droid, Windsurf | `uninstall-hooks` silently deletes **any** user hook whose command mentions both words. | **An explicit owned marker** we write and match on. Never a substring heuristic over someone else's command. |
| **Seven installers interpolate an unquoted path** into a shell string | A git-ai install path containing a space produces a broken hook (Claude, Codex, Cursor, Windsurf, Gemini, Droid, Firebender). Only Copilot and Cline quote. | **Always quote**, and normalise Windows paths — git-ai only does the latter in 3 of 15. |

**The uninstall asymmetry is the fifth.** Nearly every git-ai installer prunes emptied blocks on
*install* but leaves empty matcher blocks, empty event arrays and the `hooks` object behind on
*uninstall*. Gemini never reverts `tools.enableHooks`; VS Code never reverts `chat.useHooks`;
Droid leaves `claudeHooksImported: true`. **Our uninstall restores what our install changed —
symmetry is a test, not an aspiration.**

---

## 2. Our installer model

### 2.1 One declarative matrix, four write strategies

git-ai has 15 bespoke `.rs` files. The raid shows they collapse into **four strategies**, and
that is the abstraction we build:

| Strategy | Agents | What it writes |
|---|---|---|
| **A — JSON config merge** | claude-code, cursor, gemini, droid, firebender, github-copilot, windsurf | an entry under an events key in a shared JSON file |
| **B — TOML config merge** | codex | inline `[[hooks.*]]` + a feature flag + sha256 trust state |
| **C — plugin file** | amp, opencode, pi | a whole TypeScript file with our binary path substituted |
| **D — script file** | cline | two `/bin/sh` scripts named for the events, mode 0755 |

Everything varies inside a strategy by **data**, not code: config path, event names, entry
shape, casing. That is the matrix.

**Strategy D carries the one guard git-ai got right and we should copy verbatim**:
`ensure_hook_script_is_writable` (`cline.rs:212-223`) **refuses** to overwrite a file lacking
git-ai's marker rather than clobbering it. Amp does the opposite — `fs::remove_file` on
uninstall with **no marker check** (`amp.rs:114-133`). Cline's posture is ours, everywhere.

### 2.2 Event names are per-agent data, and they are not consistent

Do not assume `PreToolUse`. The raid's consolidated table:

| Agent | Events |
|---|---|
| claude-code, github-copilot, droid, cline | `PreToolUse` / `PostToolUse` (Pascal; Cline as **filenames**) |
| cursor, firebender | `preToolUse` / `postToolUse` (**lowerCamel**) |
| gemini | **`BeforeTool` / `AfterTool`** |
| codex | `PreToolUse` / `PostToolUse` / **`Stop`** |
| windsurf | 5 Cascade events: `pre_write_code`, `post_write_code`, `pre_run_command`, `post_run_command`, `post_cascade_response_with_transcript` |
| amp / opencode / pi | plugin API events, translated in the plugin body |

### 2.3 Config paths — and the env overrides that move them

| Agent | Path | Override |
|---|---|---|
| claude-code | `~/.claude/settings.json` | `CLAUDE_CONFIG_DIR` — used **verbatim as the dir**, no `.claude` appended |
| codex | `~/.codex/config.toml` | `CODEX_HOME` verbatim |
| gemini | `~/.gemini/settings.json` | `GEMINI_CLI_HOME` points at the **home root**, `.gemini` IS appended |
| cursor | `~/.cursor/hooks.json` | none |
| github-copilot | `~/.copilot/hooks/git-ai.json` | none (legacy `~/.github/hooks/` deleted) |
| droid | `~/.factory/settings.json` | none |
| firebender | `~/.firebender/hooks.json` | none |
| windsurf | `~/.codeium/hooks.json` **and** `~/.codeium/windsurf/hooks.json` | none |
| amp / opencode / pi | `~/.config/amp/plugins/`, `~/.config/opencode/plugins/`, `~/.pi/agent/extensions/` | **none — no `XDG_CONFIG_HOME` support**, and `~/.config` even on Windows |
| cline | `~/Documents/Cline/Hooks/{Pre,Post}ToolUse` | **no-op on Windows** |

**Note the two overrides behave differently** (`CLAUDE_CONFIG_DIR` = the dir itself,
`GEMINI_CLI_HOME` = its parent). Getting that backwards writes to the wrong place silently.

### 2.4 Detection — and a trap to avoid

git-ai marks an agent present if **a binary is on PATH OR a marker dir exists**. Three
installers additionally check a **relative** path — `amp.rs:48`, `opencode.rs:48`, `pi.rs:41`
test `.amp` / `.opencode` / `.pi` **in the current working directory**. That makes detection
**cwd-dependent**: running the installer from a directory that happens to contain such a folder
marks the agent installed.

**We use absolute markers only.** And per `f5ce89ff`, `status` reports what we can **evidence**
(a file we can show we changed), never what we merely believe.

### 2.5 What we write into the config

**An absolute path, following git-ai** (decided with Jordan). git-ai resolves it via
`current_exe()` → `canonicalize()` → strip the Windows `\\?\` prefix (`utils.rs:718-725`), and
shapes it for Windows shells with `normalize_windows_path_for_shell` (`utils.rs:692-715`,
`C:\x\y.exe` → `C:/x/y.exe`). We do both **for every agent**, plus quoting — git-ai normalises
in only 3 of 15 and quotes in only 2.

The command form mirrors git-ai's, with our verb:

```
"<abs harness path>" hooks fire <agent> --phase pre|post --hook-input stdin
```

---

## 3. Scope decisions

**IN — strategy A first (7 agents), then C (3), then D (1).** Strategy B (codex) is deferred:
its sha256 trust-state model embeds **positional indices** that go stale (`codex.rs:344-347`),
and whether its trust hash even matches what Codex computes is **unresolved from the source**.
That is a workshop of its own, not a task.

**OUT — the IDE-level trio.** `jetbrains` installs an IntelliJ plugin and never upgrades it
(existence-check only, `detection.rs:723-730`); `visual-studio`'s installer is a **TODO stub**
that always falls through to a manual message (`visual_studio.rs:345-352`); `vscode` writes **no
hooks at all**, only two settings booleans and an extension. None of them carry a hook we can
fire, so none are in our matrix.

---

## 4. Tests — the backpressure this needs before the installer exists

Per the harness doctrine (§6 of `the-harness-distilled.md`): *"sometimes the right outcome is
stopping to build backpressure first."* Installing into 15 shared config files has **no
deterministic sensor today**. These are the sensors, and they come first:

1. **Per-agent fixture round-trip** — for every agent in the matrix: a realistic pre-existing
   config, install, assert the exact resulting bytes.
2. **Foreign-content survival** — install into a config that already holds **git-ai's own
   hooks** plus an unrelated tool's, and assert both survive **byte-identical**.
3. **Comment and key-order preservation** — a JSONC config with comments and non-alphabetical
   keys must come back with both intact. This is the test that fails against git-ai's design and
   must pass against ours.
4. **Idempotency** — install twice, assert the second write is a no-op and the file is
   byte-identical.
5. **Uninstall symmetry** — install then uninstall returns the file to its **original bytes**,
   including removing containers we created and restoring flags we flipped.
6. **Unmanaged-file refusal** — a hook file lacking our marker is refused, not clobbered
   (Cline's posture).
7. **Path with a space** — the written command survives a binary path containing spaces.

**Mine git-ai's own tests for fixtures**, not just its source — e.g. `claude_code.rs`,
`firebender.rs:475/:516`, `utils.rs:944-961` (the comment-preservation regression) and
`utils.rs:1245` (the `#1413` Windows path-shape regression) are ready-made cases.

**Platform coverage**: mac and Linux both proven in CI/local before Phase 2 closes; **Windows
handed to the remote agent** and marked UNVERIFIED until they report.

---

## 5. git-ai defects worth knowing (do not inherit)

Recorded because each is a trap our implementation could fall into by imitation:

- `install-hooks` prints **"Dry-run mode (default)"** but the default is **not** dry-run
  (`install_hooks.rs:719` vs `:19-27`) — a stale message that misleads about destructiveness.
- `configure_daemon_trace2` **wipes the user's entire global `trace2` section**
  (`install_hooks.rs:271`) before writing its two keys — any `trace2.normalTarget` etc. is
  destroyed with no backup.
- `--skills` is **not sticky**: omitting it on a later run *uninstalls* previously installed
  skills (`:710-714`). (This is what removed Jordan's nine skill symlinks.)
- `uninstall-hooks` ignores the installer filter (`:885`), so on Windows it touches Visual
  Studio even though install would have skipped it.
- `MIN_CODEX_VERSION` is a **dead constant** — declared, never read.
- `check_hooks` for Claude, Cursor and Gemini reads **only the pre-event**, so a missing or
  stale post-event hook is invisible.
