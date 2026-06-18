# Execution Log — the-flow skill migration (plan 027)

**Phase**: Build (Simple, 1 phase) — groups A (migrate prompts) · B (eval harness)
**Started**: 2026-06-18
**Mode**: `implement --companion` (code-review-companion)

## Run notes / deviations

- **T-B1 pulled forward.** `.minih.json` was broken (sources → deleted `skills/eng-harness-{setup,loop}`), which blocks **all** `minih run` (companion *and* eval). Fixed it first so the companion can boot — per the user's "fix the minih skills settings before it runs."
- **Companion review is diff-based, not commit-based.** Per the standing constraint (commit only when explicitly asked) the migration edits are **not** committed. The companion is fed working-tree diffs as review-requests instead of commit SHAs — same "live second pair of eyes," no commits.
- **Edit target**: the tools-repo SOURCE `~/github/tools/skills/SDD/the-flow/` (workshop 004 deploy rule); the deployed `~/.claude/skills/the-flow/` stays the un-migrated baseline (also the AC-05 negative-test copy).

## Tasks

### T-B1 — Fix `.minih.json` (pulled forward) ✅
- **Root cause (deeper than the plan assumed):** under `~/.claude/skills`, `the-flow` + `eng-harness-flow` are **symlinks** into `~/.agents/skills/`; minih's `path:` child-scan does **not** follow symlinks, so it discovered only the 3 real dirs there → `include` failed (`E211`). That same failure aborted the first companion boot.
- **Fix:** point `sources` at `path:/Users/jordanknight/.agents/skills` (the real dirs). `minih skills doctor` → `status: ok`, resolves `the-flow` + `eng-harness-flow`; `minih run` no longer needs `--no-skills`. **AC-04 met.**
- **Upstream correction owed:** workshop 005 D1 + plan AC-04/AC-05 cite `~/.claude/skills` — wrong (symlink trap). Negative-test baseline path is `~/.agents/skills` (the real deployed copy, inode-distinct from the tools-repo source → discrimination is viable). Synced after the build.

### T-A1 — Create `flight-plan-ops.md` (7 sections) ✅
- Target: `~/github/tools/skills/SDD/the-flow/references/flight-plan-ops.md` (the tools-repo SOURCE).
- **Deviation from workshop 004 §2 (logged):** the "lift verbatim" §2 block shows `harness flow cursor --to`/`--recommend` to teach the migration — but those literal strings would **fail the workshop's own AC-01 grep** (`flow cursor|--recommend`). Rewrote §2 to teach the same cursor→nav mapping without the trip-strings (bare "cursor verb" is allowed; `flow cursor`/`--recommend`/`recommended_next`/`"cursor"` are not). Workshop 004 §2 has a self-contradiction worth flagging upstream.

### T-A2..T-A8 — Group A migration ✅
- **T-A2** cursor→nav fix in the `00-routing.md` cadence (advance bullet) → `nav set --now/--next/--clear-next`.
- **T-A3** SLIMmed the cadence block (steps 1–2): inline flags moved to `flight-plan-ops.md`, the routing-level *when* kept — the engine is demonstrably leaner (00-routing.md net −3 lines despite added content).
- **T-A4** `--agent the-flow` on all 4 `flow create` sites (`00-routing.md:31` + initial `nav set --now research`; `00-routing.md` legacy E308; `coach.md` back-fill; `SKILL.md` E308).
- **T-A5** precheck probe (`SKILL.md`) now names `nav`/`rail`.
- **T-A6** loader wired into the engine contract — `SKILL.md` "Two load paths" + `00-routing.md` § Flight plan Prerequisite → **AC-02**.
- **T-A7** `template.json`: removed top-level `cursor`/`recommended_next`/`now`/`next` → one `nav` block; `schema.json:5` `flow cursor`→`nav` (that line itself tripped AC-01); `template.md` verified in-sync + grep-clean — **no regen** (the worked-example template has no `provenance` → not CLI-renderable, would `E308`; already shows `[the-flow]`).
- **T-A8 / AC-01 ✅** grep gate returns nothing; 9 nav refs, 1 rail ref, 4 `--agent the-flow` create sites. **AC-02 + AC-03 met.**
- Companion `code-review-companion` (run `…d552`) briefed + sent the group-A diff (`.harness/temp/flow-eval/group-a-migration.diff` + new-file copy) for review — diff-based, no commits.

