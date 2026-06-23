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
