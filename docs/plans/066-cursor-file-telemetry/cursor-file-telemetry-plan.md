# Plan 066 — Cursor file-write telemetry (ApplyPatch deltas)

> **Retrospective plan.** This flow was created AFTER the work was done, at
> Jordan's direction, to put the full journey on the record. The prototype was
> built and validated live in a throwaway test worktree (`cursor-test`) during a
> telemetry-documentation session on 2026-08-04; this branch carries the same
> change cherry-picked onto `main` plus this dossier. The companion
> `execution.log.md` is the top-to-bottom narrative; nothing here was
> re-derived after the fact.

## Thesis

Cursor (`cursor-agent`) sessions emitted **zero `file` events**, so the
human-vs-agent code-attribution method (`docs/how/measuring-ai-contribution.md`)
was structurally blind to Cursor work: every Cursor-driven line read as
human-written residual. The blind spot was **not** a data limitation — Cursor's
transcript logs its edit tool (`ApplyPatch`) with the complete V4A patch as the
`tool_use.input` string. Nobody had ever observed it because no Cursor session
in this repo's history (or its fixture corpus) had ever edited a file. The fix
is ~50 lines: share the copilot adapter's existing V4A counting parser and give
untimed events an honest capture-window anchor.

## What shipped (the cherry-picked change)

| File | Change |
|---|---|
| `harness/cli/src/services/telemetry/adapters/cursor-adapter.ts` | Extract `ApplyPatch` calls: parse the V4A patch string → per-file `FileDelta` → `file` events (`Add File:` → `written`, `Update/Delete File:` → `edited`) + the `files.written/edited` path lists. Event-stream gate widened from `anyTs` to `anyTs \|\| fileEvents.length > 0` so headless CLI sessions (no bubble timeline) don't drop them. |
| `harness/cli/src/services/telemetry/adapters/copilot-adapter.ts` | `export` on `parseApplyPatchDeltas` (plan 056's counting parser) — Cursor's patch grammar is identical, so the parser is shared, not duplicated. |
| `harness/cli/src/services/telemetry/adapters/harness-adapter.ts` | `HarnessContext.capturedAt?: string` — the capture wall-clock, threaded so an adapter over an UNTIMED source can stamp `t_precision: 'interval'` ("within this window") instead of fabricating a time or dropping the event. |
| `harness/cli/src/services/telemetry/capture-service.ts` | One line: pass `deps.clock.nowIso()` as `capturedAt` at the extract callsite. |

Privacy floor unchanged (AC-04): header paths + `+`/`-` line/byte COUNTS only;
patch body text never travels. Paths stay raw in the adapter — `segment.ts`
confines them at serialize time (`confineFilePath` for events,
`relativizePath` for the lists), so out-of-repo writes still collapse to
`<external>`.

### Timing honesty

Cursor's transcript carries no timestamps, and headless CLI sessions have no
IDE bubble timeline. When a bubble anchor exists the event is `anchored`; when
none exists it takes the capture wall-clock at `t_precision: 'interval'` — the
first real use of the `interval` precision that the event schema always
allowed. The claim is exactly "this edit happened in the window ending at this
capture", which is also precisely the granularity the attribution join needs
(`product_commit` is per-window).

## Evidence

- **Specimen**: real transcript `~/.cursor/projects/...worktrees-cursor-test/agent-transcripts/1a501a09-*/1a501a09-*.jsonl` — 56 lines, 9 `ApplyPatch` calls from a genuine feature build (see `cursor-prompt.md`).
- **Replay validation**: the transcript copied under a fake conversation id and captured via `harness doctor` → segment with 9 file events, correct per-file deltas (e.g. `demo/textstat/lib.mjs` written +72 lines / 1809 bytes), 6 written + 2 edited paths, all repo-relative.
- **Tests**: `npx vitest run test/services/telemetry` — 88 files, 1316 tests, all green with the change.
- **Method validation at corpus scale** (pre-existing capture, claude-code sessions): the attribution join run over the s065 branch — 446 file events across 15 August session refs, 50/86 commits with parent-anchored telemetry, aggregate agent share 67.4 % raw / 37.6 % clamped — confirming the join mechanics this fix now extends to Cursor.

## Known limits & follow-ups (deliberately NOT in this change)

1. **Golden fixture**: the fixture corpus (`test/services/telemetry/fixtures/real/cursor/`) has no editing session. Cut a fixture from the `1a501a09` transcript (sanitized) + `expected-segment.json` so drift-guard covers the new path. Required before this leaves prototype status.
2. **Adapter unit tests**: direct tests for the `ApplyPatch` branch (string input, multi-file patch, `Delete File:`, absolute-path confinement, `interval` stamping).
3. **Docs drift**: `docs/how/telemetry.md`, `docs/how/telemetry-field-reference.html`, and the plan-056 capability matrix still say cursor emits no file events. Update with the shipped truth (AC-07's "honest null" no longer applies to files).
4. **copilot-vscode has the same blind spot** — `files: null` in `copilot-vscode-adapter.ts`. Next stream: point the same specimen-generating prompt at VS Code Copilot, dissect what its store logs for edits, and port the same pattern. (Jordan is generating that specimen next.)
5. **Headless-session enrichment**: `~/.cursor/chats/<workspace-hash>/<conv>/store.db` (protobuf) exists per CLI conversation and is the candidate source for **models + real timestamps** for headless sessions (the IDE `state.vscdb` only covers IDE sessions). Would upgrade `interval` → `anchored` and un-null `models`. Separate investigation; protobuf decoding is a heavier lift.
6. **What stays honestly null**: `tokens` (Cursor keeps consumption server-side; local `tokenCount`/`usageData` fields are vestigial/zeroed — never estimate), `thinking`, `compactions`, `api_errors` (absent from the transcript: only `text` and `tool_use` blocks exist, no `tool_result`, no thinking blocks).
7. **Capture-stall defect** (observed live, reported to the o-prime): the real Cursor session captured once (`harness doctor`, transcript line 2) then never again despite subsequent verbs + 5 hook syncs — read-cursor stuck while a controlled replay of the same transcript captured perfectly. Consistent with the known load-dependent per-invocation defect; owned outside this plan.
8. **Anchoring rhythm** (method consequence, not a defect): post-commit-hook-only capture anchors file events at the NEW head, crediting them to the *next* commit. The rhythm "run any harness verb between editing and committing" fixes anchoring; a **pre-commit capture hook** would make it deterministic and model-independent. Worth a follow-up decision.

## Definition of done (for landing, beyond the prototype)

- [ ] Fixture + expected-segment for a cursor editing session (drift-guarded)
- [ ] Unit tests for `ApplyPatch` extraction paths
- [ ] `telemetry.md` / field-reference / capability-matrix docs updated
- [ ] `harness checks` green on this branch
- [ ] Review per repo discipline