### T-B2..T-B4 — Group B eval harness ✅ (built)
- **T-B2** `agents/flow-skill-eval/` scaffolded: `prompt.md` (role-play the user; drive research→plan→workshop-excursion→nav; redirect flight-plan `--path` to `.harness/temp/flow-eval/$MINIH_RUN_ID`; report observed signals, never self-grade), `output-schema.json`, `input-schema.json` (intent), `instructions.md` (autonomy contract). One-shot (no `coordination` — avoids minih 0.2.2 peer false-positives). No `agent.json` needed (minih requires only `prompt.md`).
- **T-B3** `.harness/temp/` already gitignored (`.gitignore:159`) — verify-only.
- **T-B4** `scripts/score-flow-eval.sh` — 5 GATES (rail `[the-flow]` · rail clean · ≥1 workshop AND all `branch_of` · spine research+plan+phase · render exit 0) + advisory nav/cursor events grep; run dir from `minih last-run`; ≥1-workshop vacuous-pass guard; `bash -n` clean.
- **Discriminator = GATE 1**: the migrated `create` passes `--agent the-flow` → rail `[the-flow]`; the un-migrated deployed copy omits it → slug-titled rail → GATE 1 fails. (AC-05 discrimination rests here, not on the events grep.)

### T-B5 — Run the eval (in progress)
- Candidate resolution verified via `minih skills discover --skill-source path:~/github/tools/skills/SDD --skill the-flow` → serves the MIGRATED source.
- Positive run launched (background): `minih run flow-skill-eval --param intent="add a foo widget" --skill-source path:/Users/jordanknight/github/tools/skills/SDD --skill the-flow --skills-debug --verbose`. Negative run (un-migrated `~/.agents/skills`) follows to prove discrimination (AC-05).

