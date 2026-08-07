# Validation — eng-harness-flow-mission-first-plan

**Verdict**: ✅ VALIDATED — no material issues; one inherent limitation noted.
**Target**: `docs/plans/044-eng-harness-flow-mission-first/eng-harness-flow-mission-first-plan.md` (Simple, CS-2, READY)
**Validated**: 2026-06-30 · `/validate-v2` (adaptive — lead + deterministic proof; CS-2, no critic warranted: the plan's correctness is fact-checkable, and the facts checked out)

## Proof (fresh reads by the lead — not trusting the research workers)

| Claim the plan rests on | Evidence read this pass | Result |
|---|---|---|
| `SKILL.md` is 126 lines → "lean = reorder, not delete" | `wc -l SKILL.md` = 126 | ✅ |
| Frontmatter is router-first (AC-01/03 is a *real* gap) | `SKILL.md:4` opens "Stateless harness-loop router…"; ends unqualified "Never gates, scores, or blocks" | ✅ |
| Advisory-not-agent-silence already present (so Patch 5 is propagation, not new) | `00-routing.md:18` ("about the *user*, not the *agent*… out loud, every time"), `coach.md:136` ("always offer, out loud") | ✅ |
| Retro plain-words rule already exists; jargon persists in prompts | `retro.md:149` ("Never print the raw `[s/t/p/e/d/a]`"), magic-wand `:50,:160`, `system.compound` `:13,:92,:207`, `sensor-shaped` `:175,:182` | ✅ |
| 8 observe triggers exist (Patch 11 = echo, not invent) | `retro.md:97` "When to fire", `:108` Calibration | ✅ |
| Parity block byte-identical (AC-09 preservation surface) | `diff` of the extracted `:039 v2` block, SKILL.md vs tools `harness-seams.md` → 16/16 lines, clean | ✅ |
| Frozen contracts present (AC-08) | boot-LAST `00-routing.md:112`, harness-blind `SKILL.md:91`, hooks/`--event`/`--hooks` frozen `SKILL.md:20` | ✅ |
| Patch 9 target + safe insertion point | tools `harness-seams.md` exists; parity block at **L13–28** → an echo inserted at L10 is outside it; inserting above only shifts the block down, which the content-diff gate ignores | ✅ |
| `eng-harness-flow` authored here, not in tools (single-repo for 12 patches) | `find ~/github/tools -iname '*eng-harness-flow*'` → empty | ✅ |

## Thesis & consumers

- **Thesis** — *advanced, honestly framed.* The plan's central move is to **resist the brief's own framing**: it diffs each patch against current state and downgrades ~half to verify-only/propagation, with the over-build risk carried as the top H risk. That is the correct read (the proof above confirms ~60% is already present). The plan serves its purpose — make the mission visible on screen one — without rewriting working doctrine.
- **Consumers** — the touched files have two real downstream consumers, both handled: (1) the `doctrine-parity:039` **mirror** (the tools `harness-seams.md`) — protected by keeping the echo additive + outside the block and gating on `check:doctrine-parity` (AC-09); (2) the **router/flow tests** that pin the frozen contracts — gated by AC-08 grep + AC-10 test-green. No contract shape changes; forward-compatible.

## Limitation (noted, non-blocking)

**The legibility ACs are inferential by nature, not deterministic.** AC-01/AC-02 ("a fresh agent states the dual mandate from screen one") and AC-05's "jargon-free" are **human-judgement** proofs — a string test can't prove a reader *understood* the mission. The plan grades them correctly with a **manual legibility read** (T009), which is the right proof grade for legibility; forcing a deterministic check here would be false rigour. The deferred `flow-eval` cases (the documented follow-up) are where some of this *could* later harden into a `flow-seam-fired`-style assertion — correctly out of scope for this round.

## Residual

- None blocking. The preservation surface (frozen contracts + parity byte-stability) is deterministically gated; the legibility surface is honestly graded as a manual read; the cross-repo Patch 9 is correctly isolated as a standalone `main` commit in tools.
