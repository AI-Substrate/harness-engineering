import { describe, expect, it } from 'vitest';
import {
  type CaptureConfig,
  claudeMangle,
  claudeProjectDir,
  deriveCaptureConfig,
  instanceDir,
  isSurface,
  rawFilename,
  scratchRoot,
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
