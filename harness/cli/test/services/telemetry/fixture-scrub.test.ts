import { describe, expect, it } from 'vitest';
import {
  HOME_PLACEHOLDER,
  REPO_PLACEHOLDER,
  type ScrubConfig,
  scrubText,
  USER_PLACEHOLDER,
} from '../../../src/services/telemetry/fixture-scrub.js';

/**
 * T002 (plan 1.2 · AC-02) — TEST-FIRST contract for the pure scrub service.
 *
 * The scrub is the SOLE guard on the committed raw fixture (Finding 01): the
 * serializer allowlist protects only the OUTPUT golden, so the raw bytes must be
 * cleaned here. It strips machine paths / identity / secrets across POSIX +
 * Windows + the claude project-dir mangle, while keeping prompts and tool
 * commands VERBATIM (the whole point of the corpus).
 *
 * Config is explicit (P3 — never probes process.env / process.platform); the
 * capture extension's run() composition root supplies the real values.
 */

const CFG: ScrubConfig = {
  homeDir: '/Users/alice',
  repoRoot: '/Users/alice/substrate/harness-engineering',
  username: 'alice',
  names: ['Alice Example'],
};

describe('scrubText — machine paths', () => {
  it('rewrites a POSIX home path; no /Users/ or username survives', () => {
    const out = scrubText('opened /Users/alice/notes.txt just now', CFG);
    expect(out).not.toContain('/Users/');
    expect(out).not.toContain('alice');
    expect(out).toContain(`${HOME_PLACEHOLDER}/notes.txt`);
  });

  it('rebases a repo path onto the repo placeholder (more specific than home wins)', () => {
    const out = scrubText(
      'edited /Users/alice/substrate/harness-engineering/harness/cli/x.ts',
      CFG,
    );
    expect(out).toContain(`${REPO_PLACEHOLDER}/harness/cli/x.ts`);
    expect(out).not.toContain('/Users/');
    expect(out).not.toContain('substrate/harness-engineering/harness'); // real root gone
  });

  it('rewrites a Windows home path; no C:\\ or username survives', () => {
    const cfg: ScrubConfig = {
      homeDir: 'C:\\Users\\alice',
      repoRoot: 'C:\\Users\\alice\\repo',
      username: 'alice',
    };
    const out = scrubText('cwd was C:\\Users\\alice\\proj\\main.rs', cfg);
    expect(out).not.toContain('C:\\Users');
    expect(out).not.toContain('alice');
  });

  it('neutralizes the claude project-dir mangle -Users-<user>-...', () => {
    const out = scrubText(
      'path ~/.claude/projects/-Users-alice-substrate-harness-engineering/s.jsonl',
      CFG,
    );
    expect(out).not.toContain('alice');
    expect(out).not.toContain('-Users-alice');
  });

  it('replaces a bare username token anywhere', () => {
    const out = scrubText('user alice ran it', CFG);
    expect(out).not.toContain('alice');
    expect(out).toContain(USER_PLACEHOLDER);
  });
});

describe('scrubText — secrets + identity', () => {
  it.each([
    ['sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01', 'anthropic key'],
    ['ghp_AbCdEf0123456789AbCdEf0123456789AbCd', 'github PAT'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws access key id'],
    ['Bearer SUPER_SECRET_TOKEN_abcdef0123456789abcdef', 'bearer token'],
  ])('redacts secret-shaped token (%s)', (secret) => {
    const out = scrubText(`auth header: ${secret} end`, CFG);
    expect(out).not.toContain(secret);
  });

  it('redacts email addresses', () => {
    const out = scrubText('contact alice@example.com for access', CFG);
    expect(out).not.toContain('alice@example.com');
    expect(out).not.toContain('@example.com');
  });

  it('redacts a configured person name', () => {
    const out = scrubText('reviewed by Alice Example today', CFG);
    expect(out).not.toContain('Alice Example');
  });
});

describe('scrubText — VERBATIM preservation (the point of the corpus)', () => {
  it('keeps ordinary prompt prose untouched', () => {
    const prompt = 'please run the tests, then fix the failing assertion in the parser';
    expect(scrubText(prompt, CFG)).toBe(prompt);
  });

  it('keeps a shell command (no paths/secrets) verbatim', () => {
    const cmd = 'git status --short && npm run build';
    expect(scrubText(cmd, CFG)).toBe(cmd);
  });

  it('keeps tool/skill names and flags verbatim', () => {
    const line = 'invoked the-flow 6 implement --companion --phase "Phase 1"';
    expect(scrubText(line, CFG)).toBe(line);
  });
});

describe('scrubText — JSONL integrity', () => {
  it('output of a scrubbed JSONL line is still valid JSON', () => {
    const line = JSON.stringify({
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'editing /Users/alice/substrate/harness-engineering/a.ts' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls /Users/alice' } },
        ],
      },
    });
    const out = scrubText(line, CFG);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('/Users/');
    expect(out).not.toContain('alice');
  });
});
