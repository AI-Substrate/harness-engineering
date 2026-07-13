# Ship Report — dont-apologise-fix

**Generated**: 2026-07-09T02:40:00+10:00
**Branch**: 056-dont-apologise-fix → **Base**: main
**PR**: https://github.com/AI-Substrate/harness-engineering/pull/64 (#64)  ·  **State**: open

## Checks

| Check | Status | Details |
|-------|--------|---------|
| build-test (22) | ✅ pass | 1m44s |
| build-test (24) | ✅ pass | 1m32s |
| rename-guard | ✅ pass | 7s |
| package-smoke | ⏳ pending | (running at report time) |

**Verdict**: 3/4 green, package-smoke pending — not blocking.

## Post-ship telemetry verification (user-requested)

Rebuilt + deployed the CLI (`just build` → global relink to this tree) and exercised the new telemetry:

- **Fingerprint (T002)**: `harness observe` stamps `fp: <12-hex>` at capture; **deterministic** (same kind+target+description → identical fp). ✅
- **Vocab (T003)**: `observe_kind` + `retro` artifact type + `disp_*`/`kind_*` count keys live in the deployed serializer/schema. ✅
- **Insight generators (T005)**: `observe_conversion` + `disposition_mix` registered, run over a real report, and **degrade honestly** on pre-1.2 data (`"definitionally zero until schema-1.2 records are drained"`) — matches the tripwire runbook's T0 expectation. ✅
- **Schema 1.2 (T001)**: the deployed `harness record retro` template scaffolds with the new optional `fp` + `disposition` fields. ✅

## Repo guidance applied

- PR template: none → default body (quoted from plan Summary)
- Base: main (repo default)
- Reviewers: none auto-requested

## Deferred & Noteworthy

_Informed the go-decision; never a blocker._

| Kind | Item | Where | Reason / note |
|------|------|-------|---------------|
| Deferred (by design) | 5 token-efficiency observations | phase-1 retro record | charter for the queued follow-on efficiency plan |
| Task | `flow-pair observe` should scope its diff to allowed-paths | retro DL-001-orchestrator | bit us live this run |
| Task | rail should render a pip for `assumed`-status chores | retro DL-001-rail | harness invisible when it first appears |
| Task | governance doc references stale `harness/cli/` path | verify-time observation | misled the rebuild step; layout moved to repo root |
| Code | No new TODO/FIXME/HACK in shipped diff | — | clean |

## Resume

- Merge **not yet done** — awaiting typed `PROCEED` (or arm platform auto-merge). Base has not diverged.
- Re-check checks: `gh pr checks 64`
- Post-flight harvest chore (`retro-ship`) is due — the terminal long-horizon reflection.
