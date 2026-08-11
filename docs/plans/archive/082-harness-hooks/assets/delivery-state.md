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

---

# RESUME HERE — live state at 2026-08-09 ~01:15, written before a compaction

## Where the work actually is

```
cff8333a  Phase 1 tasks SETTLED after three validation rounds
firefly   pij-cautious-firefly — coder, live, pane %508 (right third of window @7)
          released onto the full 10-task list
reviewer  NOT SPAWNED YET. Spawn only when there is a commit range to review.
```

Commits so far, all docs — **no product code exists yet**:
`3ba5e126` plan+workshop · `f4296906` survey+delivery-state · `112cfa20` r1 findings + 3-phase
spine + tasks · `215eb68f` closed-seat threads · `8400e202` r2 rewrite · `cff8333a` r3 rewrite.

## THE ONE DESIGN FACT THAT MUST SURVIVE COMPACTION

**The commit guard discriminates on the INDEX STATE RECORDED AT PRE.** Everything else was
measured dead:

- parent-count catches only `--no-ff` merges
- the reflog subject catches ff-pull, cherry-pick, revert, amend
- **`.git` state does not exist when our hook runs** — `MERGE_HEAD` is never written by
  `merge --squash` at all, and `SQUASH_MSG` is unlinked by git *before its own post-commit hook*
  fires. Our agent hook is later still. Proven with a real post-commit hook.

**Seven transitions are byte-identical to a genuine authored commit** on all three mechanisms:
`merge --squash`, `cherry-pick -n`, `revert -n`, `git apply`, `checkout REF -- path`,
`restore --source`, `read-tree -m -u` (how `git subtree` works).

At PRE a genuine agent edit leaves a **CLEAN** index; every defeater leaves an **ALREADY-STAGED**
one. Only error mode is a false negative — the direction the doctrine demands.

**A human committing inside the PRE/POST bracket is indistinguishable and always will be.**
Nothing in git records who typed. It is an asserted KNOWN-BLIND row, not a gap to close.

### THE SECOND LAYER — added 2026-08-09, and it exists because a premise was wrong

Index-at-PRE only separates the seven defeaters from authorship **if the defeater ran BEFORE the
PRE that brackets the commit**. If a defeater and its commit happen inside ONE bracket, PRE sees
a clean index and the guard emits.

That was assumed rare on the grounds that each git command is its own tool call. **Measured
false.** Parsing `/tmp/cursor-hook-pre.jsonl` (76 records) on this machine, Cursor issues, as a
single `Shell` tool call:

```
git add -A && git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "…"
```

Chained with `&&`. So defeater-inside-one-bracket is the **normal shape**, not an edge case.

**The fix is in the payload we already receive.** The PRE record carries `tool_name` and
`tool_input.command`. `tk-000d` scans that command **per segment** (split on `&&`, `;`, `||`,
newline — the defeater and the commit are different segments, so a first-token scan misses it
every time) and refuses to emit when a segment names a content-importing operation.

It **narrows, it does not close**: a script, alias, shell function, Makefile target or heredoc
hides the operation. Those rows are asserted as **EMIT** and labelled KNOWN-BLIND. It is a
**second layer over** index-at-PRE, never a replacement — mutate each layer separately **and**
both together, or a single-layer negation passes while the other layer silently covers for it.

**Do not claim an over-emit fabricates authorship.** That is an inference nobody has measured.
Our six events tell the daemon a commit happened; the line-level split is git-ai's own, computed
from its checkpoint records. Whether an over-emitted squash-merge yields a wrong note, a note
with no agent lines, or a closed failure is **unmeasured**, and `tk-000d` records it rather than
asserting it.

## The loop — how to keep it going

1. **Coder reports per task** (not only at the end). On each report: read it, check the claim
   against the tree, correct or release.
2. **When Phase 1's tasks are all done** → spawn the reviewer:
   `pij spawn --harness copilot --model gpt-5.6-terra --effort high` and give it the commit
   range, not the branch. It must use `/builder 7 review`.
3. **Coder ⇄ reviewer until they agree.** Then take the baton, run the FULL gate, commit, push.
4. **While the reviewer works, write Phase 2's tasks** — same shape as Phase 1's, then a
   `/validate-v2` subagent pass over them before the coder sees them. Do not skip that pass:
   it found a Critical in all three rounds, including one that overturned my own fix.
5. **Advance the flight plan** — `harness flow status --path docs/plans/082-harness-hooks/the-flow.json
   --node phase-1 --to done`, then `nav set --now review-1`, and so on. Receipt every chore
   (comment first, status second) before departing a node.
6. **Answer every watchdog ping** with a real `pij report now`. It fires at 20m.

## How tonight is delivered

**Definition of done, in Jordan's words:** hooks built and running on this machine, installed
into Cursor, and a prompt-8 file he can run to validate — plus **CI green on PR #118**.

Order of operations:
1. Phase 1 (runtime) → review → commit + **push** → CI.
2. Phase 2 (installer) → review → commit + push → CI.
3. Phase 3 (doctor + LIVE install + docs) → review → commit + push → CI green.
4. Phase 3 ends by running `harness hooks install` **for real** on this machine (back up
   `~/.cursor/hooks.json` first — it holds the POC hook AND git-ai's own entries) and writing
   `assets/poc/CURSOR-PROMPT-8.md` in the shape of CURSOR-PROMPT-6/7 (probe + mixed commit +
   verbatim report).

**If time runs short, cut Phase 2's breadth, never Phase 1's guard.** A shipped installer with a
guard that fabricates notes is worse than no installer. The morning deliverable can be satisfied
with the runtime installed by hand into Cursor if `hooks install` is not ready — but say so
plainly rather than implying the verb did it.

## Running a validation pass (the pattern that keeps finding real defects)

Spawn a background `general-purpose` subagent; tell it to invoke `/validate-v2` via the Skill
tool with `--artifact <path>`; give it the plan, dossier, workshop and backpressure doc as
context; name **specifically what you want attacked**; and require it to distinguish CONFIRMED
from INFERRED, say what it checked and found clean, and end with its softest claim. Three rounds
so far, three sets of findings, each measured rather than argued.

## Operational traps (beyond §6)

- **A seat spawned into a narrow pane never binds.** firefly landed in 26x23, rendered its UI,
  created no session, and sat in `spawn-limbo` for 9 minutes with my packet queued at
  "delivery starts at bind". **`0 AIU on a live pane` means never-bound, not idle.** Fix:
  `tmux send-keys <pane> "ready" Enter` to force a first turn, then give it width.
- **`pij tail` is useless for copilot seats** — every tool call renders as a bare `⚙ bash`.
  Use `tmux capture-pane -p -t <pane>`.
- **`pij report now` has a 280-char limit** per field.
- **`dd add` needs JSON**, not bare strings; `satisfies` needs a full relative address
  (`../../../plan.dd.json#acceptance_criteria/ac-XXXX`); assertion ids mint with `--mint dw`;
  array rows without ids can only be rewritten wholesale via `set --value-json`.
- **`harness flow apply --ops` takes a FILE PATH** (or `-` for stdin) — **not** an inline JSON
  string. Passing the JSON directly gives `E301: --ops file not found or unreadable` with your
  whole payload echoed back as the "filename". The file's contents are a **bare array**, each op
  flat: `{op, id, ...fields}`; `upsert` creates or updates in one shape.
