# Phase 1 Execution Log — Safe Capture and Typed Usage

## Authority and evidence

- Plan: `d8a6dcde37ad956466fee3dc8ffec2aa88015dc2ac194f6d406d686f361742bb`
- Tasks: `2bab29b7cecf2bd055ea1ae4624b461894bd196e7f28378fb058b4159d9d12fa`
- Born-closed RED packet: `64d5f71622865c12048f3cf34d4af27d4fcc2cd34a9121e8a420287f8fd07576`
- RED runner: `d34b117f76305f71214550d8fcd557577a6f6748c7090787e5b837b4d849b673`
- Private result: `c96cf69115f285904a801e7e4836570d554eacb3ef7ab9f8a715dd4fdba4ac44`
- Opaque verdict: `RED_EXPECTED`; source count: 15
- Standard-source prefixes: exact
- Locator evidence: `NOT_APPLICABLE_REAL_CORPUS`; AC-01 is proven with sanitized structural fixtures, never excluded private data.

No corpus bytes, private paths, session identifiers, token totals, prompts, tool payloads, or private result body are retained here.

## TDD transitions

| Transition | Evidence |
|---|---|
| Locator tests RED | 6 files collected; 30 expected missing-implementation failures |
| Locator implementation GREEN | 6 files / 149 tests; architecture 2 files / 2 tests |
| Typed usage tests RED | 7 files collected; 32 expected failures plus missing implementation import |
| Typed usage implementation GREEN | 7 files / 149 tests |

## Repository proof

- Build: green.
- Focused Phase 1 review suite: 20 files / 597 tests green.
- Review-fix suites: 8/196, 7/141, 2/25, 1/10, 2/28, and 1/18 tests green after successive review passes.
- Definitive composite execution passed all 222 non-PTY files; the seven-test PTY baseline retained six accepted failures.
- Remaining PTY baseline: six failures reproduce on unchanged root and the P063 branch; `pty-input.test.ts` is not changed by P063.
- Composite envelope: typecheck, docs, flows, telemetry fixtures, doctrine parity, skills and Windows checks green; architecture and Markdown remain pre-existing degraded warnings. The test gate is limited by the same six PTY baseline failures.
- Biome and TypeScript checks: green.

### 2026-07-23 review-fix command receipts

| Purpose | Exact command | Exit | Observed receipt |
|---|---|---:|---|
| Review-fix RED | `npm test -- test/adapters/fs/fake-fs.test.ts test/adapters/fs/node-fs.test.ts test/services/telemetry/copilot-events.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/report.test.ts test/services/telemetry/otlp/reconstruction.test.ts` | 1 | 8 files collected; 14 expected failures across confinement, final-only scalar projection, session/ref/fleet/report precedence, and OTLP closure (`artifact://490`). |
| Review-fix GREEN | same command | 0 | 8 files / 196 tests passed. |
| Second review-fix RED | `npm test -- test/adapters/fs/node-fs.test.ts test/services/telemetry/copilot-ledger.test.ts test/services/telemetry/events-rollup.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/report.test.ts` | 1 | 7 files collected; 12 expected failures across ancestor symlinks, unsupported no-follow, FIFO/race safety, defensive JSON, chronological/message reduction, partial evidence, strict refs, and mixed wire identity (`artifact://530`). |
| Second review-fix GREEN | same command | 0 | 7 files / 141 tests passed. |
| Final medium-fix RED | `npm test -- test/services/telemetry/copilot-ledger.test.ts test/services/telemetry/ref-source.test.ts` | 1 | 2 files collected; three expected failures for malformed timestamps and loose-ref validation (`artifact://567`). |
| Final medium-fix GREEN | same command | 0 | 2 files / 25 tests passed. |
| Loose serializer RED→GREEN | `npm test -- test/services/telemetry/ref-source.test.ts` | 1 → 0 | Throwing malformed usage failed before the guard (`artifact://578`), malformed time then failed (`artifact://587`), and the final strict loose-ref suite passed 1 file / 10 tests. |
| Shared loose-decoder RED→GREEN | `npm test -- test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts` | 1 → 0 | Malformed/predecessor loose sessions failed before the shared decoder (`artifact://601`); strict session/ref decoder passed 2 files / 28 tests. |
| Version/token closure RED→GREEN | `npm test -- test/services/telemetry/session-export.test.ts` | 1 → 0 | Private 2.0 harness version failed before closure (`artifact://638`); strict supported-version/token/identity suite passed 1 file / 18 tests. |
| Full Phase 1 focused | `npm test -- test/adapters/git/fake-git.test.ts test/adapters/git/exec-git.test.ts test/adapters/fs/fake-fs.test.ts test/adapters/fs/node-fs.test.ts test/services/telemetry/claude-adapter.test.ts test/services/telemetry/capture-service.test.ts test/services/telemetry/copilot-adapter.test.ts test/services/telemetry/copilot-events.test.ts test/services/telemetry/copilot-ledger.test.ts test/services/telemetry/segment-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts test/services/telemetry/events-rollup.test.ts test/services/telemetry/publication-boundary.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/report.test.ts test/services/telemetry/published-telemetry.test.ts test/services/telemetry/remote-telemetry-service.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts` | 0 | 20 files / 597 tests passed. |
| TypeScript build | `npm run build` | 0 | docs/flows regenerated and `tsc -p harness/cli/tsconfig.json` passed (`artifact://644`). |
| Biome fix/check | `npm run fix` | 0 | 411 files checked; one final formatting change applied (`artifact://641`). |
| Exact non-PTY rerun | `cd harness/cli && npx vitest run --coverage --exclude test/sensors/tui/pty-input.test.ts` | 1 | 221 files passed; one unrelated Git integration test hit its 5s timeout (`artifact://597`). Immediate exact-file rerun passed 1 file / 91 tests. The definitive composite below passed that file and all 222 non-PTY files. |
| Composite gate | `HARNESS_NO_TELEMETRY=1 HARNESS_NO_TELEMETRY_AUTOSYNC=1 just checks` | 1 | Tests: all 222 non-PTY files plus one PTY test passed; only six accepted `pty-input.test.ts` cases failed (3,099 passed / 6 failed). Biome, typecheck, docs, flows, telemetry fixtures, doctrine parity, skills, and Windows gates passed; the two architecture and 199 Markdown findings remain non-blocking degraded baselines (`artifact://646`). |

