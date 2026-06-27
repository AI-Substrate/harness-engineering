import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import type { ProcessPort } from '../../../src/adapters/process/process-port.js';
import { ensureTemp } from '../../../src/services/shared/temp.js';

/**
 * T008 (plan 1.7 · AC-06 · Source-Truth/C1) — the telemetry buffer self-ignores.
 *
 * The REAL AC-06 mechanism is the nested `.harness/temp/.gitignore` = `*` that
 * the shared `ensureTemp` writes — NOT the repo-root `.gitignore:159` (which is
 * cwd-dependent and absent in a consumer repo). This is an integration test: a
 * real throwaway git repo with NO `.harness` rule in its root `.gitignore`, then
 * `git check-ignore` confirms a telemetry buffer file is ignored anyway.
 */

let repo: string;

function gitIgnored(rel: string): boolean {
  try {
    // check-ignore exits 0 (ignored) / 1 (not ignored); -q suppresses output.
    execFileSync('git', ['-C', repo, 'check-ignore', '-q', rel], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'tel-gitignore-'));
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'pipe' });
  // A repo-root .gitignore that deliberately does NOT mention .harness — proving
  // the buffer's invisibility does not depend on it.
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\ndist/\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('T008 — buffer dir self-ignores via ensureTemp (independent of repo-root .gitignore)', () => {
  it('git check-ignore reports a telemetry buffer file as ignored', () => {
    // Run the REAL ensureTemp against a NodeFs rooted at the throwaway repo.
    const proc = { cwd: () => repo } as ProcessPort;
    ensureTemp({ fs: new NodeFs(), proc });

    // Write a buffer entry + its OTLP spool pair exactly where capture-service would.
    const bufDir = join(repo, '.harness', 'temp', 'telemetry', 'sess1');
    mkdirSync(bufDir, { recursive: true });
    writeFileSync(join(bufDir, '1.json'), '{}\n');
    writeFileSync(join(bufDir, '1.logs.jsonl'), '{"resourceLogs":[]}\n');
    writeFileSync(join(bufDir, '1.metrics.jsonl'), '{"resourceMetrics":[]}\n');

    expect(gitIgnored('.harness/temp/telemetry/sess1/1.json')).toBe(true);
    expect(gitIgnored('.harness/temp/telemetry/sess1.cursor')).toBe(true);
    // T015: the OTLP spool (T010) lives in the same self-ignored dir → never
    // committed to a work tree (the OTLP bytes are as sensitive as the buffer).
    expect(gitIgnored('.harness/temp/telemetry/sess1/1.logs.jsonl')).toBe(true);
    expect(gitIgnored('.harness/temp/telemetry/sess1/1.metrics.jsonl')).toBe(true);
  });

  it("control: a file OUTSIDE .harness/temp is NOT ignored (the rule isn't over-broad)", () => {
    const proc = { cwd: () => repo } as ProcessPort;
    ensureTemp({ fs: new NodeFs(), proc });
    writeFileSync(join(repo, 'real-source.ts'), '// tracked\n');
    expect(gitIgnored('real-source.ts')).toBe(false);
  });
});
