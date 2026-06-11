# Retro — Plan 007 First-Class Documentation

**Date**: 2026-06-08 · **Mode**: Simple, single phase (companion build) · **Verdict**: clean (all findings fixed + companion-approved)

## Companion (code-review-companion) — run 2026-06-08T22-08-20-158Z-d7d0

- **Reviewed**: 17 task commits (T001–T016 + the F001–F005 fix commit). 12 APPROVE / APPROVE_WITH_NOTES, 1 REQUEST_CHANGES, then APPROVE on the fix commit `a08fbe7`.
- **Findings**: 5 sent (1 HIGH, 4 MEDIUM), all dispositioned + fixed:
  - **F002 (HIGH)** raw `harness docs <id>` used `exitWithEnvelope`→`process.exit`, which can **truncate** a large piped/redirected payload before stdout flushes → fixed with a kernel `emitRawAndExit` (writes stdout, sets `process.exitCode`, returns naturally — matches the existing help/version natural-exit). Added a unit test (asserts `process.exit` NOT called) + a child-process integration test (byte-fidelity through a real pipe + `| head` EPIPE survival).
  - **F001 (MEDIUM)** purity-guard `@generated` skip was too broad → narrowed to an explicit one-path allow-list (`src/services/docs/docs-content.ts`).
  - **F003 (MEDIUM)** corpus intros (extend-the-harness, authoring-verbs) still said core = help/doctor/new → updated to include `docs` + regenerated bundle.
  - **F004 (MEDIUM)** P12 curation guard missed `docs/project-rules/**` → added the forbidden pattern.
  - **F005 (MEDIUM)** README "Every command emits an envelope" contradicted raw `docs <id>` → reworded to call out the deliberate raw-stdout exception + regenerated bundle.
- **magicWand** → **minih/coordination**: a `minih outside finish` one-shot that drains, sends `control:stop`, waits for the farewell, and runs validation — so a companion session doesn't drift into the idle check-in window at the end (it sent a `still-needed` question because the stop arrived just after its idle threshold).
- **Difficulties**: MH-001 (scans over the large generated `docs-content.ts` produced oversized output — narrowed reads to authored sources); MH-002 (final stop arrived after the idle threshold → benign `still-needed` check-in).

## Orchestrator (me)

- **Worked well**: companion-per-commit caught the **HIGH truncation bug** (F002) that the unit tests with fake writers could not — fake `out()` accumulates synchronously, so the `process.exit`/flush race is invisible in-process; only a second pair of eyes (and a real-pipe integration test) surfaces it. Also caught 4 contract/wording drifts at commit time (cheap fixes). The byte-equal drift test proved the whole Option-C round-trip; TDD red→green on `DocsService` + the act kept the contract honest.
- **Friction**: a **committed generated module under `src/`** tripped *three* separate tooling guards that each needed a bespoke exclusion — the node-io purity guard (doc prose can quote `from 'node:fs'`), biome lint (`noTemplateCurlyInString` on `${...}` in code examples), and coverage. Each was pre-empted as a pre-flight discovery (D2/D3/D4), but it's three different exclusion mechanisms for one conceptual "this file is generated data" fact. The companion's MH-001 independently felt the same generated-file friction.
- **Magic wand** (project): a single declared "generated data globs" convention the harness's tooling all reads (purity guard, biome overrides, coverage exclude, review scans) — instead of three per-tool exclusions kept in sync by hand.

## Cross-agent / cross-plan signal

- The **generated-file-in-`src/`** pattern (chosen here as Option C) creates recurring, predictable tooling friction. Plan 006's retro flagged minih env/project-root gaps; this plan adds a *project-side* gap: tooling lacks a single source of truth for "what is generated."
- The companion's coordination magic wand (`minih outside finish`) is the second consecutive companion run asking minih to smooth the **end-of-session drain/stop** handshake — a high-confidence upstream item.

## Follow-ups

- **FU-007-01** (project): adopt a single "generated artifacts" glob convention consumed by the purity guard, biome `overrides`, coverage `exclude`, and review tooling — collapse the three hand-kept exclusions into one.
- **FU-007-02** (minih, coordination): `minih outside finish` — drain → `control:stop` → await farewell → validate, in one operation (companion magicWand; second occurrence).
- **FU-007-03** (minih, ergonomics): teach the review workbench to auto-collapse generated files in scans unless explicitly requested (companion improvementSuggestion; echoes MH-001).
- **Out of scope (by design)**: MCP server — the pure `DocsService` (`listDocs`/`getDoc`) is the reserved seam; a future `mcp/tools/docs_*` imports it unchanged.
