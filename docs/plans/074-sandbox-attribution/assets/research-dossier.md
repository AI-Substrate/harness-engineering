# Research Dossier: sandbox attribution — detection, safe commit, and recovery

**Generated**: 2026-08-07T01:20Z
**Query**: "get builder spine in, then run explore which is basically just moving our research and documentation from our research process from scratch into that folder"
**Effort**: Quick (consolidation — the research was performed live over 2026-08-06/07 in a joint investigation between this PM session and a Cursor agent; this dossier is its decision packet)
**Evidence**: 12 current sources · 4 historical sources

## The Ask

Plan 073 made git-ai the telemetry collector. A live dogfooding investigation found that agent
sandboxes silently destroy git-ai's commit attribution — and worse, the lost work is re-attested
as known-human. Over seven controlled runs (five of them executed *by a Cursor agent inside its
own sandbox*, reporting back through shared markdown), the failure was isolated, two remedies
were proven, and a recovery path was discovered. Jordan ruled a lean six-feature response, to
ship **inside PR #104** on the same branch/worktree as plan 073. This dossier consolidates that
evidence for the plan.

## Answer

1. git-ai has exactly **one ingress** — git's trace2 events over a unix socket. No git shim, no
   post-commit hook, no daemon-less mode, no control-API "commit happened" verb (F-01).
2. A sandboxed `git commit` silently loses that event; the edit data survives, and the recovery
   ladder then attests the lines as **known-human** — a wrong answer, not a gap (F-02, F-03).
3. Which commands get sandboxed is **command-shape dependent AND non-deterministic across
   sessions** (F-04, F-05) — so no IDE configuration is a reliable fix, and detection + a safe
   commit path must live in harness.
4. Both remedies are **proven end-to-end**: a single allowlisted entrypoint that stages, commits,
   and verifies (F-06), and a trace2 file-buffer→socket replay the daemon cannot distinguish from
   live traffic (F-07).
5. A **retroactive recovery sweep exists** inside git-ai and has been observed re-attributing lost
   commits — but its trigger is not yet isolated and its reach was partial (F-09 / U-1, U-2).
