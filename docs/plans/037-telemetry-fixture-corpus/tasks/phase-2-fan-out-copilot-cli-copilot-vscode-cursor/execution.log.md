# Execution Log — Phase 2: Fan out — copilot-cli + copilot-vscode + cursor

**Plan**: `../../telemetry-fixture-corpus-plan.md` · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T08-15-52-611Z-d7ea` (Power On Mode)

> Facts + evidence per task. Companion findings logged inline with their `ackOf` review-request mapping.

---

## Discoveries (early — surfaced before/while building T001)

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T001 | Noteworthy | **Extension `VerbContext` has no `db` port** (and `ctx.fs` has no mtime). The plan assumed `run()` injects `NodeDb`. | copilot-vscode/cursor (T006/T009) will compose the core `NodeDb` adapter directly at `run()` (node:* stays in the sanctioned core adapter, not the extension). copilot-cli session selection uses explicit `--session` (no mtime auto-pick). Logged `DL-001`. | `services/extensions/contract.ts` |
| 2026-06-25 | T001 | Noteworthy | **copilot-cli `process-*.log` files are per-PROCESS verbose debug logs** (100s of MB; 28KB embedded payloads) that interleave MANY sessions. The adapter reads only `assistant_usage` JSON objects filtered by inner `session_id`. Committing one verbatim = huge + cross-session leak. | Fixture keeps ONLY this session's `assistant_usage` records via a pure `filterCopilotProcessLog` (single-source in `fixture-extract.ts`). Logged `INS-003`. | `copilot-adapter.ts:findProcessLog` |
| 2026-06-25 | T001 | Noteworthy | **Reused a session already on `refs/harness-telemetry/2026/06/24/*`** (`b67cd3ce`) — one our own live telemetry already segmented — so the live-produced segment cross-checks the e2e golden. The stored segment had `tokens:null` (windowed to the `doctor` command); the e2e drives a **full-session window** so token correlation populates. | Fixture instance `copilot-cli/2026-06-24-checks-run`. | user steer |
| 2026-06-25 | T001 | Decision | **events.jsonl embeds GitHub Copilot's ~33KB proprietary system prompt** (`system.message.data.content`). The adapter never reads `system.message`. | **User-approved**: redact only the system-prompt body (pure `redactCopilotSystemMessage`); user prompts + tool usage stay verbatim. Segment unchanged; fixture 100KB→79KB; no vendor-prompt republish. | AskUserQuestion 2026-06-25 |

## T001 — copilot-cli capture branch ✅

- **`fixture-extract.ts`** (NEW, core/pure) — `filterCopilotProcessLog(log, sid)` (keep only the session's `assistant_usage` records, adapter-faithful via the same `extractJsonObjects` scan) + `redactCopilotSystemMessage(events)` (swap the vendor system-prompt body for a placeholder; envelope preserved). Brought forward from T005/T006 because T001 needs the process-log filter. No `node:*`.
- **`capture-logic.ts`** — replaced the (wrong) `copilotCliSources` with pure helpers `copilotCliEventsPath`/`copilotCliLogsDir`/`isCopilotProcessLog`/`pickCopilotCliSession` + `claudeSources`. The process log is content-matched (`process-*.log` containing the sid), not `<sid>.log`.
- **`extension.ts`** — refactored `run()` to a multi-surface, multi-file design: `resolveSources` (per-surface) now returns already-read CONTENT (some captures are transforms, not file copies), a shared scrub→stage(unscrubbed+scrubbed)→promote loop handles N files + meta. copilot-cli branch: events (redacted) + filtered process log; added `--log <path>` to skip scanning 100s-of-MB logs.
- **TDD**: `fixture-extract.test.ts` (6) + `capture-logic.test.ts` (now 17) written/updated and green.
- **Manual "anything bad" review** (non-skippable): dry-run staged to `scratch/`; user prompt = innocuous harness-test prompt; assistant reply innocuous; **leak scan 0** for `/Users/`, `C:\`, emails, `jordanknight`/`jakkaj`/`Jordan Knight`, api-key shapes, on both `raw.events.jsonl` and `raw.process.log`. Scrub rebased all paths to `/home/dev[/repo]`.
- **Evidence**: `vitest` telemetry+extension suites → **46 passed (5 files)** incl. the untouched claude e2e + privacy scan (AC-10 honoured). `harness capture-fixtures --surface copilot-cli --session b67cd3ce --log … --dry-run` → ok, staged both files; redaction confirmed (0 vendor-prompt body, 1 placeholder, user prompt verbatim ×4).
