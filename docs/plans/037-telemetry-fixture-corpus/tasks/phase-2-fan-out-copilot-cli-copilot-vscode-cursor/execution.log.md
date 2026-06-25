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

## Companion findings reconciliation (run `2026-06-25T09-03-38-253Z-12bf`)

First companion (run `…-d7ea`) idled out before any ping (deep T001 investigation + user back-and-forth exceeded its ~31min budget) → **no review**, re-booted. The second companion reviewed `2ac6b5f` + `ec6daa2` and filed findings (recovered from `agents/code-review-companion/runs/…-12bf/output/report.json`; inbox delivery flaked again):

| # | Sev | Finding | Verified? | Fix |
|---|-----|---------|-----------|-----|
| F001 | HIGH | My T004 win-drive narrowing (`(?![\\nrtbfuv"/])`) created a **false NEGATIVE**: real JSON drive paths starting with an escape letter (`"C:\\repo\\x"`, `"C:\\tmp"`, `"C:\\newfolder"`) slip the scan — and the repo path itself starts with `r`. AC-02 could pass with a real non-Users Windows path. | ✅ real | Replaced with a **boundary-sensitive** detector `(?<![A-Za-z])[A-Za-z]:\\\\` — a drive letter is a single letter at a word boundary, vs `system:\\n` (letter is the tail of a word). Added liveness cases: `C:\\tmp`/`C:\\repo`/`C:\\newfolder` flag; `on:\\n`/`system:\\n`/`entries:\\n` don't. (Applied to plain-text variant too.) |
| F002 | MED | Extension `summary`/`description` still said "claude; … Only 'claude' is implemented in Phase 1" after copilot-cli landed — contract drift. | ✅ real | Updated to "claude, copilot-cli wired; copilot-vscode/cursor pending". |

Companion magicWand (coordination): "a first-class way to reassign/alias a finding from an earlier briefing to a later task without re-sending" — backlog candidate. Both findings fixed; privacy scan 13/13 (incl. new soundness control), telemetry+extension 306/306.

---

## T005 — copilot-vscode row-projection test (RED) ✅

- **`fixture-extract.test.ts`** (+5 tests) — `describe('projectCopilotVscodeRows')` pins the copilot-vscode **privacy boundary**: raw `sessions`+`turns` rows (with real message text) → extracted-rows shape carrying **no** `user_message`/`assistant_response`, only `turn_index`/`words`/`has_response`/`timestamp` (sessions → `{id,cwd,updated_at}`).
- **Contract pinned by the test** (so T006 has no wiggle room):
  - word count **mirrors the adapter's `TURNS_SQL` exactly** — `"one  two"` (two spaces) → **3**, not 2; whitespace-only → 0. A smarter collapse-runs count would desync T008's real-SQL round-trip.
  - `has_response` = 1 only when `assistant_response` is non-empty (null + `''` → 0).
  - cwd path stays **raw** in this pure projection — `scrubText` rebases it at the extension boundary (single-source scrub, no double-scrub).
  - serialized-bytes assertion: neither the user body, the assistant body, nor a fragment (`refactor`) survives.
- **Evidence (RED)**: `vitest run fixture-extract.test.ts` → **5 failed | 6 passed** — all 5 new fail with `projectCopilotVscodeRows is not a function`; the 6 copilot-cli projections still green.
- **Commit**: `750c2c9` (test-first).

## T006 — `projectCopilotVscodeRows` impl + copilot-vscode capture branch (GREEN) ✅

