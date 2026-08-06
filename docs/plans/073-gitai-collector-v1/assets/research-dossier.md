# Exploration record — git-ai as harness's telemetry collector

**Stage**: `1a explore` (builder). **Date**: 2026-08-06.
**Seat**: `pij-respectable-clam` (PM). **Human**: Jordan Knight.

This is the decision trail of the exploring conversation, kept because the *order* of
the rulings matters to the plan and is not recoverable from the six evidence
documents alone.

---

## How this started

Immediately upstream of this work: **FX009** — Cursor's `Write`/`StrReplace`
vocabulary went unextracted, so sessions that wrote hundreds of lines published a
**confident 0.0% agent share**. Not a gap: a wrong number. Fixed and merged as
`bf58bea9` (#103).

That defect is the frame for everything below. The question Jordan brought was not
"can we measure AI contribution" — we can — but "should we keep being the ones who
maintain per-agent tool-name registries in order to do it."

Then: *"please pull `github.com/git-ai-project/git-ai` to ~/github then review what it
does."*

---

## What was found

Six evidence documents, all `file:line` cited, in this folder:

| # | Document | One line |
|---|---|---|
| 01 | `01-what-harness-captures.md` | harness's own surface — the **counts-only** axiom |
| 02 | `02-gitai-capture-inventory.md` | 19 stores, 7 event types, every field |
| 03 | `03-gitai-agent-coverage.md` | 12 stream readers, 16 presets, 15 installers, blind spots |
| 04 | `04-gitai-push-and-filtering.md` | what reaches `refs/notes/ai`; what can be filtered |
| 05 | `05-gain-lose-ledger.md` | the swap ledger (twice corrected — see below) |
| 06 | `06-gitai-attribution-algorithm.md` | the algorithm, plus an adversarial critique |

Four subagents produced 02/03/04/06 in parallel; 01 and 05 are direct reads.

### The three findings that actually moved the decision

1. **git-ai's Cursor allowlist is `Write | Delete | StrReplace | ApplyPatch`** —
   independent confirmation that the FX009 fix was right *and* that
   `ApplyPatch`-only had been genuinely incomplete.
2. **git-ai reached our own conclusion independently**: match on SHA, never on
   timestamps. Their spec bans reflog-timestamp matching by name, with a postmortem
   — *"These were implemented, found unsound, and removed. Do not reintroduce."*
3. **They carry the same defect class we do** — every adapter ends
   `_ => ToolClass::Skip`. Breadth is not immunity. But they cover 12 agents to our
   5, and they have a bash stat-diff path we have nothing equivalent to.

---

## The rulings, in order

Each of these is Jordan's, made in this conversation.

| # | Ruling |
|---|---|
| R1 | **git-ai becomes the collector.** |
| R2 | **v1 removes/disables *all* harness telemetry.** No semantic or flow capture in v1 — explicitly out of scope. |
| R3 | **Doctor owns the lifecycle** — detect, install, install hooks, and re-check later when a new coding harness appears on the machine. |
| R4 | **Pin the git-ai release** — against supply-chain risk *and* format drift. |
| R5 | **Disable, don't delete.** Revised R2 mid-conversation: v1 turns capture off rather than cutting it out, so v2's migration is easier. |
| R6 | **Disabled by default at ship** — not via an env var the user must set. |
| R7 | **Fleet lineage goes dark until v2** — accepted knowingly. |
| R8 | **v2 (later)**: use git-ai's richer *local* data as the source, build harness's data on top, and ship it **adjacent, in their formats**. |

### Concerns raised and their disposition

- **"This deletes most of what the telemetry is for"** — raised: git-ai has no notion
  of gates, findings, chores, flow stages, artifacts, marks, phases, or
  agent-vs-human time (18 event kinds, 58 counters, zero counterpart). Jordan
  reaffirmed R2 and scoped it as deliberate. **Proceeding as ruled.**
- **"Pinning kills the only auto re-check"** — accepted, and it is *why* R3 exists.
  git-ai's sole automatic hook re-check is the auto-updater re-running `install.sh`;
  there is no hook-check code in the daemon at all.
- **"Silent failure is what FX009 taught us to fear"** — noted, unresolved by design.
  In v1 there is no `degraded[]` envelope, so doctor is the only possible
  truth-teller. Carried into the plan phase as an open decision.

---

## What v1 turned out to cost — the pleasant surprise

`R5` is nearly free, because the machinery already exists:

- `KILL_SWITCH_ENV = 'HARNESS_NO_TELEMETRY'`, already enforced at **exactly** the
  three write paths — `capture-service.ts:632` (*"short-circuits to ZERO side
  effects"*), `sync-service.ts:559`, `housekeeping.ts:102`.
- **The read side is not gated.** `telemetry pull`, `report`, and the
  published-telemetry reader never check it. So capture-off / read-on is already the
  shape of the code, and the 123 existing `refs/harness-telemetry/*` stay queryable.
- The only change needed is where that gate takes its **default** from (code/settings
  rather than env), per R6.

Blast radius if we had cut instead: 26,562 lines of service code, 1,973 of acts,
~39,791 of tests — but only **4 files** outside `services/telemetry` reference it.
Worth recording: the amputation *would* have been clean if we ever want it.

---

## The probe ladder for doctor (verified, carried into planning)

The rung that matters is **not** "is the daemon running" — every silent-failure mode
git-ai has passes a liveness check (sandboxed seat, hooks installed after session
start, tool name not in the allowlist, checkpoint IPC failing → `exit(0)`).

| Rung | How | Notes |
|---|---|---|
| Binary + pinned hash | ours | see open decision 1 |
| Hooks current | `install-hooks --dry-run` | **verified non-mutating**; per-tool `not_found\|installed\|already_installed\|failed` |
| Daemon alive | read `~/.git-ai/internal/daemon/daemon.pid.json` | `bg status` and `debug` have **no `--json`** — do not parse them |
| **Collection actually happening** | `git ai status --json` | **the real signal** — a recent checkpoint for this tree, with `time_ago` + `tool_model` |
| Format drift | note at HEAD | assert `schema_version == authorship/3.0.0` |
| Deep check | `git ai debug` | synthetic repo, end-to-end; occasional, not per-session |

---

## Open decisions entering the plan phase

1. **Pinned-binary provenance** — build from source at a recorded git SHA, or mirror
   the artifact against a hash we record? Their `SHA256SUMS` and `install.sh` come
   from the same host, so their checksum proves nothing.
2. **Doctor's failure posture** — warn, or block? It is the only truth-teller in v1.
3. **trace2** — git-ai's install runs `git config --global --remove-section trace2`:
   the entire section, no backup, machine-wide, re-applied on every `install-hooks`.
   Do we use it, and will we cede it? *Flagged to prime as possibly its ruling.*
4. **Sandboxed seats** — do any pij seats run under `CURSOR_SANDBOX` /
   `CODEX_SANDBOX` / `SANDBOX_RUNTIME`? Those collect nothing, silently, forever.
5. **The v2 hedge** — should v1 record the **seat ↔ worktree ↔ git-ai session-id**
   mapping? Near-free now (pij already has a registry); without it v2 starts cold
   instead of opening with a year of joinable fleet data. *Offered, not yet ruled.*

---

## Things worth stealing regardless of the adoption decision

- **The attribution fuzzer** — an *independent* expected-attribution model that never
  reads notes or blame, unique Unicode identity per line, asserting all three classes
  after every commit and every rewrite. We have nothing of this shape.
- **`patch_id`-style content identity**, so an attribution join can survive a rebase.
- **A real untracked class**, so human stops being a residual — done properly, which
  git-ai does not (see the `h_` fabrication in 06 §7.1).

---

## Standing caution for anyone reading 05

`05` was **corrected twice** after `06` landed, and both corrections went against
git-ai. If you are reading a cached or quoted version of it, check for the
`⚠️ CORRECTED` markers. The short form: their "known human" class is fabricated by
the recovery ladder wherever no AI attestation exists, and their generated-vs-accepted
figure is real as an internal measurement but absent from the note, with
`ai_additions = ai_accepted` at commit level so acceptance always reads 100%.
