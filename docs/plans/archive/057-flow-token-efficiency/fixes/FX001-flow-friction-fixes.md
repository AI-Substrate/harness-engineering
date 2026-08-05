# Fix FX001: Flow friction fixes (retro-drain batch)

**Created**: 2026-07-10
**Status**: Complete
**Plan**: [057-flow-token-efficiency](../flow-token-efficiency-plan.md)
**Source**: retro drain `.harness/records/retro/2026-07-10/001-057-flow-token-efficiency.md` — user directive: fix CONF-001, DL-002, DL-003, DL-004, DL-005, DL-001(stranded) now
**Domain(s)**: harness-cli (contract: doctor flag, flow mutation side-effect), builder skill (one link), repo docs

---

## Problem

Six frictions observed and saved across the 057 build: ambiguous `check:docs` verdicts, a root-vitest trap, a 12KB `doctor` payload for a yes/no question, a dangling installed-skill link, a redundant `render` round-trip after every flow mutation, and stale test-command wording in the governance doc. Each is re-paid by every future agent until encoded away.

## Proposed Fix

Six bounded fixes, one phase. The load-bearing one is FX001-5 (user design decision): **every successful flow-mutating command auto-writes the sibling `the-flow.md`/`<slug>.md` — no second `render` call needed**. The `render` verb stays (manual regen, back-compat), but the cadence's render step becomes free.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | contract (additive) | `doctor --quiet`; flow mutations gain an md-write side-effect; default envelopes byte-identical |
| builder skill | internal | one link swapped to an absolute URL |
| repo docs | internal | check:docs verdict wording; governance doc test command |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | `check:docs` (and its `gen:docs` diff step) prints an unambiguous verdict: green run ends with a clear `check:docs OK — no drift` line; drift ends with an explicit FAIL line before the diff. | repo docs | /Users/jordanknight/substrate/harness-engineering/package.json, /Users/jordanknight/substrate/harness-engineering/scripts/gen-docs.mjs | both outcomes print an explicit verdict line; `harness checks` behaviour unchanged | CONF-001 |
| [x] | FX001-2 | Kill the root-vitest trap: root `npx vitest run` must not sweep `scratch/**` — add a root `vitest.config.ts` that scopes to `harness/cli` (or excludes `scratch/**`) or refuses with a pointer at `just test`. | repo tooling | /Users/jordanknight/substrate/harness-engineering/vitest.config.ts (create) | root `npx vitest run` is either green-scoped or a clear refusal; `just test` untouched | DL-002 |
| [x] | FX001-3 | `harness doctor --quiet`: slim each extension entry to `{name, status, verbs:[names]}` (drop descriptions/options). Default output stays byte-identical (regression test, mirror the flow `--quiet` pattern/tests from 057 P1). | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/src (doctor act + test) | `doctor --json --quiet` ≤ ~1.5KB in this repo; default unchanged (test-pinned); TDD | DL-003 |
| [x] | FX001-4 | Swap the tier §'s repo-relative rules-of-why link (`../../../harness-foundations/...`) for the absolute GitHub URL (pattern: eng-harness-flow retro module's references) so installed skill copies don't dangle. | builder skill | /Users/jordanknight/substrate/harness-engineering/skills/builder/references/00-routing.md | no `../../../` link in § Model-to-task; guard test (if it pins the §) still green; markdown link check clean | DL-004 |
| [x] | FX001-5 | **Auto-render on mutate (user design decision)**: every successful flow-mutating verb writes the rendered sibling `.md` immediately after the JSON write (same output as `render`, byte-identical). `render` verb retained as manual/idempotent regen. Envelope and exit code unchanged — the md write is a filesystem side-effect; `--quiet` semantics untouched; a failed md write must NOT fail the mutation (warn-only, envelope still ok). Update `docs/how/harness-flow.md` (+ regen manifest docs). | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/acts/flow.ts (+ flow services/tests), /Users/jordanknight/substrate/harness-engineering/docs/how/harness-flow.md | TDD: a mutation leaves JSON+md both updated and md byte-equal to a manual `render`; render verb still works; frozen default+quiet envelope tests untouched/green | DL-005 |
| [x] | FX001-6 | Governance doc wording: `.harness/engineering-harness.md` (and any other in-repo doc found by grep) saying `cd harness/cli && npx vitest…` aligned to canonical `just test` (keep the parenthetical explaining what it runs). | repo docs | /Users/jordanknight/substrate/harness-engineering/.harness/engineering-harness.md | grep for the stale invocation clean repo-docs-wide (source/test files exempt) | DL-001 stranded |

## Workshops Consumed

None.

## Acceptance

- [x] All six Done-When columns hold with evidence in the execution log
- [x] `just test` + `harness checks` green (degraded = pre-existing warn-tier only)
- [x] No default-output byte changes anywhere except the two documented additive surfaces (doctor `--quiet`, mutation md side-effect)

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-07-10 | FX001-3 | implementation | Slimming extension records alone left the real payload above the measurable cap because verbose layer and record-type details remained. | Quiet mode keeps the diagnostic identities (`layers[{name,ok}]`, branch, slim extensions) while default mode remains byte-pinned and complete; built payload is 1,356 bytes. |
| 2026-07-10 | FX001-5 | compatibility | Existing render drift tests assumed mutations left the sibling markdown stale, which is now intentionally impossible. | Retained the read-only drift guard by testing a manually drifted/missing sibling; automatic create/status/event renders are separately pinned. |
