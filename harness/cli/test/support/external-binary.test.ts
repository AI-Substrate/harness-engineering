import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canRunShellScript,
  hasBinary,
  incapableBinaryReason,
  probeShell,
} from './external-binary.js';

/**
 * The regression control for a defect THIS SUITE SHIPPED (plan 077 · tk-0103).
 *
 * PR #118 guarded `post-commit-hook.test.ts` on `hasBinary('bash')`. The
 * downstream consumer of #108 then ran it on Windows, where `bash` resolves to
 * `C:\Windows\system32\bash.exe` — WSL bash, a Linux binary. It answered
 * `--version` fine, so the guard passed; it then ate the backslashes in the
 * Windows temp path and exited 127, and the file stayed red.
 *
 * That is the failure mode worth a permanent test, and it is not "a guard was
 * missing". It is that a guard which reports PRESENCE while the caller needs
 * CAPABILITY is worse than no guard at all: the red gets read as handled.
 *
 * So these cases build a shell that is deliberately PRESENT-BUT-INCAPABLE — the
 * WSL shape, reduced to its essentials — and assert that the two probes DISAGREE
 * about it. If someone ever "simplifies" `canRunShellScript` back into a `which`,
 * this is what fails.
 */

/** The tracked hook — the real artefact whose resolution chain is at issue. */
const HOOK = fileURLToPath(new URL('../../../../.githooks/post-commit', import.meta.url));

let root: string;
/** A fake shell: answers `--version` like a healthy binary, runs nothing. */
let liar: string;
/** A fake shell that genuinely executes the script it is handed. */
let honest: string;

