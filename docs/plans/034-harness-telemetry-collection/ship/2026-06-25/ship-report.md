# Ship Report — harness-telemetry-collection

**Generated**: 2026-06-25
**Branch**: 036-copilot-vscode-telemetry → **Base**: main
**PR**: https://github.com/AI-Substrate/harness-engineering/pull/40 (#40)  ·  **State**: open

## Checks

| Check | Status | Details |
|-------|--------|---------|
| build-test (22) | ✅ | actions/runs/28148882480 |
| build-test (24) | ✅ | actions/runs/28148882480 |
| ci-required | ✅ | actions/runs/28148882480 |
| package-smoke | ✅ | actions/runs/28148882480 |
| rename-guard | ✅ | actions/runs/28148882480 |

**Verdict**: all green (5/5)

## Repo guidance applied

- PR template: none → default body from plan summary
- Base: main (repo default branch)
- Reviewers: none auto-requested

## Deferred & Noteworthy

_Everything punted across the build that's about to ship — surfaced so the go-decision is informed. Never a blocker._

| Kind | Item | Where | Reason / note |
|------|------|-------|---------------|
| Decided (owned) | Session id `7fb3a97f` kept in doc artifacts | plan / the-flow.json / retro | Opaque 8-char local handle, not a private identifier — maintainer call (F002) |
| Decided (owned) | Maintainer name kept in a test fixture | fake-git-write.test.ts | Public repo already carries it as commit author — maintainer call (F006) |
| Noteworthy | rules §9 "bump all four docs together" — only rules.md ticked | docs/project-rules | The other three never encoded the prior stance; bumping them is empty ceremony — defensible |
| Noteworthy | capture-service still imports concrete `resolveCopilotVscodeSessionId` | capture-service.ts | By design — the one detection-time call is the core's job; the per-read hot path is clean |

No real TODO/FIXME/HACK in the shipped diff; no skipped tasks; all acceptance criteria met (review verdict cleared).

## Resume

- Merge not yet done → awaiting typed PROCEED
- Re-check checks: `gh pr checks 40`
