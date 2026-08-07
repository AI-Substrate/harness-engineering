# Dogfood — git-ai installed live on Jordan's machine

**Date**: 2026-08-06 · **Seat**: `pij-respectable-clam` · **Machine**: darwin 26.5.2, arm64
**Authorised by**: Jordan, verbatim — *"as part of the review, install the hooks for
copilot cli and claude code and check that you can fire up new pij peers and see
telemetry"*, and on the trace2 question, *"i dont care about trace2, if it gets blown
away i dont care tbh"*.

This is the first real dogfood. Every claim below is an observation from this machine,
not a read of the source. Where it **contradicts or sharpens** a plan acceptance
criterion, that is called out.

---

## 1. What was installed, and how

Deliberately **not** via `install.sh` — `install.sh:325` calls `install-hooks` itself,
which is the exact moment ac-0008 says we must own.

| Step | Result |
|---|---|
| Pinned tag | `v1.6.21` (latest stable, released 2026-08-04) |
| Asset | `git-ai-macos-arm64`, 14,578,176 bytes |
| Expected SHA-256 | `78990a0929d1eb97243c3f1ce8db415442dfc72c3960fe328aa1c144d6c3f0d2` |
| Actual SHA-256 | **match** |
| Installed to | `~/.git-ai/bin/git-ai` + symlink `~/.local/bin/git-ai` |
| Version reported | `1.6.21` |

**This validates ac-0003 through ac-0007 by hand before the code exists.** The pin +
verify + install-without-their-installer path works exactly as specified.

## 2. ⚠️ `install-hooks --help` PERFORMS A FULL INSTALL

The single most important finding, and it was found by walking into it.

`git ai install-hooks --help` **installed everything** — no help text, no confirmation.
The mechanism is `parse_install_options` (`install_hooks.rs:357-388`):

```rust
match arg.as_str() {
    "--dry-run" | "--dry-run=true" => options.dry_run = true,
    "--verbose" | "-v"             => options.verbose = true,
    "--skills"                     => options.install_skills = true,
    ...
    _ => {}                        // ← every unrecognised arg silently ignored
}
```

`--help` is not a case, so it lands in `_ => {}` and the command runs with defaults.

**The consequence is worse than a missing help page: the safety flag fails open.**
`--dryrun`, `--dry_run`, `--dry-run=1`, `--dry-run true` — every near-miss spelling of
the flag that exists to prevent mutation performs a **real, silent, machine-wide
install**. Only two exact spellings work.

Same defect class as `_ => ToolClass::Skip` in the tool adapters (catalogued in
`03-gitai-agent-coverage.md`), but that one loses data — this one mutates the machine.

**Consequence for the plan**: doctor must never rely on a `--dry-run` spelling being
honoured. If we ever shell out with a dry-run intent, the exact two-token spelling is
the only safe form, and the result must be verified by re-reading the global git config
rather than trusted from the exit code. Worth an AC.

## 3. There is NO per-agent selector

Jordan asked for Copilot CLI and Claude Code specifically. The complete option set is
`--dry-run`, `--verbose`, `--skills`, `--visual-studio-extension`, `--api-base`,
`--api-key`. **Agent selection is not expressible.** It is all-or-nothing.

Ten agents were hooked in one invocation: Claude Code, Codex, Cursor, VS Code
(+ Insiders), GitHub Copilot, OpenCode, Pi, Gemini, Droid, Windsurf.

It also **installed a VS Code extension** (`git-ai.git-ai-vscode` v0.1.21) into *both*
Code and Code-Insiders, and rewrote both `settings.json` files.

**Consequence for the plan**: ac-0009's disclosure list is incomplete. It must also say
that hook installation cannot be scoped to chosen agents, and that it installs a VS Code
extension and edits editor settings files.

## 4. trace2 — the block branch could not be exercised here

Before install, trace2 was **empty in every scope** (global, system, local — verified via
`git config --list --show-origin`). So this run exercised only the *proceed* branch of
ac-0008. After install:

```
trace2.eventtarget  af_unix:stream:/Users/jordanknight/.git-ai/internal/daemon/trace2.sock
trace2.eventnesting 0
```

**Proving the block branch requires a planted trace2 value, and should be done in a
disposable HOME, never on a working machine.** Recorded as an open verification gap.

## 5. Re-invocation is idempotent

A second `install-hooks --skills` reported `already up to date` for all ten agents and
`already installed` for both extensions. Good — doctor's later re-check will not churn.

## 6. Skills

Three ship embedded: `ask`, `prompt-analysis`, `git-ai-search`. They install to
`~/.git-ai/skills/<name>/SKILL.md` and symlink into `~/.agents/skills/`,
`~/.cursor/skills/`, and — it honours `CLAUDE_CONFIG_DIR` (`utils.rs:430`) —
**`~/.claude-alt/skills/`**, i.e. the live one on this machine, not `~/.claude`.

Verified working: after install the three appeared as usable skills inside this very
Claude Code session.

**The name-collision hazard** (noted, not currently live): `remove_skill_link`
(`skills_installer.rs:103-116`) removes by *name*, and if the name is a real directory
rather than a symlink it calls `remove_dir_all`. Since `install-hooks` runs
`uninstall_skills` whenever `--skills` is **absent**, an ordinary invocation would delete
a user's own skill named `ask`, `prompt-analysis`, or `git-ai-search` from all three
directories. No collision exists today. Mitigation is trivial: always pass `--skills`.

