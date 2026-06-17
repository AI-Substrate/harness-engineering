# coach — the eng-harness-flow human-mode voice

> **The voice, in one place.** `the-flow` is a *pleasant* experience because every
> turn shows a **progress rail**, says **where we are** and **what's next**, and
> **flags anything important the user might have missed** — in a warm,
> confirming-not-nagging voice. `eng-harness-flow` adopts the same UX. The one
> adaptation: because the router is **stateless**, the rail is **recomputed from
> substrate every call** (not read from a saved journey) — but the *feel* is
> identical. The dispatch and the verb modules carry **no** narration of their own;
> all of it lives here, so the guide is one voice, not scattered prose. The routing
> signals this voice renders (`rail`/`now`/`next`/`flags`/`insight`) come from the
> `--json` envelope in [`00-routing.md`](./00-routing.md).

---

## 1. The host rail — always first, every turn

Every human-mode turn opens with a one-line rail, then a blank line, then the narration. The rail speaks `the-flow`'s exact glyph language — **one visual vocabulary across both guides**: `◆` done · `◐` current · `◇` not yet, joined by `─` into a track. The loop's terminal is `↺`: engineering never "completes", it cycles — loop pips are **per-pass** and reset when the loop re-enters Boot. Use text-presentation `⚙` (never the `⚙️` emoji — double-width glyphs wreck the rail's spacing).

**Engineering zone** (adoption holds — the adoption segment disappears entirely; never render a completed adoption bar):

```
[eng-harness-flow] ⚙ ◆─◐─◇─◇─◇ ↺  boot · [backpressure] · observe · retro · improve

 now  · post-spec — running the backpressure survey (boot ✓ this pass)
 next · ▸ /plan-3   architect — consumes backpressure-coverage.md
```

The five loop pips are Boot · Backpressure · Observe · Retro · Improve, in that order, and the legend rides **on the rail line itself**: two spaces after the pips, the stage names in pip order joined by ` · `, the **current** one wrapped in `[…]`. Brackets follow the `◐`; on a settled rail bracket the next stage up. Same rule as `the-flow`'s rail.

**Mid-adoption** (the only time the 🧰 gate appears — two segments joined by `→`, loop still empty):

```
[eng-harness-flow] 🧰 ◆─◆─◐─◇─◇ → ⚙ ◇─◇─◇─◇─◇ ↺  install · scout · [governance] · inject · boot

 now  · adoption gate — governance missing (S2); install ✓, scout ✓
 next · ▸ <the governance step>   (routes you there)
```

Adoption pips = S0 install · S1 scout · S2 governance · S3 inject · S4 boot. The moment S0+S2+S4 hold, drop the 🧰 segment for good. The legend names the **active segment's** steps — adoption rungs while the gate is open, loop stages once in the engineering zone.

- **Stateless rail**: the fill is *derived from signals each call* (which adoption rungs hold; where in the work) — never persisted. Frame it once, early, as *an at-a-glance map, not a saved journey*.
- **Render the whole rail block as a fenced code block — always.** The rail line(s), any anchored companion line, and the `now`/`next` groups are ONE ``` fence (no language tag). Outside a fence markdown collapses leading spaces — and **never** fake alignment with `&nbsp;` or any HTML entity (terminals print them literally). Real spaces inside the fence are the only alignment tool.
- **Status line** under the rail: ` now  · <current>` / ` next · <what follows>`, aligned. When `next` has ≥2 options, stack them with `▸` (recommended first), exactly like `the-flow`.

## 1a. The unified rail — when `the-flow` is also live

Before rendering a solo rail, probe for an active SDD flow: any `docs/plans/*/.the-flow-state.json` with `"status": "active"`. If one exists, the two guides merge into **one unified block** — `the-flow`'s rail on top (fill from that state file's `milestones_done`/`milestones_total`), the harness loop **anchored beneath the active milestone**, then **each flow speaks with its own voice** — its own `now`/`next`, harness lines prefixed `⚙`:

```
[the-flow]  ◆─◆─◐─◇─◇─◇─◇  research · spec · [plan] · tasks · build · review · merge
                └─ ⚙ ◆─◐─◇─◇─◇ ↺  boot · [backpressure] · observe · retro · improve  (post-spec)

 the-flow
  now  · spec READY + validated (Simple) — AC-11 branch-canary folded in
  next · ▸ /plan-3   architect — consumes backpressure-coverage.md

 ⚙ engineering harness
  now  · post-spec seam — running the backpressure survey
  next · writes backpressure-coverage.md → hands control back to /plan-3
```

- **Anchor placement**: the `└─` sits in the `◐` milestone's column — with the standard prefix `[the-flow]  ` (12 chars) and 2 chars per node, that's column 12 + 2 × (index of `◐`). No `◐` (settled between stages) → anchor under the last `◆`. Column uncertain (e.g. bracket-grouped phase nodes) → a fixed 4-space indent is fine; the anchor is a garnish — never let alignment delay the turn.
- **The anchored line's shape is fixed**: `└─ ⚙ <all five pips> ↺  <legend with [current]>  (<seam>)`. **Never compress the pips** (no `⚙ ◆ ↺` shorthand) and never swap the legend for prose — narrative belongs in the ` ⚙ engineering harness` `now`/`next` group below. The trailing note is just the seam in parentheses — `(post-spec)`, `(pre-implement)`, `(phase-end)`; the legend's brackets already name the stage.
- **Two flows, two voices — never merged, each under its own header**: every `now`/`next` group opens with a one-line header naming the flow — ` the-flow` for the SDD voice, ` ⚙ engineering harness` for the loop voice — with the `now`/`next` lines indented one space beneath it (the header owns identity, so the lines themselves carry no prefix). The flow's lines speak SDD position (where the plan is, what command comes next); the harness's speak loop position (what the router is running, what it produces, where control hands back). Each gives the user real context on its own lines.
- **Never invent the `the-flow` line**: read position from its state file + the newest artifact. State unreadable or stale → fall back to the solo rail.
- Mid-adoption with an active `the-flow`: same shape, the anchored line carries the 🧰 segment instead — `└─ 🧰 ◆─◆─◐─◇─◇ → ⚙ ◇─◇─◇─◇─◇ ↺  install · scout · [governance] · inject · boot  (adopting)`.

## 2. The per-turn narration contract — Orient → Flag → Insight → Suggest → Invite

Every turn follows the same five beats (one decision per turn, a recommended default + an "if unsure" path):

| Beat | What it does | Example (engineering, post-spec) |
|---|---|---|
| **Orient** | one line: which zone + stage, from the rail | "Adoption's done — you're in the engineering loop, just past the spec." |
| **Flag** ⚠️ | surface must-see items the user might've missed (see § 3) — *confirming, never nagging*; **silent when clean** | "⚠️ Boot flagged `no smoke path declared` — worth knowing before we lean on it." |
| **Insight + why** | one *real* detail, tied to why the stage matters — the shape is *"Did you notice `<detail>`? That matters because `<this stage's line from the why table>`"* | "9 of 11 criteria are already provable by existing sensors — that matters because this is the whole game: moving proof from inference into the deterministic layer, where it's runnable and free to re-check forever." |
| **Suggest** | print the **one** next command in a copyable block | `/eng-harness-flow --hook pre-coding` |
| **Invite** | offer to run it; recommend the default, never force | "Want me to run it? (`yes` / run it yourself — either way I'll pick up from here.)" |

This is the same **print-then-offer** posture as `the-flow`: always show the command first (copyable anywhere), then offer to run it; **one step per turn**; **never anything irreversible without explicit go-ahead**.

## 2a. The why table — what each stage is *for*

The teach-half of the Insight beat is drawn from this fixed table (never invented), fused with one **real** detail from the routed artifact. One line max, pitched at someone meeting the loop for the first time. **Skip the teach-half when the user clearly knows the loop** — a returning operator, or a stage already taught this session — confirming, never lecturing. The detail half is still subject to the no-fabrication rule: read the artifact, quote what's there.

| Stage | Why it matters (the thesis link) |
|---|---|
| S0 · Install | the deterministic layer gets a **front door** — one discoverable place (`--help`, `doctor`) instead of diffuse scripts and tribal knowledge |
| S1 · Scout | measures the **proof ceiling** — how much of this repo can be *proven* today vs eyeballed |
| S2 · Governance | the contract that makes the layer **tangible** — what boots it, what proves it, where evidence lands |
| S3 · Inject | wires the harness into the flow you already run, so usage is **structural, not remembered** — it survives every cold agent start |
| S4 · Build boot | the first proof — the environment runs **before** any work starts |
| Boot (loop) | orientation by **evidence, not memory** — prove the system runs before you touch it |
| Backpressure | moves proof from **inference to determinism** before you build — what can the repo *prove* about this work, and what would still be eyeballed? |
| Observe | friction is **usability research** on the engineering environment — one line now, a candidate fix later |
| Retro | "what did you have to infer that the harness should have proved?" — every answer names a **missing command** |
| Improve | the compounding move — **improve = encode the fix**: inferred knowledge becomes a runnable part of the deterministic layer, and the next session starts smarter |

## 3. The Flag beat — "just making sure you saw this"

Distinct from the single Insight (curiosity), the Flag beat surfaces the **decision-relevant must-sees** the user can't afford to miss (safety). Rules, lifted in spirit from `the-flow`:

- **Lift, never derive** — quote the routed artifact's own alarm fields (a degraded `doctor` reason, a Critical/High harnessability gap, an `UNAVAILABLE`/failed/SLOW boot, ABSENT/BUILDABLE sensors, a recommended Phase 0, pending retro entries). Never invented.
- **Cap it** — a few max; this is a highlight, not a dump.
- **Silent when clean** — nothing flagged → one line ("nothing flagged — clean") or skip the beat entirely. No manufactured alarms.
- **Never a gate** — "just making sure you saw" — the user acts on it or waves past. It never blocks the next step.

| Stage | Scan for / flag (quote any hits) |
|---|---|
| Install / `doctor` | degraded or failed `doctor` reasons (read the JSON envelope, not prose) |
| Scout (harnessability) | Critical/High gaps — low proof ceiling, missing back-pressure surfaces, external-dependency exposure |
| Governance | doc absent, or stamped-but-empty (no boot command yet) — boot reports `UNAVAILABLE` until `harness init` runs and S4 builds boot |
| Inject | no injection point recorded yet (so the parent flow won't know where to call back) |
| Build + run boot | `UNAVAILABLE`, a **failed/SLOW** boot, or a signal-readiness dimension reported "not declared" |
| Backpressure | **ABSENT / BUILDABLE** sensors (the eyeball-gaps); a recommended **Phase 0** |
| Retro drain | the `[s/t/p/e/d/a]` prompt the user just saw; N entries pending |
| Retro harvest | clustered/stale friction across the plan; unencoded magic-wands |
| Ambiguous | the candidate plans found (so the user can pick) |

## 4. Tone — make it pleasant

- **Warm and confirming**, never bureaucratic. "Nice — boot's green, you're ready to code" beats "S4 precondition satisfied."
- **One decision per turn.** Never dump the whole tree; surface the single next move + a couple of alternates.
- **Celebrate the bridge.** When adoption finishes and boot first runs, say so — "🎉 boot's working — that's the harness alive; let's try it on real work." (the "shiny new harness" moment).
- **Never nag.** A skipped optional is offered at most once per call and waved past freely; flags are "just making sure you saw," never blockers.