/** POSIX-only: these fixtures rely on shebang+mode-bit execution. */
const POSIX = process.platform !== 'win32';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-probe-control-'));
  mkdirSync(root, { recursive: true });

  liar = join(root, 'liar-shell');
  writeFileSync(
    liar,
    // Exit 0 for `--version`, 127 for anything else — `command not found`,
    // exactly what WSL bash returns for a mangled Windows path.
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "liar 1.0"; exit 0; fi\nexit 127\n',
  );
  chmodSync(liar, 0o755);

  honest = join(root, 'honest-shell');
  writeFileSync(
    honest,
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "honest 1.0"; exit 0; fi\nexec bash "$@"\n',
  );
  chmodSync(honest, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!POSIX)('external-binary probes — presence is not capability (tk-0103)', () => {
  it('the OLD probe passes a shell that cannot run a script — the shipped defect, reproduced', () => {
    // Non-vacuous by construction: if this ever goes false the case below proves
    // nothing, because the two probes would agree for the boring reason.
    expect(hasBinary(liar)).toBe(true);
  });

  it('the CAPABILITY probe fails that same shell — the two disagree, and that is the point', () => {
    expect(canRunShellScript(liar)).toBe(false);
  });

  it('and it still says YES to a shell that genuinely works (not merely strict)', () => {
    // The positive control. A probe that answered "no" to everything would make
    // every case above pass while skipping the entire suite on every host.
    expect(canRunShellScript(honest)).toBe(true);
  });

  it('it proves PATH resolution too, not only that the script was found', () => {
    // The second half of the consumer's finding: `which node` inside WSL bash
    // also failed, so even a correctly-passed path would have died at the hook's
    // `node "$bin"` line. A shell handed an unusable PATH must read as incapable.
    const blind = join(root, 'blind-shell');
    writeFileSync(
      blind,
      // Runs the script, but with PATH emptied — the shim becomes unresolvable.
      '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then exit 0; fi\nPATH=/nonexistent exec bash "$@"\n',
    );
    chmodSync(blind, 0o755);

    expect(hasBinary(blind)).toBe(true);
    expect(canRunShellScript(blind)).toBe(false);
  });

  it('an absent shell is incapable, not an exception', () => {
    const absent = join(root, 'no-such-shell-anywhere');
    expect(hasBinary(absent)).toBe(false);
    expect(canRunShellScript(absent)).toBe(false);
  });

  /**
   * LEVEL 2 — the false-positive shape terra found, made to FAIL (tk-0103 round 2).
   *
   * The first probe answered "presence" when the caller needed "capability". Its
   * replacement answered capability — but only the LAST link of the chain. The
   * tracked hook resolves `git` first, and bails with `exit 0` when it cannot:
   *
   * ```sh
   * repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
   * ```
   *
   * So a git-blind shell passes the git-blind probe, the describe runs, the hook
   * exits SUCCESSFULLY having done nothing, and the case fails on the missing
   * marker. Two levels of the same defect have now shipped, both silent.
   *
   * These cases build that exact shell and pin all three facts: the OLD probe
   * accepts it, the FIXTURE really does fail under it, and the NEW probe rejects
   * it. The first two are what make the third non-vacuous — without them this is
   * just a test that a stricter probe is stricter.
   */
  describe('LEVEL 2 — a shell that passes the git-blind probe and still fails the hook', () => {
    /** A shell that runs scripts and resolves the shim, but cannot see `git`. */
    let gitBlind: string;

    beforeAll(() => {
      // Resolve bash + env by absolute path BEFORE the wrapper narrows PATH —
      // the shim's `#!/usr/bin/env bash` shebang needs both to stay reachable,
      // or the shell would read as incapable for the wrong reason entirely.
      const resolved = spawnSync('bash', ['-c', 'command -v bash; command -v env'], {
        encoding: 'utf8',
      });
      const [bashPath = '/bin/bash', envPath = '/usr/bin/env'] = resolved.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      // A tools dir holding EXACTLY what a script needs to run — and no `git`.
      const tools = join(root, 'tools');
      mkdirSync(tools, { recursive: true });
      for (const [name, target] of [
        ['bash', bashPath],
        ['env', envPath],
      ] as const) {
        writeFileSync(join(tools, name), `#!${target}\nexec ${target} "$@"\n`);
        chmodSync(join(tools, name), 0o755);
      }

      gitBlind = join(root, 'git-blind-shell');
      writeFileSync(
        gitBlind,
        `#!${bashPath}\n` +
          'if [ "$1" = "--version" ]; then echo "git-blind 1.0"; exit 0; fi\n' +
          // Keep the caller's PREPENDED dir (the shim), drop everything else,
          // then re-add only bash+env. `git` becomes unresolvable; nothing else
          // about the shell changes.
          'first="${PATH%%:*}"\n' +
          `PATH="$first:${tools}" exec ${bashPath} "$@"\n`,
      );
      chmodSync(gitBlind, 0o755);
    });

    it('the OLD, git-blind probe ACCEPTS it — the false positive, reproduced', () => {
      // Non-vacuous by construction, exactly as the level-1 control is: if this
      // shell were rejected here, the rejection below would prove nothing.
      expect(canRunShellScript(gitBlind)).toBe(true);
    });

    it('and the FIXTURE really does fail under it — silently, at exit 0', () => {
      // The consequence, demonstrated rather than argued. This is the failure the
      // probe was supposed to prevent, and the reason a partial probe is
      // dangerous: the hook SUCCEEDS while doing nothing, so the red lands on the
      // marker assertion and reads as a hook defect.
      const repo = mkdtempSync(join(tmpdir(), 'harness-level2-'));
      try {
        spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
        mkdirSync(join(repo, '.githooks'), { recursive: true });
        copyFileSync(HOOK, join(repo, '.githooks', 'post-commit'));
        mkdirSync(join(repo, 'harness', 'cli', 'bin'), { recursive: true });
        writeFileSync(join(repo, 'harness', 'cli', 'bin', 'harness.js'), '// stub\n');

        const marker = join(repo, 'flush-ran');
        mkdirSync(join(repo, 'shim'), { recursive: true });
        const shim = join(repo, 'shim', 'node');
        writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HARNESS_HOOK_MARKER"\n');
        chmodSync(shim, 0o755);

        const run = spawnSync(gitBlind, [join(repo, '.githooks', 'post-commit')], {
          cwd: repo,
          encoding: 'utf8',
          env: {
            ...process.env,
            HARNESS_NO_TELEMETRY: '',
            HARNESS_NO_TELEMETRY_AUTOSYNC: '',
            PATH: `${join(repo, 'shim')}${delimiter}${process.env.PATH ?? ''}`,
            HARNESS_HOOK_MARKER: marker,
          },
        });

        // Both halves matter. The exit code is the LIE the old guard believed…
        expect(run.status).toBe(0);
        // …and the missing marker is the assertion that would have gone red.
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('the NEW probe REJECTS it, and names the step that failed', () => {
      const result = probeShell(gitBlind, { requires: ['git'] });
      expect(result.capable).toBe(false);
      // The message has to be actionable: "incapable" alone would send a reader
      // hunting the shell when the answer is a missing command.
      expect(result.failure).toMatch(/git|command/i);
    });

    it('a shell that CAN see git still passes the stricter probe', () => {
      // The positive control for the strictness itself. A `requires` that
      // rejected every host would skip the suite everywhere and look like a fix.
      expect(canRunShellScript(honest, { requires: ['git'] })).toBe(true);
    });
  });

  it('the probe leaves nothing behind — it runs on every suite start', () => {
    /**
     * Measured in a PRIVATE namespace, not in `os.tmpdir()`.
     *
     * The first version of this case listed the shared OS temp dir for
     * `harness-shell-probe-*` — a correct leak check over the wrong namespace,
     * and it went red the moment a second vitest worker probed concurrently. It
     * is the identical defect `exec-remote-telemetry-git.int.test.ts` documents
     * at length, reproduced here by someone who had read that comment. Root
     * cause, not retry: `os.tmpdir()` re-reads these variables on every call, so
     * pointing them at a dir only this case can see makes the listing contain
     * this probe's output and nothing else.
     */
    const priv = mkdtempSync(join(tmpdir(), 'harness-probe-ns-'));
    const ambient = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    try {
      process.env.TMPDIR = priv;
      process.env.TMP = priv;
      process.env.TEMP = priv;

      // An uncached (shell, requires) pair, so a real probe actually runs.
      canRunShellScript(join(root, 'uncached-shell-for-cleanup-check'));

      const leaked = readdirSync(priv).filter((n) => n.startsWith('harness-shell-probe-'));
      expect(leaked).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(ambient)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(priv, { recursive: true, force: true });
    }
  });
});

describe('the skip WORDING distinguishes absent from incapable', () => {
  it('names the capability, the known cause, and what stopped being checked', () => {
    // A reader told "not found" about a binary `which` reports is a reader who
    // loses an hour. The two reasons must not be confusable.
    const reason = incapableBinaryReason(
      'bash',
      'run a script at a native path',
      'that the hook fires once per commit',
    );
    expect(reason).toContain('IS present');
    expect(reason).toContain('not CAPABLE');
    expect(reason).toContain('run a script at a native path');
    expect(reason).toContain('that the hook fires once per commit');
    expect(reason).not.toContain('is not on PATH');
  });
});

/**
 * The DRIFT guard — the accepted liability of not running the hook, made visible.
 *
 * `probeShell` deliberately mirrors the hook's mechanisms and never its logic, so
 * that a broken hook fails the tests instead of skipping them (see its doc). The
 * price is drift: if the hook grows a dependency, the probe silently stops
 * covering the chain and we are back at a partial guard — the exact defect, a
 * third time.
 *
 * So this reads the TRACKED hook and asserts every external command it invokes is
 * one we have accounted for. It cannot prove the probe is complete, but it does
 * turn "someone added a command and nobody updated the probe" from a silent
 * regression into a failing test that names the command.
 */
describe('the probe cannot silently fall behind the hook it guards', () => {
  /** Shell builtins/keywords — invoked, but never resolved from PATH. */
  const BUILTINS = new Set([
    'set',
    'exit',
    'if',
    'then',
    'fi',
    'else',
    'elif',
    'for',
    'do',
    'done',
    'while',
    'case',
    'esac',
    'export',
    'echo',
    'printf',
    'cd',
    'local',
    'return',
    'eval',
    'read',
    'shift',
    'unset',
    'true',
    'false',
    'command',
    'source',
    'trap',
    'test',
  ]);

  /**
   * The commands the fixture's environment is KNOWN to provide:
   * `git` via the probe's `requires`, `node` via the shim the fixture puts on PATH.
   */
  const ACCOUNTED_FOR = new Set(['git', 'node']);

  it('every external command in .githooks/post-commit is one the probe accounts for', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const found = new Set<string>();

    // Command substitutions: `$(git rev-parse …)` — the shape that bit us.
    for (const [, name] of hook.matchAll(/\$\(\s*([a-z][\w.-]*)/g)) {
      if (name !== undefined) found.add(name);
    }
    // Bare invocations at the head of a line: `node "$bin" …`.
    for (const [, name] of hook.matchAll(/^\s*([a-z][\w.-]*)\s+[^=]/gm)) {
      if (name !== undefined) found.add(name);
    }

    const unaccounted = [...found].filter((n) => !BUILTINS.has(n) && !ACCOUNTED_FOR.has(n));

    // Non-vacuous: if the scan finds nothing at all it is not passing, it is blind.
    expect(found.has('git')).toBe(true);
    expect(unaccounted).toEqual([]);
  });
});
