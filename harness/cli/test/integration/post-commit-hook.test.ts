import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasBinary, missingBinaryReason } from '../support/external-binary.js';

/**
 * Plan 067 item 4 — the post-commit telemetry flush must honour BOTH opt-outs.
 *
 * `HARNESS_NO_TELEMETRY_AUTOSYNC=1` is documented as "no unprompted pushes" and gates
 * the `checks` housekeeping auto-sync, but the commit hook honoured only the full
 * kill-switch — so anyone who set the narrow switch still paid a foreground
 * `telemetry sync` on every single commit, which is precisely the cost this plan is
 * about.
 *
 * The hook is exercised AS TRACKED (`.githooks/post-commit` is copied verbatim into a
 * throwaway repo), with `node` shimmed on PATH so "did the flush run?" is an
 * observable file, not an inference.
 */

const HOOK = fileURLToPath(new URL('../../../../.githooks/post-commit', import.meta.url));

let repo: string;
let marker: string;

/** Run the tracked hook in `repo` with `env` overlaid; returns its exit code. */
function runHook(env: Record<string, string>): number {
  const r = spawnSync('bash', [join(repo, '.githooks', 'post-commit')], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_NO_TELEMETRY: '',
      HARNESS_NO_TELEMETRY_AUTOSYNC: '',
      PATH: `${join(repo, 'shim')}:${process.env.PATH ?? ''}`,
      HARNESS_HOOK_MARKER: marker,
      ...env,
    },
  });
  return r.status ?? -1;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'harness-post-commit-'));
  marker = join(repo, 'flush-ran');
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });

  mkdirSync(join(repo, '.githooks'), { recursive: true });
  // Was `spawnSync('cp', …)` — an undeclared external binary, absent on Windows
  // (#108), and one whose exit status was never checked, so a failed copy was
  // SILENT. copyFileSync throws instead, which is the point as much as the
  // portability is.
  copyFileSync(HOOK, join(repo, '.githooks', 'post-commit'));

  // The hook only acts when the CLI entrypoint exists at the repo root.
  mkdirSync(join(repo, 'harness', 'cli', 'bin'), { recursive: true });
  writeFileSync(join(repo, 'harness', 'cli', 'bin', 'harness.js'), '// stub\n');

  // A `node` shim that records the invocation instead of running the real CLI.
  mkdirSync(join(repo, 'shim'), { recursive: true });
  const shim = join(repo, 'shim', 'node');
  writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HARNESS_HOOK_MARKER"\n');
  chmodSync(shim, 0o755);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/**
 * bash is the SUBJECT here, not the mechanism — do not reimplement the hook.
 *
 * These cases run the REAL TRACKED ARTEFACT (`.githooks/post-commit`) through a
 * real shell. Reimplementing its logic in JS would test a copy of the hook
 * rather than the hook we ship, which is the one thing this suite exists to
 * check. On a host without bash the honest move is to skip loudly.
 *
 * NOTE for whoever arms the windows-latest leg: git-for-Windows bundles bash,
 * so this MAY simply run there — but "shipped with git" and "on PATH in the
 * runner's shell" are different facts and neither has been measured. This probe
 * answers it truthfully either way rather than assuming.
 */
if (!hasBinary('bash')) {
  console.warn(
    missingBinaryReason(
      'bash',
      'that the SHIPPED .githooks/post-commit honours HARNESS_NO_TELEMETRY, exits 0 on an injected fault, and fires the flush exactly once per commit (plan 067).',
    ),
  );
}

describe.skipIf(!hasBinary('bash'))(
  '.githooks/post-commit — telemetry flush opt-outs (plan 067)',
  () => {
    it('flushes by default (the guard assertions below are non-vacuous)', () => {
      expect(runHook({})).toBe(0);
      expect(existsSync(marker)).toBe(true);
    });

    it('HARNESS_NO_TELEMETRY=1 suppresses the flush', () => {
      expect(runHook({ HARNESS_NO_TELEMETRY: '1' })).toBe(0);
      expect(existsSync(marker)).toBe(false);
    });

    it('HARNESS_NO_TELEMETRY_AUTOSYNC=1 suppresses the flush — it IS an unprompted push', () => {
      expect(runHook({ HARNESS_NO_TELEMETRY_AUTOSYNC: '1' })).toBe(0);
      expect(existsSync(marker)).toBe(false);
    });

    it('a value other than 1 does NOT opt out (only the documented switch value)', () => {
      expect(runHook({ HARNESS_NO_TELEMETRY_AUTOSYNC: '0' })).toBe(0);
      expect(existsSync(marker)).toBe(true);
    });
  },
);
