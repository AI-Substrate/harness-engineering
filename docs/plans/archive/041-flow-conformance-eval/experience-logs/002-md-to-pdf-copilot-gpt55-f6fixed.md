# Experience Log 002 — md-to-pdf re-run · copilot gpt-5.5 · F6-fixed

**Started**: 2026-06-30 · **Orchestrator**: Claude Opus 4.8 (`pij-4s10mb`)
**Subject**: copilot `gpt-5.5` (`pij-1wlpdla`, pane %320) — BLIND
**Scenario**: `live-testing/scenarios/md-to-pdf/` · follows run 001 (see log 001 for F1–F10)

## The hypothesis under test (F6 → F7)
Run 001 found the eng-harness-flow LOOP never engaged (F7: no boot/observe/retro
verbs). Leading hypothesis: **F6** — eng-harness-flow's `description` was >1024 chars,
which `skills-check` says makes "host CLIs silently skip the skill"; if copilot skipped
it, the-flow's seam calls had nothing to route to.

**Changed since run 001**:
- ✅ F6 fixed + **redeployed to `~/.agents`** (deployed description now under cap;
  confirmed live via the host skill list).
- ✅ F8 fixed (parser gap + verb-signature fallback) — so the score will now be honest
  for copilot (the-flow → pass, eng-harness-flow → fail-if-absent, not false-fails).

**The question**: with eng-harness-flow no longer skippable, does the harness loop now
engage? (Watch `harness_verbs` for `observe`/`retro`/`boot`/`backpressure`, and the
flight-plan chore statuses flipping off `assumed`.)

**Protocol**: identical to run 001 (canary → blind packet → process nudge to use
/the-flow → drive cadence explore→plan(Simple)→validate→compact→implement→review→fix→
validate → score). One variable changed (F6). Same stop-if-off-track rule.

## Timeline
- `setup` — redeployed F6; closed run-001 peer `pij-1kil8kw` + cleaned its worktree;
  spawned fresh subject `pij-1wlpdla`.
- `canary` PASS (gpt-5.5) · `blind+nudge` delivered · subject made worktree
  `…-mdpdf-pij-1wlpdla`.
- `explore DONE` — dossier written; cadence clean. Harness-loop verbs so far: **only
  `harness worktree`** (no boot — boot should fire at pre-flight; it didn't).
- `plan+validate DONE` — real Simple plan; notably designed a **rendered-diagram
  validation sensor as a first-class AC** (strong backpressure-quality thinking,
  unprompted). validate-v2 ran (found ~3 plan fixes).
- **⚑ DIVERGENCE FROM RUN 001**: subject's plan-complete report says *"the flight plan
  shows **Backpressure survey due before coding**."* → it is **reading the harness
  chores off the flight plan** and surfacing the pre-coding seam. (Run 001 never
  acknowledged the chores.) The F6 fix may have made eng-harness-flow legible again.
  **Open**: will it EXECUTE the survey, or just note it? (the advisory-skip test)
- `compact + implement` cued — phrased to follow its flight-plan cadence (incl. due
  pre-coding items) WITHOUT naming boot/observe/retro (no contamination).
### ⚑ KEY RESULT (F6→F7) — CONFIRMED: F6 WAS the cause; loop fully re-engaged
> **Correction note**: a mid-build snapshot of truncated narration made me prematurely
> write "advisory-skip persists." The orchestrator (user) pushed me to look at the
> subject's own narration just before its replies — and the **flight-plan ground truth**
> overturned that read. Recorded honestly: the early call was wrong.

- **Ground truth (flight-plan chore statuses, run 002):**
  `backpressure → DONE · boot-1 → DONE · observe-1 → DONE · retro-1 → DONE`
  (`retro-ship` still `assumed` — that's the ship-stage harvest, not yet reached).
- **A REAL retro record was written this run**:
  `.harness/records/retro/2026-06-30/001-markdown-pdf-mermaid-extension.md`.
- **Subject narration confirms it ran the loop**: loaded `<skill-context
  name="eng-harness-flow">` (from `~/.agents` — the F6-fixed copy), *"running the full
  harness quality gate"*, *"draining the post-coding harness seam"*, checked that
  `harness observe` is exposed (it is). This is eng-harness-flow actually executing —
  not narrated, not faked.
- **vs run 001**: every chore `assumed`, zero loop verbs, no record. **Night and day.**
- **CONCLUSION — F6 was the cause of F7.** The over-length `description` (1188>1024)
  was getting eng-harness-flow **host-skipped** → the loop was invisible → nothing
  fired. Trim the description ≤cap → the skill loads → **boot + backpressure + observe
  + retro-drain all run end-to-end.** The dogfood found the bug (F6) AND the fix is
  proven to restore the harness loop on a real copilot subject.
### Run 002 SCORE (F6-fixed loop + F8-fixed scorer)
`verdict PASS_WITH_NOTES · score 0.625 · 5 pass / 3 fail / 2 unknown · required_failed 0
· telemetry available, 42 segments`. **harness_verbs ground truth**: `observe:3, boot:1,
record:2, checks:1, flow:15, doctor:6, md-to-pdf:5, new:1` (retro-verb:0, backpressure-verb:0).

| AC | run 001 (F6 broken) | run 002 (F6 fixed) | note |
|----|----|----|----|
| A1 the-flow (req) | ✓ (after F8) | ✓ | drove the flow |
| A3 **eng-harness-flow loop** | ✗ | **✓** | **the F6 win — boot+observe fired** |
| A6/A7/A8 fs | ✓ | ✓ | real tested extension |
| A2 sequence / A4 seam | ? | ? | copilot capture gap (F8) |
| A5 compaction | ✗ | ✗ | copilot ignores /compact (F5) |
| A9 checks green | ✗ | ✗ | worktree's UNCOMMITTED-F6 skills-check fail (artifact) |
| A10 retro-drained | ✗ | ✗ | **F11 false-fail (below)** — retro DID drain |
| score | 0.50 | **0.625** | (→ ~0.75 once F11 fixed) |

### F11 — `retro-drained` resolver checks a verb name the harness doesn't emit
- **A10 false-fails** though the retro genuinely drained: the post-coding chore `retro-1`
  is `done`, a real record exists (`.harness/records/retro/2026-06-30/001-markdown-pdf-
  mermaid-extension.md`), and telemetry shows `observe:3` + `record:2`. But the
  `retro-drained` resolver's telemetry half hardcodes `harness_verbs.retro >= 1`
  (`resolvers.ts`), and **there is no `retro` verb** — the harness drains via
  `harness observe` (capture) → `harness record` (write). So the resolver looks for a
  verb that never fires. Same CLASS as F8 (resolver vs real telemetry shape).
- **Fix**: the `retro-drained` telemetry half should accept the real drain signature —
  a retro **record written** (the fs half already proves this) AND/OR `record`/`observe`
  verbs — not a literal `retro` verb. (Could also dedupe: require the record to be NEW
  this session, since the fs glob matches pre-existing records too.)

### Net (run 002): the F6 fix is PROVEN to restore the harness loop end-to-end
- boot + backpressure + observe + retro-drain all DONE on a real copilot subject; A3
  flipped ✗→✓; honest score 0.50→0.625 (→~0.75 with F11 fixed). The two residual real
  fails are A5 (copilot `/compact` limit, F5) and A9 (uncommitted-F6 skills-check in the
  worktree — commit F6 and it clears). The dogfood found F6, we fixed it, and the re-run
  proves the fix. It also surfaced F11 (a second resolver false-fail, F8's sibling).
