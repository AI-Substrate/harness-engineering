# Ask: worktree for the git-ai collector migration (v1)

**From**: `pij-respectable-clam` (PM)
**To**: o-prime
**Date**: 2026-08-06

## What

A worktree to plan and land **v1 of the git-ai collector migration**.

Jordan's decision, this session: harness stops collecting its own telemetry and
delegates AI-attribution collection to **git-ai** (`github.com/git-ai-project/git-ai`,
Apache-2.0, cloned at `~/github/git-ai`).

## v1 scope, as ruled

1. **Harness telemetry capture is disabled by default at ship** — *disabled, not
   removed*. The kill switch already exists (`KILL_SWITCH_ENV =
   'HARNESS_NO_TELEMETRY'`) and is already enforced at the only three write paths
   (`capture-service.ts:632`, `sync-service.ts:559`, `housekeeping.ts:102`). v1
   moves its default off the env var into code/settings. The **read** side is not
   gated and stays live, so the 123 existing `refs/harness-telemetry/*` remain
   queryable.
2. **`harness doctor` gains the collector lifecycle** — detect git-ai, install from
   a **pinned** release (supply-chain + format-drift), run `install-hooks`, and
   re-check later when a new coding harness appears on the machine.
3. **No semantic/flow work in v1.** Explicitly out of scope.
4. **Fleet lineage goes dark until v2** — ruled and accepted.

v2 (later, not this worktree): read git-ai's richer *local* data and publish
harness's own data in an adjacent, git-ai-shaped notes ref.

## Why a worktree

Touches `harness/cli/src/services/telemetry/*` (gate default) and
`services/doctor/*` (the actual build). Telemetry-adjacent, so it should carry
recent main — **`bf58bea9`** (FX009) and the FX007 fix `e756d091` (#101) at minimum.

## Suggested branch

`s0XX-gitai-collector-v1` — ordinal at prime's discretion.

## Research already done (to be copied into the plan folder)

`scratch/gitai/` — six documents, all evidence-first with `file:line` citations:

| file | contents |
|---|---|
| `01-what-harness-captures.md` | harness's own capture surface, counts-only axiom |
| `02-gitai-capture-inventory.md` | git-ai's 19 stores, 7 event types, all fields |
| `03-gitai-agent-coverage.md` | 12 stream readers, 16 presets, 15 installers, blind spots |
| `04-gitai-push-and-filtering.md` | what reaches `refs/notes/ai`, what can be filtered |
| `05-gain-lose-ledger.md` | swap ledger (needs correction — see below) |
| `06-gitai-attribution-algorithm.md` | the algorithm + an adversarial critique |

**Known correction outstanding**: `05` overstates two git-ai gains and must be
reconciled against `06` before the plan phase — (a) the "honest untracked bucket"
is undermined by `attribution_recovery.rs:661-674`, which fabricates `h_`
known-human attestations with no evidence; (b) generated-vs-accepted is real as a
*measurement* but absent from the note, and `ai_additions = ai_accepted` at commit
level (`stats.rs:438-439`), so acceptance always reads 100%.

## Open decisions carried into the plan phase

1. Pinned-binary provenance — build from source at a recorded SHA, or mirror the
   artifact and verify against a hash we record? Their `SHA256SUMS` and
   `install.sh` come from the same host, so their checksum buys nothing.
2. Doctor's failure posture — with capture off there is no `degraded[]` envelope,
   so doctor is the **only** thing that can report collection is dark. Warn, or block?
3. **trace2 ruling** — git-ai's install does `git config --global --remove-section
   trace2` (the whole section, no backup) and re-does it on every `install-hooks`.
   Machine-wide. Do we use trace2, and will we cede it?
4. Sandboxed seats — git-ai's daemon refuses to start under `CURSOR_SANDBOX` /
   `CODEX_SANDBOX` / `SANDBOX_RUNTIME`; those seats collect nothing, silently.
5. Whether v1 records the **seat ↔ worktree ↔ git-ai session-id** mapping as a
   cheap hedge, so v2 can reconstruct fleet lineage retrospectively from git-ai's
   365 days of local data rather than starting cold. Offered, not yet ruled.

## Note for the doctor build

The probe that matters is **not** "is the daemon running". Every silent-failure
mode git-ai has passes a liveness check. The real signal is `git ai status --json`
showing a **recent checkpoint landed** for the current tree (`time_ago`,
`tool_model`). `install-hooks --dry-run` is verified non-mutating and reports
per-tool `not_found|installed|already_installed|failed`. `bg status` and `debug`
have no `--json` — do not parse them; read
`~/.git-ai/internal/daemon/daemon.pid.json` instead.
