# Distilled ask — harness-bypass-change-records
**Captured**: 2026-06-16T01:54:02Z · **By**: /the-flow · **Source**: decision conversation (distills `original-ask.md` + 10 decisions)

> The raw voice transcript lives in [`original-ask.md`](./original-ask.md) (unedited). This file is the decided design that came out of the follow-up decision chat — it supersedes the original's broad framing and is what the spec should build to.

## What we're building
Two new **committed record types** in the harness CLI, prompted at the right in-repo loop seams, that make harness **use / non-use** legible — plus a design doc on the measures they enable. The destination (cross-repo rate scanning + DORA correlation) is **explicitly out of scope** for this plan.

## The two record types (DECIDED: separate types, NOT new retro kinds)
- **`harness-bypass`** — the coding agent *could not or would not* use the harness for a piece of work. The "not used" signal. Must be (suggestively, reliably) recorded.
- **`harness-change`** — a piece of work that *improved* the harness. Becomes the harness changelog/trajectory (replaces `history.md`, see D5).
- They plug in as core types at `services/record/registry.ts` next to `retro.ts` — **no new CLI verb** (`harness record harness-bypass` / `harness record harness-change`). They *reference* retros (via `resolves`/`references[]`), they are not retro kinds.

## Decisions (locked)
1. **Separate record types**, not new retro kinds.
2. **"Must be recorded" = highly suggestive, non-blocking prompts.** The CLI owns the durable write; the consuming flow owns the prompt; the router only *flags* `bypass_recommended` in its `--json` envelope (stays stateless, never blocks). A CI cross-check against under-reporting is a *later, optional* backstop — not now.
3. **Scope = in-repo recording only.** This plan ships: the two record types; the new `win` retro kind (D8); the **in-repo** capture seams (retro `--drain` bypass backstop + `win` "what worked well?" prompt, `eng-harness-flow` router envelope flag, `eng-harness-0-add-extension` change prompt); the provenance-stamping change (D6); the `history.md` removal (D5); and a **measures design doc**. The rate emitter, cross-repo/fleet scanner, and DORA correlation are **OOS — a separate matter**.
4. **Frontmatter contract (frozen; pinned by a template↔schema superset test):**
   - **Header shape (LOCKED by validate-v2): single merged frontmatter** — the CLI splices provenance keys into the top of the record's existing `---` frontmatter (template constants stay byte-identical; one block for scanners).
   - **Provenance header — CLI-stamped at write time (D6), on ALL record types incl. retro:** `schema_version`, `record_kind`, `harness_version`, `branch`, `repo` (git remote; null if none), `created_at` (precise ISO-UTC), `agent` (from `HARNESS_AGENT`/`--agent`), **`plan_id`** (from `HARNESS_PLAN_ID`/branch-cwd inference; null if none — re-added by validate-v2 as a session/denominator join-key).
     - **OPEN Q:** base `HEAD` commit SHA — in or out? *(rec OUT; addable later, non-breaking.)* The *produced* commit is dropped — unknowable pre-commit.
   - **`harness-bypass` body:** `cause` (enum: `missing-command`|`command-failed`|`too-slow`|`unclear-output`|`no-coverage`|`policy`|`agent-could-not`), `attempted` (bool), `command`, `severity` (`blocking`|`degrading`|`annoying`).
   - **`harness-change` body:** `resolves` (**LOCKED**: free-form ref ≤200 chars → in-repo record path | `issues/123` / `org/repo#45` | retro `<retro_id>:<entry_id>`), `change_type` (enum: `new-command`|`sensor`|`fixture`|`template`|`doc`|`skill-edit`|`routing`), `target`.
5. **Remove the `history.md` concept entirely.** `harness-change` records become the trajectory/changelog. Ripples: drop `history.md` from the governance doc + `governance-doc.md`; **reword the L3 maturity rung** ("≥1 encoded — a `history.md` row exists" → "≥1 `harness-change` record exists"); update skill prose; **migrate the one existing row** (2026-06-10, cwd-independent test suite) into a `harness-change` record, then delete the file.
6. **Provenance stamping is a record-service change for ALL record types:** shift from "pure template copy" → "**CLI-stamped provenance header + agent-filled body**." Stamp via existing ports — Clock (`created_at`), `proc` (`branch`, `repo`), build constant (`harness_version`) — so it stays fake-testable and Constitution-P2-clean.
7. **Adding a retro `kind` is additive/backward-compatible** (we corrected the "frozen" framing): old records stay valid; the only cost is forward-compat blind spots for older harness versions in a mixed fleet until they upgrade — a `schema_version` **minor bump**. This is a deliberate, accepted schema change (see D8).
8. **DECIDED: add a new first-class positive retro kind — `win`.** "This worked well / the harness was effective here" — the explicit positive counterpart to `difficulty`. (`gift` was rejected as too fuzzy — it reads as "an unexpected boon," not a deliberate effectiveness report.) With `target: harness-itself` it's the cross-repo "harness is landing" signal. **Work (a 5th work-stream):** add `win` to the `kind` enum in `retro.schema.json` (+ `schema_version` minor bump), add it to `OBSERVATION_KINDS` with a `WIN` prefix in `observe/buffer-codec.ts`, document it in the `RETRO_TEMPLATE` comment, add it to the encoding-hint table (`win/* → "no encoding needed"`, like `gift`), add a drain "what worked well?" prompt that emits `--kind win`, and pin the enum in tests. Harvest clusters it for free via `(kind, target)`.
9. **Used / not-used / extent framing** (for the measures doc): NOT used → `harness-bypass` records (this plan); USED + worked well → `win`/`harness-itself` retro entries (the new kind, this plan); USED + how much → CLI usage **telemetry** (future / OOS).
10. **The strongest bypass prompt seam (`the-flow` pre-implement) is user-global and NOT vendored** into this repo. So in-repo capture must not *depend* on the-flow — the retro `--drain` backstop is the in-repo guarantee. The `the-flow` pre-implement edit is a coordinated user-global follow-up (recommendation pending explicit confirm).

## Measures design doc (in scope; describes, doesn't build)
`docs/how/harness-value-measures.md` — the two measures (harness **bypass rate**, harness **change rate** / encoded-mitigation ratio), the denominator question (PRs primary / plans·sessions secondary), why they're **leading** indicators correlated with **DORA** (lagging) rather than a 5th DORA metric, and the anti-Goodhart / team-level-only governance guardrails. Leans on `harness-foundations/source-notes/notes3.md` (which already encodes this doctrine).

## Still-open questions for spec
- base `HEAD` SHA in the provenance header — in or out? (D4)
- the-flow pre-implement edit — confirm it's a coordinated user-global follow-up. (D10)
- provenance header shape — prepend a separate CLI-owned block vs merge into one frontmatter? (D6 detail)
