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
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canRunShellScript, incapableBinaryReason } from '../support/external-binary.js';

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
      // `path.delimiter`, not a hardcoded ':' — the latter builds one
      // unparseable PATH string on Windows, which would defeat even a shell that
      // IS capable of running this hook (plan 077 · tk-0103).
      PATH: `${join(repo, 'shim')}${delimiter}${process.env.PATH ?? ''}`,
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
 * check. On a host that cannot run it, the honest move is to skip loudly.
 *
 * ## The guard probes CAPABILITY, and the first version did not (tk-0103)
 *
 * This file originally guarded on `hasBinary('bash')` — presence. The downstream
 * consumer of #108 then showed, on a real Windows box, why that is worse than no
 * guard at all: `bash` there resolves to `C:\Windows\system32\bash.exe`, which is
 * WSL bash, a LINUX binary. It answers `--version` perfectly, so the guard passed
 * — and then ate the backslashes in the Windows temp path we hand it and exited
 * 127, leaving four assertion failures the declaration had made look handled.
 * `which node` inside that same shell also fails, so the PATH shim below could
 * not have worked either.
 *
 * `canRunShellScript` runs the mechanism instead: a script at a native path, a
 * shim resolved off PATH. That answers the question this file actually asks —
 * "can this shell run our hook?" — for git-bash, WSL bash, MSYS and a stock
 * POSIX box alike, without any of them being special-cased by name.
 *
 * NOTE for whoever arms the windows-latest leg: git-for-Windows bundles bash, so
 * this MAY simply run there — but "shipped with git" and "first on PATH in the
 * runner's shell" are different facts and neither has been measured. This probe
 * answers it truthfully either way rather than assuming.
 */
const BASH_CAPABLE = canRunShellScript('bash');

if (!BASH_CAPABLE) {
  console.warn(
    incapableBinaryReason(
      'bash',
      "run a script at this platform's NATIVE path with a shimmed executable resolved off PATH — the shape every case below uses. The known cause is a `bash` on PATH that is WSL bash (a Linux binary given a Windows path: it eats the backslashes and exits 127); putting git-for-Windows' bash earlier on PATH is what fixes it, NOT installing anything",
      'that the SHIPPED .githooks/post-commit honours HARNESS_NO_TELEMETRY, exits 0 on an injected fault, and fires the flush exactly once per commit (plan 067).',
    ),
  );
}

describe.skipIf(!BASH_CAPABLE)(
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
