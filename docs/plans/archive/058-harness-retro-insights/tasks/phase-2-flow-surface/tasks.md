# Phase 2 Tasks — Flow surface + doctrine reconcile

**Plan**: [harness-retro-insights-plan.md](../../harness-retro-insights-plan.md) (v1.1.0)
**Phase**: Phase 2: Flow surface + doctrine reconcile
**Depends on**: Phase 1 (COMPLETE — `harness retro insights` verb shipped, 2311/2311)

### Executive Briefing

- **Purpose**: Make the eng-harness-flow surface *consume* the new deterministic verb — the harvest narrates the verb's numbers instead of re-deriving the analysis by inference — and add an ad-hoc `at=insights` route, closing the dangling `compound-value` seam. Nothing user-visible in the harvest regresses.
- **Non-Goals**: ❌ no CLI code changes (Phase 1 done); ❌ no new lifecycle hook; ❌ no change to the harvest's action menu / lifecycle ops UX.

### Prior Phase Context

Phase 1 shipped `harness retro insights [--plan <s>...] [--since <iso>] [--kind <k>] [--agent <s>] [--json]`. The `--json` envelope carries `data.{schema_version, generated_at, scope, sources, headline, sections, malformed_skipped, unsupported_versions, buffer_pending, buffer_malformed_skipped}`, with `data.sections.{totals, top_clusters, stale, disposition_mix_records}`; each cluster row carries `members: [{record_path, retro_id, entry_id, status}]` — the provenance the lifecycle ops act on. Human view is the Step-4-style report.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T101 | Rewrite retro.md §--harvest **Steps 1–3** (scan/dedup/curate) to ONE `harness retro insights --json` invocation; **retain Step 4's human view as the narration template rendered from the verb's JSON**; state explicitly "narration restates the verb's computed numbers, never computes its own"; lifecycle ops (done/won't-fix/stale) consume `members[].record_path` | eng-harness-flow-skill | /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/references/stages/retro.md | Steps 1–3 replaced; view + action menu + lifecycle ops intact; `skills-check` green | AC-09; V-01/V-04 |
| [x] | T102 | Replace both `scripts/compound-value.sh` / `just compound-value` refs (retro.md:39, :466) with the real verb | eng-harness-flow-skill | /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/references/stages/retro.md | `grep -rn "compound-value" skills/` returns nothing | AC-11; resolves DL-001 |
| [x] | T103 | Add the additive `at=insights` route to 00-routing.md: an `at=` grammar row (near :201) + a conflict-matrix row (near :274). **Semantics (V-02): buffer non-empty → `route` with a drain ADVISORY in the envelope — NEVER `redirect`** (unlike at=retro-harvest:274). Confirm the 5-hook list + `--hooks` manifest sections are byte-unchanged | eng-harness-flow-skill | /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/references/00-routing.md | `at=insights` present; frozen hook/manifest sections unchanged (grep-diff) | AC-10; V-02 |
| [x] | T104 | If discovery needs it, a one-line SKILL.md description touch naming the cross-plan insights surface (≤1024-char frontmatter). Skip if not needed | eng-harness-flow-skill | /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/SKILL.md | `skills-check` green | Optional |
| [x] | T105 | **Redeploy FIRST** (`npm run build` + `just install-skills-local` — the live session loads the deployed ~/.claude→~/.agents copy, which diverges from skills/ once T101–T104 land; V-03), then live-validate: run `harness retro insights` over the real corpus and confirm a narrated harvest restates the verb's numbers; `just fix` + `harness checks` | eng-harness-flow-skill | (run evidence → execution.log.md) | Redeploy done; narrated run recorded; checks green | V-03; doctrine-parity may WARN until redeploy |

### Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-07-12 | T101 | Doctrine parity | `retro.md` has no `doctrine-parity` marker, so the harvest block has no mirrored write obligation. | Kept the edit within the allowed source module and verified the deployed copy after reinstall. | `skills/eng-harness-flow/references/stages/retro.md` |
| 2026-07-12 | T103 | Frozen contract | The lifecycle-hook and `--hooks` manifest sections can be isolated by heading and hashed before/after additive routing edits. | Preserved both section hashes byte-for-byte; added only dispatch, grammar, scope, and conflict rows. | `skills/eng-harness-flow/references/00-routing.md` |
