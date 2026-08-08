import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Probe for an external binary a test genuinely NEEDS — and say so out loud when
 * it is missing (plan 077 · #108 class 3).
 *
 * ## Why this exists at all
 *
 * Most external-binary uses in this suite are MECHANISM: the test wants a file
 * copied, a mode bit set, a line counted. Those were removed outright, because a
 * guard that skips is still coverage we do not have.
 *
 * A few are SUBJECT: the binary is the thing the test asserts about, so no
 * reimplementation is correct at any level of output fidelity — rewriting them
 * would keep the test green while destroying what it proves. Those get this.
 *
 * ## Why the skip is LOUD
 *
 * An absent-binary skip that prints nothing is a control that passes by
 * examining nothing. On a machine without the binary the suite would go green
 * having asserted less than it claims, and nobody would know which claim lapsed.
 * So every skip here names the binary, the reason it cannot be substituted, and
 * what stopped being checked.
 *
 * ## Presence is not the property that matters — CAPABILITY is
 *
 * {@link hasBinary} answers "is something by this name executable here", which is
 * the whole question for a self-contained filter like `jq`. It is NOT the whole
 * question for a shell, and the first version of this file shipped that mistake
 * (tk-0103, found by the downstream consumer of #108 on a real Windows box):
 *
 * ```
 * $ (Get-Command bash).Source
 * C:\Windows\system32\bash.exe          # WSL bash, not git-bash
 * $ bash C:\Users\...\Temp\hook\post-commit
 * /bin/bash: C:Users...Temphookpost-commit: No such file or directory   # exit 127
 * ```
 *
 * `bash --version` succeeds there, so `hasBinary('bash')` returned true, the
 * guard let the suite proceed, and the cases failed anyway with exit 127. That is
 * WORSE than having no guard at all: the declaration made the gap look handled,
 * so the red was read as noise instead of as an unmeasured claim.
 *
 * {@link canRunShellScript} is the fix — it executes the mechanism rather than
 * asking after the name. See its own doc for what it proves.
 *
 * ## The cache is per-process, deliberately
 *
 * A binary does not appear mid-run, and probing once per call would add spawns
 * to a suite whose process count is already under scrutiny (#109).
 */
const cache = new Map<string, boolean>();

/** Capability results, cached on the same terms and for the same reason. */
const capabilityCache = new Map<string, ShellCapability>();

/**
 * Is `binary` present and executable on this host? Probed once per process.
 *
 * PRESENCE only. Correct for a binary whose contract is fully expressed by "it
 * ran" — `jq` reads stdin and writes stdout, and a `jq` that starts is a `jq`
 * that filters. For anything whose usefulness depends on how it interprets its
 * ARGUMENTS — above all a shell being handed a path — use
 * {@link canRunShellScript} instead, and read its doc for why.
 */
export function hasBinary(binary: string): boolean {
  const cached = cache.get(binary);
  if (cached !== undefined) return cached;
  let present: boolean;
  try {
    // `--version` is the cheapest near-universal "are you there" for the
    // binaries this suite needs. We care ONLY that it executed — a non-zero
    // exit still proves presence; ENOENT (status null + error) proves absence.
    const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
    present = probe.error === undefined;
  } catch {
    present = false;
  }
  cache.set(binary, present);
  return present;
}

/** How the hook invokes a command — shape matters, not just resolvability. */
export type InvocationShape = 'substitution' | 'invocation';

/** Where the fixture obtains a command: the ambient host, or a shim it plants. */
export type CommandProvider = 'ambient' | 'shim';

/** One command a shell script needs, with the shape it is actually used in. */
export interface RequiredCommand {
  name: string;
  shape: InvocationShape;
  provider: CommandProvider;
}

/**
 * Everything about an environment that a shell script's observable depends on.
 *
 * This is the SINGLE SOURCE (plan 077 · tk-0103 round 3). The probe drives off
 * it and the drift guard checks the tracked script against it, so a fact cannot
 * be declared in one place and forgotten in the other — which is exactly how
 * `node` came to be "accounted for" by the drift guard while never being
 * exercised by the probe.
 */
export interface ShellContract {
  /** Commands the script runs, each in the shape it runs them. */
  commands: readonly RequiredCommand[];
  /**
   * Environment variables the script BRANCHES ON. The caller's value for these
   * must survive into the script — see `probeShell` for why that is a property
   * in its own right and not a restatement of "the command resolves".
   */
  envGuards: readonly string[];
  /** Does the script file-test a path that GIT produced? */
  gitPathTest: boolean;
  /**
   * How many SILENT-SUCCESS paths the script has — branches that exit 0 or
   * swallow a failure, and so produce a successful run that did nothing. The
   * drift guard pins this count; a new one added to the script fails the build
   * rather than quietly widening the surface this contract has to cover.
   *
   * **Counted WITHIN the file, and that scope is itself guarded.** A count over
   * one file says nothing if the file can delegate — one `source ./helper.sh`
   * keeps the number at five while moving the behaviour somewhere the count
   * cannot see. So a separate control rejects every form that moves execution
   * out of the file (`source`, dot-sourcing, `eval`, `exec`, `trap`, a local
   * script invocation, an explicit subshell), rather than trying to follow them:
   * following is a behaviour enumeration over arbitrary content and does not
   * terminate; the ways of LEAVING a file are finite and do.
   */
  silentSuccessPaths: number;
}

/**
 * The contract of the TRACKED `.githooks/post-commit`, as measured from it.
 *
 * Its five silent-success paths are the reason this type exists at all:
 *
 * | # | branch | kind |
 * |---|---|---|
 * | 1 | `HARNESS_NO_TELEMETRY=1 && exit 0` | env |
 * | 2 | `HARNESS_NO_TELEMETRY_AUTOSYNC=1 && exit 0` | env |
 * | 3 | `git rev-parse … \|\| exit 0` | command |
 * | 4 | `[ -f "$bin" ] \|\| exit 0` | git-produced path test |
 * | 5 | `node "$bin" … \|\| true` | command, failure SWALLOWED |
 *
 * Levels 1–3 of this defect all lived in rows 3 and 5, which is why enumerating
 * COMMANDS looked like a complete answer: it explained every level already hit
 * and none of the ones not yet hit. Rows 1, 2 and 4 are equally able to produce a
 * successful run that writes no marker, and row 1 was demonstrated doing so.
 */
export const POST_COMMIT_HOOK_CONTRACT: ShellContract = {
  commands: [
    { name: 'git', shape: 'substitution', provider: 'ambient' },
    { name: 'node', shape: 'invocation', provider: 'shim' },
  ],
  envGuards: ['HARNESS_NO_TELEMETRY', 'HARNESS_NO_TELEMETRY_AUTOSYNC'],
  gitPathTest: true,
  silentSuccessPaths: 5,
};

/** The value the probe passes for every env guard, and expects to survive. */
const ENV_SENTINEL = 'harness-probe-sentinel';

/** What a shell probe found, and — when it failed — which property failed. */
export interface ShellCapability {
  capable: boolean;
  /** A human-readable name for the FIRST property that failed. */
  failure?: string;
}

/** Probe exit codes → the property that failed. Kept beside the script below. */
const PROBE_FAILURES: Record<number, string> = {
  21: 'a required command could not be run from inside the shell, or its output could not be captured by command substitution',
  22: 'a required command ran but produced no output, so the shell cannot use its result',
  23: '`git rev-parse --show-toplevel` could not be run from inside the shell',
  24: '`git rev-parse --show-toplevel` produced no path',
  25: 'a path PRODUCED BY GIT did not survive a `[ -f … ]` test in this shell — the exact step at which the tracked hook exits 0 having done nothing',
  26: "an environment value set BY THE CALLER did not survive into the script — something in this shell's startup (BASH_ENV, an rc file, an exported default) overrode it, so the script branches on a value its caller never chose",
  127: 'a shimmed executable on the prepended PATH could not be resolved',
};

/**
 * Can `shell` run a script the way this suite's shell-hook fixtures run one?
 * Probed once per process, per (shell, contract) pair (plan 077 · tk-0103).
 *
 * It executes the MECHANISM rather than asking after the name, and it drives off
 * a {@link ShellContract} rather than a hand-kept list — because three rounds of
 * this defect proved that a probe and a separate declaration of the same facts
 * WILL diverge.
 *
 * ## Three levels shipped. Each fix predicted the next gap.
 *
 * | level | what the guard proved | what it missed | found by |
 * |---|---|---|---|
 * | 1 | `bash` is PRESENT | WSL bash mangles a native path, exits 127 | the consumer |
 * | 2 | native path + a generic shim | the hook resolves `git` FIRST | review |
 * | 3 | + `git` resolution | the hook invokes `node`, which a shell FUNCTION can shadow | review |
 * | 4 | + `node` unshadowed | the hook branches on ENV VARS a startup file can re-export | reproduced before shipping |
 *
 * Every level exited 0. That is the whole character of this bug: the hook's
 * bail-outs are `exit 0` and `|| true`, so an environment gap produces a
 * SUCCESSFUL run that did nothing, the fixture fails on its marker rather than on
 * an exit code, and the red reads as a hook defect.
 *
 * ## Why enumerating COMMANDS terminated the wrong search
 *
 * Levels 1–3 all landed in the command half of the hook, so "enumerate its
 * commands" looked complete — it explained every level already hit and none of
 * the ones not yet hit, which is the signature of a frame fitted to past data.
 * The entity that actually causes these failures is the hook's SILENT-SUCCESS
 * PATHS, of which commands are 2 of 5. {@link ShellContract} enumerates all five.
 *
 * ## The unification: BASH_ENV does not shadow commands, it shadows INTENT
 *
 * A startup file shadows a command with a function (level 3) and a variable with
 * an export (level 4) by the identical mechanism. Chasing those as separate
 * defects costs one round each, forever. The property worth proving is the one
 * underneath: **does what the CALLER passed — PATH entries and env values —
 * actually survive into the script?** Both projections close at once.
 *
 * ## What it proves, in ONE spawn against a real temp git repo
 *
 * 1. **A script at a NATIVE path runs** — WSL bash mangles a Windows path.
 * 2. **Caller-passed env values SURVIVE** — nothing in the shell's startup
 *    re-exported them (level 4).
 * 3. **Every ambient command resolves, runs, and its output is CAPTURABLE**
 *    through command substitution (level 2).
 * 4. **A path produced BY GIT survives a `[ -f … ]` test** — the hook's own
 *    chain, and a step whose failure is silent.
 * 5. **Every shimmed command runs the executable ON PATH** — proven by a shim
 *    NAMED for that command, because shadowing is name-specific and a generic
 *    probe shim proves nothing about `node` (level 3).
 *
 * Exit 0 is deliberately NOT the pass condition — every level of this defect
 * exited 0. The per-command observables are.
 *
 * ## What it deliberately does NOT do: run the hook
 *
 * Running `.githooks/post-commit` itself would make the probe drift-proof, and
 * was rejected: a probe that executes the SUBJECT cannot tell "this environment
 * cannot run it" from "this hook is broken", so a genuine hook defect would be
 * reported as an environment gap and the whole suite would skip itself green —
 * converting a loud failure into a silent absence of coverage, which is strictly
 * worse than the bug being fixed. The probe mirrors the hook's MECHANISMS and
 * never its LOGIC. The residual cost is drift, and the drift guard in
 * `external-binary.test.ts` checks the tracked hook against this same contract so
 * the two cannot disagree.
 *
 * It never throws: any failure is reported as not-capable with the failed
 * property named, which is the honest reading — the probe cannot tell "shell is
 * broken" from "host is unusual", and for skip purposes it need not.
 */
export function probeShell(shell: string, contract: ShellContract): ShellCapability {
  /**
   * The contract is enforced at RUNTIME, not only by the type (plan 077 · tk-0103).
   *
   * The non-optional parameter was supposed to make a blind probe fail to
   * compile. It does — in an editor. It does NOT in this repo's gate, because
   * `harness/cli/tsconfig.json` has `include: ["src"]`, so **test files are never
   * typechecked**; a deliberate type error in this very file was measured passing
   * `typecheck: ok`. Two other places in `src` already document that boundary.
   *
   * So the type alone would have been a guarantee that reads as enforced and is
   * not — the exact shape of defect this whole task is about. This throws
   * instead: LOUDLY, and before any probing, so a caller that omits the contract
   * gets an error naming the fix rather than a confident `capable: false`
   * (which would silently skip the suite) or a confident `capable: true`.
   */
  if (contract === undefined || !Array.isArray(contract.commands)) {
    throw new TypeError(
      'probeShell requires an explicit ShellContract. There is deliberately no default: a probe with no contract is levels 1–4 of this defect, which is how three rounds of "capable" verdicts were wrong. Pass POST_COMMIT_HOOK_CONTRACT, or state a partial contract explicitly and say why in a comment.',
    );
  }

  const key = `capability:${shell}:${JSON.stringify(contract)}`;
  const cached = capabilityCache.get(key);
  if (cached !== undefined) return cached;

  let root: string | undefined;
  let result: ShellCapability = { capable: false, failure: 'the probe could not be run at all' };
  try {
    root = mkdtempSync(join(tmpdir(), 'harness-shell-probe-'));
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });

    /** Plant an executable named `name` that announces itself when it RUNS. */
    const plantShim = (name: string, token: string): void => {
      const path = join(binDir, name);
      writeFileSync(path, `#!/usr/bin/env bash\nprintf "%s\\n" "${token}"\n`);
      chmodSync(path, 0o755);
    };

    // The generic observable: proves the script reached its end at all.
    plantShim('harness-probe-shim', 'CAPABLE');

    const shimmed = contract.commands.filter((c) => c.provider === 'shim');
    for (const command of shimmed) plantShim(command.name, `OK:${command.name}`);

    // The target the git-derived path must find — the stand-in for the hook's
    // `[ -f "$repo_root/harness/cli/bin/harness.js" ]`.
    writeFileSync(join(root, 'probe-target'), '');

    if (contract.gitPathTest) spawnSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

    const lines = ['set -uo pipefail'];

    // (1) Does what the CALLER passed survive into the script? A startup file can
    //     shadow a variable with an export exactly as it shadows a command with a
    //     function — same mechanism, and the hook branches on both.
    for (const guard of contract.envGuards) {
      lines.push(`[ "\${${guard}-}" = "${ENV_SENTINEL}" ] || exit 26`);
    }

    // (2) Ambient commands: resolvable, runnable, and their output capturable.
    for (const command of contract.commands) {
      if (command.provider !== 'ambient') continue;
      lines.push(`probe_out="$('${command.name}' --version 2>/dev/null)" || exit 21`);
      lines.push('[ -n "$probe_out" ] || exit 22');
    }

    // (3) A path GIT produced, through the file test the hook performs on it.
    if (contract.gitPathTest) {
      lines.push('probe_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 23');
      lines.push('[ -n "$probe_root" ] || exit 24');
      lines.push('[ -f "$probe_root/probe-target" ] || exit 25');
    }

    // (4) Shimmed commands, invoked BY NAME and in the hook's argument shape.
    //     Shadowing is NAME-SPECIFIC, so only a shim named `node` can prove that
    //     `node` is unshadowed — a generic probe shim proves nothing about it.
    for (const command of shimmed) {
      // `"$0"` — a real path argument, always defined, mirroring the hook's
      // `node "$bin" telemetry sync` without depending on the git block above.
      lines.push(`${command.name} "$0" probe args`);
    }

    lines.push('harness-probe-shim');

    const script = join(root, 'probe.sh');
    writeFileSync(script, `${lines.join('\n')}\n`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
    };
    for (const guard of contract.envGuards) env[guard] = ENV_SENTINEL;

    const probe = spawnSync(shell, [script], { cwd: root, encoding: 'utf8', env });

    if (probe.error !== undefined) {
      result = {
        capable: false,
        failure: `the shell itself could not be executed (${probe.error.message})`,
      };
    } else if (probe.status !== 0) {
      const named = probe.status === null ? undefined : PROBE_FAILURES[probe.status];
      result = {
        capable: false,
        failure:
          named ??
          `the probe script exited ${String(probe.status)} without reaching its observable`,
      };
    } else {
      // Exit 0 is NOT the answer — every level of this defect exited 0. The
      // observables are: a shadowed command returns success while running
      // nothing, so its token is the only thing separating the two outcomes.
      const shadowed = shimmed.find((c) => !probe.stdout.includes(`OK:${c.name}`));
      if (shadowed !== undefined) {
        result = {
          capable: false,
          failure: `\`${shadowed.name}\` returned SUCCESS without running the executable on PATH — something in this shell shadowed it (a function, alias or builtin from BASH_ENV or an rc file), so a script can invoke it, get exit 0, and observe nothing`,
        };
      } else if (!probe.stdout.includes('CAPABLE')) {
        result = { capable: false, failure: 'the probe script exited 0 without reaching its end' };
      } else {
        result = { capable: true };
      }
    }
  } catch (error) {
    result = { capable: false, failure: `the probe could not be set up (${String(error)})` };
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }

  capabilityCache.set(key, result);
  return result;
}

/** {@link probeShell}, reduced to the boolean a `skipIf` needs. */
export function canRunShellScript(shell: string, contract: ShellContract): boolean {
  return probeShell(shell, contract).capable;
}

/**
 * The reason string for a loud skip. Kept as a function so the wording cannot
 * drift between call sites, and so a reader of the skip output learns what was
 * NOT checked rather than only that something was not run.
 */
export function missingBinaryReason(binary: string, whatIsUnproven: string): string {
  return `SKIPPED — the external binary \`${binary}\` is not on PATH for this host. This case is NOT reimplementable: ${binary} is the SUBJECT of the assertion, not its mechanism, so an in-process substitute would assert something weaker while still passing. What is now unproven on this host: ${whatIsUnproven}`;
}

/**
 * The reason string for a skip caused by an INCAPABLE binary — one that is
 * present, and answers to the right name, and still cannot do the job.
 *
 * Deliberately worded to be distinguishable from {@link missingBinaryReason} at a
 * glance, because the two send a reader to different places: "not installed" is
 * fixed by installing something, whereas "installed and wrong" is fixed by
 * putting a DIFFERENT one earlier on PATH — and being told "not found" about a
 * binary `which` reports is how an hour disappears.
 */
export function incapableBinaryReason(
  binary: string,
  whatItCannotDo: string,
  whatIsUnproven: string,
): string {
  return `SKIPPED — \`${binary}\` IS present on this host but is not CAPABLE of what these cases need: ${whatItCannotDo}. Presence was never the property that mattered, so this is a capability probe, not a \`which\`. This case is NOT reimplementable: ${binary} is the SUBJECT of the assertion, not its mechanism. What is now unproven on this host: ${whatIsUnproven}`;
}
