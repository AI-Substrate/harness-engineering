# Execution Log — eng-harness-flow-mission-first (Simple, 1 phase)

**Plan**: `eng-harness-flow-mission-first-plan.md` · **Mode**: Simple · **Testing**: Lightweight + gates
**Started**: 2026-06-30

Posture (locked): surgical reframe + resurface + de-jargon — diff each patch against current state; **add/reorder, do not rewrite working doctrine**; never touch the `doctrine-parity:039 v2` block (SKILL.md L40–55) or reshape a frozen-contract line.

---

### T001–T004 · SKILL.md mission-first reframe — DONE

All four are additive/above the parity block; the `doctrine-parity:039 v2` block (now ~L40–55) and every frozen-contract line are untouched.

- **T001** — frontmatter `description` rewritten mission-first: leads with the dual mandate + four-beat loop + "advisory means the user is never blocked — NOT that the agent may silently skip." Mechanics (stateless router, boot-LAST gate, `--hook/--event/--json/--hooks`, never-gate) kept, but **after** the mission. (Patch 1 + 5a; AC-01, AC-03)
- **T002** — new `## Why this skill exists` block inserted immediately after the H1: two jobs (primary + standing-secondary), "code review checks the product; the harness loop reviews the process," the four-beat loop, and a bolded **Meaning of advisory** anchor. (Patch 2 + 4; AC-01, AC-02)
- **T004** — the 8 observe triggers (sourced from `retro.md:97-107`, not reinvented) folded compactly into loop beat 2 as a trigger→`harness observe` line. (Patch 11; AC-04)
- **T003** — mission now leads the hot path; propagated the advisory qualifier into the state-contract opener (former L14) pointing to the *Meaning of advisory* anchor. No frozen-contract line deleted (additive only). (Patch 3 + 5b; AC-03, AC-10) — final AC-08/AC-10 grep is gated in T009.

**Evidence**: edits applied via Edit tool; parity-block byte-stability + frozen-contract grep verified in T009.

### T005 · retro.md user-facing prompt de-jargon — DONE

- **Two decisions, one at a time** (Patch 6): the drain closeout is now explicitly *Decision 1 — save the notes* (yes/pick/skip) then *Decision 2 — turn saved notes into fixes* (offered only after save resolves). The two were previously one mixed prompt.
- **Plain primary prompt** (Patch 7): the "magic wand" wording is replaced as the *primary* user prompt by plain language ("Anything we should make easier or more provable next time? …"). The two locked magic-wand questions **stay as model-facing self-prompts** in the in-flight § (the brief explicitly permits the concept as internal/explanatory prose).
- **Jargon out of the prompts** (Patch 8): the user-facing route keyword `extension` → **`command`** ("a harness command/check"), `sensor-shaped` → "repeated proof-gap" in user-facing text; reconciled the Step-3 handler heading, its body, the §-links, and the harvest route list so `command` is consistent end-to-end. The deeper encode-guidance prose (lines ~332/408) keeps `extension`/`sensor-shaped` as **model-facing concept** vocabulary (over-build guard — not user prompts).
- **Non-skippable closeout** (Patch 12): added "This offer is **always made, never silently skipped**" to the drain; reinforced at the routing level by SKILL.md loop beat-4 ("name the single highest-leverage improvement … Do not end silently").
- Storage paths (`.harness/records/retro/`) and `system.compound` remain only in the **mechanics/data** prose, never in a user prompt (already true; confirmed).

**Evidence**: Edits applied; consistency of the `command` route verified by grep (no orphaned user-facing `extension`/`sensor-shaped` in the prompts).

### T006 · coach.md + 00-routing.md — VERIFY-ONLY, no edits

Confirmed the advisory-non-silence + plain-retro doctrine is **already present and consistent** (matches the SKILL.md wording, which was drawn from here):
- `coach.md:129` — "Retro drain → plain words, never codes" (already forbids `[s/t/p/e/d/a]`/`[r/w/s]`).
- `coach.md:136` — "Never nag — but always offer, out loud … silently dropping the boot, the survey, or the end-of-plan encode offer is the failure the loop exists to prevent."
- `00-routing.md:147` — "`post-flight` (plan complete) must not end silently … name the highest-leverage candidate out loud and make the encode offer explicit. The user may decline the offer; the agent may not skip making it." (Patch 12 already satisfied at the routing level.)
No edits — confirms the dossier's "~60% already present" thesis; editing here would be over-build.

