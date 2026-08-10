import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * FAULT INJECTION against the REAL verb (plan 082 tk-000a, tk-000b).
 *
 * Two properties are proven here and they are deliberately different:
 *
 * 1. **Every failure path exits 0 and writes nothing the agent can see.** The hook
 *    runs inside an agent's tool loop; a non-zero exit or a stray line could abort
 *    or corrupt the agent's own turn.
 *
 * 2. **Because of (1), the exit code carries NO information** — it is 0
 *    unconditionally, including when everything failed. So no assertion here may
 *    rest on the exit code alone. Every one is paired with the JOURNAL, which is
 *    the actual observable, and `harness hooks status` cannot be used because it
 *    is a Phase 2 deliverable and Phase 2 depends on Phase 1.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function fire(home: string, phase: 'pre' | 'post', payload: string, cwd: string): Run {
  const result = execFileSync(
    process.execPath,
    [CLI, 'hooks', 'fire', 'cursor', '--phase', phase, '--hook-input', 'stdin'],
    {
      cwd,
      encoding: 'utf8',
      input: payload,
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
      // A non-zero exit would THROW here; catching below would hide it, so we let
      // execFileSync's own failure be the test failure.
    },
  );
  return { status: 0, stdout: result, stderr: '' };
}

function journal(home: string): Record<string, unknown>[] {
  try {
    return readFileSync(join(home, '.harness', 'hooks', 'fires.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe('hooks fire — every failure path exits 0 and stays silent (dw-0018, dw-0019)', () => {
  it.each([
    ['a malformed payload', '{ not json at all'],
    ['an empty payload', ''],
    ['a payload naming a directory that is not a repo', '{"tool_input":{"cwd":"/nonexistent-42"}}'],
    ['a payload with no repo at all', '{"tool_name":"Shell"}'],
    ['a payload that is a JSON scalar', '"just a string"'],
  ])('survives %s with exit 0 and no agent-visible output', (_name, payload) => {
    /*
    Test Doc:
    - Why: dw-0018. These are the shapes an agent can hand us on a version bump
      nobody tested against. A crash here breaks the agent's turn.
    - Contract: exit 0, empty stdout.
    - Quality Contribution: drives the REAL verb through the REAL bin, so it also
      proves the wiring, not just the service.
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    try {
      const run = fire(home, 'post', payload, home);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('survives an UNREACHABLE socket, and the journal records the failure AND its cause (dw-001a)', () => {
    /*
    Test Doc:
    - Why: dw-001a and dw-001b. This is the case that would otherwise be perfectly
      invisible: the guard decides to emit, the emit fails, and exit 0 says nothing.
    - Contract: exit 0, silent, and a journal entry naming the outcome and cause.
    - Quality Contribution: asserts on the JOURNAL FILE, never on `hooks status`
      (Phase 2) and never on the exit code (which is unconditional by design).
    */
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    const repo = join(home, 'repo');
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
      const git = (args: string[]): string =>
        execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
      writeFileSync(join(repo, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'base']);

      const payload = JSON.stringify({
        tool_name: 'Shell',
        tool_input: { cwd: repo, command: 'git add -A && git commit -m "x"' },
      });

      // PRE brackets the commit; the agent then commits; POST decides to emit and
      // finds nothing listening (the hermetic env points trace2 nowhere usable).
      expect(fire(home, 'pre', payload, repo).status).toBe(0);
      writeFileSync(join(repo, 'a.txt'), 'edited\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'the agent authored this']);
      const post = fire(home, 'post', payload, repo);

      expect(post.status).toBe(0);
      expect(post.stdout).toBe('');

      const entries = journal(home);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const phases = entries.map((e) => e.phase);
      expect(phases).toContain('pre');
      expect(phases).toContain('post');

      // The POST entry names WHAT happened and WHY. Asserted UNCONDITIONALLY:
      // an `if (kind === 'failed')` guard would let this test pass on a run where
      // the guard never even reached the emit, which is precisely the invisible
      // case the journal exists to expose.
      const last = entries.at(-1) as { outcome?: { kind?: string; cause?: string } };
      expect(last.outcome?.kind).toBe('failed');
      expect(last.outcome?.cause).toBe('no relayable trace2 ingress configured');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('writes its state OUTSIDE the observed repository — the hook leaves no trace in the tree', () => {
    // An agent working in a repo must never find hook bookkeeping in its own
    // `git status`. State and journal live under the user's home.
    const home = mkdtempSync(join(tmpdir(), 'harness-hookfault-'));
    const repo = join(home, 'repo');
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
      const git = (args: string[]): string =>
        execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
      writeFileSync(join(repo, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'base']);

      const before = git(['status', '--porcelain']);
      fire(home, 'pre', JSON.stringify({ tool_input: { cwd: repo } }), repo);
      fire(home, 'post', JSON.stringify({ tool_input: { cwd: repo } }), repo);

      expect(git(['status', '--porcelain'])).toBe(before);
      // And the journal genuinely was written — otherwise this passes vacuously.
      expect(journal(home).length).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
