# Workshop: `--emit-injection` Scope & Idiom Boundary

**Type**: Integration Pattern
**Plan**: 021-harness-flow-hooks
**Spec**: [harness-flow-hooks-plan.md](../harness-flow-hooks-plan.md) (§ Business Specification · Phase 3)
**Created**: 2026-06-17
**Status**: Approved

**Value Thesis**: `--emit-injection` is the **largest net-new surface** and the one most able to erode neutrality (a `the-flow` profile would make the router know about a product). Deciding its scope — what ships in v1, which idioms, and how "idiom not product" is enforced — protects the lean budget and the one-door neutrality the whole plan rests on, while keeping the design build-ready for when it lands.
**Target Proof Level**: Preferred Direction (sequencing decision) + Contract Ready (the deferred design is fully specified)
**Current Proof Level**: Preferred Direction + Contract Ready

**Selected Value Axes**:
- **Cost / Attention Reduction**: deferring the sugar keeps v1 lean and lets the manifest (WS-2) stabilize before anything renders from it.
- **Safety to Change**: rendering from a still-settling manifest shape is the trap; sequence the contract before the renderer.
- **Strategic Value**: neutrality (idiom-not-product) is load-bearing for "one door" — this surface is where it's most at risk.
- **Operator Usability**: when it lands, a host wires a seam by copy-pasting one emitted block.

**Related Documents**:
- [002-manifest-shape.md](./002-manifest-shape.md) — `--emit-injection` renders *from* this manifest; it must stabilize first
- [001-execution-substrate.md](./001-execution-substrate.md) — WS-1: skill-first (renderers are skill-side string templates, not CLI code)
- plan AC-04 + the Risks-table row "`--emit-injection` erodes neutrality" + KF-07 (one-door) — the neutrality finding this surface guards (the plan's "R4" label doesn't exist; cite the unnumbered Risks row)

**Domain Context**:
- **Primary Domain**: `eng-harness-flow`
- **Related Domains**: `the-flow` (a *consumer*, never an idiom — the neutrality line)

---

## Purpose

Decide whether `--emit-injection` ships in v1 or v2, which idioms it supports, and exactly how "idiom not product" + unknown-idiom fallback are enforced. Fully specify the deferred design so v2 is a pure build.

## Fresh Entrant Outcome

A fresh human or agent should reach **Preferred Direction** (the sequencing call, with rationale) and **Contract Ready** (the idiom set, renderer contract, and neutrality guard) with no additional context.

## Key Questions Addressed

