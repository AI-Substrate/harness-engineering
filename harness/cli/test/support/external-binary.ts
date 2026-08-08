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

/** What a shell probe found, and — when it failed — which property failed. */
export interface ShellCapability {
  capable: boolean;
  /** A human-readable name for the FIRST property that failed. */
  failure?: string;
}

/** Options for {@link probeShell} / {@link canRunShellScript}. */
export interface ShellProbeOptions {
  /**
   * Ambient commands the caller's fixtures need the SHELL to resolve and run —
   * not merely commands this process can see. `git` is the one that matters for
   * the post-commit hook; see {@link probeShell} for why that distinction has now
   * bitten twice.
   */
  requires?: readonly string[];
}

/** Probe exit codes → the property that failed. Kept beside the script below. */
const PROBE_FAILURES: Record<number, string> = {
  21: 'a required command could not be run from inside the shell, or its output could not be captured by command substitution',
  22: 'a required command ran but produced no output, so the shell cannot use its result',
  23: '`git rev-parse --show-toplevel` could not be run from inside the shell',
  24: '`git rev-parse --show-toplevel` produced no path',
  25: 'a path PRODUCED BY GIT did not survive a `[ -f … ]` test in this shell — the exact step at which the tracked hook exits 0 having done nothing',
  127: 'a shimmed executable on the prepended PATH could not be resolved',
};

/**
 * Can `shell` run a script the way this suite's shell-hook fixtures run one?
 * Probed once per process, per (shell, requires) pair (plan 077 · tk-0103).
 *
 * This executes the mechanism instead of asking after the name, because the two
 * answers diverge on real machines — and it now proves EVERY command-resolution
 * property the fixtures reach before their observable assertion, because proving
 * only some of them is how this same defect shipped twice.
 *
 * ## The two levels this has already failed at — both silently
 *
 * **Level 1 (presence).** The guard was `hasBinary('bash')`. On Windows `bash` is
 * `C:\Windows\system32\bash.exe` — WSL bash. It answers `--version`, so the guard
 * passed; it then ate the backslashes in the Windows temp path and exited 127.
 *
 * **Level 2 (partial capability).** The replacement proved native-path execution
 * and shim-on-PATH resolution — and nothing else. But the tracked hook resolves
 * `git` FIRST, and does it like this:
 *
 * ```sh
 * repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
 * bin="$repo_root/harness/cli/bin/harness.js"
 * [ -f "$bin" ] || exit 0
 * node "$bin" telemetry sync …
 * ```
 *
 * Both bail-outs are `exit 0`. So a shell that passes a git-blind probe but
 * cannot resolve `git` — or cannot make a git-PRODUCED path survive `[ -f … ]`,
 * which is exactly what a Windows-shaped `C:/…` path does to WSL bash — runs the
 * hook to a **successful exit that did nothing**. The fixture then fails on the
 * marker, not on the exit code, and the failure looks like a hook defect rather
 * than an unusable shell.
 *
 * That second one is the nastier of the two: level 1 failed loudly with 127,
 * level 2 fails SILENTLY at `exit 0`. A guard that half-answers is the same
 * mistake as a guard that answers the wrong question, and it lives in the fix for
 * the first one.
 *
 * ## What it proves now, in ONE spawn against a real temp git repo
 *
 * 1. **A script at a NATIVE path runs** — WSL bash mangles a Windows path.
 * 2. **Every `requires` command resolves, runs, and its output can be CAPTURED**
 *    through command substitution, from inside the shell.
 * 3. **A path produced BY GIT survives a `[ -f … ]` test** — the hook's own
 *    chain, and the step whose failure is silent.
 * 4. **A shimmed executable on the prepended PATH resolves**, and is the single
 *    observable: nothing prints `CAPABLE` unless every step above succeeded.
 *
 * ## What it deliberately does NOT do: run the hook
 *
 * Running `.githooks/post-commit` itself would make the probe drift-proof, and
 * was rejected: a probe that executes the SUBJECT cannot tell "this environment
 * cannot run it" from "this hook is broken", so a genuine hook defect would be
 * reported as an environment gap and the whole suite would skip itself green.
 * The probe therefore mirrors the hook's MECHANISMS and never its LOGIC — if the
 * hook is broken, the probe passes and the tests correctly fail. The cost of that
 * choice is drift: a new dependency in the hook needs a matching `requires` here.
 * That is a real, accepted liability, recorded rather than papered over.
 *
 * It never throws: any failure is reported as not-capable with the failed step
 * named, which is the honest reading — the probe cannot tell "shell is broken"
 * from "host is unusual", and for skip purposes it need not.
 */
export function probeShell(shell: string, options: ShellProbeOptions = {}): ShellCapability {
  const requires = options.requires ?? [];
  const key = `capability:script:${shell}:${requires.join(',')}`;
  const cached = capabilityCache.get(key);
  if (cached !== undefined) return cached;

  let root: string | undefined;
  let result: ShellCapability = { capable: false, failure: 'the probe could not be run at all' };
  try {
    root = mkdtempSync(join(tmpdir(), 'harness-shell-probe-'));
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });

    // The shim, mirroring what the fixtures place on PATH.
    const shim = join(binDir, 'harness-probe-shim');
    writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s" "CAPABLE"\n');
    chmodSync(shim, 0o755);

    // The target the git-derived path must find — the stand-in for the hook's
    // `[ -f "$repo_root/harness/cli/bin/harness.js" ]`.
    writeFileSync(join(root, 'probe-target'), '');

    const needsGit = requires.includes('git');
    // A real repository, so `rev-parse --show-toplevel` answers about THIS dir
    // and the path it returns is one git itself produced on this platform.
    if (needsGit) spawnSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

    const lines = ['set -uo pipefail'];
    for (const command of requires) {
      lines.push(`probe_out="$('${command}' --version 2>/dev/null)" || exit 21`);
      lines.push('[ -n "$probe_out" ] || exit 22');
    }
    if (needsGit) {
      lines.push('probe_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 23');
      lines.push('[ -n "$probe_root" ] || exit 24');
      lines.push('[ -f "$probe_root/probe-target" ] || exit 25');
    }
    lines.push('harness-probe-shim');

    // The script, invoked by NATIVE path exactly as the fixtures invoke theirs.
    const script = join(root, 'probe.sh');
    writeFileSync(script, `${lines.join('\n')}\n`);

    const probe = spawnSync(shell, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
    });

    if (probe.error !== undefined) {
      result = {
        capable: false,
        failure: `the shell itself could not be executed (${probe.error.message})`,
      };
    } else if (probe.status === 0 && probe.stdout.includes('CAPABLE')) {
      result = { capable: true };
    } else {
      const named = probe.status === null ? undefined : PROBE_FAILURES[probe.status];
      result = {
        capable: false,
        failure:
          named ??
          `the probe script exited ${String(probe.status)} without reaching its observable`,
      };
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
export function canRunShellScript(shell: string, options: ShellProbeOptions = {}): boolean {
  return probeShell(shell, options).capable;
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
