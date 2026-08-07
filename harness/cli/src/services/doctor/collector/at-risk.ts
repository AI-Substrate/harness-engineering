import type {
  CommitWindowRule,
  GitAttributionPort,
} from '../../../adapters/git/git-attribution-port.js';
import { type IngressReading, ingressProves, trace2Policy, trace2TargetPath } from './ingress.js';

/**
 * AT-RISK ENUMERATION (plan 074 · ac-0003) — the honest answer to "did anything
 * already slip through?".
 *
 * Every word here is chosen against one failure mode. A commit with no
 * `refs/notes/ai` entry is **unattributed**: harness has no record of who wrote
 * it. That is ALL this says. It never claims the commit is AI-authored, because
 * it cannot know that and because the claim would be defamatory-by-tooling on
 * every ordinary human commit made before git-ai was installed.
 *
 * The second discipline is that **empty is not clean**. If the ingress cannot be
 * reached — or was never probed — then the absence of unattributed commits
 * proves nothing at all, and the list reports `unproven`. That is the same
 * doctrine the 073 health read already runs on (absent is not green, empty is
 * not clean), applied to a new question.
 */

/** The bounds ac-0003 fixes. Data, so the wording and the behaviour cannot drift. */
export const AT_RISK_CAP = 200;
export const AT_RISK_FALLBACK = 50;

/**
 * `clean` — a reachable ingress and no unattributed commits in the window.
 * `unattributed` — commits with no note were found.
 * `unproven` — nothing was found, but nothing could be proven either: the
 *   ingress is blocked or was never probed, so an empty list is an absence of
 *   evidence rather than evidence of absence.
 */
export type AtRiskStatus = 'clean' | 'unattributed' | 'unproven';

export interface AtRiskReport {
  status: AtRiskStatus;
  /** Unattributed commit shas, NEWEST FIRST. */
  commits: string[];
  /** Which window rule bounded the search — named in the output, never implied. */
  rule: CommitWindowRule;
  /** Human phrasing of the window that was applied. */
  window: string;
  detail: string;
  /** Present on every non-clean status. Names the recovery command; never runs it. */
  next_action?: string;
}

export interface AtRiskDeps {
  git: Pick<GitAttributionPort, 'commitWindow' | 'listNotedShas'>;
  /** The ingress reading, when one was taken. Absent → nothing can be proven. */
  ingress?: IngressReading;
  cap?: number;
  fallback?: number;
}

/**
 * Enumerate unattributed commits in a bounded window.
 *
 * READ-ONLY (ac-0007): it walks a commit list and asks which shas carry a note.
 * It writes nothing, replays nothing, and touches no socket — which is what lets
 * doctor and checks call it on every run. The note set is read in ONE call, so
 * the cost does not scale with the window.
 */
export function enumerateAtRisk(deps: AtRiskDeps): AtRiskReport {
  const cap = deps.cap ?? AT_RISK_CAP;
  const fallback = deps.fallback ?? AT_RISK_FALLBACK;
  const window = deps.git.commitWindow(cap, fallback);
  const noted = new Set(deps.git.listNotedShas());
  const commits = window.shas.filter((sha) => !noted.has(sha));
  const proven = deps.ingress !== undefined && ingressProves(deps.ingress);

  if (commits.length > 0) {
    return {
      status: 'unattributed',
      commits,
      rule: window.rule,
      window: window.detail,
      detail: `${commits.length} commit(s) in this window carry NO refs/notes/ai entry — harness has no record of who wrote them (this does NOT mean they are AI-authored; it means their authorship was never recorded). Window: ${window.detail}. Newest first: ${commits
        .slice(0, 5)
        .map((sha) => sha.slice(0, 8))
        .join(', ')}${commits.length > 5 ? ', …' : ''}`,
      next_action:
        'If those commits were made through a blocked ingress, run `harness doctor telemetry-nudge` from an UNSANDBOXED shell to replay any buffered trace2 events. Commits made before git-ai was installed will never gain a note and are expected here.',
    };
  }

  if (!proven) {
    // The whole reason this rung exists. A blocked probe means git silently
    // disabled trace2, so an empty list is exactly what a totally broken
    // collector also produces. Reporting it as `clean` would be the same class
    // of confident wrong answer the plan exists to kill.
    return {
      status: 'unproven',
      commits: [],
      rule: window.rule,
      window: window.detail,
      detail: `no unattributed commits found in this window, but that is UNPROVEN: the collector ingress ${describeIngress(deps.ingress)}, so an empty list cannot be distinguished from a collector that saw nothing. Window: ${window.detail}`,
      next_action:
        'Restore a reachable ingress (an unsandboxed shell, or a running git-ai daemon) and re-run `harness doctor` before treating this as clean.',
    };
  }

  return {
    status: 'clean',
    commits: [],
    rule: window.rule,
    window: window.detail,
    detail: `every commit in this window carries a refs/notes/ai entry. Window: ${window.detail}`,
  };
}

/** Why nothing could be proven, in operator language. */
function describeIngress(ingress: IngressReading | undefined): string {
  if (ingress === undefined) return 'was not probed on this run';
  // The kind table owns the non-socket descriptions, so a new target kind
  // cannot arrive here and be described by the probe fallback below — which
  // would report "could not be probed" about something that was never probeable
  // (that is how a named pipe used to read).
  if (ingress.target.kind !== 'af_unix') {
    return trace2Policy(ingress.target).describe(trace2TargetPath(ingress.target) ?? '');
  }
  switch (ingress.outcome) {
    case 'denied':
      return 'was DENIED — a sandbox is blocking the socket connect';
    case 'refused':
      return 'refused the connection — a stale socket with nothing listening';
    case 'absent':
      return 'has no socket file — the daemon is not running';
    case 'timeout':
      return 'did not answer within the probe timeout';
    default:
      return `could not be probed (${ingress.outcome ?? 'not probed'})`;
  }
}
