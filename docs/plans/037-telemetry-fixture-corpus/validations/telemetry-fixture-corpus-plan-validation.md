# Validation — telemetry-fixture-corpus-plan

**Target**: `docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md`
**Validated**: 2026-06-25 · **Verdict**: ✅ VALIDATED WITH FIXES
**Topology**: lead + deterministic proof + 1 independent critic (adaptive default)

## Proof (deterministic, lead-read)
- `node-db.ts:49` — `new DatabaseSync(dbPath, { readOnly: true })` over `node:sqlite` → AC-04 writable-build-then-read dance is necessary & valid.
- `shared/posix-path.ts` — `toPosix`/`posixNormalize` exist → scrub reuse claim holds.
- `scripts/flow-fixtures.mjs` + `package.json` — `--check` drift contract shells the built bin; the telemetry golden has no CLI verb → drove Finding 1.
- `constitution.md:144` — P12 "Raw/private source material lives only in gitignored `scratch/`" verbatim → capture-via-`scratch/` + Deviation Ledger required (AC-09) confirmed.
- `cursor-adapter.ts` — `nullCaps` only when the *transcript* is absent; on this machine transcripts persist at `~/.cursor/projects/<cwd>/agent-transcripts/<conv>/<conv>.jsonl` (+ `state.vscdb`). **Cursor-gap claim corrected (2026-06-25): `AGENT_TRANSCRIPTS` only gates auto-detect, not capture → cursor is a real Phase-2 surface, not a gap.**
- 4 synthetic fixtures present and unchanged → AC-10 holds.

## Findings (all repaired in-target — evidence-pinned, uniquely determined by the plan's own contract/non-goals)

| # | Sev | Finding | Fix applied |
|---|-----|---------|-------------|
| 1 | MED (critic: HIGH) | AC-07/3.1 "clone `flow-fixtures.mjs`" doesn't transfer — that script shells the built CLI bin, but the telemetry golden is test-only code with no `harness telemetry` verb (and a verb is a Non-Goal). | AC-07 + Task 3.1 reworded: reuse the `--check` *drift contract*; regen **imports built `dist/` adapter + `serializeSegment` directly**, no CLI verb. |
| 2 | HIGH | AC-02 negative-control under-specified; a literal banned-token control would contradict the scan's own absence assertion / pollute the public corpus. | AC-02 + Task 1.6: scanner liveness proven by a known-bad string **in test code** (asserted flagged); **no banned token committed** to the corpus. |
| 3 | MED | Byte-scan covered only raw fixtures; `serializeSegment` reduces out-of-repo paths to a basename that can ride into a committed `expected-segment.json` golden unscanned. | AC-02 + Task 1.6: byte-scan now covers **both** raw fixtures and committed goldens. |
| 4 | MED | The SQLite writable→read-only mechanism (AC-04) is the riskiest novelty and was fully back-loaded to Phase 2; claude-first proves nothing about it. | Added Task 1.8 (Phase 1 mechanism spike) + AC-04 coverage row. |

## Cleared (disprove attempts that held the plan)
- **Capture-tool topology** — defaulted resolution is concrete enough for Phase 1; the workshop is explicitly optional/non-gating. Not a blocker.
- **"no `node:*` in services" vs. capture reading `~/.claude/…`** — no contradiction: all `node:*` I/O is placed at the extension `run()` composition root (AC-06 / Task 1.4); scrub/extract stay pure services.

**Thesis**: advanced — the plan serves its purpose (publication-safe real-log corpus + pinned adapter output); the two-guard privacy model is sound once Finding 2/3 tightened the raw-artifact scan.
**Consumers**: STANDALONE — a plan; no downstream artifact consumes it yet. Phase 1 (claude proof) is self-contained.
