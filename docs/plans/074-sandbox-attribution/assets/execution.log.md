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

---

## Fix round 1 — review `assets/reviews/phase-1-review.md` (FIX_REQUIRED, 7 findings)

Independent adversarial review found seven defects. All seven are closed, each with a test
that fails against the pre-fix code. The two HIGH findings share a theme, and it is the
same theme the plan exists to attack: **a recovery surface claiming more than it can
establish.**

| # | sev | what was wrong | what changed | the guarding test |
|---|---|---|---|---|
| F001 | HIGH | `commitShasIn()` unioned the sidecar with **every 40-hex token in the payload**. trace2's `start` event carries git's own argv, so `git commit -m "Revert <sha>"` enrolled an unrelated historical commit. That commit has no note (nothing pre-git-ai ever will), so the segment could never fully confirm — retained forever, and an innocent commit reported as missing attribution. | The **sidecar is the sole identity source**. The payload scan is gone: a scan over author-controlled text cannot establish identity, so it does not get a vote. A sidecar-less segment is `unconfirmable` — honest, reportable, never a guess. | `nudge.test.ts` — "a REVERT message in the trace2 argv never enrols a foreign commit" (asserts the foreign sha is never even *looked up*), plus "a segment with NO sidecar is unconfirmable even when its payload is full of shas". |
| F002 | HIGH | The only `retained` value was the segment the **current** run rotated. A later nudge with no live buffer returned `no-buffer` and called it "the healthy shape" while unrecovered segments sat beside it. | Nothing carries state between invocations, so **the directory listing IS the state**: every run enumerates `segment-*.jsonl`, inspects each against its sidecar, and reports all of them with a retry pointer. A run that leaves any segment behind is `retained` — never `replayed`, never a healthy `skipped`. `NudgeDeps.fs` gained `readdir`. | `nudge.test.ts` — "a run with no live buffer is NOT healthy while an earlier segment remains", "this run's success does not hide an earlier segment", and the negative control "a truly clean directory still reports the healthy no-buffer shape". |
| F003 | MED | The file-target commit branch named `telemetry-nudge --buffer <target>` — a command that *necessarily* skips, because the nudge rejects a non-`af_unix` ingress before it ever reads `--buffer`, and that branch's target is by definition a file. | Chose the honest option of the two the review offered: **the guidance names the prerequisite, in order** — reconfigure FIRST (there is genuinely nowhere to replay to until then), drain SECOND. Both the commit advice and the nudge's own skip text now say it that way. Also: the file branch now writes its **sidecar beside the file target**, so the eventual drain is confirmable instead of permanently `unconfirmable`. | `commit-service.test.ts` — asserts the *ordering* (`--install-collector` before `telemetry-nudge --buffer`), and that the sidecar is written; `nudge.test.ts` asserts the same ordering in the skip. |
| F004 | MED | `resolveTrace2Target()` treated git's disabled forms (`0`, `false`), fd forms (`3`–`9`) and relative paths as `{ kind: 'file' }`. `harness commit` then left trace2 unoverridden and told the operator their events were buffering in a file that will never exist. | Only an **absolute** path is a `file` target. Every other form reads `unconfigured` and takes the buffered branch, where the harness controls a real, drainable file. | `ingress.test.ts` — a table over `0`/`false`/`3`/`9`/relative asserting *not* a file target, plus an absolute-path table (POSIX, drive-letter, UNC). |
| F005 | MED | A relative `--buffer` was taken verbatim and the segment path built with `lastIndexOf('/')` — `-1` for a bare filename, producing the sibling `buffer.json` and a `rename` that threw out of a verb whose contract is never to. No containment either, on a verb that renames and deletes. | `--buffer` is **resolved** (`resolveInRepo`) and **contained**: inside the repo, or beside the configured trace2 file target — the two roots the harness or the operator's own git config named. Anything else is `buffer-refused`, untouched. Segment paths use `posixDirname`. Rotation and deletion failures **degrade** (`fs-error`, or the enumeration pass reports the survivor); nothing escapes as an exception. | `nudge.test.ts` — relative `--buffer` resolves correctly; `/etc/passwd` is refused with zero renames and zero deletes; a forced rename failure degrades; a forced delete failure is reported rather than thrown. |
| F006 | MED | `test/acts/doctor.test.ts` drove the production composition root, which built the real `NodeSocketProbe` — so on any machine whose global `trace2.eventTarget` is an `af_unix` path (every box with git-ai installed), the test performed a genuine `net.createConnection`. An ac-000a violation as shipped. | `registerDoctorAct` takes an optional `SocketOverrides` — **two fields, `probe` and `relay`, not one**, so ac-0007's read-only split survives the seam: the report path can only ever be handed a probe. | `doctor.test.ts` — a test that forces an `af_unix` target via `GIT_CONFIG_GLOBAL` (so the probe is *definitely* consulted, whatever the host config says) and asserts the **injected** fake received the call. |
| F007 | MED | `!result.ok \|\| result.sha === null` collapsed two different facts. A successful `git commit` whose follow-up `rev-parse HEAD` failed was reported as **commit failure, exit 1, "nothing was committed"** — for a commit that is really in the history, inviting a re-run and a double commit. | The two facts are separate. `CommitOutcome` gained `shaUnknown`; commit-success-with-unknown-sha is a **degraded** envelope that says "the commit is real — do NOT re-run", keeps the buffer recoverable, and explains that the segment will read `unconfirmable`. `envelopeFor` is exported so the exit-code claim itself is testable. | `commit-service.test.ts` — the unknown-sha path on both the direct and buffered branches, the negative control that a real git failure is *still* a failure, and an envelope test asserting degraded-vs-ok. |

