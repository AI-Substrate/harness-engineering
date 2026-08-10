import { describe, expect, it } from 'vitest';
import { FakeGitAttribution } from '../../../../src/adapters/git/fake-git-attribution.js';
import type { CommitWindow } from '../../../../src/adapters/git/git-attribution-port.js';
import { FakeSocketProbe } from '../../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../../src/adapters/net/socket-probe-port.js';
import {
  AT_RISK_CAP,
  AT_RISK_FALLBACK,
  enumerateAtRisk,
} from '../../../../src/services/doctor/collector/at-risk.js';
import { readIngress } from '../../../../src/services/doctor/collector/ingress.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * Plan 074 · ac-0003 — the at-risk list.
 *
 * The two assertions that carry the design: the wording says UNATTRIBUTED and
 * never claims AI authorship, and an EMPTY list under a blocked or unprobeable
 * ingress reports `unproven` rather than `clean`.
 */

const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';
const SHAS = ['c'.repeat(40), 'b'.repeat(40), 'a'.repeat(40)];

async function ingressWith(outcome: ProbeOutcome, socketOnDisk = true) {
  const fs = new FakeCollectorFs();
  if (socketOnDisk) fs.writeText(SOCK, '');
  return readIngress({
    fs,
    probe: new FakeSocketProbe({ [SOCK]: outcome }),
    git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCK}` }),
    env: { get: () => undefined },
  });
}

function windowOf(shas: string[], rule: CommitWindow['rule'] = 'merge-base'): CommitWindow {
  return {
    shas,
    rule,
    detail:
      rule === 'merge-base'
        ? `commits ahead of merge-base(HEAD, origin/main), capped at ${AT_RISK_CAP}`
        : `no upstream merge-base available — the last ${AT_RISK_FALLBACK} commits on HEAD`,
  };
}

describe('plan 074 · ac-0003 — unattributed commits are enumerated, newest first', () => {
  it('lists only the commits with no refs/notes/ai entry, preserving order', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: [SHAS[1] as string] });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(report.status).toBe('unattributed');
    expect(report.commits).toEqual([SHAS[0], SHAS[2]]);
  });

  it('says UNATTRIBUTED and never claims the commits are AI-authored', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(report.detail).toContain('NO refs/notes/ai entry');
    expect(report.detail).toContain('does NOT mean they are AI-authored');
    expect(report.detail.toLowerCase()).not.toContain('written by ai');
    expect(report.detail.toLowerCase()).not.toContain('ai-authored commits');
  });

  it('names which window rule applied — merge-base', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(report.rule).toBe('merge-base');
    expect(report.window).toContain('merge-base(HEAD, origin/main)');
    expect(report.detail).toContain('merge-base');
  });

  it('names which window rule applied — the recent-commit fallback', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS, 'recent-fallback') });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(report.rule).toBe('recent-fallback');
    expect(report.window).toContain(`the last ${AT_RISK_FALLBACK} commits`);
    expect(report.detail).toContain(`last ${AT_RISK_FALLBACK} commits`);
  });

  it('reads the note set in ONE call — the cost never scales with the window', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(git.calls.filter((c) => c === 'listNotedShas')).toHaveLength(1);
    expect(git.calls.filter((c) => c.startsWith('hasAiNote'))).toEqual([]);
  });

  it('asks the port for the ac-0003 bounds — 200 capped, 50 fallback', async () => {
    const git = new FakeGitAttribution({ window: windowOf([]) });
    enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(git.calls).toContain(`commitWindow:${AT_RISK_CAP}:${AT_RISK_FALLBACK}`);
  });

  it('points at the nudge without running it (ac-0007)', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('denied') });

    expect(report.next_action).toContain('harness doctor telemetry-nudge');
  });
});

describe('plan 074 · ac-0003 — empty is not clean', () => {
  it('an empty list under a CONNECTED ingress is clean', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(report.status).toBe('clean');
    expect(report.commits).toEqual([]);
    expect(report.detail).toContain('every commit in this window carries');
  });

  it.each([
    'denied',
    'refused',
    'absent',
    'timeout',
    'error:EPIPE',
  ] as const)('an empty list under a %s ingress is UNPROVEN, never clean', async (outcome) => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const report = enumerateAtRisk({ git, ingress: await ingressWith(outcome) });

    expect(report.status).toBe('unproven');
    expect(report.status).not.toBe('clean');
    expect(report.detail).toContain('UNPROVEN');
    expect(report.next_action).toBeDefined();
  });

  it('an empty list with NO ingress reading at all is unproven', () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const report = enumerateAtRisk({ git });

    expect(report.status).toBe('unproven');
    expect(report.detail).toContain('was not probed on this run');
  });

  it('names WHY nothing could be proven, per blocking cause', async () => {
    const denied = enumerateAtRisk({
      git: new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS }),
      ingress: await ingressWith('denied'),
    });
    const absent = enumerateAtRisk({
      git: new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS }),
      ingress: await ingressWith('absent', false),
    });

    expect(denied.detail).toContain('sandbox is blocking');
    expect(absent.detail).toContain('daemon is not running');
  });

  it('never tells a Windows operator their SOCKET FILE is missing (F006)', () => {
    /*
    Test Doc:
    - Why: before F006 a pipe reading always had `outcome: null` and so was
      described by the kind table. Now it is PROBED, so it reaches the outcome
      arms — which were written when only a socket could get there and said
      "has no socket file", "a stale socket", "blocking the socket connect".
      About a named pipe the first is not imprecise but FALSE: there is no socket
      file for a pipe whether or not the daemon is running. That is plan 075's
      "four wrong statements from one misclassification" arriving through the
      front door instead of the back.
    - Contract: a probed pipe is described in pipe vocabulary, never socket
      vocabulary.
    - Quality Contribution: asserts the ABSENCE of the wrong word as well as the
      presence of the right one — a description that said "named pipe" while
      still mentioning a socket file would pass a presence-only assertion.
    */
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const pipeReading = (outcome: ProbeOutcome) =>
      enumerateAtRisk({
        git,
        ingress: {
          target: { kind: 'named_pipe', path: '\\\\.\\pipe\\git-ai' },
          outcome,
          socketExists: false,
          markers: [],
        },
      }).detail;

    expect(pipeReading('absent')).toContain('has no named pipe');
    expect(pipeReading('denied')).toContain('blocking the named pipe connect');
    expect(pipeReading('refused')).toContain('a stale named pipe');
    for (const outcome of ['absent', 'denied', 'refused'] as const) {
      expect(pipeReading(outcome)).not.toContain('socket');
    }
  });

  it('never sends a Windows operator to the nudge for UNATTRIBUTED commits (F006)', () => {
    /*
    Test Doc:
    - Why: the `unattributed` rung recommends `harness doctor telemetry-nudge`
      unconditionally. Before F006 a pipe reading was never probed, so the
      reading that reaches this rung alongside a pipe target is a CONSEQUENCE of
      making pipes probeable. Replay into a named pipe is still refused (plan 075
      · TRACE2_TARGET_POLICY.named_pipe.replayInto), so the recommendation is a
      command that answers "not supported on this platform" — the same class of
      wrong next action F1 caught one rung down.
    - Contract: with a named-pipe target and a NON-EMPTY unattributed list, the
      nudge is not RECOMMENDED — it is named only to say it is unavailable, the
      same shape health.ts and commit-service already use — and the manual note
      check is named instead. Naming the wrong verb to forbid it beats silence:
      an operator who knows the nudge exists would otherwise try it and get a
      bare refusal with no alternative.
    - Quality Contribution: the sibling test above covers only the EMPTY-list
      description arms; this is the only row that reaches the `unattributed`
      next_action with a pipe. Asserting the absence of the RECOMMENDING form
      ("run `harness doctor telemetry-nudge`") kills a revert to the shared
      string, which asserting the absence of the bare verb name could not do
      without also forbidding the honest denial.
    */
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({
      git,
      ingress: {
        target: { kind: 'named_pipe', path: '\\\\.\\pipe\\git-ai' },
        outcome: 'denied',
        socketExists: false,
        markers: [],
      },
    });

    expect(report.status).toBe('unattributed');
    expect(report.commits).toHaveLength(3);
    expect(report.next_action).not.toContain('run `harness doctor telemetry-nudge`');
    expect(report.next_action).toContain('NOT available');
    expect(report.next_action).toContain('git notes --ref=ai show');
  });

  it('still points an af_unix reading AT the nudge — the split cuts both ways', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('denied') });

    expect(report.status).toBe('unattributed');
    expect(report.next_action).toContain('run `harness doctor telemetry-nudge`');
    expect(report.next_action).not.toContain('NOT available');
  });

  it('keeps SOCKET wording for an af_unix reading — the split cuts both ways', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('absent', false) });
    expect(report.detail).toContain('has no socket');
    expect(report.detail).not.toContain('named pipe');
  });

  it('a FILE target is unproven — events buffer rather than reach the collector', () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS), notes: SHAS });
    const report = enumerateAtRisk({
      git,
      ingress: {
        target: { kind: 'file', path: '/tmp/buf.jsonl' },
        outcome: null,
        socketExists: false,
        markers: [],
      },
    });

    expect(report.status).toBe('unproven');
    expect(report.detail).toContain('/tmp/buf.jsonl');
  });

  it('found commits still report as unattributed even under a blocked ingress', async () => {
    // Presence of evidence beats absence of proof: we SAW unattributed commits.
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    const report = enumerateAtRisk({ git, ingress: await ingressWith('denied') });

    expect(report.status).toBe('unattributed');
    expect(report.commits).toHaveLength(3);
  });
});

describe('plan 074 · ac-0007 — the enumeration is READ-ONLY', () => {
  it('issues no stage, no commit, and no note write', async () => {
    const git = new FakeGitAttribution({ window: windowOf(SHAS) });
    enumerateAtRisk({ git, ingress: await ingressWith('connected') });

    expect(git.commits).toEqual([]);
    expect(git.staged).toEqual([]);
    expect(git.calls.filter((c) => c.startsWith('stage') || c === 'commit')).toEqual([]);
    expect(git.calls).toEqual([`commitWindow:${AT_RISK_CAP}:${AT_RISK_FALLBACK}`, 'listNotedShas']);
  });
});
