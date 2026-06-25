import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET_DETECTORS } from '../../../src/services/telemetry/fixture-scrub.js';

/**
 * T007 (plan 1.6 · AC-02) — the byte-scan privacy guard.
 *
 * The committed RAW fixture has ONLY the scrub as its guard (Finding 01): the
 * `serializeSegment` allowlist protects the OUTPUT golden, never the raw input
 * bytes. So this scans the committed BYTES of BOTH every `raw.*` fixture AND
 * every `expected-segment.json` golden and asserts no machine path / email /
 * secret / identity token survives.
 *
 * Durability contract (companion F003/F004):
 * - GENERIC markers (`/Users/`, `/home/<other>`, emails, secret shapes) are
 *   machine-independent → a DURABLE guard on CI and for any reviewer.
 * - Windows-path detection is artifact-ENCODING aware: JSON(L)/golden bytes
 *   double a real backslash (`C:\\`), plain-text `raw.*.log` keep a single one.
 * - Secret detectors are REUSED from `fixture-scrub` (one source of truth — the
 *   scrub and its guard cannot drift).
 * - IDENTITY tokens (home username / git handle / person name) cannot be hard-
 *   committed (that would leak them). They are scanned best-effort from the
 *   runtime (USER/HOME) AND explicitly via `HARNESS_FIXTURE_SCRUB_TOKENS` (a
 *   comma-separated capture-time denylist a capturer/CI can pass WITHOUT
 *   committing). On a machine that knows neither, identity rests on the scrub +
 *   the non-skippable manual review (documented, honest).
 *
 * Scanner LIVENESS is proven by a FAKE known-bad string in test code asserted to
 * flag EVERY label — the absence assertions can never pass vacuously, and no real
 * token is ever committed.
 */

const FIXTURES_ROOT = fileURLToPath(new URL('./fixtures/real', import.meta.url));

type Kind = 'json' | 'text';
function kindOf(path: string): Kind {
  return /\.jsonl?$|\.json$/.test(path) ? 'json' : 'text';
}

interface Banned {
  label: string;
  re: RegExp;
}

/** Machine-independent markers — durable on any host. */
const GENERIC: Banned[] = [
  { label: 'macos-home', re: /\/Users\// },
  { label: 'linux-home-leak', re: /\/home\/(?!dev\b)[^/\s"'\\]+/ }, // any /home/<other> (dev = placeholder)
  { label: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  ...SECRET_DETECTORS.map((d) => ({ label: d.label, re: d.re })),
];

/** Windows-path markers depend on the artifact's backslash encoding. */
function windowsBanned(kind: Kind): Banned[] {
  return kind === 'json'
    ? [
        { label: 'win-home', re: /[A-Za-z]:\\\\Users\\\\/ }, // JSON-doubled `C:\\Users\\`
        { label: 'win-drive', re: /[A-Za-z]:\\\\/ },
      ]
    : [
        { label: 'win-home', re: /[A-Za-z]:\\Users\\/ }, // plain-text `C:\Users\`
        { label: 'win-drive', re: /[A-Za-z]:\\[A-Za-z0-9_.$~\\/-]/ }, // drive + path char (not a stray `\n`)
      ];
}

function bannedFor(kind: Kind): Banned[] {
  return [...GENERIC, ...windowsBanned(kind)];
}

const ALL_LABELS = [...new Set([...GENERIC.map((b) => b.label), 'win-home', 'win-drive'])];

/** Identity tokens: runtime best-effort + an explicit, never-committed denylist env (F004). */
function identityTokens(): string[] {
  const home = process.env.HOME ?? '';
  const homeBase = home.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  const user = process.env.USER ?? process.env.USERNAME ?? '';
  const denylist = (process.env.HARNESS_FIXTURE_SCRUB_TOKENS ?? '').split(',').map((s) => s.trim());
  return [...new Set([user, homeBase, ...denylist])].filter((t) => t.length >= 3 && t !== 'dev');
}

function scanForLeaks(text: string, banned: Banned[], identity: string[]): string[] {
  const hits: string[] = [];
  for (const { label, re } of banned) if (re.test(text)) hits.push(label);
  for (const tok of identity) if (text.includes(tok)) hits.push(`identity:${tok}`);
  return hits;
}

/** Every committed instance artifact under fixtures/real/ (raw input, golden, invariants, meta). */
function committedArtifacts(): string[] {
  return readdirSync(FIXTURES_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((p) =>
      /(^|\/)(raw\.[^/]+|expected-segment\.json|invariants\.json|meta\.json)$/.test(
        p.replace(/\\/g, '/'),
      ),
    )
    .map((p) => `${FIXTURES_ROOT}/${p}`);
}

describe('fixture privacy byte-scan (AC-02)', () => {
  const artifacts = committedArtifacts();
  const identity = identityTokens();

  it('finds at least the claude raw fixture + its golden to scan', () => {
    expect(artifacts.some((p) => p.endsWith('raw.jsonl'))).toBe(true);
    expect(artifacts.some((p) => p.endsWith('expected-segment.json'))).toBe(true);
  });

  it.each(
    artifacts.map((p) => [p.replace(FIXTURES_ROOT, 'fixtures/real'), p] as const),
  )('no leak in committed bytes of %s', (_label, path) => {
    const bytes = readFileSync(path, 'utf8');
    expect(scanForLeaks(bytes, bannedFor(kindOf(path)), identity)).toEqual([]);
  });

  it('the scanner is LIVE — a fake known-bad string flags EVERY label', () => {
    // FAKE tokens only — never a real path/identity. Covers every banned label so
    // no absence assertion can pass vacuously. `C:\\\\` is the JSON-doubled form.
    const knownBad = [
      'macos /Users/alice/x',
      'linux /home/bob/y',
      'win C:\\\\Users\\\\carol\\\\z',
      'email dave@example.com',
      `anth sk-${'a'.repeat(28)}`,
      `ghpat ghp_${'b'.repeat(30)}`,
      `ghfine github_pat_${'c'.repeat(30)}`,
      'aws AKIAIOSFODNN7EXAMPLE',
      `slack xoxb-${'1'.repeat(14)}`,
      `bearer Bearer ${'d'.repeat(20)}`,
    ].join(' ');
    const hits = new Set(scanForLeaks(knownBad, bannedFor('json'), ['alice']));
    for (const label of ALL_LABELS) expect(hits.has(label)).toBe(true);
    expect(hits.has('identity:alice')).toBe(true);
  });

  it('plain-text Windows paths are caught (the future raw.process.log shape)', () => {
    // A single-backslash C:\Users\... must flag in a TEXT artifact (AC-03 process log).
    const textHits = scanForLeaks('cwd C:\\Users\\erin\\proj', bannedFor('text'), []);
    expect(textHits).toContain('win-home');
    // ...but a JSON-escaped YAML key (letter:colon + \n) must NOT false-positive in JSON.
    const jsonHits = scanForLeaks('"on:\\n  push:"', bannedFor('json'), []);
    expect(jsonHits).toEqual([]);
  });
});
