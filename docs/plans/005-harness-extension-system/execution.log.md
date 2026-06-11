# Execution Log — Plan 005: Harness Extension System

**Phase**: Implementation (Simple mode, single phase, T001–T028)
**Started**: 2026-06-08
**Companion**: `code-review-companion` run `2026-06-08T16-56-36-144Z-a9ad` (Power-On-Mode, live per-commit review)
**Baseline**: 96 tests / 21 files green; jiti not yet installed; Node 24 local (≥22 floor).

## Pre-phase harness validation

- No agent-harness governance doc (`docs/project-rules/engineering-harness.md` absent) → standard testing, no Boot/Interact/Observe pre-flight.
- Harness-loop observe active (no `docs/harness/.disabled`).

## Companion finding disposition

Companion run `2026-06-08T16-56-36-144Z-a9ad` sent **8 findings** (1 HIGH + 7 MEDIUM). It exited via `idle_budget` (verdict `completed`) before the resumed-session triage, so no `control:stop` was needed and the fix-commit pings below were not live-reviewed. All findings were read from the companion's `inside` inbox lane and triaged in the resumed session; 7 fixed test-first, 1 deferred with a documented scope note.

| Finding | ackOf (review-request) | Severity | Disposition | Fix commit | Notes |
|---------|------------------------|----------|-------------|-----------|-------|
| F006 | T015/T016 (verb-context) | HIGH | FIXED | `0853f56` | `finalizeVerbResult` had no `default` case → an invalid JS-extension status fell through to `undefined`, crashing `exitWithEnvelope` outside `runVerb`'s catch (catastrophic E100). Added a default → E141 error Envelope. Verified end-to-end in the installed bin (`weird` → E141, exit 1). |
| F007 | T015/T016 (verb-context) | MED | FIXED | `0853f56` | Blank/whitespace `next_action` (and blank `error.message`) bypassed P5 on degraded/unconfigured/error. Added a `nonBlank()` helper across all non-ok paths. |
| F001 | T005 (node-exec) | MED | FIXED | `e240ec9` | `spawn` can throw synchronously in the Promise executor (e.g. null byte → `ERR_INVALID_ARG_VALUE`), rejecting despite the never-reject contract. Wrapped in try/catch → code 127. |
| F002 | T007/T008 (jiti-loader) | MED | FIXED | `d54321b` | Native `.js` path returned `mod.default ?? mod`, leaking the namespace for a named-only module. Return `mod.default` only; a no-default module now resolves `undefined` → clean E140 (verified in installed-bin doctor smoke). |
| F005 | T011/T012 (registry) | MED | FIXED | `ca3f42a` | `shadowed ??=` recorded only the first conflict per multi-verb export. Changed `ExtensionRecord.shadows` → `string[]`; collect all; list all in the E142 message. Synced workshop contract + tests. |
| F004 | T009/T010 (discovery) | MED | FIXED | `986aa8a` | `package.json` manifest entries (`../escape.ts`) could escape the subdir. Added separator-aware lexical containment (`path.relative`, not bare `startsWith`). Symlink escapes remain out of scope (see F003). |
| F008 | T019/T020 (verb act) | MED | FIXED (reject) | `79f7747` / doc `7880f81` | Variadic args (`<files...>`) give commander a `string[]`, violating the public `ctx.args: Record<string,string\|undefined>` type. v1 **rejects** variadics in `verbShapeIssues` (chose reject over widening the public type). Also hardened arg/option shape validation so malformed extensions become clean E140/E120 instead of crashing commander. Documented the limitation in `authoring-verbs.md`. |
| F003 | T009/T010 (discovery) | MED | DEFERRED | — | Dedup/containment use `path.resolve`, not realpath, so symlinked duplicates/escapes aren't collapsed. True realpath needs a new `FsPort.realpath` capability — deferred for v1 (extension tree is developer-trusted local code). Documented inline in `discovery.ts`. |

**Rubber-duck review** (resumed-session, pre-implementation) sharpened five of these: F004 separator-aware containment (not `startsWith`), F007 error-path + whitespace coverage (not just empty string), F008 defensive arg/option shape validation alongside the variadic reject, and confirmed E141 (not E140) for F006.

## Task entries

T001–T028 implemented test-first in dependency order during the original session (commits `c55c995`…`9baee4f`); see git log. Resumed-session companion-finding fixes: `0853f56` (F006/F007), `e240ec9` (F001), `d54321b` (F002), `ca3f42a` (F005), `986aa8a` (F004), `79f7747` (F008), `7880f81` (F008 doc). Final state: **145 tests green, tsc clean, biome clean, 92.44% statement coverage**; installed-bin smokes (happy path, invalid-status E141, named-only E140) all pass.