6. Doctor currently reports green forever on capture (F-10); the collector health read explicitly
   defers liveness (`ac-0012`) and is the designed extension point (F-12).

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | git-ai's sole ingress is trace2 over `af_unix`; no `git` shim, empty `.git/hooks`, no daemon-less mode, control API has no commit verb | `assets/research/01-sandbox-attribution-gap.md` §2 | No second door exists; every remedy must speak trace2 or drive git itself | High |
| F-02 | Sandboxed commits lose only the commit event; agent hooks, payloads, checkpoints all survive (daemon: zero errors) | `01` §2 table; `03-scratch-cursor-sandbox-investigation.md` | Detection can't rely on daemon health — it must probe the ingress or the notes | High |
| F-03 | Unattributed lines get `h_` **known-human** attestations (`attribution_recovery.rs:661-674`); observed live 3× | `03` § Why worse than no data | The failure is a wrong answer, invisible to every health signal — the whole case for doctor detection | High |
| F-04 | Under `Allowlist (with Sandbox)`: standalone `git commit` → unsandboxed + attributed; compound (`&&`, `$( )`) → sandboxed + lost. Isolated A/B/C/D | `cursor-runs/run-6.md`; `run-5.md` | Agents chain by default ⇒ the natural path loses attribution even when "configured correctly" | High |
| F-05 | Run 7: identical compound shapes ran **unsandboxed and attributed** — placement varies across sessions with no config change | `cursor-runs/run-7.md` + note check (3/3 NOTE) | Non-determinism kills any "configure Cursor properly" answer; also contaminated the recovery baseline (U-1) | High |
| F-06 | Single `node commit.mjs` entrypoint from inside a sandboxed Cursor session: staged, committed, **attributed** (`67fad79`), self-verified | `cursor-runs/run-6.md` step E; `cursor-runs/commit.mjs.txt` | `harness commit` is proven in principle; port the prototype | High |
| F-07 | `GIT_TRACE2_EVENT=<file>` buffers events; `node:net` replay into the socket produces a full correct note (`2144a4d3`); daemon can't tell | `04-scratch-workarounds-proven.md` §4; `cursor-runs/relay.mjs.txt` | The nudge's delivery mechanism exists and needs no new dependency | High |
| F-08 | **Repo-local `trace2.eventTarget` is ignored** — git reads trace2 from system/global config + env only | `cursor-runs/run-1.md` reply; control commit `4766646` | Buffering can't be a quiet per-repo config; it's the entrypoint's env (`harness commit` sets it) or global | High |
| F-09 | Recovery sweep observed: after a drain + activity, 5 notes appeared retroactively incl. Cursor's `b165cbe` (sweep reads `~/.cursor/projects/…` transcripts); a plain commit alone (lever 1) recovered nothing | daemon log `sweep item:` lines; `run-5.md` reply; lever-1 result | A nudge verb is viable; its trigger must be isolated before the design is fixed (U-1) | Medium |
| F-10 | `capture-liveness` doctor check is ungated → green forever post-073 | `doctor-service.ts:25,755` | Fix in the same pass; flagged independently twice | High |
| F-11 | The socket was **reachable from inside the sandbox** in one session (probe `connected` with `CURSOR_SANDBOX=seatbelt` set) | `cursor-runs/run-1.md` step 3 | Env markers must never assert a verdict — only the probe outcome decides; markers explain | High |
| F-12 | Collector health read (`CollectorVerdict`, `health.ts`) exists, is bounded, and explicitly defers liveness as `ac-0012` | `harness/cli/src/services/doctor/collector/health.ts` docstring | The probe verdict (`ingress-blocked`) is an additive extension of an existing surface, not new machinery | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Plan 073 ruled: doctor **warns, never blocks** (`ac-000c`); simple health depth for v1; no upstream git-ai filing (Jordan, standing) | `docs/plans/073-gitai-collector-v1/plan.dd.json` | Direct | All new verdicts are warnings; no git-ai patches or issues |
| H-02 | FX009: Cursor work recorded as a *wrong number*, not a gap — same shape as F-03, predating this investigation | `03` § Why worse | Direct | This is a recurring class, not a one-off; detection is the durable answer |
| H-03 | "Backfill impossible" was concluded early from two wrong probes (`checkout`, `--allow-empty`), then falsified by F-09 | `03` § Backfill; `run-5.md` reply | Superseded | Carry the correction: retroactive recovery EXISTS; only its trigger is unknown |
| H-04 | Review constraint (Jordan, in-flight on 073): new tests must be CI-achievable, **no new or external deps** | `docs/plans/073-gitai-collector-v1/assets/HANDOVER.md` | Direct | `node:net` only; all socket tests drive a fake port |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| U-1 | Nudge trigger not isolated (replay vs transcript-sweep poke vs restart); run-7 baseline was contaminated by F-05 | F-09, `run-7.md` | Decides what `telemetry-nudge` actually does | Lever experiment against the 8 still-missing commits (`6da9d1e`…`9d07284` in `~/temp/gitai-allowlist-test`); or ship replay-only v1 and record the sweep as opportunistic |
| U-2 | Recovery reach was partial — 2 of 8 missing commits recovered; window/span unknown | F-09 | Sets honest wording of what nudge promises | Same lever experiment |
| U-3 | Replay idempotency / staleness / multi-repo interleaving untested | `04` §4 open questions | Gates whether nudge can run unconditionally from doctor/checks | Phase task: double-replay + stale-replay tests against a live daemon locally (never CI) |
| U-4 | Only `git` and `node` proven to run unsandboxed when allowlisted; the `harness` prefix itself untested | run-6 E used `node` | `harness commit` docs must tell users what to allowlist | One-line Cursor test post-implementation |
| U-5 | Windows: git's `af_unix` trace2 target is Unix-only; git-ai's Windows transport unknown; Cursor documents no Windows sandbox | `04` §"relay on Windows" | Windows is "must not break", not "must work" — use `node:net` (named-pipe compatible) and guard by platform | Non-blocking; note in plan |

## Planning Handoff

- **Preserve**: `CollectorVerdict`/`health.ts` shape and its honesty doctrine (empty ≠ clean, absent ≠ green); `ac-000c` warn-never-block; the ports-and-adapters pattern (`SocketProbePort` as a new port, fake-driven in tests); plan 073's shipped surface untouched except additive extension.
- **Change carefully**: `doctor-service.ts` capture-liveness wiring (twice-flagged, but it is a *verdict* change — own AC, own review); anything touching commit flow must never swallow git's exit code or block a commit on verify failure (warn loud, exit honest).
- **Likely files/symbols**: `services/doctor/collector/health.ts` (+verdict), new `services/doctor/collector/sandbox.ts` or `ingress.ts`, new `adapters/net/socket-probe-port.ts`, extension verb `harness commit` (`.harness/extensions/` or CLI verb — decide in plan), `harness doctor telemetry-nudge` verb, `doctor-service.ts:25,755`, AGENTS.md one-liner.
- **Decisions still required**: nudge v1 scope given U-1 (recommend: replay-what-is-buffered + verify, record sweep-wake as observed-but-unrelied-on); `harness commit` as CLI verb vs repo extension; whether the at-risk list runs on every doctor or only when the probe is blocked.

## External Research

_Resolved during investigation (Cursor sandbox = Seatbelt; unix-socket connect = network op; allowlist/`sandbox.json` semantics) — citations inline in `01` and `04`. No open external questions._
