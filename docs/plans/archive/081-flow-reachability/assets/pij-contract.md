# Contract: flow reachability for pij workteam — s081 handoff to AI-Substrate/pij

**From**: s081/flow-reachability (harness-engineering) · 2026-08-09
**Status**: offered for ratification — semantics are built and tested; the verb NAME and the
CLI registration timing are the two ratifiable points.

## What Jordan ruled (2026-08-09 pre-amble, verbatim anchors)

- Plan validation does NOT go into `harness checks` — "users may choose to use other SDD
  flows (like OpenSpec)". Enforcement lives in pij: "in pij verbs and the pij skill itself
  (will move from 'pij pair' to pij **workteam**)".
- "pij will use harness verbs please." · Bundling: "that is fine, pij can rely on harness."
- Missing flight plan: "no its a warning still." · Nudge: "leave nudge out for now."

## What harness now provides (built, tested, on branch s081/flow-reachability)

### 1. `flight-plan` is a bundled flow type — the dispatch one-liner works bare

```bash
harness flow create flight-plan --slug <slug> --path <plan-dir>/the-flow.json --plan-dir <plan-dir>
```

**AVAILABLE ONLY WHEN s081 IS MERGED — on current main this exact line returns E304** (verified
differentially by prime: branch build ok, main build E304). Encode the finding now, hold the
command until prime signals the merge.

No `--schema`/`--template`/`--agent`, no builder skill on disk. This is the line
`pij stream create` (or the workteam allocate step) should mint per stream — it closes
#140's target 1/2 without coupling pij to a skill install. (The one-liner #140 originally
proposed omitted `--path` and failed E304 before this work — see friction F1.)
The builder skill stays the single source; `gen-flows` bundles it; `check:flows` guards drift.

### 2. The two-clause check — `checkReachability` (service today, verb on registration)

Target invocation (name ratifiable): `harness flow check --plan-dir <dir> [--flow <path>]`

| stream state | verdict | exit | notes |
|---|---|---|---|
| plan.dd.json missing or invalid | **error** | 1 | catches the actual wave failure (098/099: no plan doc at all) |
| plan ok, flow absent (E301) | **degraded** (warning) | 0 | reason `absent`; next_action carries the bare create line above |
| plan ok, flow legacy/malformed/future (E308/E300/E306) | **degraded** (warning) | 0 | four DISTINCT reasons — a hand-written flow never counts as one that exists |
| both good | **ok** | 0 | |

- Envelope carries `examined[]` + `excluded[]` (both artifacts always examined; never
  survivors-only counting) and machine-readable `plan`/`flow` clauses with codes.
- Warning polarity is ruled: pij may harden (treat degraded as red) in workteam context —
  that decision is pij's, the harness default stays advisory.
- Hardened against a lying child: a failed `plan validate` subprocess whose stdout parses
  as JSON is rejected unless exit/status pairing matches the published kernel contract
  (found by cross-model review; regression-tested).

### 3. Known nuance pij should carry

`plan validate` returns E400 for BOTH "no plan document" and "present but invalid" — the
check distinguishes them by fs probe (`plan.present` vs `plan.validates`). If pij wants
that split from the raw verb instead, it needs an s080-side envelope change (flagged to
that stream's owner).

## What pij owes (the dispatch-side fix — #140 targets 1/2, evidence-backed)

1. Workteam allocate step (or `pij stream create`) mints the flow with the bare create line.
2. The stream-brief template carries a **Flow** line beside Plan folder/Worktree/Branch/Base.
3. The workteam verbs call the check per-stream (post-hoc callable on any worktree — the
   seam must not assume it ran at allocate: hand-rolled streams are the measured norm,
   including this one).

## Evidence the mandate needs a MECHANICAL carrier, not context (for the workteam design)

- pij#227: 0/9 flight plans, 2/9 no plan doc, 9/9 merged green — seats never asked.
- #140: 37/50 of harness-engineering's own briefs never name the flow.
- **F4/D1 (this stream)**: the maximally-briefed exemplar seat itself skipped the workteam
  pattern until human backpressure — a reachable-but-optional convention still lost.
- **F3**: `/pij pair`'s engine (flow-pair) was absent from the skills install — the paved
  path taught the detour. The workteam feature must carry or verify its engine.

## Registration status (the one pending piece)

`acts/flow.ts` is contended (three claimants); the check logic is complete and tested
behind the seam, and the CLI lift is ~10 lines that can ride another change or land in a
brokered window. pij should code against the CONTRACT above, not the registration date.

## Collaboration offer

s081's PM seat offers: joint ratification of the verb name; a walkthrough of the module and
fixtures; DELTA convergence into `docs/how/fleet/stand-up.md` (docs/fleet-live-findings);
and review of the pij-side wiring against the fixture matrix (six shapes, committed at
`harness/cli/test/services/flow/fixtures/reachability/`). Route via pij-massive-meadowlark.