### T007 · getting-started.md framing — DONE

- Added the **cold-agent / deterministic-layer** paragraph at the top of `## The Big Picture` (every session starts cold; encode-the-fix once you'd infer it twice → command/check/fixture/smoke/diagnostic/template/default/clearer error). (Patch 10; AC-06)
- Retitled the loop label `Retro and Magic Wand` → **`Retro and Improve → Encode`** (magic-wand demoted from the primary label; concept survives elsewhere). (Patch 10; AC-06)

### T009 · preservation + deploy gates — DONE (deploy deferred to ship)

| Gate | Result |
|---|---|
| Parity block byte-identical (echo added *above* it) | ✅ `diff` clean |
| `npm run check:doctrine-parity` | ✅ ok — block byte-identical (in-repo SKILL.md ↔ deployed the-flow) |
| Frozen contracts present (AC-08) | ✅ boot-LAST, 5 hooks, `--event` alias, harness-blind×2, progressive disclosure, never-gate×3, coding=silent, `--json`/`--hooks` all grep-present |
| Targeted vitest (doctrine-parity + flow-chore + flow-orient) | ✅ 3 files / 67 tests passed |
| No user-facing jargon leaked into SKILL.md | ✅ 0 hits (`system.compound`/`sensor-shaped`/`[s/t/p/e/d/a]`) |
| Manual legibility read (AC-01/02) | ✅ first screen states both jobs + the four-beat loop + advisory clause |
| Token discipline (AC-10) | ✅ SKILL.md 126→161; +35 lines is the mission block (every line behaviour-changing or routing); "lean" = reorder-to-lead, not shrink |

## Phase complete — Simple, all 9 tasks [x]

**Delivered**: `eng-harness-flow` reframed mission-first (frontmatter + top "Why this skill exists" + four-beat loop + observe triggers), advisory-non-silence propagated to first-impression spots, retro drain prompts de-jargoned into two plain decisions, getting-started cold-agent framing, and a cross-repo "Why the harness seams exist" echo in tools/the-flow. Every frozen contract + the parity mirror preserved (deterministically gated).

### Deferred & Noteworthy (this phase)

- **Deferred — deploy** (`Noteworthy`): the live-skill refresh (`just install-skills-from-source` here, and the tools-repo the-flow deploy) is **held for ship**, not run mid-build — avoids mutating the live skill while parallel sessions run, and review comes first. The parity gate already passed against the deployed copy, so the block is proven safe; full live refresh + re-run `check:doctrine-parity` at ship.
- **Noteworthy — route keyword rename**: the retro user-facing route `extension` → `command` (drain + harvest + Step-3 handler reconciled); the deeper encode-guidance prose (retro.md ~L332/408) intentionally **keeps** `extension`/`sensor-shaped` as model-facing concept vocabulary (over-build guard) — a reviewer may want to confirm that split reads consistently.
- **Noteworthy — evals deferred** (per plan): no `flow-eval` behavioural cases authored this round.

**Two-repo diff surface**: this repo — `skills/eng-harness-flow/{SKILL.md, references/stages/retro.md, references/getting-started.md}` (coach.md + 00-routing.md verify-only, untouched); tools repo (`main`) — `skills/SDD/the-flow/references/harness-seams.md`.

**Suggested commit (this repo)**: `docs(eng-harness-flow): mission-first reframe + plain-language retro UX (plan 044)`
**Suggested commit (tools, main)**: `docs(the-flow): add "Why the harness seams exist" echo to harness-seams`

### Cross-model review fix (copilot gpt-5.5, pij-14zth7o) — APPROVE_WITH_NOTES

- **MEDIUM @ retro.md:408** — stale route-link "(the \"extension\" route below)" survived the keyword rename → **fixed** to "(the \"command\" route below)". Re-verified: grep shows no stale route-links; remaining `extension` mentions are all the legitimate concept ("a `harness <verb>` extension"); `check:doctrine-parity` still green.
- All other axes PASSED (preservation, parity, over-build, retro-UX, legibility, forbidden-paths). Durable record: `reviews/review.phase-1.md`. Orchestrator sanity pass done (re-read hunk, fix exact).



