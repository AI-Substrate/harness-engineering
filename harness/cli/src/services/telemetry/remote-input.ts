import type { RemoteRepository } from '../../adapters/git/remote-telemetry-git-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';

export interface RepositoryFileInput {
  /** Used only for safe diagnostics; file contents are never echoed. */
  path: string;
  /** Exact file bytes, or null when missing/unreadable. */
  bytes: Uint8Array | null;
}

export interface RawRepositoryInputs {
  repos: readonly string[];
  repoFiles: readonly RepositoryFileInput[];
}

export type RemoteInputError = { ok: false; code: 'E108'; message: string };

export type RemoteRepositoryParseResult =
  | { ok: true; repositories: RemoteRepository[] }
  | RemoteInputError;

export type RemoteSelector =
  | { kind: 'session'; session: string }
  | { kind: 'date'; from: string; to: string }
  | { kind: 'commit'; from: string; to: string };

export interface RawRemoteSelector {
  session?: string;
  fromDate?: string;
  toDate?: string;
  fromCommit?: string;
  toCommit?: string;
}

export type RemoteSelectorParseResult =
  | { ok: true; selector: RemoteSelector | null }
  | RemoteInputError;

const invalid = (message: string): RemoteInputError => ({ ok: false, code: 'E108', message });

const SAFE_SESSION = /^[A-Za-z0-9._-]{1,256}$/;
const FULL_OID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const SCP_LIKE = /^(?:([A-Za-z0-9._-]+)@)?([A-Za-z0-9.-]+):(.+)$/;

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizePath(path: string): string | null {
  let value = path;
  if (value.endsWith('/')) value = value.slice(0, -1);
  if (value.endsWith('.git')) value = value.slice(0, -4);
  if (value.length === 0 || value === '/') return null;
  return value.startsWith('/') ? value : `/${value}`;
}

function canonicalizeUri(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'ssh:' && scheme !== 'git:') return null;
  if (parsed.search.length > 0 || parsed.hash.length > 0 || parsed.password.length > 0) return null;
  if (parsed.hostname.length === 0) return null;
  if (/\s/u.test(raw) || hasControlCharacter(raw)) return null;

  const host = parsed.hostname.toLowerCase();
  const defaultPort =
    (scheme === 'https:' && parsed.port === '443') ||
    (scheme === 'ssh:' && parsed.port === '22') ||
    (scheme === 'git:' && parsed.port === '9418');
  const port = parsed.port.length > 0 && !defaultPort ? `:${parsed.port}` : '';
  const username = parsed.username.length > 0 ? `${parsed.username}@` : '';
  const path = normalizePath(parsed.pathname);
  if (path === null) return null;
  return `${scheme.slice(0, -1)}://${username}${host}${port}${path}`;
}

/** Return a safe canonical network identity, or null for every local/unsafe form. */
export function canonicalizeRemoteRepository(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.includes('\\') || value.includes('?') || value.includes('#')) {
    return null;
  }
  if (/^(?:\.{0,2}\/|\/|[A-Za-z]:[\\/]|file:|ext::)/i.test(value)) return null;

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return canonicalizeUri(value);

  const scp = SCP_LIKE.exec(value);
  if (scp === null) return null;
  const [, user, rawHost, rawPath] = scp;
  if (rawHost.length === 0 || rawPath.length === 0 || rawPath.startsWith('/')) return null;
  if (
    rawPath.includes(':') ||
    rawPath.includes('@') ||
    /\s/u.test(rawPath) ||
    hasControlCharacter(rawPath)
  ) {
    return null;
  }
  const path = normalizePath(rawPath);
  if (path === null) return null;
  return `ssh://${user === undefined ? '' : `${user}@`}${rawHost.toLowerCase()}${path}`;
}

function parseRepositoryFile(input: RepositoryFileInput): string[] | RemoteInputError {
  if (input.bytes === null)
    return invalid(`repository file is missing or unreadable: ${input.path}`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return invalid(`repository file is not valid UTF-8: ${input.path}`);
  }
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** Parse, canonicalize, de-duplicate, collision-check, and byte-sort 1..N repositories. */
export function parseRemoteRepositories(
  raw: RawRepositoryInputs,
  hash: HashPort,
): RemoteRepositoryParseResult {
  const values = [...raw.repos];
  for (const input of raw.repoFiles) {
    const parsed = parseRepositoryFile(input);
    if (!Array.isArray(parsed)) return parsed;
    values.push(...parsed);
  }
  if (values.length === 0) return invalid('at least one --repo or --repo-file is required');

  const identities = new Map<string, RemoteRepository>();
  const keys = new Map<string, string>();
  for (const value of values) {
    const identity = canonicalizeRemoteRepository(value);
    if (identity === null) return invalid('repository must be a safe network Git URL');
    if (identities.has(identity)) continue;
    const digest = hash.sha256Hex(identity).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) return invalid('repository identity hash is invalid');
    const key = `repo-${digest.slice(0, 16)}`;
    const prior = keys.get(key);
    if (prior !== undefined && prior !== identity) {
      return invalid('distinct repository identities produced the same repository key');
    }
    keys.set(key, identity);
    identities.set(identity, { key, identity, transportUrl: identity });
  }
  if (identities.size === 0) return invalid('at least one repository is required');
  const repositories = [...identities.values()].sort((a, b) => compareUnsignedUtf8(a.key, b.key));
  return { ok: true, repositories };
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Validate the zero/one `ls` selector or exactly-one `pull` selector. */
export function parseRemoteSelector(
  mode: 'ls' | 'pull',
  raw: RawRemoteSelector,
): RemoteSelectorParseResult {
  const hasSession = raw.session !== undefined;
  const hasDate = raw.fromDate !== undefined || raw.toDate !== undefined;
  const hasCommit = raw.fromCommit !== undefined || raw.toCommit !== undefined;
  const families = Number(hasSession) + Number(hasDate) + Number(hasCommit);
  if (families > 1 || (mode === 'pull' && families !== 1)) {
    return invalid(
      mode === 'pull'
        ? 'pull requires exactly one selector family'
        : 'selector families cannot be mixed',
    );
  }
  if (families === 0) return { ok: true, selector: null };

  if (hasSession) {
    if (raw.session === undefined || !SAFE_SESSION.test(raw.session)) {
      return invalid('--session must be a safe exact terminal session id');
    }
    return { ok: true, selector: { kind: 'session', session: raw.session } };
  }

  if (hasDate) {
    if (
      raw.fromDate === undefined ||
      raw.toDate === undefined ||
      !validDate(raw.fromDate) ||
      !validDate(raw.toDate) ||
      raw.fromDate > raw.toDate
    ) {
      return invalid('date selectors require a valid ordered --from-date/--to-date pair');
    }
    return { ok: true, selector: { kind: 'date', from: raw.fromDate, to: raw.toDate } };
  }

  if (
    raw.fromCommit === undefined ||
    raw.toCommit === undefined ||
    !FULL_OID.test(raw.fromCommit) ||
    !FULL_OID.test(raw.toCommit) ||
    raw.fromCommit.length !== raw.toCommit.length
  ) {
    return invalid('commit selectors require a same-width full --from-commit/--to-commit pair');
  }
  return {
    ok: true,
    selector: {
      kind: 'commit',
      from: raw.fromCommit.toLowerCase(),
      to: raw.toCommit.toLowerCase(),
    },
  };
}

/** Deterministic unsigned UTF-8 byte ordering (never locale-sensitive). */
export function compareUnsignedUtf8(a: string, b: string): number {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}
