---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-02T23:40:31.570Z"
agent: agent
plan_id: 049-telemetry-ref-rollup
schema_version: "1.1"
retro_id: "2026-07-02T23:40:31Z-agent-049p1"
started_at: "2026-07-02T21:11:00Z"
ended_at: "2026-07-02T23:40:31Z"
summary: "049 Phase 1 drain — ref rollup + history-union migration + buffer prune shipped through 3 cross-model review rounds; live dogfood migrated all real refs first try, recovered the buried telemetry (June time_s +8%), and shrank the local buffer 100MB→3.9MB. One open perf finding on the no-op sync path."
entries:
  - id: WIN-001
    kind: win
    description: "Live migration worked first try: 36 old refs → 28 rolled + 1 today-excluded straggler (by design); rewritten=26, deleted=7 (same-path single-day refs rewrote in place), segments=17943 unioned. June sweep totals rose 267,792→289,247 time_s (+8%) — the recovery proof for the 390 buried files. .migrated sentinel + .startdate sidecars in place; prune took .harness/temp/telemetry 100MB→3.9MB."
    target: project
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T23:36:13.000Z"
  - id: WIN-002
    kind: win
    description: "Cross-model review caught two vacuity-class defects behind a green gate: the AC-09 byte-equivalence test passed a parse/re-stringify laundering mutation (fixture already canonical), and ExecGitWrite.readRefTree silently truncated >1MiB blobs (spawnSync ENOBUFS, empirically proven by the reviewer) then would have force-pushed the truncated roll — the exact F-03 loss class the plan exists to kill, via the ops layer. Both fail-closed now (raw-byte opaque fixtures; shared GIT_MAX_BUFFER + throw-on-partial-read)."
    target: project
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T23:05:00.000Z"
  - id: INS-001
    kind: insight
    description: "T007 (buffer prune scope-add) exposed that the writer's buffer-only tree rebuild contradicted pruning — enabling prune flipped three existing ACs RED. The fix was already in the plan's own design item 02 (union local rolled ref tree + buffer delta); the scope-add forced completion of a design shortcut. Pattern: a coder that STOPS at a design fork and hands back options (A/B/C with costs) is cheap; the orchestrator decision took one message."
    target: project
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T22:40:00.000Z"
  - id: DL-001
    kind: difficulty
    description: "OPEN perf: a steady-state NO-OP `harness telemetry sync` (synced=0, sentinel present, nothing buffered) costs ~2min wall / 96s CPU. Suspects: (a) the union writer's no-op decision reads the ENTIRE rolled ref tree — including the multi-MB session.logs.jsonl — per session just to learn refMaxSeq, where a manifest-only blob read would do; (b) capture-side transcript correlation on a 19k-segment session. This cost now rides every commit/checks-adjacent sync."
    target: tooling
    severity: degrading
    workaround: "none needed functionally — the run is correct, just slow"
    suggested_encoding: "bounded fix task: manifest-only refMaxSeq read on the no-op path (readRefTree stays for the actual rewrite); profile capture correlation separately"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T23:39:41.184Z"
---

# Retro — 049 Phase 1 (ref rollup + migration + prune) drain

Three review rounds, each catching something the previous gate couldn't see: a laundering-vacuous P12 test, then an ENOBUFS silent-truncation that would have weaponized the force-push. The dogfood closed the loop the same session: real refs migrated, buried June data measurably recovered (+8% time_s), buffer 25× smaller. Open: the no-op sync perf finding (DL-001) — recommend a bounded fix before ship.
