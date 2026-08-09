# Delivery state — read this FIRST if you are picking 082 up cold

**Written**: 2026-08-09 · **By**: `pij-respectable-clam` (PM) · **Live at**: `3ba5e126`

Everything needed to *build* 082 is in `plan.dd.md`, `assets/research-dossier.md`,
`assets/workshops/hooks-installing.md` and `assets/backpressure-coverage.md`. **This file holds
the operational contract that lives nowhere else** — lose it and the work still ships, but into
the wrong branch, in the wrong shape, without the loop Jordan asked for.

---

## 1. The contract Jordan set (verbatim intent, 2026-08-09 evening)

- **Fleet**: pij coders on the **copilot** harness. **Coder = Opus 5, high effort. Reviewer =
  gpt-5.6-terra, high effort.** Fresh seats — deliberately not the ones that worked earlier today.
- **Three phases maximum.**
- **The loop**: plan → `/validate-v2` by subagent → phase-N tasks → `/validate-v2` by subagent →
  coder⇄reviewer until they agree → **commit and push between phases** → next phase. **While the
  reviewer works, the next phase's tasks get prepared** so the coder never idles.
- **Landing**: **CI green on the EXISTING PR — `#118`,
  https://github.com/AI-Substrate/harness-engineering/pull/118, branch `s077/suite-portability`.
  No new branch, no new PR.**
- **Both seats must use `/builder` themselves** — `/builder 5 tasks`, `/builder 6 implement`,
  `/builder 7 review`. Not optional.
- **Supervision**: watchdog on; at every ping, check the coder is progressing rather than looping
  or burning tokens.
- **Escalation**: pij Telegram if stuck. Otherwise autonomous overnight.
- **Testing**: hook install exercised for **every client** in the matrix; mine git-ai's own tests
  for fixture shape. **mac and Linux both verified**; **Windows handed to the remote agent on
  #108** and marked UNVERIFIED until they report.

## 2. THE MORNING DELIVERABLE (this is the acceptance test)

> *"When I wake up in the morning you will have the new hooks built and running on this machine,
> installed into Cursor, and a prompt 8 file I can run in there to validate this works straight
> up."*

So Phase 3 is not "wire up doctor and stop". It ends with:
1. `harness hooks install` **run for real on this machine**, writing our hook into
   `~/.cursor/hooks.json` — by our own verb, not by hand.
2. **`assets/poc/CURSOR-PROMPT-8.md`** — a paste-and-go prompt that validates the whole chain in
   one Cursor run, in the same shape as CURSOR-PROMPT-6/7 (probe + mixed commit + report).

**Back up `~/.cursor/hooks.json` before touching it.** It currently carries the POC hook plus
git-ai's own entries; both must survive or be deliberately replaced.

## 3. Seats

| Role | Seat | Harness / model |
|---|---|---|
| PM (me) | `pij-respectable-clam` | claude-opus-5 |
| Phase coder | `pij-bewildered-grouse` | copilot / claude-opus-5, high |
| Reviewer | `pij-native-krill` | copilot / gpt-5.6-terra, high |

Earlier seats `pij-nasty-mosquito` and `pij-exuberant-skaffen` are **finished but kept** — they
hold context on the collector auto-install and #144. Do not close them without asking.

**Baton**: `s077-gate` covers **commit AND full-tree gate runs** in this worktree. Take it for
both. Two seats share this checkout, so a gate certifies the holder's work only if the tree is
otherwise clean — say so in the evidence when it is not.

## 4. Corrections to the plan document itself

**The plan's Phase 1 brief says "needs a NEW socket port". That is WRONG and would cause a
duplicate.** `pij-bewildered-grouse` found `src/adapters/net/socket-probe-port.ts` (plan 074),
which already provides `SocketRelayPort.send(path, payload)`, `NodeSocketProbe` and
`FakeSocketRelay`. **Reuse it**; extend it if the emit needs a half-close. The constitution is
explicit — *"Re-implement a command the target repo already provides instead of wrapping it ❌"*
and P8 wrap-don't-rebuild.

## 5. Jordan's two design rulings, with the reasoning

- **What we write into a customer's agent config: an ABSOLUTE path to the harness binary,
  following git-ai's pattern.** Asked because bare `harness` breaks whenever the hook context's
  PATH differs from a login shell (nvm, a GUI-launched editor), while an absolute path breaks
  when npm relocates the binary on upgrade. Jordan: *"just follow git-ai I guess."* Mitigation is
  that `harness hooks status` detects a path that no longer resolves.
- **Node startup cost is a watch-item, not a design constraint.** Hooks fire on *every* tool call
  (~38 invocations across a 19-tool-call run) and Node starts far slower than git-ai's Rust
  binary. Jordan: *"we run harness command many times a session anyway."* Mitigation is to exit
  before loading anything on tool names that cannot be commit-bearing.

## 6. Traps that already cost time tonight

- **`just test` is the FAST scope** and skips 10 files; **`just test-all`** is what CI gates on.
  "Gate green" silently meant two different quantities after #155 landed. Always name which.
- **`harness plan new` scaffolds only 6 of the 20 schema-declared plan sections**, and neither
  `dd set` nor `dd add` can create a seventh (`E450 section-unknown`). The missing sections here
  were seeded mechanically once, then filled entirely through the CLI. A cold seat hits the same
  wall — this is filed as an `observe`.
- **`pij daemon start` blocks on an interactive `npx tsx` prompt inside the daemon's own tmux
  pane**, unreachable by `npm_config_yes`. It presents as a hang. `pij` and the daemon belong to
  `pij-continuing-ermine` — **ask them, do not restart it yourself.**
- **Assert on note IDENTITY per commit, never a note count.** Any unsandboxed commit in the repo
  moves the count.

## 7. What we are NOT fixing, and must not claim to

- **The absorption case** — human lines stamped AI — was **never reproduced**. Everything
  reproduced was *total loss*. Upstream `git-ai#2067` describes absorption and is open; we do not
  file upstream issues to git-ai. **Do not describe this work as fixing absorption.**
- **Claude Code's Bash-class tool calls record nothing** on an unsandboxed machine while
  Write-class works. Unexplained, separate, and possibly the real cause of the original
  complaint. Out of scope, recorded in dossier §7.5.

---

## 8. Open threads inherited from closed seats

**From `pij-exuberant-skaffen` (#144, closed 2026-08-09):**

- **UNMEASURED and most likely to be wrong**: whether Cursor *inherits or resets* a per-repo
  `<workspace>/.cursor/sandbox.json` that states no `default`. The #144 row chose the reading
  that assumes least and says so at the code. It is a choice, not a finding.
- **Every #144 case is a FAKE.** The `sandbox.json` parsing has never met a real Cursor file,
  and doctor was never re-run against Jordan's actual config to watch the row fire.
- **Jordan's Mac is short nine skill symlinks and `~/.git-ai/skills`**, removed by a git-ai
  `uninstall-hooks` run. Unrestored, and it is his call. Note `--skills` is **not sticky** —
  any future `install-hooks` without it removes them again (`install_hooks.rs:710-714`).

**From the plan-082 validation (`/validate-v2`, applied at `112cfa20`):** every finding was
applied, but one rests on an unverified premise worth re-testing during Phase 1 — that git-ai's
daemon would in fact *claim* a fast-forward/cherry-pick/revert transition rather than fail closed
under ownership rule 1. If the daemon rejects them, the class-(b) guard work is a documentation
gap rather than a correctness bug. **Design for the dangerous reading; measure it when the
live-daemon fixture exists.**
