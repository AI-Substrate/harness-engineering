import { toPosix } from '../shared/posix-path.js';

/**
 * Pure scrub service for the real-capture fixture corpus (plan 037).
 *
 * The committed RAW fixture has ONLY this scrub as its guard (Finding 01): the
 * `serializeSegment` allowlist protects the OUTPUT golden, never the raw input
 * bytes. So this strips machine paths / identity / secrets across POSIX +
 * Windows shapes and the claude project-dir mangle, while keeping prompts and
 * tool commands VERBATIM — the whole point of the corpus.
 *
 * Pure by construction (Finding 03 / P2): no `node:*`, no `process` probing.
 * Path math reuses `shared/posix-path` (`toPosix`); config is passed explicitly
 * (P3) — the capture extension's `run()` composition root supplies real values.
 */

/** Neutral placeholder for the user's home dir. Contains no `/Users/`, no username. */
export const HOME_PLACEHOLDER = '/home/dev';
/** Neutral placeholder for the repo root (a child of {@link HOME_PLACEHOLDER}). */
export const REPO_PLACEHOLDER = '/home/dev/repo';
/** Neutral placeholder for a bare username token. */
export const USER_PLACEHOLDER = 'dev';

const SECRET = '<REDACTED_SECRET>';
const EMAIL = '<email>';
const NAME = '<name>';

export interface ScrubConfig {
  /** Absolute home dir, e.g. `/Users/jane` or `C:\\Users\\jane`. */
  homeDir: string;
  /** Absolute repo root (a descendant of homeDir). Rebased onto {@link REPO_PLACEHOLDER}. */
  repoRoot: string;
  /** Bare login/username token (e.g. `jane`) scrubbed wherever it appears. */
  username: string;
  /** Configured person names to redact (e.g. `['Jane Doe']`). */
  names?: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The claude `projects/` dir mangle: every non-alphanumeric char → `-` (`/Users/x/p.d` → `-Users-x-p-d`). */
function claudeMangle(absPath: string): string {
  return toPosix(absPath).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * The cursor `projects/` dir mangle: the same char-for-char mangle as
 * {@link claudeMangle} but WITHOUT the leading separator, so `/Users/x/p.d`
 * becomes `Users-x-p-d` (observed live: `~/.cursor/projects/Users-<user>-<path>`).
 * Without this variant the bare-username sweep still catches the identity, but the
 * real directory structure rides into a committed fixture verbatim (plan 068 item 5).
 */
function cursorMangle(absPath: string): string {
  return claudeMangle(absPath).replace(/^-+/, '');
}

/** All textual shapes a configured absolute path takes in a transcript. */
function pathVariants(absPath: string): string[] {
  const native = absPath;
  const posix = toPosix(absPath);
  const mangle = claudeMangle(absPath);
  const cursor = cursorMangle(absPath);
  // Longest first: the cursor mangle is a SUFFIX of the claude mangle, so replacing
  // the claude form first leaves no partial `-Users-…` stub behind.
  return [...new Set([native, posix, mangle, cursor])].filter(Boolean);
}

function replaceAll(text: string, needle: string, replacement: string): string {
  return text.replace(new RegExp(escapeRegExp(needle), 'g'), replacement);
}

export interface SecretDetector {
  label: string;
  re: RegExp;
}

/**
 * Secret-shaped token detectors (source regexes, non-global) — targeted (prefix
 * + Bearer), never a blunt high-entropy sweep that would eat verbatim content.
 * EXPORTED so the fixture privacy byte-scan reuses the SAME list: the scrub and
 * its committed-fixture guard can never drift apart (companion F003).
 */
export const SECRET_DETECTORS: readonly SecretDetector[] = [
  { label: 'anthropic-key', re: /sk-[A-Za-z0-9-]{20,}/ }, // anthropic / openai
  { label: 'github-pat', re: /gh[posru]_[A-Za-z0-9]{20,}/ }, // github PAT family
  { label: 'github-fine-pat', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: 'aws-key', re: /AKIA[0-9A-Z]{16}/ }, // aws access key id
  { label: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ }, // slack
  { label: 'bearer', re: /Bearer\s+[\w.-]{16,}/ }, // bearer header token
];

const SECRET_PATTERNS: RegExp[] = SECRET_DETECTORS.map((d) => new RegExp(d.re.source, 'g'));

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Defense-in-depth catch-alls for ANY home-shaped path (not just the configured one),
// so an unexpected path in a real transcript can never ride into the committed bytes.
const GENERIC_HOME: Array<[RegExp, string]> = [
  [/\/Users\/[^/\s"'\\]+/g, HOME_PLACEHOLDER], // macOS
  [/\/home\/[^/\s"'\\]+/g, HOME_PLACEHOLDER], // linux
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, HOME_PLACEHOLDER], // windows native
  [/[A-Za-z]:\/Users\/[^/\s"'\\]+/g, HOME_PLACEHOLDER], // windows posix-ized
];

/**
 * Scrub a block of transcript text. Order matters: most-specific path (repoRoot)
 * before homeDir before the generic home catch-all; secrets/emails/names before
 * the bare-username sweep.
 */
export function scrubText(text: string, cfg: ScrubConfig): string {
  let out = text;

  // 1. Repo root (most specific) → REPO_PLACEHOLDER, in every textual shape.
  for (const v of pathVariants(cfg.repoRoot)) out = replaceAll(out, v, REPO_PLACEHOLDER);
  // 2. Home dir → HOME_PLACEHOLDER, in every textual shape.
  for (const v of pathVariants(cfg.homeDir)) out = replaceAll(out, v, HOME_PLACEHOLDER);
  // 3. Generic home-shaped paths (any user) → HOME_PLACEHOLDER.
  for (const [re, rep] of GENERIC_HOME) out = out.replace(re, rep);

  // 4. Secrets.
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => (m.startsWith('Bearer') ? `Bearer ${SECRET}` : SECRET));
  }
  // 5. Emails.
  out = out.replace(EMAIL_RE, EMAIL);
  // 6. Configured person names.
  for (const name of cfg.names ?? []) out = replaceAll(out, name, NAME);
  // 7. Bare username token (last — paths/emails already handled).
  if (cfg.username) out = replaceAll(out, cfg.username, USER_PLACEHOLDER);

  return out;
}
