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
  POST_COMMIT_HOOK_CONTRACT,
  probeShell,
  type ShellCapability,
  type ShellContract,
} from './external-binary.js';

/**
 * The BLIND contract — what the level-1 and level-2 probes effectively asked.
 * Kept only so the false-positive shapes can be reproduced; nothing ships it.
 */
const BLIND: ShellContract = {
  commands: [],
  envGuards: [],
  gitPathTest: false,
  silentSuccessPaths: 0,
};

/** The level-2 contract: git proven, `node` and the env guards still blind. */
const GIT_ONLY: ShellContract = {
  commands: [{ name: 'git', shape: 'substitution', provider: 'ambient' }],
  envGuards: [],
  gitPathTest: true,
  silentSuccessPaths: 0,
};

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
    expect(canRunShellScript(liar, BLIND)).toBe(false);
  });

  it('and it still says YES to a shell that genuinely works (not merely strict)', () => {
    // The positive control. A probe that answered "no" to everything would make
    // every case above pass while skipping the entire suite on every host.
    expect(canRunShellScript(honest, BLIND)).toBe(true);
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
    expect(canRunShellScript(blind, BLIND)).toBe(false);
  });

  it('an absent shell is incapable, not an exception', () => {
    const absent = join(root, 'no-such-shell-anywhere');
    expect(hasBinary(absent)).toBe(false);
    expect(canRunShellScript(absent, BLIND)).toBe(false);
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
      expect(canRunShellScript(gitBlind, BLIND)).toBe(true);
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
      const result = probeShell(gitBlind, GIT_ONLY);
      expect(result.capable).toBe(false);
      // The message has to be actionable: "incapable" alone would send a reader
      // hunting the shell when the answer is a missing command.
      expect(result.failure).toMatch(/git|command/i);
    });

    it('a shell that CAN see git still passes the stricter probe', () => {
      // The positive control for the strictness itself. A contract that
      // rejected every host would skip the suite everywhere and look like a fix.
      expect(canRunShellScript(honest, GIT_ONLY)).toBe(true);
    });
  });

  /**
   * LEVELS 3 AND 4 — one mechanism, two projections (tk-0103 round 3).
   *
   * `BASH_ENV` names a file bash sources before running a non-interactive script.
   * It can define a FUNCTION that shadows a command (level 3, terra) or EXPORT a
   * variable that overrides what the caller passed (level 4, reproduced here
   * before it shipped). Same mechanism, two faces — so both are controlled with
   * the same discriminator rather than as separate defects a round apart.
   *
   * What makes them dangerous is shared too: the hook's bail-outs are `exit 0`
   * and `|| true`, so either shadowing produces a hook run that SUCCEEDS having
   * done nothing, and the fixture fails on its marker looking like a hook defect.
   */
  describe('LEVELS 3 & 4 — BASH_ENV shadows the caller, not merely a command', () => {
    /** A shell whose startup file is `startup`, otherwise an ordinary bash. */
    const shellWithStartup = (name: string, startup: string): string => {
      const path = join(root, name);
      writeFileSync(
        path,
        `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then exit 0; fi\nBASH_ENV=${startup} exec bash "$@"\n`,
      );
      chmodSync(path, 0o755);
      return path;
    };

    /** Run the REAL tracked hook under `shell`; report its exit and its marker. */
    const runRealHook = (shell: string, extraEnv: NodeJS.ProcessEnv = {}) => {
      const repo = mkdtempSync(join(tmpdir(), 'harness-shadow-'));
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

        const run = spawnSync(shell, [join(repo, '.githooks', 'post-commit')], {
          cwd: repo,
          encoding: 'utf8',
          env: {
            ...process.env,
            HARNESS_NO_TELEMETRY: '',
            HARNESS_NO_TELEMETRY_AUTOSYNC: '',
            PATH: `${join(repo, 'shim')}${delimiter}${process.env.PATH ?? ''}`,
            HARNESS_HOOK_MARKER: marker,
            ...extraEnv,
          },
        });
        return { status: run.status, marker: existsSync(marker) };
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    };

    it('LEVEL 3 — a shadowed `node` passes the git-only probe and kills the fixture', () => {
      const startup = join(root, 'startup-node.sh');
      // A zero-returning `node` function. It shadows the PATH shim, because a
      // function beats PATH — which is why a GENERIC probe shim proves nothing.
      writeFileSync(startup, 'node() { return 0; }\nexport -f node\n');
      const shell = shellWithStartup('node-shadow-shell', startup);

      // The false positive: the level-2 contract is satisfied by this shell.
      expect(canRunShellScript(shell, GIT_ONLY)).toBe(true);

      // The consequence, demonstrated: successful hook, no marker.
      const run = runRealHook(shell);
      expect(run.status).toBe(0);
      expect(run.marker).toBe(false);

      // And the contract-driven probe rejects it, NAMING what was shadowed.
      const verdict = probeShell(shell, POST_COMMIT_HOOK_CONTRACT);
      expect(verdict.capable).toBe(false);
      expect(verdict.failure).toContain('node');
    });

    it('LEVEL 4 — a re-exported env guard does the same, and is not a command at all', () => {
      const startup = join(root, 'startup-env.sh');
      // The caller passes HARNESS_NO_TELEMETRY=''. The startup file overrides it.
      // Nothing here is a command, so enumerating commands could never catch it.
      writeFileSync(startup, 'export HARNESS_NO_TELEMETRY=1\n');
      const shell = shellWithStartup('env-shadow-shell', startup);

      // The false positive: even a `node`-aware contract is blind to this if it
      // does not check that the CALLER'S values survived.
      expect(canRunShellScript(shell, GIT_ONLY)).toBe(true);

      const run = runRealHook(shell);
      expect(run.status).toBe(0);
      expect(run.marker).toBe(false);

      const verdict = probeShell(shell, POST_COMMIT_HOOK_CONTRACT);
      expect(verdict.capable).toBe(false);
      expect(verdict.failure).toMatch(/environment value|caller/i);
    });

    it('an unshadowed shell still passes the FULL hook contract', () => {
      // The positive control for the full contract. Without this, every case
      // above is satisfied by a probe that simply rejects everything.
      const startup = join(root, 'startup-empty.sh');
      writeFileSync(startup, ': # nothing shadowed\n');
      const shell = shellWithStartup('clean-shell', startup);

      expect(canRunShellScript(shell, POST_COMMIT_HOOK_CONTRACT)).toBe(true);
      const run = runRealHook(shell);
      expect(run.status).toBe(0);
      expect(run.marker).toBe(true);
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
      canRunShellScript(join(root, 'uncached-shell-for-cleanup-check'), BLIND);

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
   * The contract IS the accounted-for set. Two structures describing one fact,
   * maintained separately, will disagree — and did: `node` was listed here while
   * the probe never exercised it, which is precisely how level 3 shipped.
   */
  const DECLARED = new Set(POST_COMMIT_HOOK_CONTRACT.commands.map((c) => c.name));

  it('a contractless probe THROWS rather than guessing — the type alone is not enforcement', () => {
    /**
     * Measured, not assumed: `harness/cli/tsconfig.json` sets `include: ["src"]`,
     * so test files are NOT typechecked. A deliberate type error added to this
     * file was observed passing the gate as `typecheck: ok`. So the non-optional
     * parameter is an editor-time guarantee only, and the runtime guard is what
     * actually closes it.
     *
     * The cast is the point: it is what an erased type looks like at runtime, and
     * what a future JS caller or a `as any` would produce.
     */
    const contractless = probeShell as unknown as (shell: string) => ShellCapability;
    expect(() => contractless('bash')).toThrow(/requires an explicit ShellContract/);
  });

  it('every external command in .githooks/post-commit is one the CONTRACT declares', () => {
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

    const unaccounted = [...found].filter((n) => !BUILTINS.has(n) && !DECLARED.has(n));

    // Non-vacuous: if the scan finds nothing at all it is not passing, it is blind.
    expect(found.has('git')).toBe(true);
    expect(found.has('node')).toBe(true);
    expect(unaccounted).toEqual([]);
  });

  it('every env var the hook BRANCHES on is declared as a guard', () => {
    // Level 4 lived here. A new opt-out added to the hook without a matching
    // guard would re-open exactly that hole, silently.
    const hook = readFileSync(HOOK, 'utf8');
    const branched = new Set<string>();
    // `[ "${HARNESS_NO_TELEMETRY:-}" = "1" ]` — a var TESTED, not merely read.
    for (const [, name] of hook.matchAll(/\[\s*"\$\{([A-Z_][A-Z0-9_]*)/g)) {
      if (name !== undefined) branched.add(name);
    }
    expect([...branched].sort()).toEqual([...POST_COMMIT_HOOK_CONTRACT.envGuards].sort());
  });

  it('the hook has exactly the number of SILENT-SUCCESS paths the contract claims', () => {
    /**
     * The count is load-bearing, so it is COUNTED, not read. Re-run the
     * enumeration yourself with:
     *
     * ```sh
     * grep -nE '\b(exit|return|trap|exec)\b|\|\||&&|set[[:space:]]+-' .githooks/post-commit
     * ```
     *
     * A silent-success path is a branch that yields exit 0 having done nothing:
     * `&& exit 0`, `|| exit 0`, or a swallowed failure `|| true`. The file's
     * final bare `exit 0` is the NORMAL terminus and is deliberately excluded —
     * it is reached only after the work is done.
     *
     * Note what the enumeration shows is ABSENT: no `trap`, no `return`, no
     * `exec`, and `set -uo pipefail` carries no `-e`, so there is no implicit
     * exit-on-error path. `set -u` aborts LOUDLY on an unbound variable, which is
     * a non-zero exit and therefore not this class.
     */
    const hook = readFileSync(HOOK, 'utf8');
    const silent =
      (hook.match(/&&\s*exit\s+0/g) ?? []).length +
      (hook.match(/\|\|\s*exit\s+0/g) ?? []).length +
      (hook.match(/\|\|\s*true/g) ?? []).length;

    expect(silent).toBe(POST_COMMIT_HOOK_CONTRACT.silentSuccessPaths);

    // The shapes this enumeration cannot reason about. If one ever appears, the
    // count above stops being complete, and this says so rather than under-count.
    expect(hook).not.toMatch(/\btrap\b/);
    expect(hook).not.toMatch(/set\s+-\w*e\w*\s/);
  });
});
