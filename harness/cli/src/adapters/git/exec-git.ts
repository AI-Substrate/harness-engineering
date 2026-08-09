import { spawnSync } from 'node:child_process';
import { GIT_MAX_BUFFER } from './exec-git-limits.js';
import type { GitPort, ReflogEntry, ReflogRead } from './git-port.js';

/** Real git access — wraps `git rev-parse` (read-only, informational). */
function isAbsoluteWorktreePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** Parse Git's NUL-delimited worktree porcelain without truncation or fallback. */
export function parseWorktreePorcelain(
  raw: string,
  maxCandidates: number,
): ReturnType<GitPort['knownWorktreeRoots']> {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    return { status: 'unavailable', reason: 'too-many' };
  }
  if (raw.length === 0 || !raw.endsWith('\0\0')) {
    return { status: 'unavailable', reason: 'malformed' };
  }

  const records = raw.slice(0, -2).split('\0\0');
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const fields = record.split('\0');
    const worktree = fields[0];
    const head = fields.find((field) => field.startsWith('HEAD '));
    if (
      worktree === undefined ||
      !worktree.startsWith('worktree ') ||
      head === undefined ||
      !/^(?:HEAD )[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$/.test(head)
    ) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    const root = worktree.slice('worktree '.length);
    if (root.length === 0 || !isAbsoluteWorktreePath(root)) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
    if (roots.length > maxCandidates) {
      return { status: 'unavailable', reason: 'too-many' };
    }
  }
  return { status: 'ok', roots };
}

/**
 * The field separator inside one reflog record, and the record separator between
 * them. NUL between fields because a reflog subject may contain anything
 * printable including spaces and colons; NEWLINE between records because a
 * reflog message CANNOT contain one — git's own on-disk reflog is line-based, so
 * `%gs` is newline-free by construction and the framing is unambiguous.
 */
const REFLOG_FORMAT = '%H%x00%gD%x00%gs';

/** A full lowercase git OID, sha1 or sha256 — the same shape `currentCommit` accepts. */
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Parse `git reflog show --format=%H%x00%gD%x00%gs` output (plan 082 tk-0002).
 *
 * Pure and exported so the framing is provable without a repository — the same
 * shape as {@link parseWorktreePorcelain}. Fails closed: one malformed record
 * invalidates the whole read rather than yielding a partial list, because the
 * guard reasons about "the newest entry" and a silently dropped record would
 * shift which entry that is.
 */
export function parseReflogPorcelain(raw: string, limit: number): ReflogRead {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return { status: 'unavailable', reason: 'bad-limit' };
  }
  const body = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  // An existing ref with no reflog is a real, successful, EMPTY answer (git exits 0).
  if (body.length === 0) return { status: 'ok', entries: [] };

  const entries: ReflogEntry[] = [];
  for (const line of body.split('\n')) {
    const fields = line.split('\0');
    if (fields.length !== 3) return { status: 'unavailable', reason: 'malformed' };
    const [sha, selector, subject] = fields;
    if (!OID.test(sha.toLowerCase()) || selector.length === 0) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    // Subject may legitimately be empty (`update-ref` without `-m`) — not malformed.
    entries.push({ sha: sha.toLowerCase(), selector, subject });
  }
  // More records than asked for means the `-n` bound did not hold; the caller's
  // "newest N" contract is broken, so refuse rather than silently over-report.
  if (entries.length > limit) return { status: 'unavailable', reason: 'malformed' };
  return { status: 'ok', entries };
}

export class ExecGit implements GitPort {
  /**
   * `timeoutMs` bounds the reflog read only — every other method here predates it
   * and is left byte-for-byte alone. It exists because the commit guard runs from
   * an agent hook on EVERY tool call, where a hung git would stall the agent
   * itself; the guard's caller treats a timeout as `unreadable` and stays silent.
   */
  constructor(
    private readonly cwd?: string,
    private readonly timeoutMs = 5_000,
  ) {}

  isRepo(): boolean {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    return result.status === 0 && result.stdout.trim() === 'true';
  }

  currentBranch(): string | null {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }
    const branch = result.stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  }

  currentCommit(): string | null {
    const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const oid = result.stdout.trim().toLowerCase();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) ? oid : null;
  }

  remoteUrl(): string | null {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }
    const url = result.stdout.trim();
    return url.length > 0 ? url : null;
  }

  knownWorktreeRoots(maxCandidates: number): ReturnType<GitPort['knownWorktreeRoots']> {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return { status: 'unavailable', reason: 'not-a-repository' };
    }
    return parseWorktreePorcelain(result.stdout, maxCandidates);
  }

  readReflog(ref: string, limit: number): ReflogRead {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { status: 'unavailable', reason: 'bad-limit' };
    }
    const result = spawnSync(
      'git',
      // `--` terminates options so a ref can never be read as a flag; the ref is
      // DATA, and there is no shell anywhere on this path.
      ['reflog', 'show', '-n', String(limit), `--format=${REFLOG_FORMAT}`, ref, '--'],
      {
        cwd: this.cwd,
        encoding: 'utf8',
        timeout: this.timeoutMs,
        maxBuffer: GIT_MAX_BUFFER,
      },
    );
    // Non-zero covers not-a-repo, unknown/unborn ref and git-absent; a timeout
    // arrives as status null with `error` set. All are `unreadable` — reported,
    // never guessed apart.
    if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') {
      return { status: 'unavailable', reason: 'unreadable' };
    }
    return parseReflogPorcelain(result.stdout, limit);
  }
}