The full-suite delta is confined to the accepted real-PTY proof ceiling: P063 does not modify `test/sensors/tui/pty-input.test.ts`. The non-PTY suite and every changed Phase 1 seam are green.

## Review

Initial independent Terra review: `REQUEST_CHANGES`, report `607c701b2a300953e0c3e8483c7cea0f7304e15dafc4ad0bf53dbdd6fc0085ec`.

Required fixes:

1. close typed usage at the JSON Schema boundary;
2. validate every OTLP log record before logs-only reconstruction/session export;
3. expose this tracked-safe opaque RED receipt.

Fix evidence:

- Segment JSON Schema conditionally requires a recognized usage observation kind plus at least one bucket and rejects usage-only fields on other event kinds.
- Logs-rooted reconstruction validates every OTLP record before decoding; malformed usage records return a closed failure and logs-only session export skips the shard.
- Negative schema/reconstruction/session-export tests are included in the 231-test review-fix suite.
- This tracked-safe receipt exposes only approved hashes, verdict, source count, and proof summaries.

Re-review verdict: `APPROVE`, report `e1c23c2e4032203cbf49929aee2456d990fd1b045b32dc8323f14f6c77ab4f3f`; independent re-review proof: 6 files / 259 tests, TypeScript and Biome green.

Second automated five-axis review: `REQUEST_CHANGES`; report `reviews/review.phase-1-safe-capture-and-typed-usage.md`.

Review-fix outcomes:

1. filesystem reads now receive an explicit confinement root, reject ancestor/final symlinks, bind pre-open resolution to the opened handle, use nonblocking classification, and fail closed when `O_NOFOLLOW` is unavailable;
2. scalar segment tokens project final shutdown only; session, ref, report, and fleet readers reduce typed observations once across the whole session before falling back to legacy turn/segment tokens;
3. bucketless usage and typed usage under Segment 2.4/2.5 wire identities fail closed;
4. usage kind/bucket vocabulary lives in the exported event contract while reducer implementation remains internal;
5. the plan Domain Manifest names every touched production boundary; and
6. this section records exact privacy-safe commands, exits, counts, and available output pointers.

Final automated review verdict: `APPROVE`; report `reviews/review.phase-1-safe-capture-and-typed-usage.final.md`.

The final review additionally verified chronological observation selection, no payload-equality message dedupe, partial typed evidence blocking legacy fallback, strict OTLP/ref/session reconstruction, canonical timestamps, supported 1.1/2.0–2.6 loose identities, closed captured environment/model/token/event fields, exact token equations, and private-value rejection. Implementation, domain, anti-reinvention, evidence, and final doctrine adjudication all returned clean.

## Discoveries

- Historical transcripts are appendable sources; frozen-prefix identities avoid false drift while preserving exact historical bytes.
- The private replay must use a pinned local TypeScript runtime and privacy-safe typed stage diagnostics.
- Worktree dependency readiness needs a deterministic local bootstrap; `npm install` restored the governed cold-start substrate before proof.
- Current-wire changes require explicit compatibility projection across published readers, fixtures, and OTLP goldens.
- Tool-created `.serena/` scaffolds escaped worker edit scopes and were removed before each gate.

Phase 3 real GREEN replay remains unrun and separately gated.