### Decisions taken in this round

- **F001: deleted the "belt", did not narrow it.** The original comment argued a permissive
  scan was the safe direction because a false positive costs only a note lookup. That was
  wrong, and the review's counter-example is decisive: a false positive costs a segment
  that can **never** be deleted plus a false "missing attribution" report against an
  innocent commit. Identity is not a thing you guess at cheaply.
- **F003: chose "name the prerequisite" over "make `--buffer` work anyway".** The review
  offered both. Making it work regardless would need a socket path, and in the file-target
  state there is **no source for one** — git-ai's own config key is precisely what got
  overwritten. Inventing a default socket path would be another confident guess. The
  ordering fix is the one that keeps ac-0006 honest.
- **`FakeFs` fidelity left alone.** Making `writeText`/`rename` maintain parent directory
  listings (which real `readdir` would show) broke 12 telemetry tests that depend on the
  current behaviour. That is a real fake-fidelity gap and a genuine finding, but fixing it
  is a separate change with its own blast radius — **not** something to smuggle into a fix
  round. The nudge tests seed the directory listing explicitly instead, with a comment
  saying why. Logged as a difficulty, not silently absorbed.

### Gate after the fix round

```
just checks → tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
              check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
              root-invocation-smoke:ok dd doctor:ok skills-check:ok
              arch-check:2  markdown-lint:196  windows-check:6      ← baseline, unchanged
```

Tests: **4941 → 4967 passing**, 339 files, no skips.

One incidental find: `npm run lint` reports 10 biome **warnings** at `HEAD` that predate
this plan (`acts/plan/index.ts`, `acts/plan/pr-body.ts`, two telemetry tests). They are
warn-severity, so `biome check` exits 0 and the gate is green — they are recorded here,
not fixed, because they are unrelated to this plan.

---

## Fix round 2 — review `assets/reviews/phase-1-review.md` § Round 2 (FIX_REQUIRED)

Round 2 closed F001, F002, F004, F006 and F007. It left **F003 not closed**, a **coupled
defect in the otherwise-correct F005 guard**, and found a **new cross-repo regression** —
and all three are one root cause:

> **A `file` trace2 target is MACHINE-GLOBAL. Two mechanisms assumed it was repo-local.**

`trace2.eventTarget` is read from *global* git config only (dossier F-08), so a file target
is an absolute path outside the repository, shared by every repo on the box. Round 1 fixed
the two mechanisms independently and each one quietly assumed ownership of that path.

