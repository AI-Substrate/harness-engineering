---
record_kind: "retro"
harness_version: "0.13.0"
branch: "s065/deterministic-documents"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-05T21:31:13.461Z"
agent: "pij-related-koala"
plan_id: "072-plan-ready-gate"
schema_version: "1.2"
retro_id: "2026-08-05T21:31:13Z-pij-related-koala-072a"
started_at: "2026-08-04T17:20:11Z"
ended_at: "2026-08-05T21:31:13Z"
summary: >
  Plan 072 shipped `harness plan ready` — a three-valued readiness gate — through six coder
  rounds and four cross-model review rounds. The code was right early; almost every round after
  the first corrected a CLAIM that outran its mechanism. Two entries below predate this plan
  (the 2026-08-04 eval/FX001 stream in the same worktree) and are drained here rather than left
  to rot. The headline is DL-007: a deployed skill three weeks behind its source, invisible to
  every gate, which caused this plan to be authored in the format the plan itself was
  deprecating.
entries:
  - id: INS-001
    kind: insight
    description: >
      One PR walked the CLEAN trap end-to-end in 90 minutes: MERGEABLE/CLEAN with no checks
      attached (absence of a verdict) -> UNSTABLE checks pending (verdict in progress) -> CLEAN
      all green (verdict). First and third are the SAME STRING meaning opposite things.
      Corollary: a CI verdict binds to the (PR, head) pair, and committing the exit-log entry
      moved the head — the evidence artifact destroyed the thing it evidenced.
    target: tooling
    suggested_encoding: "freeze -> green on current head -> declare; the final verdict lives in reports/verification, never in a branch commit"
    fp: "ba638cd89bed"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T17:20:11Z"

  - id: DL-001
    kind: difficulty
    description: >
      `telemetry get` reads ONLY the local buffer; flush moves payloads to
      refs/harness-telemetry leaving marker files, so a flushed session scores E100/0-segments
      even though every segment is on the ref. The post-commit telemetry hook auto-flushes on
      every commit, so any subject that COMMITS blinds its own telemetry lane before the
      orchestrator can score it.
    target: tooling
    severity: degrading
    workaround: "score before any commit; run 1 only survived because its subject committed nothing"
    suggested_encoding: "telemetry get falls back to reading refs/harness-telemetry when the buffer is flushed"
    fp: "b326887b0071"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T21:08:37Z"

  - id: DL-002
    kind: difficulty
    description: >
      plan-ordinal.py returns an already-used ordinal: it scans docs/plans/ but not
      docs/plans/archive/, so an archived plan's number is handed out again. It returned 071,
      which is archive/071-dd-native-builder.
    target: tooling
    severity: degrading
    workaround: "spotted the collision by eye and took 072 instead"
    suggested_encoding: "scan docs/plans/archive/ as well — one glob"
    fp: "4f4cfd7e5ef5"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-05T07:28:44Z"

  - id: DL-003
    kind: difficulty
    description: >
      pij watchdog stale-threshold is mis-tuned for long-turn coding peers: a high-effort opus
      coder doing multi-file edits legitimately goes 5-10min between emitted events, firing
      'gone quiet' twice on a peer whose clock was demonstrably advancing (09:23 -> 09:33). The
      alert cannot distinguish 'long turn' from 'wedged'.
    target: tooling
    severity: annoying
    workaround: "poll lastEventAt for movement — the discriminator that actually works"
    suggested_encoding: "key the alert on a frozen clock, not on elapsed silence"
    fp: "07713222cf71"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-05T09:35:15Z"

  - id: DL-004
    kind: difficulty
    description: >
      The pij 'gone quiet' alert can fire while the platform's own systemState reads 'working' —
      it keys on liveness:stale independently. An alert that contradicts the state field beside
      it trains the reader to ignore it, which is the same failure ruling ac-7007 names for
      per-row warnings. Three false firings preceded one real one.
    target: tooling
    severity: degrading
    workaround: "verified each firing by polling lastEventAt rather than trusting or dismissing the alert"
    suggested_encoding: "reconcile the alert with systemState, or state why they can legitimately disagree"
    fp: "406354f09d8e"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-05T09:36:45Z"

  - id: DL-005
    kind: difficulty
    description: >
      pij compact-self reported 'fired /compact into %956' and the peer then froze permanently:
      lastEventAt stuck for 10+ min while activity stayed 'working', and no compaction event
      ever appeared in the tail. The send-receipt is not evidence the compaction took, and a
      post-compact 'gone quiet' alert IS the failure signature.
    target: tooling
    severity: blocking
    workaround: "declared a 10-minute frozen-clock threshold in advance, closed the seat on it, respawned"
    suggested_encoding: "compact-self verifies the compaction landed before returning ok, or returns a distinct 'fired, unconfirmed' status"
    fp: "0d1ba2de91b8"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-05T09:56:11Z"

  - id: DL-006
    kind: difficulty
    description: >
      pij spawn (copilot) hangs pre-bind when an MCP server is unresponsive — pane shows
      '1 MCP server — still waiting on mcp: github-mcp-server' and lifecycle stays 'pending'
      indefinitely. Two consecutive spawns lost. pij send correctly reports BLOCKED rather than
      queueing, but the watchdog cannot see pre-bind seats, so only tmux capture-pane revealed
      the cause.
    target: tooling
    severity: blocking
    workaround: "diagnosed via capture-pane; switched harness to codex and cleared its update prompt with a keypress"
    suggested_encoding: "a pre-bind timeout that states the blocking MCP server, or an MCP-skip flag on spawn"
    fp: "b3d64746c3d5"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-05T10:02:14Z"

  - id: DL-007
    kind: difficulty
    description: >
      A deployed skill can be weeks behind its in-repo source with nothing detecting it:
      ~/.agents/skills/builder was dated Jul 15 and authored markdown plans, while in-repo
      skills/builder (Aug 4, plan 071) authors plan.dd.json. Eleven `harness checks` runs
      reported check:doctrine-parity:ok — that gate guards the mirrored doctrine block, not
      deploy freshness. Cost: plan 072 was authored in the deprecated format by the tool it was
      specifying, and `harness plan ready` could not read its own plan (E400). Separately,
      `harness doctor` reported "no stale install shadowing" while the global binary resolved
      into a worktree — version identity is not path identity.
    target: tooling
    severity: blocking
    workaround: "diagnosed by comparing file dates and grepping both trees for plan.dd.json"
    suggested_encoding: "compare source vs deployed hashes per skill in the skill-deployment doctor; have doctor report readlink -f $(which harness) and warn on *-worktrees/*"
    fp: "unset"
    disposition: task
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-05T21:31:35Z"
---

