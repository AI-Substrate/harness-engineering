# Execution Log — Phase 4: Durable sync (GitWritePort + orphan ref + docs)

**Plan**: [harness-telemetry-collection-plan.md](../../harness-telemetry-collection-plan.md)
**Started**: 2026-06-23 · **Mode**: Full · **Companion**: code-review-companion (run `2026-06-23T10-51-46-373Z-14ff`)
**Awareness**: built against the validated dossier (T001–T008) + the §T1 governance gate (non-individual author, AC-07/13), AC-06 (porcelain-unchanged via plumbing), AC-14 (offline-safe), AC-12 (frozen schema — watermark outside the segment). Phases 1–3 frozen (capture-service/segment/adapters untouched except the T006 plan-id resolution). git / sync / docs/measures domains.

---

## T001 — GitWritePort contract test (+ port interface + FakeGitWrite)
**Status**: ✅ done · **AC**: AC-07, AC-13 (scaffold)

- Defined `src/adapters/git/git-write-port.ts`: `GitWritePort` plumbing interface (`hashObject`/`mktree`/`refTip`/`commitTree`/`updateRef`/`deleteRef`/`push`) + `TELEMETRY_REF` + the `TELEMETRY_AUTHOR` constant (`harness-telemetry <noreply@anthropic.com>`). Author/committer are **not** parameters — forced inside the adapter (§T1).
- `src/adapters/git/fake-git-write.ts`: `FakeGitWrite` — records `calls`, deterministic object/commit shas, an in-memory ref map with real compare-and-set + `staleOnce` race sim + `failPush` toggle (mirrors `FakeGit` style; fakes-not-mocks).
- `test/adapters/git/fake-git-write.test.ts`: 7 tests pinning the orphan shape (parent null → prior tip), CAS semantics, ff-retry on race, `deleteRef` rollback, push-failure throw, and the §T1 author/committer fact (author == `TELEMETRY_AUTHOR`, ≠ a planted engineer email).
- **Evidence**: 7/7 green. (RED→GREEN: initial fail was a test-import bug — constants are sourced from `git-write-port.js`, not the fake.)

## T002 — ExecGitWrite (real plumbing) + porcelain/author integration proof
**Status**: ✅ done · **AC**: AC-06, AC-07, AC-13