### T-B5 results — positive eval PASS ✅
- Positive run `…ff02` (migrated candidate) completed + validated. **Deterministic scorer PASSED all 5 gates** (exit 0) on `.harness/temp/flow-eval/…ff02/the-flow.json`:
  - rail `[the-flow] ◆─◆─[ ◇ ]─◇  Research · Plan ─ [ Phase 1: Add Foo Widget ] ─ Merge` · rail clean · ≥1 workshop all `branch_of` · spine research+plan+phase · renders · events show nav not cursor.
  - → **AC-06 proven** + positive half of **AC-05** (verified by the scorer, NOT the agent's self-grade). Agent workedWell: `insert-node --branch-of plan --rejoin phase-1` kept the workshop off the rail.
- Negative run `…` launched (un-migrated `~/.agents/skills`) → expect scorer **non-zero** (discrimination).

### Companion review — APPROVE_WITH_NOTES, 2 MEDIUM (both addressed)
- **F-companion-1 (MEDIUM — a real bug I introduced):** T-A4's `harness flow nav set --now research` lacked `--path` → a verbatim first guided run would fail. **FIXED** → `nav set --path docs/plans/<ord>-<slug>/the-flow.json --now research`. The eval agent masked this (it added `--path` itself); the companion caught it in the diff — exactly its value.
- **F-companion-2 (MEDIUM — template.md drift):** row 11 regen was skipped. Confirmed `template.json` `E308`s (no provenance) → added a `provenance` block (also removes a latent "copy-this-and-it-`E308`s" trap) and regenerate `template.md`. [in progress]
- Companion's own magicWand was minih-layer (SDK tool cwd vs `$MINIH_PROJECT_ROOT`) — known minih gripe, not a migration defect. Companion verdict: **APPROVE_WITH_NOTES**.

### T-B5 — discrimination FAILED first pass → eval prompt fixed (the iterate loop)
- **Negative run `…524e` (un-migrated deployed copy) PASSED the scorer (exit 0) — discrimination BROKEN.** The negative test did its job: it exposed an eval-design flaw, not a migration flaw.
- **Root cause** (from the negative report): the eval **agent prompt over-prescribed the target** — it named `create --agent the-flow`, `nav set`, `insert-node --branch-of` as the commands to "follow." A smart gpt-5.5 agent read those as the *goal* and **rescued the broken skill**: it added `--agent` and used `nav set` even though the un-migrated skill omitted `--agent` and prescribed the removed `cursor` verb (agent's own words: *"the fresh-start text omitted `--agent the-flow` while the eval expected a [the-flow] rail"*; `cursorCalled=true`).
- **Fix (faithful prompt — iterate #2):** rewrote `agents/flow-skill-eval/{prompt.md,instructions.md}` to (a) remove ALL target leakage (no pre-named commands, no "expect [the-flow]"), (b) require running EXACTLY what the skill prescribes with exact flags (only `--path` may change; never add `--agent`, never swap `cursor`→`nav`), (c) treat any errored command as a STOP-and-report finding, never worked around.
- Re-running BOTH with the faithful prompt: negative must now **FAIL** (un-migrated → slug rail + cursor error), positive must still **PASS** (migrated prescribes `--agent` + `nav`).

### T-B5 results — discrimination PROVEN ✅ (faithful prompt, iterate #2)
Same faithful agent prompt, two skill sources:
- **Positive (migrated `…0a1f`):** rail `[the-flow] ◆─◆─[ ◇ ]─◇  Research foo widget · Plan foo widget ─ [ Phase 1: Add foo widget ] ─ Merge`; `navUsed=true`, `cursorCalled=false`, workshop as `branch_of`. **SCORER EXIT 0 (PASS)** — all 5 gates + advisory.
- **Negative (un-migrated `…4aa2`):** rail `[foo-widget] ◆─◇─◇  Research · Plan ─ Merge` (slug — create omits `--agent`); `navUsed=false`, `cursorCalled=true`; the faithful agent **stopped at `error: unknown command 'cursor'`** instead of rescuing. **SCORER EXIT 1 (FAIL)** at GATE 1.
- → **AC-05 fully proven** (scorer 0 on migrated / non-zero on un-migrated; ≥1 attached workshop) + **AC-06** (clean `[the-flow]` spine-only rail, workshop excursion).

## Phase complete — all 6 ACs satisfied (deterministically, not self-graded)

| AC | Verdict | Evidence |
|----|---------|----------|
| AC-01 | ✅ | grep gate returns nothing across the source; `template.json` has a `nav` block |
| AC-02 | ✅ | `flight-plan-ops.md` (7 §) exists **and** wired into `SKILL.md` "Two load paths" + `00-routing.md` § Flight plan |
| AC-03 | ✅ | 4 `flow create` sites carry `--agent the-flow`; advance uses `nav set` |
| AC-04 | ✅ | `minih skills doctor` → `ok` (the-flow + eng-harness-flow resolve via `~/.agents/skills`) |
| AC-05 | ✅ | scorer exit 0 (migrated) / exit 1 (un-migrated); ≥1 attached workshop required |
| AC-06 | ✅ | `minih run` → `[the-flow]` spine-only rail, workshop as excursion |

**Companion debrief (T-B6):** `code-review-companion` (run `…d552`) reviewed group A live → **APPROVE_WITH_NOTES**, 2 MEDIUM, **both fixed** (nav `--path`; `template.md` regen via added provenance). It exited cleanly via `idle_budget` — no live drain/stop needed (sub-skill's "companion completed before final ping" path). Its own magicWand was minih-layer (SDK non-shell tool cwd vs `$MINIH_PROJECT_ROOT`), not a migration defect.

**Residual observations (not blockers, out of scope for cursor→nav):**
- Both eval agents hit empty `MINIH_PROJECT_ROOT`/`MINIH_RUN_ID` in-shell (known minih gripe) — worked around; not re-surfaced as a new finding.
- Eval magicWand: the-flow guided mode could support a caller-supplied scratch working-root (derive *all* artifacts from it, not just the flight-plan `--path`) — a future the-flow enhancement.
- **Upstream corrections owed to the workshops** (the `~/.claude/skills` symlink trap; workshop 004 §2's AC-01 self-contradiction) — noted inline; sync to 004/005 when convenient.
- **Deploy not done** (separate gated step): land the CLI first, then promote the migrated source `~/github/tools/skills/SDD/the-flow` → deployed `~/.agents/skills/the-flow`.
- **Nothing committed** (standing constraint: commit only on explicit ask).