- Is `--emit-injection` in v1 or deferred?
- Which idioms ship first (`make` / `ci` / `shell` / `sdd-skill`)?
- How is "idiom not product" enforced, and how is an unknown idiom handled?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Preferred Direction + Contract Ready | A sequencing decision *and* a build-ready spec for when it lands |
| Primary Value Axis | Cost / Attention Reduction | Deferring protects the lean budget; the manifest is the real v1 contract |
| Supporting Value Axes | Safety to Change · Strategic Value (neutrality) | Don't render from an unstable shape; guard the one-door line |
| Downstream Loop Improved | Implementation sequencing + future host wiring | v1 stays lean; v2 is a pure build from this spec |

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — Full v1** | Ship all four idioms in v1 (Phase 3 as planned). | Complete vision at once. | Largest net-new surface added before the manifest (WS-2) has stabilized; every renderer churns if the shape moves; spends the lean budget on sugar. | Rejected |
| **B — Defer to v2 (fully spec'd)** | Cut `--emit-injection` from the v1 build; ship `--hooks` as the wiring contract; keep the full design in this workshop so v2 is a pure build. | Leanest v1; manifest stabilizes first; renderers built once against a frozen shape; neutrality risk deferred with it. | The convenience sugar lands a release later — in the meantime a host hand-wires from the manifest's `invoke` strings (authoring the advisory framing + idiom boilerplate by hand, not just a second read). | **Selected** |
| **C — Minimal v1** | Ship the neutral fallback + one idiom (`shell`), defer the rest. | Some convenience now. | Still renders from a pre-stable manifest; "which one idiom" is itself a guess; half-measure. | Rejected |

**Plan impact**: deferring `--emit-injection` removes **Phase 3** from the v1 build → **v1 is 3 phases** (vocabulary+alias → manifest+help → docs/guards). Phase 3 becomes a tracked **v2** phase, fully specified below. **AC-04 (emit-injection's only acceptance criterion) migrates to v2 with it — it is not a v1 AC.** Fold on the next re-plan per the § Re-plan delta checklist below.

## Preferred Direction

**Defer `--emit-injection` to v2; v1 ships `--hooks` as the wiring contract.** Rationale: a renderer is a projection *of the manifest* — building it before WS-2's shape is proven in real use means every idiom template churns when the shape moves. Stabilize the contract (the manifest), let one host wire from `--hooks --json`, then add the sugar against a frozen shape. This is the lean call (matches the dossier's "cutting it from v1 keeps the plan lean") and it parks the highest neutrality risk until it's cheapest to get right. (`--emit-injection` is a **wanted** feature, not a cut — this is a *sequencing* call: it ships in v2 against a frozen manifest, a release later.)

### The v2 design (build-ready — no re-design needed)

**Signature**: `eng-harness-flow --emit-injection <idiom>` → renders the five-hook manifest into a host idiom. `render(idiom, hooksManifest)`.

**Idiom set** (generic integration *surfaces*, never products), shipped in this order:

| # | Idiom | Renders | Why this order |
|---|-------|---------|----------------|
| 1 | `shell` | a POSIX function/snippet calling `eng-harness-flow --hook <name>` at each fire-point | most portable; smallest template; proves the renderer |
| 2 | `sdd-skill` | a neutral seam-invocation block an SDD-style skill drops into its stage boundaries | the primary consumer *pattern* (any SDD skill, NOT `the-flow` the product) |
| 3 | `make` | `.PHONY` targets per fire-point | common build entry |
| 4 | `ci` | a CI job step stanza (engine-neutral pseudo-YAML + a note to adapt) | the de-facto PR gate |

**Rendering rules** (all idioms):
- Only `kind: "fire"` hooks render as call-points. `coding` (silent) renders as a **comment note** ("capture friction with `harness observe …`"), never a fire-point.
- Every emitted block carries an **advisory header**: `# advisory — the harness never gates; remove freely`.
- Blocks name the **invocation** (`/eng-harness-flow --hook …`), never a child skill (one-door). `coding` is the one exception: its comment-note renders from the manifest's `coding.invoke` (`harness observe …`, a CLI verb), which is why it isn't an `--hook` call.
- `aliases` (the subsumed `--event` seams) render as an optional **migration comment** per fire-point (e.g. `# was: --event phase-end`), never as a second call-point.
- The renderer reads the WS-2 manifest for hook data (`hook`/`kind`/`invoke`/`run_at`/`aliases`) and supplies only fixed framing (the advisory header, the `coding` comment scaffolding) from constants — it invents **no manifest fields**.

### Neutrality guard — "idiom not product" (enforced, not hoped)

| Rule | Enforcement |
|------|-------------|
| No product profile (no `the-flow` idiom, ever) | The idiom set is a **closed allow-list** {`shell`,`sdd-skill`,`make`,`ci`}; a guard/test asserts it contains no product/skill names |
| Unknown idiom → never guess | Print the **neutral manifest** (the `--hooks` text output) + one line: `unknown idiom '<x>' — here's the neutral manifest; wire it yourself` |
| `sdd-skill` is a *pattern*, not `the-flow` | The template references generic "stage boundaries / seams", never a named flow, command grammar, or stage id |

### Re-plan delta checklist (fold WS-3)

Deferring Phase 3 is not just a deletion — these plan elements must move/repoint so nothing is left dangling:

| Plan element | Action on re-plan |
|---|---|
| Phase Index + § Summary narration | Drop the Phase 3 row; v1 = 3 phases (1 · 2 · 4); reword the "four phases sequence … emit-injection" summary |
| **AC-04** (emit-injection's only AC) | **Migrate to the v2 phase** — remove from the v1 acceptance set (else v1 ships an AC no phase satisfies) |
| Acceptance Coverage Map | Remove/relocate the `AC-04 → 3.1, 3.2` row (tasks move to v2) |
| Risks table | The "`--emit-injection` erodes neutrality" row cites mitigation **task 3.2** → repoint to the v2 phase (mitigation defers with it) |
| Phase 4 | `Depends on: Phases 1–3` → `Phases 1–2` (neutrality-grep task 4.3 stays valid; optional renumber Phase 4 → 3) |
| WS-2 deltas (carry together) | Also fold WS-2's `data.hooks → top-level hooks` + new `aliases` field in the same re-plan |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| `--emit-injection` is the largest net-new surface + top neutrality risk | plan Risks-table neutrality row + KF-07 (one-door); dossier WS-3 | defer it; guard it hardest | Validated |
| Renderer is a projection of the manifest | WS-2 (002-manifest-shape.md) | sequence the manifest before the renderer | Validated |
| WS-1 → skill-first | 001-execution-substrate.md | renderers are skill-side string templates, not CLI code | Validated |
| `coding` is `kind: silent` | WS-2 field reference | renders as a comment note, never a fire-point | Validated |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| v1 build | unclear if Phase 3 is in scope | **out** — v1 is 3 phases; lean budget protected |
| v2 build | a design debate | a pure build from the idiom set + rendering rules + guard above |
| Neutrality review | "could a product profile sneak in?" | closed allow-list + a guard test; unknown→neutral fallback specified |

## Validation / Acceptance

- The v1-vs-v2 sequencing decision is made with rationale (defer to v2). ✅
- The idiom set is a closed allow-list with a shipping order and per-idiom render target. ✅
- "idiom not product" enforcement + unknown-idiom fallback are concrete (guard test + neutral fallback). ✅
- `coding`/silent rendering and the advisory framing are specified. ✅

## Open Questions

### Q1: Plan delta — does deferring drop Phase 3 from v1?

**RESOLVED (workshop authoritative).** Yes — v1 = 3 phases; Phase 3 (`--emit-injection`) becomes a v2 phase, fully specified here. Fold on the next re-plan.

### Q2: Could a host need `--emit-injection` in v1?

**RESOLVED — no.** `--hooks --json` is the complete wiring contract — each hook carries its exact `invoke` string, so a host can hand-wire every fire-point. (WS-2 additionally adds an `aliases` field handing over the `--event` migration map; that field folds into the plan's manifest contract on the next re-plan — it is **not yet** in the plan's pinned contract.) `--emit-injection` is convenience on top, not a prerequisite.

### Q3: Is `sdd-skill` a backdoor `the-flow` profile?

**RESOLVED — no, with a guard.** It renders a *generic* seam block (any SDD-style skill). The neutrality test asserts the template names no flow, no command grammar, no stage id, and the idiom allow-list contains no product names.

---

> Routing is the flow's job — run the parent flow bare to continue.
