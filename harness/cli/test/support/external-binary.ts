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

/**
 * Can `shell` actually run a script the way this suite runs one? Probed once per
 * process (plan 077 · tk-0103).
 *
 * This executes the mechanism instead of asking after the name, because the two
 * answers diverge on real machines. It asserts BOTH properties the shell-script
 * fixtures in this suite depend on, and a shell that fails either is unusable
 * here however confidently `which` reports it:
 *
 * 1. **A script at a NATIVE path runs.** The fixtures build paths with
 *    `path.join()` under `os.tmpdir()`. WSL `bash` — which is what `bash`
 *    resolves to on a stock Windows box — is a LINUX binary handed a Windows
 *    path; it eats the backslashes as escapes and exits 127.
 * 2. **A shimmed executable on PATH resolves.** The fixtures put a fake `node`
 *    on PATH so "did it run?" is an observable file rather than an inference.
 *    That needs the platform's `path.delimiter` to mean something to the shell,
 *    and an interpreter that honours a shebang on the shimmed file — neither of
 *    which follows from the shell merely existing (`which node` inside that same
 *    WSL bash also fails).
 *
 * Both are proven in ONE spawn against a real temp tree, so the probe cannot
 * drift from the thing it certifies. It never throws: any failure at all is
 * reported as "not capable", which is the honest reading — the probe cannot tell
 * "shell is broken" from "host is unusual", and for skip purposes it does not
 * need to.
 */
export function canRunShellScript(shell: string): boolean {
  const key = `capability:script:${shell}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let root: string | undefined;
  let capable = false;
  try {
    root = mkdtempSync(join(tmpdir(), 'harness-shell-probe-'));
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });

    // The shim, mirroring what the fixtures place on PATH.
    const shim = join(binDir, 'harness-probe-shim');
    writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s" "CAPABLE"\n');
    chmodSync(shim, 0o755);

    // The script, invoked by NATIVE path exactly as the fixtures invoke theirs.
    const script = join(root, 'probe.sh');
    writeFileSync(script, 'harness-probe-shim\n');

    const probe = spawnSync(shell, [script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
    });
    capable = probe.error === undefined && probe.status === 0 && probe.stdout.includes('CAPABLE');
  } catch {
    capable = false;
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }

  cache.set(key, capable);
  return capable;
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
