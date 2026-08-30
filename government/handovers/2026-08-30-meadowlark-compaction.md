# Handover — pij-massive-meadowlark pre-compaction (2026-08-30 ~17:55 local)

Seat: o-prime, harness-engineering. Claude session 6616ca6a-61c0-4a92-b9be-3512605a2826.
Window `prime`. Read this + government/how-we-work.md + briefs/backlog.md before acting.

## State: CLEAN. Nothing in flight. Parked `waiting`.

Main = ef895a3c + release commit; machine rebuilt and current (npm ci + build done;
live `harness convo sync` verified). All 091-era worktrees/seats torn down. The
governance branch (prime-governance, THIS worktree ../governance) is the durable
record — rulings, 22-row backlog, retro, this file.

## Today shipped (all merged, CI-green on verified shas)
- #184 ddocs bump (dd pin → de01b77a; dd→ddocs rename swept, 31 files)
- #185 settings machinery + `harness convo sync` (plan 091 proving packet)
- #187 collision-skip (extension/core name clash can no longer brick the CLI)
- #188 dispatch fix (--pij argv bug + DOA detection with exit codes)
- Conversation sync LIVE, confirmed end-to-end by 3 governments (us, fs3, dd);
  enabled in this repo (tracked .harness/settings.json), pij (#321), dd (7f0fa0d);
  fs3 enabled post their convo→fs3-convo rename.
- Retro: records/retro/2026-08-30-plan-091-and-the-first-fleet-day.md (the 9-instance
  packet's-law arc). Compare-notes with lynx CLOSED by summary (their row 108).

## v0.14.0 — HALF-RELEASED, the one open operational item
Tag + GitHub release EXIST (published 07:43Z). npm publish FAILED: publish job's
hardened npmrc refuses git deps (EALLOWGIT) on `@ai-substrate/dd@github:...#de01b77a`.
DO NOT loosen the publish job (provenance hardening — deliberate).
THE CURE (Jordan concurred): dd publishes to npm → swap our pin to `^0.1.0` (one
small PR) → republish. Kills three problems: this, bun row 5, pin rot.
Jordan's human pieces: RELEASE_PLEASE_TOKEN + npm trusted-publisher entry on
AI-Substrate/dd + name-availability check FROM AN UNMANAGED NETWORK (both our
machines proxy-blind; dajeil's workflow is one `branches:` line from armed).

## Standing grants (rulings/ has verbatim texts — cite, don't re-derive)
- 2026-08-30-merge-train-grant: push/CI/merge FLEET-VERIFIED branches without
  asking; NEVER auto-merge non-fleet PRs (dependabot #183/#76 sit open on purpose);
  rebuild machine after merges.
- prime-governance branch: prime pushes directly, never merges to main.
- Per-branch flow: push → `just ci` (refuses on drift) → match run headSha to
  branch head → PR → squash-merge. Row 19: live-daemon-note.int.test.ts is a
  CI-only load flake — rerun isolated before believing a red.

## Fleet / roster
- coral (pij-vicarious-coral): PM, OPEN, first-pick for multi-unit plans. All
  coder seats closed. Spawn form is PINNED VERBATIM in how-we-work ritual 5
  (`cd <wt> && pij spawn --harness pi --bin omp ... --effort high`; --bin omp
  MANDATORY for -1m selectors; rename the tmux window after spawn).
- Peers: lynx (fs3 o-prime), dajeil (dd prime), vicuna (pij o-prime) — all warm;
  symmetry pact with lynx (first honesty-fix sends the shape, other mirrors).

## Next packets, in the order I would run them
1. Backlog 21: convo auto-identity resolves like `pij whoami` does (PIJ_SESSION_ID
   absent in terminal shells; info provably exists) — unlocks push-side sync from
   prime-like seats.
2. Backlog 22: `--verify` read-back on the explicit command, raising the claim to
   DELIVERED (2 instances, 2 governments behind it; seams stay fire-and-forget).
3. Backlog 13+2: commit-service.ts:496 detail-string overclaim + report-note-as-
   data attribution fix (design: scratch/attribution-verify-fix-design.md in MAIN
   checkout scratch/ — NOTE scratch is gitignored, survives only on this machine).
4. Row 5 pin swap the moment dd publishes.
5. Parked bigger: s077 audit (157 unshipped commits, fan-out candidate), bun
   (blocked on row 5), boot/127 sensor tax (rows 14-15).

## Traps that bit TODAY (doctrine now, but the fresh scars)
- A silent python-replace no-op nearly reported as encoded — verify every
  governance edit landed (grep count + non-empty commit).
- My own probe truncations manufactured false counts twice (head -12 as "12
  commits"; grep pattern missing multi-line forms). Open the file.
- "Live proof" against fs3 proved nothing — their rename had landed; the world
  changes under probes. Fixtures carry proof; see the fixture rule.
- Envelope language: fired ≠ delivered; survived-grace ≠ delivered; read-back is
  the only delivery proof and it is OUT-OF-BAND today.

## Untouchables (standing)
Never git add -A in the MAIN checkout (other sessions' work; .gitignore stays
modified+unstaged, byte-stable). Never write the-flow files. Never start/stop
fs3's prod daemon (operator = lynx). Never print the jakkaj token. Worktree cwd
resets between Bash calls — use git -C / absolute paths.
