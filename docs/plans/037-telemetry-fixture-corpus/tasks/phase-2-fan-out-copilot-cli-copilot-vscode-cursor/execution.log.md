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
- **Commit**: `2ac6b5f` (mechanism).

## T002 — capture + manual review one real copilot-cli session ✅

- Promoted `fixtures/real/copilot-cli/2026-06-24-checks-run/` (`raw.events.jsonl` 66KB, `raw.process.log` 12KB, `meta.json`) — re-running the capture WITHOUT `--dry-run` after the manual review passed (user-approved redaction).
- **Manual "anything bad" review**: leak scan 0 across both raw files (`/Users/`, `C:\`, emails, `jordanknight`/`jakkaj`/`Jordan Knight`, api-key shapes); user prompt + assistant reply innocuous; vendor system prompt redacted.

## T003 — copilot-cli e2e golden + invariants (AC-03) ✅

- Extended `real-capture.e2e.test.ts` with a copilot-cli block: `FakeFs` events + a `process-*.log` (with the `dirs` map seeded so `findProcessLog`'s `readdir` surfaces it), full-session window → `copilotAdapter.extract` → `serializeSegment` → committed `expected-segment.json` + `invariants.json` (`REGEN_GOLDEN=1`, human-reviewed).
- **Token correlation proven (AC-03)**: `tokens = {input:4, output:539, cache_create:45885, cache_read:40183, total:86611, grand_total:86611}`, model `claude-opus-4.8` — summed from the 2 filtered `assistant_usage` blocks (interaction `7a9a4042`, which matches the events' `interactionId`). The stored telemetry segment had `tokens:null` (windowed to `doctor`); full-session window correlates.
- **Gotcha**: `FakeFs.readdir` reads a separate `dirs` map (not the seeded `files`); seeding only `files` made `findProcessLog` return null → null tokens. Fixed by passing the `dirs` arg.

## T004 — byte-scan covers the new copilot-cli files (AC-02) ✅

- The scan auto-globbed the new instance (raw.events.jsonl, raw.process.log, expected-segment.json, invariants.json, meta.json).
- **Scanner false-positive fixed** (Discoveries below): JSON `win-drive` flagged `system:\\n`/`entries:\\n` — a YAML key + a *doubly-JSON-escaped* newline (the harness retro template embedded in the `doctor --json` tool output), NOT a Windows path. Narrowed the JSON `win-drive` regex to exclude JSON escape sequences (`\\n\\t\\r\\"\\/…`); `win-home` still catches the identity-bearing `C:\\Users\\` case, and the liveness control still flags a real `C:\Users\carol`.
- **Evidence**: full telemetry + extension suite **305 passed (33 files)**; privacy scan 12/12 incl. liveness.

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T003 | gotcha | `FakeFs.readdir` reads a separate `dirs` map, not seeded `files` → `findProcessLog` found nothing → token correlation produced null. | Pass the `dirs` arg `{ [logsDir]: ['process-test.log'] }`. | fake-fs.ts |
| 2026-06-25 | T004 | Noteworthy | JSON `win-drive` byte-scan false-positives on doubly-nested JSON escape seqs (`key:\\n`) — extends Phase-1's T007 finding to nested JSON. | Exclude JSON escape letters after `:\\`; `win-home` keeps the identity case; liveness control preserved. | fixture-privacy-scan.test.ts |
| 2026-06-25 | T003 | insight | Real token correlation = `input 4 / output 539 / cache_create 45885 / cache_read 40183` (total 86611) from the live session — a real cross-check the stored telemetry segment couldn't give (it was windowed to `doctor` → tokens null). | AC-03 satisfied with real data. | invariants.json |
