# Phase 4 — In-repo capture seams · Execution Log

**Phase**: Phase 4: In-repo capture seams · **Completed**: 2026-06-16T08:23Z · **CS-2 (prose-only)**

## Summary

All three in-repo capture seams wired (AC-9), the tracked-drift `| win` Kinds-list fix folded in, verified by enum-string grep + the architecture guards + the full suite. 638 tests green (unchanged — prose-only, no new tests). No code, no `description:` edits, no Phase-5 scope touched. Not yet committed.

## Tasks

| ID | Outcome |
|----|---------|
| T000 | Pre-implement seam — prose-only phase; baseline boot is the vitest suite (638 green at start). No code risk. |
| T001 | `eng-harness-4-retro/SKILL.md` — added `### Capture seams — bypass backstop + the `win` beat` at the end of the `--drain` block (after "What `--drain` does NOT do", before `## Mode: --harvest`). Bypass backstop references `harness record harness-bypass` + the full `cause` enum verbatim; `win` beat references `harness observe "<what>" --kind win`. `[s/t/p/e/d/a]` menu (L162) + field-source comment untouched; body-only (description unchanged, 834 chars). |
| T002 | Same file — `| win` added to the Kinds list at L85 → full 8-kind set, matching `OBSERVATION_KINDS` + the schema enum (tracked drift, crc2 F1; sibling of T001). |
| T003 | `eng-harness-flow/SKILL.md` — added `bypass_recommended` (false) + `bypass_cause` (null/enum) to the `--json` envelope JSON example + a prose paragraph stating the router only *flags* (reads/derives), never writes a record, never blocks (stateless contract). Body-only; description unchanged (859 chars). |
| T004 | `eng-harness-0-add-extension/SKILL.md` — added `### 4. Record the change (best-effort)` after Step 3's verify block; references `harness record harness-change --slug <name>` + `change_type`/`target`/`resolves`; framed optional/non-blocking (exits `unconfigured`/2 when absent). Description unchanged (461 chars). |
| T005 | VERIFY — (a) enum/kind/CLI strings all present, zero typos (`confusion | win`, full `cause` enum, `--kind win`, `bypass_recommended`/`bypass_cause`, `harness record harness-change`); (b) negative scope check clean — no `AGENTS_README`/`harness-value-measures`/`gen:docs` in any edited file (Phase-5 boundary held); (c) descriptions 834/859/461 — all well under the 900 warn band, none edited; (d) `npx vitest run test/architecture` 3/3 (incl. `history-md-guard`); full suite **638 passed**. |
| T00z | Phase-end seam — observe buffer empty (drained at Phase 3); nothing to drain. No friction worth recording this phase (clean prose edits). |

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-16 | T001 | decision | Placed the capture-seams subsection at the *end* of the `--drain` block rather than inside Step 3 routing — keeps the `[s/t/p/e/d/a]` flow and its menu byte-untouched. | New `###` between "What `--drain` does NOT do" and `## Mode: --harvest`. | tasks.md T001 suggested placement |

## Gate

- Names/enums/kinds: ✅ verbatim, zero typos
- Phase-5 scope: ✅ clean (no AGENTS_README/measures/gen:docs)
- Description band: ✅ 834/859/461, all <900, none edited
- Tests: ✅ 638 green (65 files); architecture guards 3/3
