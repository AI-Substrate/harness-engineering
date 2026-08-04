import { GIT_MAX_BUFFER } from './exec-git-limits.js';

/**
 * Batched flat-tree `cat-file` reader (plan 067) — the shared engine behind the READ
 * adapter's `readShardTree`/`readTreeAtCommit` and the WRITE adapter's `readRefTree`.
 *
 * WHY (measured 2026-08-04): both adapters walked a tree by spawning ONE
 * `git cat-file blob <sha>` PER ENTRY. A `telemetry sync` that flushed nothing still
 * burned 18,217 git subprocesses / ~2m of CPU, because one legacy pre-rollup ref
 * carries 17,566 blobs and every shape probe re-read all of them. Blob reads here are
 * batched instead: the shas are streamed to ONE long-lived `git cat-file --batch`, so
 * a tree of N blobs costs 3 subprocesses (list → size → batch), not N + 1.
 *
 * VERB SET UNCHANGED: only `cat-file` (`-p` / `--batch-check` / `--batch`), so both
 * adapters keep their read-only-by-construction guarantee — nothing here writes an
 * object, moves a ref, fetches a remote, or touches the index/working tree.
 *
 * BYTE-EXACT: `--batch` frames each record as `<oid> SP <type> SP <size> LF <bytes> LF`
 * where `<size>` counts BYTES, so the runner MUST hand back a Buffer (a utf8 string
 * would desynchronise the frame on any multi-byte character). Records come back in
 * REQUEST ORDER, which is how each record is correlated with its tree entry.
 *
 * NEVER SILENTLY PARTIAL: a spawn-level failure (ENOBUFS, timeout), a `missing`
 * object, or a frame that does not match its requested sha returns `failed` — callers
 * choose their own policy (the READ adapter degrades to `[]`, the WRITE adapter throws,
 * exactly as before).
 */

/** One raw git invocation; `stdout` MUST be the raw bytes (no string encoding). */
export type GitBytesRunner = (
  args: string[],
  input?: string,
) => { status: number | null; stdout: Buffer | null; error?: Error };

/** One flat tree entry's name + decoded UTF-8 content. */
export interface FlatTreeBlob {
  name: string;
  content: string;
}

/** `absent` = a clean non-zero exit (no such tree); `failed` = a read that may be partial. */
export type FlatTreeRead =
  | { kind: 'ok'; blobs: FlatTreeBlob[] }
  | { kind: 'absent' }
  | { kind: 'failed'; message: string };

/**
 * Bytes of blob content requested per `--batch` invocation. `spawnSync` buffers the
 * whole stdout in memory and fails with ENOBUFS past {@link GIT_MAX_BUFFER}, so a tree
 * bigger than the cap is split across several batches rather than truncated. Half the
 * cap leaves generous headroom for the per-record framing.
 */
const BATCH_BYTE_BUDGET = GIT_MAX_BUFFER / 2;

interface TreeEntry {
  sha: string;
  name: string;
  size: number;
}

/** `<mode> SP <type> SP <sha> TAB <name>` — the `cat-file -p <tree>` listing line. */
const TREE_LINE = /^(\S+) (\S+) (\S+)\t(.+)$/;

/**
 * Read every BLOB of a flat tree (`<rev>^{tree}`, `<commit>^{tree}`, …) in batches.
 * Subtree entries are skipped — a telemetry shard tree is flat by construction.
 */
export function readFlatTree(run: GitBytesRunner, treeSpec: string): FlatTreeRead {
  const listing = run(['cat-file', '-p', treeSpec]);
  if (listing.error !== undefined) {
    return {
      kind: 'failed',
      message: `tree read failed for ${treeSpec}: ${listing.error.message}`,
    };
  }
  if (listing.status !== 0) return { kind: 'absent' };

  const named: { sha: string; name: string }[] = [];
  for (const line of (listing.stdout?.toString('utf8') ?? '').split('\n')) {
    const m = TREE_LINE.exec(line);
    if (m === null) continue;
    const [, , type, sha, name] = m;
    if (type !== 'blob') continue;
    named.push({ sha, name });
  }
  if (named.length === 0) return { kind: 'ok', blobs: [] };

  const sized = sizeEntries(run, named);
  if (sized.kind !== 'ok') return sized;
  return readBatched(run, sized.entries);
}