# Retro — 072 plan-ready-gate

## What this plan was

`harness plan ready` — one command an agent runs at plan setup and at gates: are the acceptance
criteria claimed by tasks, and was the backpressure survey done or explicitly declined? Merged
to `main` as `1aef9d9c`.

## The shape of the work, honestly

**The code was right early. Almost every round after the first corrected a claim, not a
mechanism.** R4, R5 and R6 each fixed prose that said more than the implementation had earned —
twice in a sentence written to fix the previous sentence. That is this plan's own thesis (an
instrument whose claim is broader than its coverage) landing on the plan itself, four times.

The unavailable-receipt boundary was set **five times** — too broad, too narrow,
"doctrine-complete", three recognisers, then withdrawn to nearly where it started. Every swing
refined *how* to parse while the *whether* went unchecked: the shapes being parsed were, per the
instruction agents actually follow, never written. A reviewer asking "does any producer emit
this?" was worth more than four refinements. Root cause recorded in the execution log as: **the
premise was never examined, only the implementation of it.**

## What the loop caught that a review would not

Every serious error in this plan was a claim I had not verified — three rulings about parsing a
form nobody emits, a both-forms clause sitting in a file I had read in full, and a verification
proxy ("zero diff on this file") that I invalidated with my own later instruction and kept
quoting. The coder and reviewer caught all of them. **Adversarial review found defects; the
harness loop found that my evidence was the thing decaying.**

## Highest-leverage improvement (DL-007)

A detector for deployed-vs-source skill drift. It is the only entry here that caused a plan to
be built wrong rather than merely costing time, and the fix is cheap: the skill-deployment
doctor already knows both paths — it needs to compare them.
