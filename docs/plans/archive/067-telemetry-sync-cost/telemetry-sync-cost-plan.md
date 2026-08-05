# Plan 067 — telemetry sync cost repair (the 18k-spawn corpus walk)

## Problem, with evidence (measured 2026-08-04)

`harness telemetry sync` costs ~2–2.5 minutes **even when there is nothing to
flush** (`synced: 0`), and it runs in the foreground of every `git commit`
(post-commit hook) and every `harness checks` (housekeeping autosync). Every
agent on a busy box learns to switch telemetry off — the defect corrodes the
sensor it serves.

Profile of one empty sync (cpu-prof + `GIT_TRACE`):

- 2m07s wall, 51s user + 55s sys; **130.8s of 133s sampled CPU inside `spawnSync`**.
- **18,217 git subprocesses**: 1 `for-each-ref`, 98 `cat-file -p` (tree reads),
  **18,118 `cat-file blob` — one synchronous spawn per blob**, 18,115 of them
  unique blob shas.
- Call chain (corrected during implementation — the original attribution to
  `ref-source.ts:195/:238` was wrong; those serve session/fleet evidence, not
  sync): sync → `sync-service.ts` `maybeMigrate` → `isRolledShape` →
  `readShardTree` → `adapters/git/exec-git-read.ts` `readTreeAt` →
  spawn-per-blob. Verified independently by the reviewer.
- **The dominator is one legacy pre-rollup ref**:
  `refs/harness-telemetry/2026/06/23/15eaa924-56f3-4427-9c7e-e4313cdb3e2a`
  carries **17,566 files** in its tree (pre-plan-049 sharded layout, never
  migrated). Every properly rolled-up ref has exactly 3 files. So ~97 % of the
  cost is re-reading one stale June session, every sync, forever.

## Fix design (code only — the data migration of the legacy ref is a separate,
prime-gated decision and OUT OF SCOPE here)

1. **Skip the corpus walk when there is nothing to do.** With zero buffered
   segments and no plan-links work, `sync` must not enumerate or read committed
   refs at all. Empty sync target: **< 2 s**.
2. **Batch the blob reads that remain.** Replace spawn-per-blob in the read path
   (`exec-git-read.ts`) with `git cat-file --batch` (one long-lived subprocess,
   shas streamed on stdin) or at minimum one batch invocation per tree. The port
   surface (`GitReadPort`) may grow a batch method; keep the fake in
   `fake-git-read.ts` faithful.
3. **Bound the walk to what sync actually needs.** Sync's legitimate read needs
   are per-session (the sessions present in the buffer): their existing ref's
   manifest/rollup for merge. Reading *other* sessions' refs — and especially
   *every blob* of a 17k-file legacy tree — serves nothing in the flush path.
   If the plans sweep needs corpus data, it must read manifests only (tiny),
   never full shard trees.

4. **Hook honours the narrow opt-out** (o-prime scope addition, Seq 556): the
   post-commit hook currently exits early only on `HARNESS_NO_TELEMETRY=1`
   (line 22) while `HARNESS_NO_TELEMETRY_AUTOSYNC=1` gates only the `checks`
   housekeeping path (`housekeeping.ts:39`). Make `.githooks/post-commit`
   honour BOTH, restoring the opt-out semantics users already believe they
   have.

> **O-prime ruling (2026-08-04, spine Seq 556)**: the legacy 17,566-file ref is
> NOT to be deleted, rewritten, or migrated — it is published shared corpus and
> real measurement data, and the batch fix subsumes the win. Reopens only if
> batched reads land and sync is still slow, and then only as a migration with
> a preserved-data proof.

## Acceptance criteria

- AC-1: empty-buffer `telemetry sync` spawns **no** per-blob git reads for refs
  outside the buffered session set (regression-guarded via the fake git-read
  history — assert on `readShardTree`/blob-read call counts).
- AC-2: sync with one buffered segment reads only that session's ref data;
  total git subprocess count for the whole sync is O(sessions in buffer), not
  O(corpus). Guarded by a test using the fake's recorded history.
- AC-3: a ref with a huge legacy shard tree in the corpus does NOT affect the
  cost of syncing an unrelated session (test: fake corpus with a 1000-blob
  legacy ref + unrelated buffered session → zero reads of the legacy ref).
- AC-4: behaviour parity — rollup contents, manifest fields, plan links, and
  push semantics byte-identical for the normal path (existing 1341-test
  telemetry suite + fixture drift guard stay green).
- AC-5: `harness checks` green (arch rules included — new port methods respect
  the ports-only boundary; no `node:*` in services).

## Verification

Wall-clock before/after on this box is the human check (orchestrator runs it);
the committed proof is the call-count regression tests (AC-1..3), which pin the
O(corpus)→O(buffer) contract independent of machine load.
