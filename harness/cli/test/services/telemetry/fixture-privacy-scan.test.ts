import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T007 (plan 1.6 · AC-02) — the byte-scan privacy guard.
 *
 * The committed RAW fixture has ONLY the scrub as its guard (Finding 01): the
 * `serializeSegment` allowlist protects the OUTPUT golden, never the raw input
 * bytes. So this scans the committed BYTES of BOTH every `raw.*` fixture AND
 * every `expected-segment.json` golden for machine paths / emails / secret
 * shapes, and asserts none survive.
 *
 * The scan is GENERIC (no real username/name is hardcoded — that would itself
 * commit an identity token); machine-specific identity is scanned via
 * runtime-derived tokens (USER/HOME), which never enter the repo. Scanner
 * LIVENESS is proven by a known-bad string IN TEST CODE (a FAKE `/Users/alice`,
 * never a real token) asserted to be flagged — so the absence assertions can
 * never pass vacuously.
 */

const FIXTURES_ROOT = fileURLToPath(new URL('./fixtures/real', import.meta.url));

interface Banned {
  label: string;
  re: RegExp;
}
const BANNED: Banned[] = [
  { label: 'macos-home', re: /\/Users\// },
  // These artifacts are JSON(L): a real Windows backslash is byte-doubled (`C:\\`),
  // while a `\n`/`\t` escape is a single backslash — so match the DOUBLED form to
  // avoid flagging JSON-escaped YAML keys (`on:\n`, `steps:\n`). Plain-text raw.*
  // (Phase 2 process logs) will need the single-backslash variant.
  { label: 'win-home', re: /[A-Za-z]:\\\\Users\\\\/ },
  { label: 'win-drive', re: /[A-Za-z]:\\\\/ },
  { label: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { label: 'anthropic-key', re: /sk-[A-Za-z0-9-]{20,}/ },
  { label: 'github-pat', re: /gh[posru]_[A-Za-z0-9]{20,}/ },
  { label: 'aws-key', re: /AKIA[0-9A-Z]{16}/ },
  { label: 'bearer', re: /Bearer\s+[\w.-]{16,}/ },
];

/** Identity tokens derived from the runtime env — scanned but NEVER committed. */
function runtimeIdentityTokens(): string[] {
  const home = process.env.HOME ?? '';
  const user = process.env.USER ?? process.env.USERNAME ?? '';
  const homeBase = home.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  return [...new Set([user, homeBase])].filter((t) => t.length >= 3 && t !== 'dev');
}

function scanForLeaks(text: string, extraTokens: string[] = []): string[] {
  const hits: string[] = [];
  for (const { label, re } of BANNED) if (re.test(text)) hits.push(label);
  for (const tok of extraTokens) if (text.includes(tok)) hits.push(`identity:${tok}`);
  return hits;
}

/** Every committed `raw.*` + `expected-segment.json` under fixtures/real/. */
function committedArtifacts(): string[] {
  return readdirSync(FIXTURES_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((p) => /(^|\/)(raw\.[^/]+|expected-segment\.json)$/.test(p.replace(/\\/g, '/')))
    .map((p) => `${FIXTURES_ROOT}/${p}`);
}

describe('fixture privacy byte-scan (AC-02)', () => {
  const artifacts = committedArtifacts();
  const identity = runtimeIdentityTokens();

  it('finds at least the claude raw fixture + its golden to scan', () => {
    expect(artifacts.some((p) => p.endsWith('raw.jsonl'))).toBe(true);
    expect(artifacts.some((p) => p.endsWith('expected-segment.json'))).toBe(true);
  });

  it.each(
    artifacts.map((p) => [p.replace(FIXTURES_ROOT, 'fixtures/real'), p] as const),
  )('no leak in committed bytes of %s', (_label, path) => {
    const bytes = readFileSync(path, 'utf8');
    expect(scanForLeaks(bytes, identity)).toEqual([]);
  });

  it('the scanner is LIVE — a known-bad string (fake) is flagged', () => {
    // FAKE tokens only — never a real path/identity. `C:\\\\` here is the
    // JSON-doubled-backslash form a real Windows path takes in these artifacts.
    const knownBad = `leak at /Users/alice/x C:\\\\Windows\\\\sys key sk-${'a'.repeat(28)} bob@example.com`;
    const hits = scanForLeaks(knownBad, ['alice']);
    expect(hits).toContain('macos-home');
    expect(hits).toContain('win-drive');
    expect(hits).toContain('anthropic-key');
    expect(hits).toContain('email');
    expect(hits).toContain('identity:alice');
  });
});
