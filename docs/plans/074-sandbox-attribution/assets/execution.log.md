# Execution log — plan 074, Phase 1 (sandbox attribution)

**Run**: 2026-08-07 · one pass, all 12 tasks · agent `pij-nice-anglerfish` (Copilot CLI)
**Branch**: `s073/gitai-collector-v1` (PR #104) — committed directly, never pushed.

---

## What shipped

| task | outcome |
|---|---|
| tk-0001 | `SocketProbePort` + `SocketRelayPort` (`adapters/net/`), fakes, and the trace2 target resolver |
| tk-0002 | `NodeSocketProbe` — `node:net`, 750ms bound, destroy-on-settle, never sends a byte |
| tk-0003 | `ingress-blocked` verdict in `health.ts` (additive), markers explain-never-decide |
| tk-0004 | `enumerateAtRisk` — bounded window, honest wording, `unproven` under a blocked ingress |
| tk-0005 | capture-liveness gated on `captureDisabledReason` — green-forever is dead |
| tk-0006 | `harness commit` — exhaustive probe-outcome partition, verify-after-commit |
| tk-0007 | `harness doctor telemetry-nudge` — rotate → replay → confirm → delete/retain |
| tk-0008 | doctor + checks wiring, read-only: detection present, mutation absent |
| tk-0009 | `harness instructions commit` core page + `AGENTS.md` managed block |
| tk-000a | `docs/how/gitai-collector.md` § Sandbox attribution |
| tk-000b | SPIKE (local, live daemon) — ran FIRST, as the gate requires |
| tk-000c | dependency + surface audit |

---

## tk-000b — the spike, and what it settled

Fixture: a fresh temp repo whose commits were made with `GIT_TRACE2_EVENT` pointed at a
file (the proven repro — no dependency on any pre-existing repo or commit).
Log: `scratch/074-spike/spike-run-1.log`.

| question | result |
|---|---|
| (a) does replay recover a buffered commit? | **Yes — 3/3.** All three notes landed after one replay |
| (b) duplicate-replay semantics (U-3) | **Idempotent.** Notes byte-identical, notes-ref entries 3 → 3, no corruption |
| (c) staleness | A 30-second-stale replay still landed its note |
| (d) empty replay | Accepted, no error — a safe no-op |

**Decision taken, and why it is deliberately conservative.** (b) is exactly the evidence
ac-0006 said would unblock automatic retry — and v1 still does **not** auto-re-replay a
retained segment. The AC's shipped behaviour is normative ("v1 never automatically
re-replays… retained segments are listed with an explicit retry instruction"), and one
observation, on one daemon, in one session, seconds apart, is not enough to make an
unattended retry loop safe across daemon restarts and multi-repo interleaving. The
result is recorded here so a future plan can build the automatic retry on it rather
than re-run the experiment.

---

## Two real defects the LIVE verification found (tk-0011, local-only)

Both were invisible to the unit tests, because both are facts about the daemon.
Neither would have survived to a reviewer, but both are worth writing down: they are
the reason the manual verification task exists at all.

### D1 — git's trace2 stream names NO commit sha

ac-0006 says to delete a segment only when "every commit SHA named in that segment's
events" carries a note. The live run showed the events name **no sha at all** — git
emits them while the commit is still being made, and git-ai's daemon derives the sha
itself by reading the repo. So `commitShasIn(payload)` returned `[]`, "every named sha
has a note" was **vacuously true**, and the nudge deleted the segment having confirmed
nothing. A confident wrong answer — the exact shape this plan exists to kill.

**Fix**: `harness commit` writes a **sidecar** (`buffer.jsonl.shas`) naming the commits
it buffered — it is the only thing that knows. The nudge rotates the sidecar with its
segment and confirms against it. A segment with no sidecar and no shas is now
**retained as `unconfirmable`**, never deleted, because deleting on an unprovable claim
is the defect, not the cure.

### D2 — confirmation raced git-ai's asynchronous note write

The nudge judged `hasAiNote` the instant `send` resolved. Live, a commit reported
`stillMissing` and its note appeared ~2 seconds later — needlessly retaining a segment
that had in fact been fully recovered.

**Fix**: a bounded settle loop (`CONFIRM_TIMEOUT_MS`, injectable `sleep`), the same
shape `harness commit`'s verify already used. CI drives it with no wall clock.

**Re-verified live after both fixes** — the whole loop, end to end:

```
harness commit (ingress absent) → mode=harness-buffered, sidecar written, buffer gitignored
harness doctor telemetry-nudge  → replayed, recovered=[2e65c357…], stillMissing=[], segment+sidecar deleted
git notes --ref=ai show HEAD    → PRESENT
```

Also verified live: the reachable branch (`mode=direct-verified`, `verify=landed`), all
four new doctor rows against this repo, and `instructions commit --inject` being
idempotent (`inserted` then `unchanged`).

---

## Decisions taken

| # | decision | why |
|---|---|---|
| 1 | `commit` is a **CORE** verb, not an extension (ac-0008 placement) | The failure is a property of the MACHINE, not of any repo's toolchain. A per-consumer extension would have to be authored once per repo, and the repos most exposed are the least likely to author it. Reserved in `RESERVED_NAMES`. |
| 2 | Two socket interfaces, not one | `SocketProbePort` connects+destroys; `SocketRelayPort` writes. Doctor/checks are handed the probe ONLY, so a read-only surface **structurally cannot** mutate the collector (ac-0007 proven by construction, not by discipline). |
| 3 | `telemetry-nudge` is a doctor **subcommand**, not a flag | A bare `doctor` must stay read-only. Making recovery a separately-typed verb is what keeps the diagnostic honest. |
| 4 | The doctor report path became **async** | The ingress probe is a socket connect; it cannot be synchronous. One probe per run, taken in the composition root, injected into a still-pure sync report. `parseAsync` was already the production parse path; five test call sites moved with it. |
| 5 | At-risk reads notes in ONE batched call | `hasAiNote` per commit would be up to 200 child processes on a surface that runs on every doctor. `listNotedShas` makes the cost independent of the window. |
| 6 | `ingress-blocked` placed immediately before `healthy` | Provably additive: the ONLY read it converts is the one that would otherwise have claimed "collection is configured" — precisely the read that would have been a lie. No pre-existing verdict path changes. |
| 7 | capture-liveness reports `ok:false` when capture is off | ac-0004 requires "does not report healthy", and `LayerReport` is boolean. Warn-only; doctor still exits 0. The shared test baseline now opts capture in, because those cases exercise the liveness LOGIC. |
| 8 | `--inject` is an explicit opt-in on `instructions commit` | Doctor warns about the `AGENTS.md` block and never edits it; the write happens only when asked. The adopt flow's step 4 now names the command. |

---

## Discoveries & Learnings

| tag | what |
|---|---|
| Noteworthy | **Repo-local `trace2.eventTarget` really is ignored** (F-08 re-confirmed live): setting it locally left the probe using the global socket. The buffer path must come from the entrypoint's own env, which is what `harness commit` does. |
| Noteworthy | The `hermetic-git-fixtures` arch guard string-scans for trace2 env keys and cannot tell "sets it on real git" from "asserts a fake recorded it". Rather than weaken the guard, the env key is now an exported constant (`TRACE2_EVENT_ENV`) — better code, and the false positive is gone. |
| Noteworthy | An inline `import('…').Type` in a type position trips `services-ports-type-only` in dependency-cruiser — it reads as a runtime import. Converted to a top-level `import type`; arch-check returned to its 2-warning baseline. |
| Deferred | **Automatic nudge retry** — evidence now exists (spike (b)), deliberately not shipped in v1. See the decision above. |
| Deferred | **U-4 remains open**: only `git` and `node` are proven to run unsandboxed when allowlisted; the `harness` prefix itself is still untested from inside a Cursor sandbox. One-line test post-implementation. |
| Deferred | **U-1/U-2 (the transcript-sweep wake)** stay recorded-but-unrelied-on, exactly as the plan's non-goals require. The nudge is replay-only. |

---

## Gate

```
just checks → tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
              check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
              root-invocation-smoke:ok dd doctor:ok skills-check:ok
              arch-check:2  markdown-lint:196  windows-check:6      ← recorded baseline, unchanged
harness plan validate docs/plans/074-sandbox-attribution → 0 errors, 0 warnings, 0 open
```

Tests: **4911 → 4941 passing**, 337 → 339 files, no skips. 100 new assertions across six new
test files, every one fake-driven.

**No new production dependency.** The whole feature is `node:net` (probe/relay) and
`node:child_process` (the git adapter) — both Node builtins, both in adapters. No CI
test requires a running daemon, a real socket, a sandbox, or a network: every one drives
a fake port. The 073 surface changed additively only — one new verdict
(`ingress-blocked`), two new verbs (`commit`, `doctor telemetry-nudge`), new ports.
