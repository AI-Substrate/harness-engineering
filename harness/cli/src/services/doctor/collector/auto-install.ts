import { readAutoInstallBlock, writeAutoInstallBlock } from './auto-install-block.js';
import { readCollectorHealth } from './health.js';
import { installCollector, recheckCollector } from './install.js';
import { GITAI_PIN } from './pin.js';
import { mayInstallHooks, readGlobalTrace2 } from './trace2.js';
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
  /**
   * The pinned binary is placed and digest-verified, and it CANNOT RUN here, so
   * the hooks were never attempted (plan 082 · F007 · review round 2, F2).
   *
   * ITS OWN ACTION BECAUSE IT IS NEITHER OF THE TWO IT KEPT COLLAPSING INTO. It
   * is not `failed` — `failed` writes the machine-wide block, and blocking here
   * would force the operator back to `--install-collector` after installing a
   * missing runtime, which is the machine-customisation task plan 077 deleted.
   * And it is not `installed`, which is what it fell through to: a bare doctor
   * announced "harness installed the pinned git-ai collector automatically …
   * no flag required" beside a warning saying the binary cannot run and nothing
   * is being collected. That is the ORIGINAL DEFECT of this plan — a claim about
   * bytes standing where a claim about behaviour was needed — recreated one
   * layer up, in prose.
   */
  | 'skipped-binary-unusable'
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

/**
 * The sentence the latch made a lie, and the reason it is a named constant.
 *
 * Whatever the refusal says next, it has to name a command that WORKS FROM
 * WHERE THE OPERATOR IS STANDING. Before the unlatch fix the message said "run
 * `git-ai install-hooks`" and nothing else — so the one action our own advice
 * led to (remove the trace2 section, re-run doctor) produced the identical
 * refusal, and the only command that would have recovered was never mentioned.
 *
 * Both routes named here are MEASURED, not assumed: a bare `harness doctor`
 * re-reads the live config on the branch above, and `--install-collector` goes
 * through `installCollector`, which always reaches `installHooks`.
 * `--recheck-collector` is deliberately NOT named — it returns early when no new
 * agent is detected, which is exactly the state of an operator who changed only
 * their trace2 config.
 */
const UNLATCH_HINT =
  'Once you clear that section yourself, a plain `harness doctor` picks it up on the next run — it re-reads the live git config every time, so this refusal will not outlive its cause. `harness doctor --install-collector` forces the same thing immediately.';

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

    case 'cli-only-trace2': {
      // THE ONE WARN CASE. A pre-existing global trace2 config is a real user
      // setting that `git-ai install-hooks` deletes machine-wide.
      //
      // AND THE ONE THAT MUST NOT LATCH. `readCollectorHealth` is synchronous,
      // so this verdict is derived from the RECORDED outcome of the last
      // attempt, never from the live git config. Refusing on the record alone —
      // which is what this branch used to do, deliberately, to avoid rewriting
      // the attempt record on every doctor run — made the refusal
      // SELF-SUSTAINING: an operator who did exactly what our own `next_action`
      // told them (back up the trace2 keys, remove the section) re-ran
      // `harness doctor` and was told, again, that the config they had just
      // deleted was present. The documented remedy was unreachable through the
      // documented command. Found by pij-exuberant-skaffen on a real macOS run,
      // 2026-08-09; a guard that cannot stop refusing is as broken as one that
      // cannot start.
      //
      // So the guard re-reads its OWN PRECONDITION before trusting the record.
      // One `git config --global --get-regexp '^trace2\.'` — read-only, cheap,
      // and the identical call `installHooks` is about to make anyway. The
      // write-amplification argument still holds where it was actually true:
      // while trace2 is genuinely present, the refusal below still writes
      // nothing at all.
      const live = await readGlobalTrace2({ exec: deps.exec, cwd: deps.cwd }, deps.clock.nowIso());
      if (!mayInstallHooks(live)) {
        // Fail-closed on `unknown` too, via the same predicate `installHooks`
        // uses: a guard that cannot read the thing it is guarding must not clear.
        return {
          action: 'skipped-guard',
          detail: `git-ai hooks were NOT installed automatically: ${live.detail}. Harness will not do that to a setting it did not make. ${UNLATCH_HINT}`,
          warnings: [],
        };
      }
      // THE PRECONDITION IS GONE, so the refusal goes with it.
      //
      // Through `installCollector` (`runLifecycle('installed')`), NOT
      // `recheckCollector`: the re-check returns early when no NEW agent is
      // detected (`install.ts` recheckCollector, and `acts/doctor.ts` is its only
      // caller besides this one), which is exactly the shape of an operator who
      // changed nothing but their trace2 config. Routing here through the
      // re-check would have silently done nothing and reported success.
      return runLifecycle(deps, 'installed');
    }

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
    if (result.hooks === 'binary-unusable') return binaryUnusable('recheck', result.warnings);
    if (HOOK_STAGE_FAILURES.has(result.hooks)) {
      // Same unbounded-repeat hazard as the install path below, reached from the
      // other direction: a re-check that fails leaves a `degraded`/`incomplete`
      // reading, which routes straight back here on the next bare doctor.
      return recordAndReport(deps, `the hook re-check reported ${result.hooks}`, result.warnings);
    }
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
    return recordAndReport(
      deps,
      `the pinned git-ai binary could not be installed — ${detail}`,
      result.warnings.slice(1),
    );
  }
  if (result.hooks === 'binary-unusable') return binaryUnusable('install', result.warnings);
  if (HOOK_STAGE_FAILURES.has(result.hooks)) {
    // P1-A (cross-model review, pij-assistant-asp / gpt-5.6-terra, 2026-08-09).
    //
    // THE DEFECT: only a failed CLI stage was recorded. A run where the CLI
    // succeeded and the HOOK stage came back `failed` or `unverified` returned
    // `action: 'installed'`, wrote no block, and left a `degraded` reading — so
    // the next bare doctor re-entered here and ran `install-hooks` again.
    // Unbounded, and destructive on every repeat: `install-hooks` rewrites every
    // detected agent's config in place, discarding JSONC comments each time.
    //
    // It also made a printed sentence FALSE. The cli-failed path says "this will
    // NOT be retried on every run" — true there, and the exact opposite of what
    // this path did. Two of the three facts in that message were about a branch
    // the operator was not on.
    //
    // The guard refusals are deliberately NOT here. `skipped-trace2` and
    // `skipped-skills` are recoverable by an operator action, and the unlatch
    // above depends on re-attempting them on every run — blocking those would
    // reintroduce the latch through a second door.
    return recordAndReport(
      deps,
      `the pinned git-ai CLI is installed, but the hook install reported ${result.hooks} — no AI attribution is being collected`,
      result.warnings,
    );
  }
  return {
    action: 'installed',
    detail: `harness installed the pinned git-ai collector automatically (cli: ${result.cli}, hooks: ${result.hooks}) — no flag required`,
    warnings: result.warnings,
  };
}

