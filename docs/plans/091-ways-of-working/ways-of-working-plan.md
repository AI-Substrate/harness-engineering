# Plan 091 — Adopt the pij-team way of working (settings, government, fleet)

**Status**: LYNX-APPROVED-AS-READ (4 notes, encoded) — awaiting Jordan GO
**Pending ruling**: prime-governance ORPHAN BRANCH (Jordan iterating; see below)
**Prime**: pij-massive-meadowlark · **Source**: Jordan directive 2026-08-30 +
lynx operations interview (`flowspace3/scratch/meadowlark-operations-interview.md`)

## Intent (Jordan, near-verbatim)

Adopt lynx's fleet way of working here: government + settings, prime writes plans
and impl-guides in worktrees, PMs orchestrate, coder workers execute, cross-model
review. Model roster per Jordan: "opus 5 PMs, gpt 5.6 sol fast high workers" —
confirmed current by lynx and by fs3's settings.dd.json.

## Phase 1 — Government skeleton (prime, solo, this branch)

Create `government/` additions mirroring fs3's inventory, adapted:
- `government/how-we-work.md` — operating manual; Jordan's preamble is DIRECTIVE.
- `government/worker-roster.md` — seat ↔ domain ↔ native session id ↔ status.
  (git authorship is a null signal — every seat commits as Jordan.)
- `government/rulings/` — exists here already; adopt fs3's convention: one file
  per binding decision, dated, QUOTING Jordan verbatim; reversals name what they
  reverse.
- `government/briefs/backlog.md` — the numbered defect/idea ledger (lynx: "the
  single most-load-bearing file I own").
- `government/settings.dd.json` — the model roster, copied SHAPE from fs3
  including meta.source (verbatim ruling provenance) and per-role `note`
  carrying the operational trapdoors. Initial rows (verified against fs3 +
  Jordan's words; canary before first real assignment):
    pm:       pi/omp github-copilot/claude-opus-5, effort medium
    coder:    pi/omp github-copilot/gpt-5.6-sol-fast-1m, effort high
              (note: never append :high to the selector; effort rides --effort;
               runtime effort is a DISCLOSED proof gap — pij#306)
    reviewer: pi/omp github-copilot/gpt-5.6-sol, effort high
              (different FAMILY from coder by design — self-agreement is the
               reviewer failure mode)

## Phase 2 — Settings machinery (ONE proving packet through the new pipeline)

The deliverable Jordan already directed (ingest command) rides on this.
Per lynx G4: hand-consume the settings FILE first; build machinery once the
shape stops moving. So:
- 2a (prime, cheap): the settings file lands in phase 1 and is hand-consumed.
- 2b (THE proving packet, 1 PM + 1-2 coders): `services/settings/` — pure
  resolver + FsPort loader, tracked `.harness/settings.json` + gitignored
  `.harness/settings.local.json`, merged with **split-by-nature** (lynx A4
  correction, adopted): local wins ONLY inside its machine-fact namespace; a
  governance key in the local file is REFUSED loudly, never merged. Origins
  (`default|repo|local|kill-switch`) on every resolved value. Self-gitignore on
  first local write (trace2-buffer pattern). Malformed/unknown-major = refuse
  loudly. `HARNESS_NO_TELEMETRY` stays absolute.
- 2c (same packet or rider): `harness convo sync` — detection gate (command -v +
  ping, measured 0-10ms vs 360ms fire), resolve harness+session from the hook
  payload's transcript_path (NEVER journalled — existing PII contract), fire
  `flowspace3 conversation ingest --harness <h> --session <id> --folder <root>`
  fire-and-forget. Gated on `flowspace.ingest.enabled`, default false. Commit
  seam primary + boot drain. Envelope says so ONCE when enabled-but-unreachable.
  Smoke proof (lynx correction 2, adopted): the INCREMENTAL contract — fire ingest
  twice against a session that grew between fires; the receipt must show run 2
  ingesting ONLY the new turns under the SAME conversation identity (fs3 measured
  +243-turn re-run; copy that proof shape). A second full ingest = FAIL.

## Phase 3 — Rituals (adopted as written, fs3-proven)

- ack-before-code (numbered plan; "restatement + will proceed" gets ruled back)
- verify-then-relay as LAW; [INFERENCE] quarantined until someone opens the file
- receipts-or-not-done (exact commands + tails; mutation-checked tests)
- canary-before-trust on every fresh spawn (identity echo: id/cwd/model)
- worktree-per-packet, cut from current origin/main; prime merges, never coders;
  later-lander adapts on API collision
- teardown: BEFORE any tidy — `git -C <wt> status --short` + sweep known dossier
  paths (scratch/, assets/), copy live material out, THEN tidy. Encode lynx's
  wanted improvement when we build tidy here: stash-rescue dirty files to a named
  rescue dir and print the path. (lynx's scar, D3 + our own s090/dossier trap.)

## Deliberately NOT yet (lynx G4, adopted)

Standing PM seats · reviewer seats for small packets (CI + prime carries them) ·
fan-out beyond the proving packet · settings machinery beyond 2b · run-analysis
seat. Width follows demonstrated disjointness. First genuine fan-out candidate
when Jordan wants it: the s077 salvage (157 unshipped commits, cleanly
per-subsystem decomposable).

## Known divergences from fs3 (deliberate)

- Rust-isms diverge freely (CARGO_TARGET_DIR → per-seat env as applicable here).
- `harness team new/tidy` exist in FS3'S repo extensions, not here — verified by
  running it (top-level help = verb absent, the #162 trap). Porting them is a
  backlog row, not a phase-1 blocker; worktrees are cut by hand until then.
- Our government/ lives at repo root (existing convention), not .harness/.

## Done-bar for the plan itself

Phase 1 files exist and Jordan has ruled the preamble; the 2b/2c packet has gone
through packet → ack → code → receipts → prime merge as the end-to-end proof;
frictions logged to EXPERIENCES + relayed to lynx.

## Governance storage — discovery + pending ruling (2026-08-30)

DISCOVERY: `/government/` is GITIGNORED by standing rule (.gitignore:166-167,
"pij prime government — local orchestration state, never committed") and has ZERO
tracked files at HEAD. The phase-1 skeleton therefore CANNOT land on a normal
branch at that path — my draft plan was wrong to assume it could.

This converges with Jordan's in-flight idea (via lynx): a dedicated ORPHAN BRANCH
with a standing worktree — governance/PRD/backlog committed and pushed freely
there, never merged to main. That shape resolves the contradiction exactly:
durable + versioned + pushable, while main's gitignore rule stays byte-stable
(standing ruling: never modify it).

Plan posture: skeleton files are WRITTEN in this worktree and correct in content;
where they LIVE follows Jordan's ruling. If orphan branch: adopt from day one.
If not: the fallback is .harness/government/ (tracked there, not at root).
