/**
 * Shared `spawnSync` stdout cap for every REAL git adapter (READ + WRITE) — one
 * source of truth (plan 049 round-2 F1).
 *
 * A telemetry shard blob (`session.logs.jsonl`) routinely exceeds Node's default
 * 1 MiB `maxBuffer`, at which `spawnSync` returns an ENOBUFS `error` with a
 * SILENTLY TRUNCATED stdout. If the WRITE adapter's `readRefTree` (the T007 union
 * base) read fewer bytes than the READ adapter that committed them, a rolled
 * rewrite would force-push a partial tree — the F-03 data-loss class, now via the
 * ops layer. Both adapters lift the cap to the same generous ceiling so a large
 * blob round-trips byte-verbatim; anything past this ceiling still surfaces the
 * ENOBUFS `error` (never a silent truncation) and the caller fails closed.
 */
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