## 7. ✅ ATTRIBUTION WORKS END-TO-END — both harnesses

A fresh `pij` peer was spawned into a scratch repo *after* hook installation:

```
pij spawn --harness copilot --model claude-sonnet-5 --effort low
→ pij-teenage-earthworm, bound to copilot session bcc232a5-06be-4076-b427-837fef2d839c
```

It edited `calc.py` and committed. The note at `refs/notes/ai`:

```
calc.py
  s_e5ad0f6fb287dd::t_2bb1ca92c6a91b 3-10
---
{
  "schema_version": "authorship/3.0.0",
  "git_ai_version": "1.6.21",
  "sessions": { "s_e5ad0f6fb287dd": {
      "agent_id": { "tool": "github-copilot-cli",
                    "id": "bcc232a5-06be-4076-b427-837fef2d839c",
                    "model": "unknown" },
      "human_author": "Jordan Knight <jakkaj@gmail.com>" } }
}
```

Line-level ranges, correct file, correct session. **The mechanism is real.**

### 7a. 🔑 The F7 join concern is RESOLVED — and v2 lineage is available

`pij` reported the bound copilot session as `bcc232a5-06be-4076-b427-837fef2d839c`.
git-ai recorded **the identical full UUID**. The two systems already share a join key,
with no bridge required.

The seed commit's note carries `id: ac636c44-4f8c-46ee-9404-05cb34298161` — **this
Claude Code session's own id**, the same one in this session's scratchpad path.

**So the seat ↔ git-ai-session join works for both harnesses, today, with no code.**
That materially cheapens the v2 hedge (open decision 5 in the exploration record): fleet
lineage goes dark in v1 as ruled, but v2 does *not* start cold — provided we retain the
pij registry, the join is reconstructable after the fact.

### 7b. Their bash stat-diff path is genuinely strong

The seed commit was written by **`printf … > calc.py` in a Bash tool call**, not by any
editor tool. git-ai still attributed lines 1-2 to `tool: "claude"` with the correct
session id. It caught a file created by shell redirection and tied it to the agent that
ran the shell. **We have nothing equivalent**, and this is the capability most worth
stealing.

### 7c. ✅ The `model: "unknown"` weakness reproduced LIVE

Predicted in `03-gitai-agent-coverage.md`; now observed:

| harness | model recorded |
|---|---|
| Claude Code | `claude-opus-5` — **correct** |
| Copilot CLI | **`"unknown"`** |

The peer was spawned with an explicit `--model claude-sonnet-5` and git-ai still recorded
`unknown`. **This is not a configuration mistake on our side — the model is simply not
recoverable from Copilot CLI through their path.** Combined with Copilot CLI having no
OTEL at all (no tokens, no cost, no latency — our `copilot-ledger` carries `nano_aiu`),
this is the sharpest measurable regression in the v1 swap, and it is now evidenced rather
than predicted.

## 8. Disk footprint — measured, and NOT the problem it first appeared

`~/.git-ai/internal/metrics-db` was **1.2 GB within minutes** of install, which looked
alarming. Sampled every 20s over two minutes: **completely flat**, no growth. It is a
one-time allocation, not a leak or a trace2 firehose.

Recorded because the first reading invites a wrong conclusion, and the correction is the
useful artifact. Stores present: `metrics-db` (1.2 GB), `transcripts-db`,
`bash-checkpoints-db`, each with `-shm`/`-wal` siblings.

## 9. Restart requirement

Install warned that already-running agents must be **restarted** for attribution to take
effect, listing 52 live Claude Code PIDs among others, and that prior work is attributed
as human.

**Consequence for the plan**: doctor cannot report "installed" as equivalent to
"collecting". A seat that was already running when hooks landed is silently uninstrumented
until it restarts. This is a **concrete instance of the gap ac-0012 defers**, and it
strengthens the case that simple health depth is the honest v1 posture — a liveness check
would pass for every one of those 52 processes while none of them were being captured.

---

## What this changes in the plan

| # | Finding | Action |
|---|---|---|
| 1 | `--help`/typo'd `--dry-run` performs a real install | **new AC** — never trust a dry-run spelling; verify by re-reading config |
| 2 | No per-agent selector; installs a VS Code extension; edits editor settings | **amend ac-0009**'s disclosure list |
| 3 | Running agents are uninstrumented until restart | **amend ac-000a/ac-0012** — name restart explicitly |
| 4 | Session-id join works today, both harnesses | **note against v2** — lineage is reconstructable; keep the pij registry |
| 5 | trace2 block branch unexercised | open verification gap — needs a disposable HOME |
| 6 | Copilot CLI model is unrecoverable | evidence for the losses section, no plan change |

## Reversibility

`~/.gitconfig` was **not** backed up before the accidental install — the `--help`
invocation pre-empted the backup step. Restoring is nonetheless a two-line operation,
since the only additions are the two trace2 keys:

```bash
git config --global --unset trace2.eventTarget
git config --global --unset trace2.eventNesting
```

Full removal additionally: `git ai uninstall-hooks`, `rm -rf ~/.git-ai`, and remove the
three skill symlinks from `~/.agents/skills`, `~/.cursor/skills`, `~/.claude-alt/skills`.
