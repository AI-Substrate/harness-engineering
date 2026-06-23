# Research Dossier — Harness Telemetry Collection (034)

**Generated**: 2026-06-23 · **Mode**: Pre-Plan · **FlowSpace**: not used (standard tools) · **Subagents**: 6 (CLI, records/measures, extensions, git/ship, testing, prior-learnings) + proven probes in `scratch/telem/`

## Executive Summary

**What we're building**: a sensor layer that auto-captures per-session `segment` records (tokens, skills, tools, subagents, files, plan-links) on every harness command, across heterogeneous agent harnesses (Claude Code, Copilot CLI; Cursor later), and persists them for the eng-thrive measurement program — *emit + commit*, no daemon, no OTel collector.

**The headline finding**: this repo already has 80% of the substrate. The **record system** (`.harness/records/<type>/<date>/<NNN>-slug.md`), the **8-key auto-stamped provenance contract**, the **`harness record <type>` verb**, the **hexagonal ports/DI + arch-check** discipline, and — critically — **`docs/how/harness-value-measures.md`, the eng-thrive contract this telemetry feeds**, all exist. We are *extending* a designed system, not inventing one. That reframes the work and exposes three tensions (below) that are more important than any new code.

**Three tensions the plan MUST resolve** (each is a thesis-level decision, not a detail):
1. **Individual attribution vs. house anti-surveillance doctrine** — our grilled decision said per-user identity + per-user reports; the repo's measures doctrine forbids exactly this. (§T1)
2. **Auto-on-every-command requires a CORE kernel change** — extensions can't do it; the capture hook must live in `app.ts`. (§T2)
3. **Orphan-ref-on-every-command vs. temp-then-flush-at-ship** — the git-write plumbing the orphan ref needs doesn't exist yet, and writing git objects on every command's hot path fights the "atomic/fast" constraint. A gitignored temp buffer flushed at ship may be the cleaner shape. (§T3)

## The substrate that already exists (reuse, don't rebuild)

| Capability | Where | What we get for free | Evidence |
|---|---|---|---|
| Record system | `harness record <type>` + `.harness/records/<type>/<YYYY-MM-DD>/<NNN>-slug.md` | deterministic, never-clobber paths; `segment` = a new **core** record type, **no new verb** | REC-01/03, PL-06 |
| 8-key provenance | `src/services/record/provenance.ts` (CLI-stamped) | `record_kind, harness_version, branch, repo, created_at, agent, plan_id, schema_version` auto-stamped from git/clock/env — **exactly our segment metadata, free** | REC-02, PL-13 |
| Identity resolution | env `HARNESS_AGENT`/`HARNESS_PLAN_ID` → branch/cwd inference → `null` | agent + plan-link resolution chain already specified; never fails capture | PL-21 |
| Transient buffer precedent | `harness observe` → `.harness/temp/<bucket>/` (gitignored) + atomic temp+rename writes | the exact pattern for a fast, PR-invisible hot-path write | REC-06/07, GIT-11 |
| Hexagonal ports + DI | `src/services/*` take injected `fs/git/exec/clock/env`; `FakeFs`/`FakeClock` | unit-testable capture service; copy `init-service.ts` shape | TEST-01/02 |
| Arch guardrails | `.dependency-cruiser.cjs` + `arch-check` + `no-direct-node-io` test | rules dictate: capture logic in `src/services/telemetry/`, ports-only I/O, no `node:*` | TEST-03 |
| **eng-thrive contract** | `docs/how/harness-value-measures.md` | the measures telemetry feeds: bypass-rate, encoded-mitigation ratio, **PR denominator**, DORA leading/lagging | REC-05, PL-18/19 |

## Proven token/skill/subagent sources (from `scratch/telem/` probes — see agent memory)

| Harness | Correlation handle (env) | Source of truth | Status |
|---|---|---|---|
| Claude Code | `CLAUDE_CODE_SESSION_ID` | `~/.claude/projects/<slug>/<id>.jsonl` — per-turn `usage` (dedupe by `message.id`; sum all 4 token buckets; subagent cost inline in `Agent` tool_result) | **proven** |
| Copilot CLI | `COPILOT_AGENT_SESSION_ID` (detect innermost harness — Claude vars leak when nested) | process log `kind: assistant_usage` (live, full token detail); `subagent_started/completed` for subagent identity/model | **proven**; subagent token attribution best-effort |
| Cursor | TBD | TBD | deferred — adapter slot, `null` until built |

No tokenizer needed (server-reported counts authoritative); **no estimation** — null when a source is absent. `<synthetic>` turns excluded from cost.

## The three tensions (decision-relevant)

### §T1 — Attribution: individual vs. team-only ⚠️ CONFLICT
`docs/how/harness-value-measures.md` is explicit and **load-bearing**: measures are *"aggregated only at the team or repo level, never a per-person scoreboard"*; **token count is on the explicit do-NOT-use-for-individuals list**; *"Harness measurement requires team-level governance that prevents individual surveillance and productivity leaderboards."* (REC-05, PL-20). Our grilled decisions (commit-author identity + per-user reports) sit directly against this. **Resolution to take into planning**: keep `agent` as optional provenance for *causality/debugging* (already the house pattern), persist commit-author on the ref for provenance, but **drop per-user reporting as a goal** — reports are team/repo-level only. The plan should state this reconciliation as a constitutional alignment, not silently keep "per-user reports."