/**
 * Size every entry with ONE `cat-file --batch-check` (headers only, no content), so the
 * content batches below can be split under {@link BATCH_BYTE_BUDGET} deterministically
 * instead of discovering an ENOBUFS truncation after the fact.
 */
function sizeEntries(
  run: GitBytesRunner,
  named: readonly { sha: string; name: string }[],
): { kind: 'ok'; entries: TreeEntry[] } | { kind: 'failed'; message: string } {
  const r = run(['cat-file', '--batch-check'], `${named.map((e) => e.sha).join('\n')}\n`);
  if (r.error !== undefined) {
    return { kind: 'failed', message: `batch-check failed: ${r.error.message}` };
  }
  if (r.status !== 0) return { kind: 'failed', message: 'batch-check exited non-zero' };
  // One line per requested sha, in request order: `<oid> SP <type> SP <size>` (or
  // `<request> SP missing`).
  const lines = (r.stdout?.toString('utf8') ?? '').split('\n').filter((l) => l.length > 0);
  if (lines.length !== named.length) {
    return {
      kind: 'failed',
      message: `batch-check returned ${lines.length} record(s) for ${named.length} object(s)`,
    };
  }
  const entries: TreeEntry[] = [];
  for (const [i, line] of lines.entries()) {
    const parts = line.split(' ');
    const entry = named[i];
    if (parts.length !== 3 || parts[0] !== entry.sha || parts[1] !== 'blob') {
      return { kind: 'failed', message: `unreadable object ${entry.sha} (${entry.name})` };
    }
    const size = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(size) || size < 0) {
      return { kind: 'failed', message: `unparseable size for ${entry.sha} (${entry.name})` };
    }
    entries.push({ sha: entry.sha, name: entry.name, size });
  }
  return { kind: 'ok', entries };
}

/** Split into runs whose total content bytes stay under the budget (≥1 entry each). */
function chunkByBytes(entries: readonly TreeEntry[]): TreeEntry[][] {
  const chunks: TreeEntry[][] = [];
  let current: TreeEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (current.length > 0 && bytes + entry.size > BATCH_BYTE_BUDGET) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Read the sized entries' content with one `cat-file --batch` per byte-budgeted chunk. */
function readBatched(run: GitBytesRunner, entries: readonly TreeEntry[]): FlatTreeRead {
  const blobs: FlatTreeBlob[] = [];
  for (const chunk of chunkByBytes(entries)) {
    const r = run(['cat-file', '--batch'], `${chunk.map((e) => e.sha).join('\n')}\n`);
    if (r.error !== undefined) {
      return { kind: 'failed', message: `batch blob read failed: ${r.error.message}` };
    }
    if (r.status !== 0) return { kind: 'failed', message: 'batch blob read exited non-zero' };
    const parsed = parseBatch(r.stdout ?? Buffer.alloc(0), chunk);
    if (parsed.kind !== 'ok') return parsed;
    blobs.push(...parsed.blobs);
  }
  return { kind: 'ok', blobs };
}

/**
 * Decode one `--batch` stream against the entries it was asked for. Each record is
 * `<oid> SP <type> SP <size> LF <size bytes> LF`; the requested sha + byte length are
 * both re-checked, so a desynchronised stream fails loudly instead of yielding
 * mis-attributed content.
 */
function parseBatch(stdout: Buffer, chunk: readonly TreeEntry[]): FlatTreeRead {
  const blobs: FlatTreeBlob[] = [];
  let offset = 0;
  for (const entry of chunk) {
    const lf = stdout.indexOf(0x0a, offset);
    if (lf === -1) {
      return { kind: 'failed', message: `truncated batch record for ${entry.sha}` };
    }
    const header = stdout.toString('utf8', offset, lf).split(' ');
    if (header.length !== 3 || header[0] !== entry.sha || header[1] !== 'blob') {
      return { kind: 'failed', message: `unexpected batch record for ${entry.sha}` };
    }
    const size = Number.parseInt(header[2], 10);
    const start = lf + 1;
    const end = start + size;
    if (size !== entry.size || end > stdout.length) {
      return { kind: 'failed', message: `short batch record for ${entry.sha} (${entry.name})` };
    }
    blobs.push({ name: entry.name, content: stdout.toString('utf8', start, end) });
    offset = end + 1; // skip the record's trailing LF
  }
  return { kind: 'ok', blobs };
}