| # | what was wrong | what changed | the guarding test |
|---|---|---|---|
| F003 | The ordering advice ("reconfigure FIRST, then drain") was correct but **unexecutable**: the instant `trace2.eventTarget` is pointed back at the socket, the old file is no longer the *configured* target, and round 1's containment rule authorized only the configured one. The verb refused the exact path it had just told the operator to drain — `buffer-refused`. | **Authorize by RECORD.** `harness commit`'s file branch now writes the target path into repo-local, gitignored `.harness/temp/trace2/known-targets`. `resolveBuffer()` authorizes three roots: inside the repo, the *currently configured* file target, or a *harness-recorded* one. The path is trusted because **the harness wrote it down**, never because a caller supplied it. | `nudge.test.ts` — "F003 — reconfigure THEN drain actually works": the composed path end to end (file-target commit → records path + tagged sidecar → reconfigure to `af_unix` → nudge drains the external target, confirms, and deletes). `commit-service.test.ts` — the ledger is written, deduped, and written even when the sha is unknown. |
| F005 (coupled) | The containment guard itself is right and stays; its *two-root* rule is what made F003's remedy unreachable. | Widened by **one authorized source**, not by shape. An arbitrary out-of-repo path is still refused with zero renames and zero deletes. | `nudge.test.ts` — "F005 — the containment guard is NOT weakened": a repo *with* a valid recorded target still refuses `/etc/passwd`. |
| new | **Cross-repo sidecar poisoning.** `<target>.shas` accumulated every repo's shas. The nudge confirmed all of them against *this* repo's `refs/notes/ai`, where another repo's commit cannot resolve at all — so it read as "still missing a note" forever, the segment was retained forever, and unrelated commits were reported as unattributed here. | **Scope confirmation by repository; replay stays whole.** Sidecar lines are now `<sha> <git-common-dir>`. The nudge replays the **whole** segment (the daemon attributes each commit in its own repo — replaying a foreign event is correct, not a leak), confirms **only** this repo's shas, and reports the rest as *replayed and handed off*, naming the owning repo. Foreign entries never appear as missing and never block deletion. | `nudge.test.ts` — "two repos share one target" (run **both ways**: each repo confirms only its own sha, never looks the other's up, `handedOff` names the owner, and the segment is deleted so the lifecycle terminates), plus the leftover-segment and pre-identity variants. |

### Decisions taken in this round

- **Repo identity is the git COMMON dir, not the worktree root.** `git rev-parse
  --git-common-dir` resolves to the *main* repository's `.git` for every linked worktree,
  and `refs/notes/ai` lives there — shared by all of them. So a commit made in one worktree
  genuinely **is** confirmable from a sibling worktree, and the common dir is exactly the
  boundary of "shas this process can check". The worktree root would split one repository
  into several false identities and make sibling-worktree commits look foreign — inventing
  the very bug this fix removes. Read with `--path-format=absolute` (git 2.31+) so the same
  repo never reads as two identities depending on cwd; older git falls back to the bare read
  resolved against cwd rather than reporting a wrong identity.
- **Deletion rule: every OWN sha confirms, and no own sha remains unconfirmed.** A segment
  whose commits are *all* foreign is deleted after a successful replay. This is **not** the
  vacuous confirmation the no-sidecar branch still refuses: there, identity is *unknown*;
  here it is known precisely, and known not to be ours. Retaining instead would let foreign
  entries block deletion forever and make every later run in this repo report a segment it
  structurally cannot clear — the same false alarm, one invocation later.
- **A pre-identity (untagged) sidecar entry is read by LOCATION, not by a guess.** A sidecar
  *inside* the repository was written by it — that is the existing `.harness/temp/trace2/`
  case and it is correct, so every round-1 test keeps passing untouched. A machine-global
  one could belong to anybody, so it is handed off rather than claimed. Guessing "ours"
  there would re-create the accusation bug for legacy files; guessing "theirs" for the local
  buffer would stop confirming commits we really made.
- **`handed-off` does not flip the status.** `withRemainingSegments` lists a foreign segment
  but does not count it as unrecovered. Naming it is honest; owning it is not.

### Gate after the fix round

```
just checks → tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
              check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
              root-invocation-smoke:ok dd doctor:ok skills-check:ok
              arch-check:2  markdown-lint:196  windows-check:6      ← baseline, unchanged
```

Tests: **4967 → 4976 passing**, 339 files, no skips.

## Fix round 3 — F008: a machine-global target can live INSIDE the repository

Round 3 closed everything except one edge in round 2's own repair. The untagged
(pre-identity) fallback was "a sidecar inside the repository is ours". That is true of the
harness's own directory and **false** of a global target that merely happens to sit there:
`trace2.eventTarget` is read from SYSTEM and GLOBAL config only, but nothing stops the path
it names from being `<repo>/trace2/agent.jsonl`. An untagged **foreign** entry there was
claimed as own, queried against a note that cannot exist in this object store, reported as
missing, and the segment retained forever — the permanent retention this plan exists to
kill, reappearing through the migration format. The reviewer's probe went RED on it.

| # | what was wrong | what changed | the guarding test |
|---|---|---|---|
| F008 | `partitionByRepo`'s `sidecarIsRepoLocal` came from `isWithin(cwd, path)` — a whole-worktree containment test. A machine-global file target inside the worktree passed it, so its untagged history was claimed rather than handed off. | **Narrowed to ours BY CONSTRUCTION.** New `isHarnessOwned()` tests containment against the harness's **default buffer directory** (`<repo>/.harness/temp/trace2/`) and nothing else — the directory `harness commit` creates, writes, and gitignores, which no configured `eventTarget` can land in. Both call sites (`inspectSegment`, `runNudge`) use it. Untagged entries at a *configured* or *recorded* target are ambiguous by definition and are handed off. | `nudge.test.ts` — "F008 — an untagged entry at a global target inside the repo is handed off, not claimed" (the reviewer's scenario: replayed whole, `handedOff=[{sha, repo: null}]`, never queried locally, segment **and** sidecar deleted so the lifecycle terminates); "…the same rule holds on the enumeration path" (leftover segment named, not owned, nothing touched); and the negative control "an untagged entry in the HARNESS default dir is still ours" (`partial`, `stillMissing=[sha]`, `hasAiNote` *was* called). |

The four-way partition the fix preserves, stated once:

| identity | outcome |
|---|---|
| known and ours | confirmed against `refs/notes/ai`; gates deletion |
| known and not ours | replayed, handed off, delete-eligible, never accused |
| **unknown, in a shared/configured location** | replayed, handed off — **never claimed, never accused** |
| no sidecar at all | `unconfirmable`, retained (unchanged) |

Mutation check: reverting `isHarnessOwned()` to the old whole-worktree test turns both new
guards RED and leaves the negative control and all 40 prior nudge tests green — so the
guards bite on exactly this rule and nothing else.

### Gate after the fix round

```
just checks → tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
              check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
              root-invocation-smoke:ok dd doctor:ok skills-check:ok
              arch-check:2  markdown-lint:196  windows-check:6      ← baseline, unchanged
```

Tests: **4976 → 4979 passing**, 339 files, no skips.

## Fix round 4 — review r4 (F009): the heuristic was DELETED, not narrowed again

Round 4's verdict closed F008's original case but rejected the repair's premise. The
reviewer set a global `trace2.eventTarget` to `/repoA/.harness/temp/trace2/buffer.jsonl` in an
isolated `GIT_CONFIG_GLOBAL` and git read it back verbatim — so a foreign pre-identity sidecar
can sit in the one directory round 3's predicate trusted most. The probe went RED there.

**The shape of the mistake, three rounds running.** Each time, the defect was the *fix's own
assumption*, always the same species:

| round | the assumption | how it died |
|---|---|---|
| r1 | identity inferred from payload text | a `Revert <sha>` message enrolled an unrelated commit → the scan was deleted |
| r3 | ownership inferred from "inside the repo" | a machine-global target legally sits inside a worktree → narrowed to the harness dir |
| r4 | ownership inferred from "the harness dir" | a global target can be configured INTO the harness dir → **stop narrowing** |

Each narrowing produced a smaller *wrong* claim, never a right one. The reviewer's finding is
general and correct: **path location cannot prove provenance.** A location the harness merely
*prefers* is not one it can *prove*, and any rule of that shape has a next counterexample.

| # | what was wrong | what changed | the guarding test |
|---|---|---|---|
| F009 | `isHarnessOwned()` presumed an untagged entry under the harness's default buffer directory was ours *by location*. Git accepts any absolute path for the global `trace2.eventTarget`, including that one, so a foreign pre-identity sidecar there was claimed, queried against a note that cannot exist in this object store, reported missing, and its segment retained forever. | **`isHarnessOwned()` DELETED**, and with it every location-based ownership inference (`grep` proves no caller remains). `partitionByRepo` now takes only the entries and this repo's identity, and returns **three** buckets. An untagged entry — or any entry when our own common dir is unreadable — is `unknown`: replayed whole, never queried, never claimed, never accused, and its segment **retained and reported**. `HandedOffSha.repo` tightened from `string \| null` to `string`, so the type itself now carries the invariant that a handed-off sha always names its owner. | `nudge.test.ts` R4 block — "F009 — a global target configured INTO the harness buffer path is still unprovable" (the reviewer's scenario: replayed, `hasAiNote` **never** called for it, `unconfirmable`/`retained`, segment kept, detail + `next_action` carry the reason and the operator instruction); "F008 collapses into the same arm"; "**the LOCATION heuristic is gone** — the same untagged sha reads the same everywhere" (one sha planted in the harness dir, an in-repo global target, and `/tmp` — all three must return `unconfirmable`); "a TAGGED sidecar is unaffected"; "a MIXED segment confirms what it can prove and keeps what it cannot". The R2 test that asserted the location rule was rewritten to assert its absence, and round 3's negative control — which encoded the disproved rule — was **removed**, not repaired. |

**Three arms, all provable, and no fourth:**

| entry | arm | outcome |
|---|---|---|
| origin recorded = this repo's git common dir | **own** | confirmed against `refs/notes/ai`; gates deletion |
| origin recorded = another repo | **handed off** | replayed, delete-eligible, never accused |
| origin NOT recorded (or ours unreadable) | **unknown** | replayed, never confirmed, never accused, segment RETAINED + reported |
| no sidecar at all | (same as unknown) | `unconfirmable`, retained (unchanged since r1) |

**Why retention is acceptable here.** It is *visible*: every run reports the segment with a
reason (`UNKNOWN provenance — written before sidecars carried repo identity`), the shas, and a
concrete operator instruction (check the attribution-at-risk row in whichever repo made them,
then delete the segment and its sidecar). No auto-resolution was invented and no CLI surface
was added this late. Visible-and-stuck beats silently-wrong, and this is a legacy-only path:
every sidecar written since ac-0005 carries repo identity, so it ages out on its own.

Mutation checks (both restored afterwards):

- Reintroducing round 3's exact predicate (`isWithin(dirname(defaultBuffer), path)`) → **4 RED**,
  including the "heuristic is gone" structural guard.
- Removing the `unknown.length === 0` gate on the delete branch → **4 RED**.

Sidecar fixtures in the test file now use the REAL tagged format (`<sha> <repo>`); a new
`sidecarUntagged()` helper marks the legacy shape explicitly, so no test can quietly depend on
untagged-means-ours again.

### Gate after the fix round

```
just checks → tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
              check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
              root-invocation-smoke:ok dd doctor:ok skills-check:ok
              arch-check:2  markdown-lint:196  windows-check:6      ← baseline, unchanged
```

Tests: **4979 → 4981 passing**, 339 files, no skips. `plan validate --complete`: 0 errors,
0 warnings, 0 open, 130 items. `docs/how/gitai-collector.md` step 4 rewritten — it stated the
disproved rule.
