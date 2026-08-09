import { readAutoInstallBlock, writeAutoInstallBlock } from './auto-install-block.js';
import { readCollectorHealth } from './health.js';
import { installCollector, recheckCollector } from './install.js';
import { GITAI_PIN } from './pin.js';
import type { CollectorDeps } from './types.js';

/**
 * Auto-install the collector from a BARE `harness doctor` (plan 077 · packet §3a).
 *
 * THE REQUIREMENT: the customer must have telemetry working without customising
 * their machine. Until now doctor reported the collector missing and told the
 * operator to re-run with `--install-collector` — which is a machine
 * customisation task by another name, just one with an apologetic tone. So
 * doctor now does it, and says what it did.
 *
 * WHAT "READ-ONLY" STILL MEANS, because the codebase asserts it in two places
 * and it must not now be quietly false. Plan 074 · ac-0007 is about the
 * RECOVERY path: no bare doctor or checks run ever mutates a SOCKET, a BUFFER,
 * or a REF. That is untouched and still enforced by construction — doctor is
 * handed the probe port and never the relay, so it structurally cannot replay a
 * buffered event or write a note. What a bare doctor MAY now do is place the
 * pinned CLI and install hooks. Diagnosis is still side-effect free with respect
 * to your git history; it is no longer side-effect free with respect to your
 * machine's telemetry setup, and that is the deliberate change.
 *
 * AND WHY THAT IS NOT A CONTRADICTION OF THE REQUIREMENT IT SERVES: the thing
 * being eliminated is the CUSTOMER PERFORMING the customisations, not the
 * customisations. Harness does them once, on their behalf, from a pinned and
 * digest-verified artifact, having first copied the only files the vendor
 * command destroys — instead of handing a developer a destructive command and a
 * warning and calling that consent.
 *
 * FAIL-SAFE IS THE HARD REQUIREMENT (§3c). This now runs on EVERY doctor
 * invocation, so it is the one place where an unhandled throw would break a
 * command nobody opted into. Everything is caught; every outcome is a report;
 * the caller is never given a reason to exit non-zero.
 */

export type AutoInstallAction =
  | 'not-needed'
  | 'installed'
  | 'rechecked'
  | 'skipped-guard'
  | 'skipped-opt-out'
  | 'skipped-unsupported'
  | 'skipped-blocked'
  | 'failed';

/**
 * The dedicated opt-out. `=1` means harness installs NOTHING: no download, no
 * hooks, no agent config rewritten.
 *
 * ITS OWN SWITCH, deliberately NOT folded into `HARNESS_NO_TELEMETRY`, because
 * the two express DIFFERENT CONSENTS:
 *
 *   HARNESS_NO_TELEMETRY  — harness does not CAPTURE. It is the kill switch on
 *                           our own collection (`capture-gate.ts` KILL_SWITCH_ENV).
 *   HARNESS_NO_COLLECTOR  — harness does not INSTALL SOMEONE ELSE'S SOFTWARE on
 *                           your machine.
 *
 * A developer may perfectly reasonably want the second without the first, and
 * aliasing them would silently deny that. Named to match the established
 * opt-out shape (`HARNESS_NO_EXTENSIONS`, `HARNESS_NO_TELEMETRY_AUTOSYNC`).
 *
 * When set, doctor STILL REPORTS the collector row, and reports it as skipped by
 * explicit opt-out — never as `could-not-determine`. An opt-out that makes a
 * deliberate choice indistinguishable from a broken machine is the same defect
 * class as a gate that never opened the file.
 */
export const COLLECTOR_OPT_OUT_ENV = 'HARNESS_NO_COLLECTOR';

export interface AutoInstallOutcome {
  action: AutoInstallAction;
  /** One operator line. Empty only when nothing happened and nothing needed to. */
  detail: string;
  /** Non-blocking lines from the lifecycle — never a reason to fail a run. */
  warnings: string[];
}

/**
 * A failed automatic install is recorded MACHINE-WIDE and not retried.
 *
 * There is no timer here on purpose. The fact is about the machine (git-ai
 * absent, download failed), so a repo-local note would give a developer with ten
 * repos ten failed downloads for one broken network. And `--install-collector`
 * IS the retry, which is why that flag keeps its job now that installing is
 * automatic: the operator asks, explicitly, at a moment of their choosing.
 */
export async function autoInstallCollector(
  deps: CollectorDeps,
  /**
   * Read by the COMPOSITION ROOT and passed in (P2) — the service never reaches
   * for a global. `true` when `HARNESS_NO_COLLECTOR=1`.
   */
  optedOut = false,
): Promise<AutoInstallOutcome> {
  if (optedOut) {
    return {
      action: 'skipped-opt-out',
      detail: `no automatic git-ai install: ${COLLECTOR_OPT_OUT_ENV}=1 is set, so harness installed nothing and touched no agent config. Attribution is NOT being collected by harness's doing. Unset it, or run \`harness doctor --install-collector\` once, to change that.`,
      warnings: [],
    };
  }
  try {
    return await decide(deps);
  } catch (err) {
    // The whole point of this function. An auto-install that throws would take
    // down a diagnostic the developer ran for an unrelated reason.
    return {
      action: 'failed',
      detail: `the automatic git-ai install could not run: ${message(err)} — doctor continued and every other check is unaffected`,
      warnings: [],
    };
  }
}

