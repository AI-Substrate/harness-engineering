import { describe, expect, it } from 'vitest';
import {
  buildMeta,
  type CaptureConfig,
  claudeMangle,
  claudeProjectDir,
  defaultInstanceId,
  deriveCaptureConfig,
  instanceDir,
  isSurface,
  rawFilename,
  scratchRoot,
  sessionFiles,
} from './capture-logic.js';

/** T004 (plan 1.4 · AC-06) — pure orchestration helpers for the capture extension. */

describe('capture-logic — surfaces', () => {
  it('recognises the four surfaces and rejects others', () => {
    expect(isSurface('claude')).toBe(true);
    expect(isSurface('cursor')).toBe(true);
    expect(isSurface('nope')).toBe(false);
    expect(isSurface(undefined)).toBe(false);
  });

  it('maps each surface to its raw.* filename', () => {
    expect(rawFilename('claude')).toBe('raw.jsonl');
    expect(rawFilename('cursor')).toBe('raw.jsonl');
    expect(rawFilename('copilot-cli')).toBe('raw.events.jsonl');
    expect(rawFilename('copilot-vscode')).toBe('raw.rows.json');
  });
});

describe('capture-logic — paths', () => {
  it('mangles a repo root the way claude does (every non-alnum → -)', () => {
    expect(claudeMangle('/Users/x/substrate/harness-engineering')).toBe(
      '-Users-x-substrate-harness-engineering',
    );
  });

  it('builds the claude project dir', () => {
    expect(claudeProjectDir('/home/u', '/repo')).toBe('/home/u/.claude/projects/-repo');
  });

  it('stages to a gitignored scratch root, promotes to the corpus dir', () => {
    expect(scratchRoot('/r')).toBe('/r/scratch/telemetry-fixtures');
    expect(instanceDir('/r', 'claude', '2026-06-25-abc')).toBe(
      '/r/harness/cli/test/services/telemetry/fixtures/real/claude/2026-06-25-abc',
    );
  });
});

describe('capture-logic — config derivation', () => {
  it('derives username from the home basename and trims trailing slashes', () => {
    const cfg = deriveCaptureConfig({ home: '/Users/jane/', cwd: '/Users/jane/repo/' });
    expect(cfg).toEqual<CaptureConfig>({
      homeDir: '/Users/jane',
      repoRoot: '/Users/jane/repo',
      username: 'jane',
      names: [],
    });
  });

  it('honours an explicit username + names', () => {
    const cfg = deriveCaptureConfig({
      home: '/Users/jane',
      cwd: '/Users/jane/repo',
      user: 'jdoe',
      names: ['Jane Doe'],
    });
    expect(cfg?.username).toBe('jdoe');
    expect(cfg?.names).toEqual(['Jane Doe']);
  });

  it('returns null when home is unknown (cannot safely scrub)', () => {
    expect(deriveCaptureConfig({ home: undefined, cwd: '/repo' })).toBeNull();
  });
});

describe('capture-logic — instance + meta', () => {
  it('derives a date-stamped default instance id', () => {
    expect(defaultInstanceId('2026-06-25T07:00:00Z')).toBe('2026-06-25-real');
  });

  it('builds capture provenance with day-granular date, no session id, scrub attestation', () => {
    const meta = buildMeta('claude', '2026-06-25T07:00:00Z', 'claude-code', 'a real session');
    expect(meta).toEqual({
      surface: 'claude',
      captured_utc: '2026-06-25',
      harness: 'claude-code',
      scrubbed: true,
      scrub_categories: ['machine-paths', 'home-username', 'git-handles', 'person-names', 'emails', 'secrets'],
      note: 'a real session',
    });
  });

  it('selects + sorts .jsonl session files only', () => {
    expect(sessionFiles(['b.jsonl', 'notes.md', 'a.jsonl', 'x.txt'])).toEqual(['a.jsonl', 'b.jsonl']);
  });
});