- **`fixture-extract.ts`** (+`projectCopilotVscodeRows`, `+sqlWordCount`) — pure projection: raw `sessions`+`turns` → `{sessions:[{id,cwd,updated_at}], turns:[{session_id,turn_index,words,has_response,timestamp}]}`. `sqlWordCount` mirrors `TURNS_SQL` (`trimmed.length - trimmed.replaceAll(' ','').length + 1`; 0 for empty). No `node:*`.
- **`extension.ts`** — added `resolveCopilotVscode`: composes a core **`NodeDb`** at `run()` (DL-001 — `node:sqlite` stays sealed in NodeDb; the extension source still imports no `node:*`), bridges `ctx.env`(`.get` only)+`config.homeDir` into a tiny **`EnvPort`** shim for the adapter path helpers, resolves the session by `--session` or `resolveCopilotVscodeSessionId(db,env,cwd)`, reads raw `sessions`+`turns`, projects (drops bodies), promotes `raw.rows.json`. Summary/description updated (copilot-vscode now wired — pre-empting F002 drift).
- **Test fix**: the T005 expected word count for the 8-word sample was off-by-one (`7`→`8`, 7 spaces + 1) — my fixture comment was wrong, the SQL-mirror is right. 11/11 green.
- **Live mechanism proven** (feeds T007): `harness capture-fixtures --surface copilot-vscode --names "jakkaj,Jordan Knight,jordanknight" --dry-run` against the **real** 4 KB store → staged `raw.rows.json` for session `7fb3a97f` (8 turns). **Manual review**: unscrubbed→scrubbed diff = the cwd path ONLY (`/Users/jordanknight/...` → `/home/dev/repo`); scrubbed file leak-scan **0**; **no message columns/prose** — bodies fully stripped by the projection (text never reaches a written file). All 8 turns timestamped → `event_stream` will populate, `t_precision:'anchored'`.
- **Evidence**: full telemetry suite **296 passed (32 files)**; `just build` typechecks the NodeDb/EnvPort composition clean.
- **Commit**: T006 (mechanism — no fixture committed yet; that's T007).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T006 | decision | Extension `ctx.env` exposes `.get` only (no `.home()`), which the copilot-vscode adapter path helpers need. | Build a 3-line `EnvPort` shim from `ctx.env.get` + `config.homeDir` at `run()` — no node:* reach, no contract change. Confirms DL-001's "compose at the root" resolution. | extension.ts `envPortFor` |
| 2026-06-25 | T006 | insight | The real store is the anticipated **thin** one (4 KB, 1 session, 8 turns) but fully substantive — real prompts (124/146-word turns) with responses, real ISO timestamps. | Good enough for a real golden + the SQL round-trip (T008). No synthetic padding needed. | session `7fb3a97f` |

## T007 — promote the real copilot-vscode fixture + manual review ✅

- Promoted `fixtures/real/copilot-vscode/2026-06-25-real/` (`raw.rows.json` 1.7 KB, `meta.json`) — re-ran capture WITHOUT `--dry-run` after the T006 manual review passed.
- **Manual "anything bad" review** (non-skippable): leak scan **0** (`/Users/`, `C:\`, emails, `jordanknight`/`jakkaj`/`Jordan Knight`, key shapes); **no message text** (projection-stripped); only structural rows + the rebased `/home/dev/repo` cwd. `meta.json` attests `scrub_categories` incl. git-handles + person-names.
- **Thinness documented** (per task Note / plan Risk): one session, 8 turns. Substantive enough for a real golden — turns carry real word counts (2–146) + ISO timestamps; no padding.
- **Byte-scan** auto-globbed the new instance: `fixture-privacy-scan.test.ts` **15 passed** (incl. liveness control).
- **Commit**: `b54814d` (fixture data).

## T008 — copilot-vscode SQL round-trip int-test + golden (AC-04) ✅

- **`copilot-vscode-sqlite.int.test.ts`** (NEW, 4 tests) — reconstructs a throwaway **writable** `node:sqlite` store from `raw.rows.json` at the exact path `copilotVscodeStoreDbPaths(env)[0]` resolves, then reads it back through the **real read-only `NodeDb`** via the adapter's **actual SQL** (`resolveCopilotVscodeSessionId` cwd→session + `TURNS_SQL`) → `serializeSegment` → committed golden.
- **The round-trip is non-tautological**: a turn with `words:N` is synthesised as N space-joined tokens (N−1 spaces); the adapter's `TURNS_SQL` (`spaces+1`) recovers N. Capture-side `projectCopilotVscodeRows` and runtime `TURNS_SQL` share the formula, so `seg.user_prompts === fixture.words` ([124,4,12,71,4,2,3,146]) is a real cross-check — drift on either side breaks the deep-equal.
- **Golden** (`expected-segment.json`, 2.7 KB, human-reviewed): `tokens:null` (honest ceiling — VS Code Copilot keeps usage server-side), `models:null`, 16 events (8 prompt + 8 turn), **every event `t_precision:'anchored'`** (untimed-precision store), rollup present. Leak scan 0.
- **Evidence**: `REGEN_GOLDEN=1` mint → re-run clean **4 passed**; full telemetry suite **303 passed (33 files)** incl. the byte-scan auto-globbing the new golden.
- **Commit**: T008 (round-trip + golden).

---

### copilot-vscode surface COMPLETE (T005–T008)

The copilot-vscode SQLite surface is done end-to-end: pure projection (privacy boundary) → capture branch (NodeDb at run(), DL-001) → real reviewed fixture (thin but substantive) → real-SQL round-trip golden. tokens null + `anchored` timeline are the honest ceiling, asserted. **Next: cursor (T009–T011).**

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T008 | insight | `copilotVscodeStoreDbPaths` pushes the macOS slot (`Library/Application Support/…`) at index 0 whenever HOME is set, REGARDLESS of platform (no OS detection). | The int-test seeds `paths[0]` and the adapter reads `paths[0]` → platform-independent round-trip (green on macOS + Linux CI without per-OS branching). | copilot-vscode-adapter.ts:47 |

## T009 — cursor capture branch (transcript + cursorDiskKV projection) ✅

- **`fixture-extract.ts`** (+`projectCursorBubbleRows`) — the cursor PRIVACY BOUNDARY. A raw `cursorDiskKV` bubble embeds `gitDiffs`/`consoleLogs`/attached file contents/full `text`+`richText`/tool args; the runtime `cursorAdapter` reads ONLY `type`/`createdAt`/`modelInfo.modelName`. The projection re-serializes each row's `value` to JUST those (omitting `modelInfo` when no model name) — everything else dropped. Test-first: +4 in `fixture-extract.test.ts` (incl. a serialized-bytes assertion that text/diffs/`apiKey`-beside-`modelName` don't survive). 15/15 green.
- **`capture-logic.ts`** (+`cursorMangle`/`cursorTranscriptsDir`/`cursorTranscriptFile`, +2 tests) — derive the on-disk transcript path from home+cwd (`~/.cursor/projects/<mangled>/agent-transcripts/<conv>/<conv>.jsonl`); mangle = strip leading `/`, `/`→`-` (the observed scheme, verified against the live dir). Finding 04: capture reads the path directly, never via `AGENT_TRANSCRIPTS`.
- **`extension.ts`** (+`resolveCursor`) — TWO sources: the transcript kept **verbatim** (prompts/tool-calls are the corpus's point; only paths/identity scrubbed, like claude) + the `cursorDiskKV` bubbles read via core `NodeDb` (DL-001) and projected. Requires `--session <conv>`. Summary/description: all four surfaces now wired.
- **Live mechanism proven** (feeds T010): `harness capture-fixtures --surface cursor --session 01aa25af… --dry-run` → staged `raw.jsonl` (10 KB) + `raw.rows.json` (4.5 KB, 24 projected bubbles). **Manual review**: scrub rebased every `/Users/jordanknight/...` → `/home/dev/repo` in tool args (`working_directory`/`path`/`target_directory`); transcript is an innocuous harness session (boot/checks/doctor + counting to 10); the one ad-hoc-scan hit (`stop:\n`) is a word-tail false positive the authoritative boundary-scan excludes; bubbles carry only type/timestamp/model. **No leak.**
- **Evidence**: full telemetry + capture-logic suites **324 passed (34 files)**; `just build` clean.
- **Commit**: T009 (mechanism — no fixture committed yet; that's T010).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T009 | decision | The cursor transcript is kept VERBATIM (prompts/tool-args scrubbed only) but the `cursorDiskKV` bubble is PROJECTED to model/timing — asymmetric handling of the two sources. | Right per source role: the adapter READS transcript prose (word counts/tool names) so it's the corpus payload (like claude); it reads only model/timing from bubbles, whose raw form embeds diffs/file-contents/prose → must project. | extension.ts `resolveCursor` |
| 2026-06-25 | T009 | insight | The captured session's MODEL (`composer-2.5`) lives on the type-1 (user) bubbles; type-2 (assistant) bubbles have `modelName:null`. | The adapter's `modelHistogram` counts modelName across ALL bubble types → still surfaces `composer-2.5` as dominant for the model attribution. T011 asserts this join. | cursor bubbles 01aa25af |

## T010 — promote the real cursor fixture + manual review ✅

- Promoted `fixtures/real/cursor/2026-06-25-checks-walkthrough/` (`raw.jsonl` 10 KB verbatim transcript, `raw.rows.json` 4.5 KB 24 projected bubbles, `meta.json`). Substantive convo (not a stub): 5 user prompts, ~13 assistant turns, real harness-command tool calls, model `composer-2.5`, real bubble timestamps.
- **Manual "anything bad" review** (non-skippable): transcript leak scan **0** (`/Users/`, identity, emails, key shapes); all machine paths rebased to `/home/dev/repo`; content innocuous (boot/checks/doctor + a count-to-10). Bubbles carry only type/createdAt/modelName — no diffs/prose.
- **Byte-scan** auto-globbed the instance: `fixture-privacy-scan.test.ts` **19 passed** — and the boundary-scan correctly did NOT flag the transcript's `stop:\n` (the F001 fix paying off on real data).
- **Commit**: T010 (fixture data).