async function decide(deps: CollectorDeps): Promise<AutoInstallOutcome> {
  const health = readCollectorHealth({
    fs: deps.fs,
    host: deps.host,
    cwd: deps.cwd,
    hash: deps.hash,
    ...(deps.manifest !== undefined ? { manifest: deps.manifest } : {}),
  });

  switch (health.verdict) {
    case 'healthy':
    case 'ingress-blocked':
      // `ingress-blocked` means installed and hooked up; the blockage is a
      // sandbox, and reinstalling cannot open a socket.
      return quiet();

    case 'cli-only-trace2':
      // THE ONE WARN CASE. A pre-existing global trace2 config is a real user
      // setting that `git-ai install-hooks` deletes machine-wide. The guard
      // inside `installHooks` would refuse anyway — not attempting means we also
      // do not rewrite the attempt record on every single doctor run.
      return {
        action: 'skipped-guard',
        detail:
          'git-ai hooks were NOT installed automatically: a global git `trace2` config is already present, and `git-ai install-hooks` deletes that whole section machine-wide. Harness will not do that to a setting it did not make.',
        warnings: [],
      };

    case 'cli-only-skills':
      return {
        action: 'skipped-guard',
        detail: `git-ai hooks were NOT installed automatically: ${health.detail}. Harness will not delete content it did not create.`,
        warnings: [],
      };

    case 'not-installed':
      // Unsupported platform is a `not-installed` too, and it is the one that
      // must never retry: there is no artifact to fetch, on any run, ever.
      if (
        health.binary.digest === 'unknown' &&
        !health.binary.present &&
        isUnsupported(health.detail)
      ) {
        return {
          action: 'skipped-unsupported',
          detail: health.detail,
          warnings: [],
        };
      }
      return runLifecycle(deps, 'installed');

    case 'could-not-determine':
      // §4's rung: a binary with no harness record. This is precisely the state
      // auto-install exists to resolve, so it self-heals rather than telling the
      // operator to run the command we could have run.
      return runLifecycle(deps, 'installed');

    case 'degraded':
      // Covers a digest mismatch (restore the pinned artifact) and a failed or
      // unverified hook install (retry it) — both are re-runnable.
      return runLifecycle(deps, 'installed');

    case 'hooks-incomplete':
      return runLifecycle(deps, 'rechecked');

    default:
      return quiet();
  }
}

async function runLifecycle(
  deps: CollectorDeps,
  action: 'installed' | 'rechecked',
): Promise<AutoInstallOutcome> {
  const blocked = readAutoInstallBlock(deps.fs, deps.host);
  if (blocked !== null) {
    return {
      action: 'skipped-blocked',
      detail: `the automatic git-ai install failed at ${blocked.at} and is NOT retried automatically (${blocked.detail}). Run \`harness doctor --install-collector\` to retry it, or install git-ai yourself from https://github.com/git-ai-tools/git-ai and re-run doctor.`,
      warnings: [],
    };
  }

  if (action === 'rechecked') {
    const result = await recheckCollector(deps);
    return {
      action: 'rechecked',
      detail: `harness re-ran the git-ai hook install to cover a newly-detected coding harness (hooks: ${result.hooks})`,
      warnings: result.warnings,
    };
  }

  const result = await installCollector(deps);
  if (result.cli === 'failed') {
    const detail = result.warnings[0] ?? 'no detail';
    // Record MACHINE-WIDE and stop. Note what this does NOT touch: hook coverage
    // state, which is a fact about the machine and survives a failed attempt
    // intact. Conflating the two once made doctor report that nothing was being
    // collected while the hooks were live.
    writeAutoInstallBlock(
      deps.fs,
      deps.host,
      deps.clock,
      detail,
      (deps.manifest ?? GITAI_PIN).version,
    );
    return {
      action: 'failed',
      detail: `the pinned git-ai binary could not be installed automatically — ${detail}. Doctor continued and nothing else is affected; this will NOT be retried on every run. Retry with \`harness doctor --install-collector\`, or install git-ai from https://github.com/git-ai-tools/git-ai.`,
      warnings: result.warnings.slice(1),
    };
  }
  return {
    action: 'installed',
    detail: `harness installed the pinned git-ai collector automatically (cli: ${result.cli}, hooks: ${result.hooks}) — no flag required`,
    warnings: result.warnings,
  };
}

function isUnsupported(detail: string): boolean {
  return detail.includes('publishes no');
}

function quiet(): AutoInstallOutcome {
  return { action: 'not-needed', detail: '', warnings: [] };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