/**
 * Hook-stage outcomes that must STOP the automatic retry loop.
 *
 * `failed` and `unverified` mean the vendor command ran (or tried to) and did
 * not achieve hooks; `not-attempted` means a precondition of OURS refused to let
 * it run at all. All three leave a reading that routes straight back into
 * `runLifecycle` on the next bare doctor, so all three need a record.
 *
 * The guard refusals — `skipped-trace2`, `skipped-skills` — are deliberately
 * absent, and their absence is load-bearing: they are recoverable by an operator
 * action, and the unlatch depends on re-attempting them on every run.
 */
const HOOK_STAGE_FAILURES: ReadonlySet<string> = new Set(['failed', 'unverified', 'not-attempted']);

/**
 * THE GUARD REFUSAL, ANNOUNCED AS ONE — not as a failure, and not as an install
 * (plan 082 · F007 · review round 2, F2).
 *
 * TWO DOORS, TWO TRUTHS, and that is why this takes a `door` rather than
 * printing one sentence. On a first install nothing is hooked and nothing is
 * being collected. On a RE-CHECK the hooks that are already on are still on and
 * still collecting — a probe that refused to invoke the vendor command changed
 * nothing — and saying "no AI attribution is being collected" there would be
 * false in exactly the way this plan exists to stop.
 *
 * WHAT IS SHARED is the half that justifies never latching: the operator is told
 * this fixes itself. `--install-collector` is deliberately not named, because
 * needing it would be the machine-customisation task plan 077 deleted.
 */
function binaryUnusable(door: 'install' | 'recheck', warnings: string[]): AutoInstallOutcome {
  const detail =
    door === 'install'
      ? 'the pinned git-ai CLI is installed and its digest matches, but the binary could NOT be run on this machine, so no hooks were installed and no AI attribution is being collected. Nothing on your machine was changed and nothing needs undoing — read the cause below, and once the binary runs the next ordinary `harness doctor` installs the hooks itself, with no flag and no re-run by hand.'
      : 'a newly-detected coding harness was NOT hooked: the pinned git-ai binary could NOT be run on this machine, so nothing was invoked. The hooks already installed are unaffected and still collecting — read the cause below, and once the binary runs the next ordinary `harness doctor` covers the new harness itself, with no flag and no re-run by hand.';
  return { action: 'skipped-binary-unusable', detail, warnings };
}

/**
 * Record the failure MACHINE-WIDE, then report it — the single place that pairs
 * those two, so no failure branch can write one without the other.
 *
 * `--install-collector` clears this record on its way in, which is what makes it
 * the retry: the operator asks, explicitly, at a moment of their choosing.
 */
function recordAndReport(
  deps: CollectorDeps,
  cause: string,
  warnings: string[],
): AutoInstallOutcome {
  writeAutoInstallBlock(
    deps.fs,
    deps.host,
    deps.clock,
    cause,
    (deps.manifest ?? GITAI_PIN).version,
  );
  return {
    action: 'failed',
    detail: `the automatic git-ai setup did not complete — ${cause}. Doctor continued and nothing else is affected; this will NOT be retried on every run. Retry with \`harness doctor --install-collector\`, or install git-ai from https://github.com/git-ai-tools/git-ai.`,
    warnings,
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
