# Ship Report — deterministic-documents

**Generated**: 2026-08-04T05:40+10:00
**Branch**: s065/deterministic-documents → **Base**: main
**PR**: https://github.com/AI-Substrate/harness-engineering/pull/87 (#87)  ·  **State**: open

## Checks

| Check | Status | Details |
|-------|--------|---------|
| build-test (22) | ✅ 2m52s | actions/runs/30845959292/job/91794181489 |
| build-test (24) | ✅ 2m31s | actions/runs/30845959292/job/91794181477 |
| ci-required | ✅ 5s | actions/runs/30845959292/job/91795226103 |
| package-smoke | ✅ 1m3s | actions/runs/30845959292/job/91794929391 |
| rename-guard | ✅ 7s | actions/runs/30845959292/job/91794181443 |

**Verdict**: all green

## Repo guidance applied

- PR template: none → default body (plan summary + human-items section)
- Base: main (repo default)
- Reviewers: none auto-requested (no CODEOWNERS match)

## Deferred & Noteworthy

_Everything punted across the build that ships without an explicit human sign-off — the go-decision reads this first._

| Kind | Item | Where | Reason / note |
|------|------|-------|---------------|
| **Human call** | Exemplar taste rows `bp-0902`/`ac-0901` unchecked | `docs/plans/065-deterministic-documents/exemplar/` | Jordan's "clever use of primitives" bar — the corpus records of itself that no machine proves taste |
| Deferred | Telemetry containment debt: two docs.test.ts timeouts raised (d531383c, 68d62225) around the unfixed per-invocation capture cost (~5.16s loaded vs ~0.2s idle) | test/integration/docs.test.ts | Prime-counted debt: "two is containment, a third means adaptation out-competed the fix"; with Jordan alongside the synchronous post-commit sync (3.5–4.5s, swallows failures) |
| Deferred | Shared-OS-tmpdir enumeration in exec-remote-telemetry-git.int.test.ts is concurrency-unsafe (intermittent under parallel peers) | test/adapters/git/ | Reported P6, outside every phase fence; fix shape: per-run temp root |
| Deferred | Shared observe buffer loses entries under multi-agent concurrency (read-modify-write race) | .harness/temp/agent/session-buffer.md | Needs per-seat buffers or append-only capture (retro 003 DL-005) |
| Noteworthy | `autoRegenerateSibling` gained its first call site in P5 (verify-basis --update); renderer column-order from valuesShape remains a deferred magic-wand | services/dd/render | retro 004/005 MW rows |
| Noteworthy | Expected merge conflict with dependabot PRs #74–#82 on package.json | package.json | Anticipated in the OD-3 ruling |
| Noteworthy | Doctrine candidates drained for encoding: ruled-values-need-pinning; the self-defeating-probe rule (evaluate probes in the consumer's form); CLI-in-tests recipe (HARNESS_NO_TELEMETRY, cwd pinning) | retro records 004/005 | Offered at harvest, not silently encoded |

## Resume

- Merge NOT armed — convergence is the prime's (standing ruling); dependabot conflict expected at merge time.
- Re-check checks: `gh pr checks 87`