- `src/adapters/git/exec-git-write.ts`: real `spawnSync` plumbing (`hash-object -w --stdin`, `mktree`, `rev-parse --verify --quiet`, `commit-tree` with `-p`, `update-ref` CAS via the `<oldvalue>` arg + `""`=must-not-exist, `update-ref -d`, `push origin <refspec>`). Author+committer forced via `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on the commit-tree spawn (§T1) — config `user.email` never read. `cwd` injectable for the integration test; composition root uses `new ExecGitWrite()`.
- `test/adapters/git/exec-git-write.int.test.ts`: 5 tests against a **real throwaway repo** seeded with `user.email=engineer@example.com`. Proves: orphan write (`parent null`) lands the segment in the ref tree with **`git status --porcelain` byte-identical** before/after (AC-06); author **and** committer = `noreply@anthropic.com` and **≠ the configured engineer email** (AC-07/13); real CAS rejects a stale oldSha; `deleteRef` rollback leaves zero working-tree footprint; `push` throws with no origin (offline path).
- **Evidence**: 5/5 green; arch (`no-direct-node-io`) 3/3 (adapters may use `node:child_process`, like `exec-git.ts`); tsc clean; biome clean.

## T003 + T004 — sync-service (flush buffer → orphan ref)
**Status**: ✅ done · **AC**: AC-08, AC-14, AC-12, AC-05

- **T003 tests** (`test/services/telemetry/sync-service.test.ts`, 7): flush-all-once → ONE orphan commit + single-refspec push + watermarks advanced; **second sync = no-op** (consume proven); **plan-link dedupe across the flush** → sorted set in `result.plans` + commit message (AC-08); **failed push → `ok:false`, buffer + watermark intact, local ref rolled back** (`deleteRef` on orphan), retry then succeeds (AC-14); empty buffer = no git calls; kill-switch = zero git + fs writes; **ff-retry** (staleOnce → 2 `updateRef` attempts, wins); corrupt segment skipped (parse only), never throws.
- **T004 impl** (`src/services/telemetry/sync-service.ts`, ports-only): `syncTelemetry(deps)` fail-safe wrapper + `syncUnsafe`. Enumerates session dirs (dot-free filter excludes `.cursor`/`.flushed`/`.gitignore`), reads segments past each session's `<session>.flushed` watermark, hash-objects each + builds a per-session subtree, composes the top tree, commits on the tip with ff-retry, pushes one refspec, and **only on push success** advances the watermarks (atomic temp+rename — the consume marker lives OUTSIDE the segment, AC-12). Plan links deduped into a sorted set.
- **Decisions honoured**: consume = flushed-watermark (not delete/`.synced` — FsPort has no delete); push-fail rollback (`deleteRef` orphan / CAS-back otherwise) keeps the local ref == last-pushed state.
- **Evidence**: 7/7 green; arch 3/3 (service is `node:*`-free); tsc clean; biome clean. (dep-cruiser is not a wired gate in this repo — the vitest `test/architecture/` suite is the enforced check; memory `harness-cli-build-layout`.)

## T005 — `harness telemetry sync` verb + composition-root wiring
**Status**: ✅ done · **AC**: AC-07, AC-14

- `src/acts/telemetry.ts`: `registerTelemetryAct` — a `telemetry` command family (mirrors `registerFlowAct`) with a `sync` subcommand. Maps `syncTelemetry` outcome → Envelope (ok→0 `{synced,sessions,pushed,plans}`; failed push/ref → `formatError` exit 1 with a "buffer intact, retries next sync" next_action). JSON + human ports.
- Wiring: `VerbActDeps` gains optional `gitWrite?: GitWritePort` (optional → no sweep of the ~10 full-deps test builders); `defaultDeps()` provides `new ExecGitWrite()`; `registerTelemetryAct(program, io, deps)` added to the composition root; act resolves `deps.gitWrite ?? new ExecGitWrite()`.
- `test/acts/telemetry.test.ts`: 4 tests (flush→ok exit 0 with synced/pushed/plans + single refspec; failed push→error exit 1, buffer intact; empty buffer→ok no-op exit 0, zero git calls; human one-liner).
- **Two command-list assertions updated** (`index.test.ts`, `app.test.ts` ×2) to include the new `telemetry` command between `flow` and `instructions` — expected registration-surface change, not a regression.
- **Evidence**: full suite **1120/1120**; tsc clean; biome clean.

## T006 — cwd-based plan-id detection (closes live-smoke finding #2 → AC-08)
**Status**: ✅ done · **AC**: AC-08

- `capture-service.ts`: exported pure `planIdFromCwd(cwd)` (regex `(?:^|/)docs/plans/([^/]+)`, posix-normalized — works at any depth, never false-matches `docs/plansfoo/`) + `resolvePlanId(env,cwd)` (explicit `HARNESS_PLAN_ID` wins, else cwd). `buildInput` now takes `cwd` and uses `resolvePlanId`; `plans_touched` populated from either source. **No schema/adapter change** (AC-12) — only the plan-id *resolution* inside the existing capture path.
- `test/services/telemetry/plan-id-cwd.test.ts`: 6 tests — `planIdFromCwd` (depth, Windows-shaped, the `docs/plansfoo` non-match, the bare `docs/plans` null) + capture-level wiring (cwd inside `docs/plans/034-x/…` → `plans_touched:["034-x"]`; env override; neither → `[]`).
- Closes the Phase-3 live-smoke gap where `plans_touched` was `[]` despite working inside the plan dir.
- **Evidence**: 6/6 new + capture-service unchanged; full suite **1126/1126**; tsc + biome clean; service stays `node:*`-free.

## T007 + T008 — docs (telemetry guide + value-measures contract + AC-11 audit)
**Status**: ✅ done · **AC**: AC-10, AC-11

- **T007** `docs/how/telemetry.md`: the guide — capture model + diagram, counts-only segment (links to plan `### Segment Schema` + `segment.schema.json`, no copy), **path semantics** with a worked out-of-repo→basename example (finding #3), `HARNESS_NO_TELEMETRY` kill-switch, plan-link rules (env + cwd), `harness telemetry sync` + orphan-ref/single-refspec/ambient-auth, **offline-safe** behaviour, trailing-tail caveat, team/repo-only attribution, and **Known limitations** stating `subagents[].tokens` null in practice (finding #1) + out-of-repo lossiness explicitly. Bundled (`docs-manifest.json` + `npm run gen:docs` → `harness docs telemetry`).
- **T008** extended `docs/how/harness-value-measures.md` with **§(e) The telemetry segment — a counts-only sensor contract**: available fields at team/repo grain (links, no copy), a hand-traced segment example, how it joins the `harness-change` records by `plan_id`, and the team/repo-only / no-per-individual statement (commit-author + `agent` never per-person). See-also cross-links both ways.
- **AC-11 deterministic audit** (`test/architecture/no-per-individual-surface.test.ts`, 3): no `src/**` reads the contributor identity (`'user.email'`/`'user.name'` quoted args or `--format=%a[en]/%c[en]`); the orphan identity is the fixed non-individual constant; `ExecGitWrite` forces it via env and never `git config`s a user identity. Upgrades AC-11 from doc-presence (inferential) → code-path sensor (deterministic). (Regexes target real code patterns; backticked prose mentions don't false-match.)
- **Evidence**: docs-content regen current (byte-equal + manifest/DOCS id-set tests pass); markdown-lint introduced **no** new findings (the 8 are pre-existing, none in these files; non-blocking gate); full suite **1130/1130**; tsc + biome clean.