### §T2 — Trigger: core preamble, not extension ✅ RESOLVED BY EVIDENCE
Extensions are invocation-triggered only — **no kernel hooks/middleware** (EXT-04/11). So "auto on every command" is impossible as an extension. The single clean injection point is the composition root `app.ts:~294` before `parseAsync`, or the existing **exit/banner-decorator** precedent (`exitWithEnvelope`, `setBannerDecorator`) for an at-exit capture (CLI-02/03/04/07). Capture must be **fail-safe** (never change the host command's exit code) — exit conventions support this. Adapters (Claude/Copilot/Cursor) are **capability modules inside core** (`src/services/telemetry/adapters/*`), not separate-repo extensions.

### §T3 — Storage shape: orphan-ref-on-hot-path vs. temp-then-flush
Locked decision was "one orphan git ref via plumbing." But: the CLI's `GitPort` is **read-only** (`isRepo/currentBranch/remoteUrl`) — hash-object/commit-tree/update-ref/push are **not wrapped** and must be built as a new `GitWritePort` (GIT-01/05). Running git plumbing on **every command's hot path** fights "atomic/fast." **Cleaner shape surfaced by research**: capture writes the segment to a **gitignored `.harness/temp/telemetry/<session>/`** buffer on the hot path (fast, PR-invisible, uses the proven `observe`/temp + atomic-write precedent), and a **`ship`/sync step flushes** the buffer → orphan ref via the new `GitWritePort` → push. This decouples *emit* (always, cheap) from *commit* (deferred, ship), satisfies "never touch index / invisible to PRs," and isolates all git-plumbing risk to one deferred path. Plan should weigh this against direct orphan-ref-per-command.

## Net-new surfaces (scope reality)

| Surface | State today | Note |
|---|---|---|
| `harness ship` command | **does not exist** in the CLI — only a flow node label | "first-class extensible ship command" is net-new core; large item (GIT-06) |
| `GitWritePort` (plumbing) | **does not exist** — git port is read-only | needed for orphan-ref write/push; isolate behind a port, fake-tested (GIT-05) |
| `segment` record type | not present | core record type: `kind/type/description/template`, frozen-body-keys test, **no schema file required** (but a `segment.schema.json` helps cross-tool/repo consumers) (PL-02/16, REC-12) |
| Kernel capture preamble | no hook mechanism exists | new, in `app.ts`; the one core-kernel change (§T2) |
| Per-harness adapters | proven in `scratch/`, not in CLI | port-injected services, golden-file tested against captured fixtures (TEST-05) |
| Cursor over multiple sessions | "since last command" cursor/watermark | needs a stored offset per session; Copilot is naturally per-`-p`-session, Claude is one long session |

## Must-knows / gotchas (from prior art)

- **Provenance splice = pure string op, never YAML-parse in the service** (PL-14); idempotent.
- **Dated-subdir layout is current; flat `<date>-slug.md` is a stale-prose trap** (PL-05).
- **Telemetry is a *leading* diagnostic feeding existing DORA/eng-thrive — not a new scoreboard metric** (PL-19); PR is the denominator (PL-10).
- **Auto-capture is deterministic (not voluntary)** → no Goodhart under-reporting incentive, but **higher surveillance risk** → §T1 governance is the safeguard (PL-10/24).
- **Tests: hand-written fakes, never `vi.mock`; run `npm run test` (= `cd harness/cli && vitest run`); biome `npm run fix` before commit** (PL-15, TEST-04/06).
- **Kill switch**: env var disables capture+commit (grilled), default on.

## Complexity

**CS-4 (large)** — Surface 2 (CLI kernel + new command + ports), Integration 2 (3 harness adapters + git + eng-thrive contract), Data/State 2 (segment schema, cursor, orphan ref), Novelty 1 (orphan-ref plumbing new here; sources proven), Non-functional 1 (perf on hot path, fail-safety), Testing 2 (fixtures per harness, golden files, git-write fakes). Sum ≈ 10 → **CS-4**, leaning Full mode.

## External Research Opportunities

**None blocking** — the design space is internal (this codebase's record/measures/ports system is the contract). The token/skill sources are already empirically proven in `scratch/telem/`. The only "research" left is the §T1–§T3 *decisions*, which belong to the plan + a likely workshop on §T1 (governance/attribution) and §T3 (storage shape).

---
**Consumer note**: the `plan` verb should open by resolving §T1 (constitutional alignment — likely a workshop), then §T3 (storage shape), then phase the build: segment type + provenance → per-harness adapters (capability-based) → kernel capture preamble → GitWritePort + orphan-ref flush → ship/sync. Reuse, don't rebuild.
