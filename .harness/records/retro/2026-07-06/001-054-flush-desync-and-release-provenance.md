---
schema_version: "1.1"
retro_id: "2026-07-06T08-10-00Z-claude-opus-054flushdesync"
agent: "claude-opus"
plan_id: "054-telemetry-flush-desync"
started_at: "2026-07-06T02:30:00Z"
ended_at: "2026-07-06T08:10:00Z"
summary: "Two silent-failure bugs found and fixed in one session. (1) #53 telemetry flush-desync: after a buffer-dir wipe, nextSeq reset below the durable .flushed watermark so `harness telemetry sync` silently no-op'd ('Nothing buffered') — diagnosed live on this very session, fixed by seeding nextSeq from max(watermark, maxFile)+1 (readFlushed moved to the shared cursor.ts leaf), built + reviewed by a copilot gpt-5.5 flow-pair fleet (0 fix rounds), Dim-0 mutation-proven twice, live-verified (298->19432 heal), shipped green on PR #58. (2) Release npm-publish silently broken for 3 versions (0.7.0/0.8.0/0.9.0 — registry stuck at 0.6.0): --provenance rejects private repos (E422); surfaced only because we went to pull the PR up. Fixed via NPM_CONFIG_PROVENANCE=false (PR #56), cut 0.9.1, verified live on npm. Both share a theme: a green surface signal (sync 'ok', a git tag) was not proof of the real effect (bytes on a ref, a package on npm)."
entries:
  - id: WIN-001
    kind: win
    description: "Copilot gpt-5.5 flow-pair fleet (same-model coder + reviewer) delivered the #53 fix end-to-end in one delegation, 0 fix rounds: readFlushed->cursor.ts, nextSeq=max(readFlushed(.flushed),maxFile)+1, non-vacuous regression. Reviewer's Dim-0 mutation matched the orchestrator's to the exact line (capture-service.test.ts:388). Fleet cost ~533 AIC (~$5.33: coder $3.50 / reviewer $1.83). Shipped PR #58, CI green."
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-06T06:15:00Z"
  - id: INS-001
    kind: insight
    description: "Telemetry flush-desync root cause: pending-detection keys off nextSeq (max-existing-FILE+1, resets to 1 on ANY buffer-dir wipe) vs a DURABLE cumulative watermark (.flushed = ref manifest max_seq). They decouple the moment .harness/temp/telemetry/<id>/ is cleared out-of-band while the watermark survives -> new segments fall below it -> sync silently no-ops. FIX SHIPPED (#53/#58): seed nextSeq from max(durableWatermark, maxFile)+1. Fleet-safe as-is (fresh peers get new session ids); at-risk only = a long-lived session id whose temp buffer is wiped mid-life."
    target: tooling
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-06T02:55:37Z"
  - id: DL-001
    kind: difficulty
    description: "This session's own telemetry was the live repro: .flushed stuck at 19431 while the reset buffer held seq 1..298 (07-02..07-06) below it, all unflushed since 07-03. The code fix heals FUTURE captures (verified: next capture jumped 298->19432, sync now engages the flush) but does NOT recover the already-stranded 1..298 segments — a naive watermark-reset would clobber the flat ref's historical 1.json..19431.json (F-03)."
    target: tooling
    severity: degrading
    workaround: "One-off recovery = renumber the stranded buffer seqs above 19431 before sync (explicitly out-of-scope of the #53 code fix, per plan Non-Goals)."
    suggested_encoding: "A `harness telemetry recover` verb (or a migration) that rebases a reset buffer's seqs above the durable watermark, for the already-stranded case the forward fix doesn't cover."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-06T02:36:54Z"
  - id: DL-002
    kind: difficulty
    description: "Release npm-publish silently broken for 3 versions (0.7.0/0.8.0/0.9.0 never reached npm; registry stuck at 0.6.0): release.yml ran `npm publish --access public --provenance`, but sigstore provenance rejects PRIVATE repos (E422). release-please still cut the git tag + GitHub release, so it LOOKED released while npm got nothing. FIXED: NPM_CONFIG_PROVENANCE=false on both publish steps (PR #56), cut 0.9.1, verified live on npm (latest 0.6.0->0.9.1)."
    target: infra
    severity: blocking
    workaround: "Disable provenance (NPM_CONFIG_PROVENANCE=false) — trusted publishing auto-enables it, so dropping the --provenance flag alone is insufficient. Re-enable only if the repo goes public."
    suggested_encoding: "SHIPPED in release.yml (PR #56). Standing lesson: verify the npm registry after a release — a green tag/GitHub release is not proof of a published package."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-06T03:22:38Z"
  - id: INS-002
    kind: insight
    description: "Process lesson (user-driven): the principal pushed 'did you see the telemetry though, not the code... the actual physical manifestation' — unit tests (FakeFs) proved the fix in the abstract, but the real proof was the LIVE buffer healing (298->19432) and sync engaging on the actual session. When a fix targets a stateful system, verify the physical artifact changed, not just that the code+tests are green. Same theme as DL-002 (green tag != published package)."
    target: process
    system:
      compound:
        status: open
        source: user
        first_seen_at: "2026-07-06T07:30:00Z"
---

# Retro — 054 flush-desync + release-provenance (2026-07-06)

Two **silent-failure** bugs, same shape: a green surface signal masked a broken real effect.

- **#53 telemetry flush-desync** — `sync` reported `ok`/`Nothing buffered` while bytes never reached a ref. Fixed (PR #58, CI green), built by a copilot gpt-5.5 flow-pair fleet (0 fix rounds), Dim-0 mutation-proven, and **live-verified on this session** (the seq healed 298→19432 and sync began engaging the flush).
- **Release npm-publish** — a git tag + GitHub release were cut for 0.7.0/0.8.0/0.9.0 while npm stayed at 0.6.0 (`--provenance` on a private repo, E422). Fixed (PR #56), 0.9.1 now live on npm.

The recurring lesson (`INS-002`, from the principal): **verify the physical artifact, not just green code/tests** — the live buffer heal and the npm registry check were the real proofs, not the unit suite or the tag.

**Open follow-on**: `DL-001` — the one-off recovery of this session's already-stranded 1..298 segments (the forward fix only heals future captures).
