import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../../src/adapters/fs/fake-fs.js';
import { FakeGitAttribution } from '../../../../src/adapters/git/fake-git-attribution.js';
import {
  FakeSocketProbe,
  FakeSocketRelay,
} from '../../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../../src/adapters/net/socket-probe-port.js';
import { FakeProcess } from '../../../../src/adapters/process/fake-process.js';
import { readIngress } from '../../../../src/services/doctor/collector/ingress.js';
import {
  commitShasIn,
  type NudgeDeps,
  telemetryNudge,
} from '../../../../src/services/doctor/collector/nudge.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * Plan 074 · ac-0006 — the nudge's SEGMENT LIFECYCLE, driven entirely through a
 * fake socket and a fake filesystem. No daemon, no real socket, no network.
 *
 * The four assertions that carry the design: rotate BEFORE reading (so an
 * appender never races a truncation), replay the WHOLE segment, delete ONLY on
 * full confirmation, and RETAIN a partially-confirmed segment intact with no
 * partial rewrite and no automatic re-replay.
 */

const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';
const REPO = '/repo';
const BUFFER = `${REPO}/.harness/temp/trace2/buffer.jsonl`;
const NOW = '2026-08-07T01:02:03.000Z';
const SEGMENT = `${REPO}/.harness/temp/trace2/segment-2026-08-07T01-02-03-000Z-a.jsonl`;
const SIDECAR = `${BUFFER}.shas`;
const SEGMENT_SIDECAR = `${SEGMENT}.shas`;

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/**
 * A REALISTIC trace2 stream: it names NO commit sha, because git's events never
 * do (verified against a live daemon). Which commits a buffer covers is carried
 * by the sidecar `harness commit` writes — that is the only thing that knows.
 */
function payload(): string {
  return '{"event":"version"}\n{"event":"cmd_name","name":"commit"}\n{"event":"exit"}\n';
}

/** The sidecar `harness commit` writes beside a buffer. */
function sidecarNaming(...shas: string[]): string {
  return `${shas.join('\n')}\n`;
}

async function ingress(outcome: ProbeOutcome, target = `af_unix:stream:${SOCK}`) {
  const cfs = new FakeCollectorFs();
  cfs.writeText(SOCK, '');
  return readIngress({
    fs: cfs,
    probe: new FakeSocketProbe({ [SOCK]: outcome }),
    git: new FakeGitAttribution({ trace2Target: target }),
    env: { get: () => undefined },
  });
}

function deps(over: {
  fs?: FakeFs;
  relay?: FakeSocketRelay;
  git?: FakeGitAttribution;
  ingress: Awaited<ReturnType<typeof ingress>>;
  bufferPath?: string;
}): NudgeDeps & { fs: FakeFs; relay: FakeSocketRelay; git: FakeGitAttribution } {
  const fs = over.fs ?? new FakeFs();
  const relay = over.relay ?? new FakeSocketRelay();
  const git = over.git ?? new FakeGitAttribution();
  return {
    fs,
    relay,
    git,
    proc: new FakeProcess({ node: '/usr/bin/node' }, REPO),
    clock: new FakeClock(NOW),
    ingress: over.ingress,
    // No wall clock in CI: the bounded confirmation settle resolves instantly.
    sleep: () => Promise.resolve(),
    confirmTimeoutMs: 500,
    ...(over.bufferPath !== undefined && { bufferPath: over.bufferPath }),
  };
}

describe('plan 074 · ac-0006 — which commits a segment covers', () => {
  it('a REAL trace2 stream names no commit sha at all — the sidecar carries it', () => {
    // Verified against a live daemon: git emits its events while the commit is
    // still being made, so the sha appears nowhere. Scanning the payload alone
    // would make "every named sha has a note" vacuously true on every segment.
    expect(commitShasIn(payload())).toEqual([]);
    expect(commitShasIn(payload(), sidecarNaming(SHA_A, SHA_B)).sort()).toEqual(
      [SHA_A, SHA_B].sort(),
    );
  });

  it('dedupes across the sidecar and the payload, and ignores non-sha lines', () => {
    const withSha = `{"event":"x","oid":"${SHA_A}"}\n`;
    expect(commitShasIn(withSha, `${SHA_A}\n# a comment\n\n`)).toEqual([SHA_A]);
  });
});

describe('plan 074 · ac-0006 — ROTATE before reading, always', () => {
  it('renames the live buffer to a timestamped segment before replaying', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    await telemetryNudge(d);

    // The live buffer is GONE (a fresh `git` creates a new one), and the rename
    // happened — the appender can never have raced a truncation.
    expect(fs.exists(BUFFER)).toBe(false);
    // The sidecar travels WITH its segment; leaving it behind would attribute
    // this segment's commits to the next one.
    expect(fs.exists(SIDECAR)).toBe(false);
  });

  it('the whole segment is replayed — never a filtered subset', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A, SHA_B));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A, SHA_B] }),
    });

    await telemetryNudge(d);

    expect(d.relay.sends).toHaveLength(1);
    expect(d.relay.sends[0]?.payload).toBe(payload());
    expect(d.relay.sends[0]?.path).toBe(SOCK);
  });
});

describe('plan 074 · ac-0006 — delete ONLY when every named sha is confirmed', () => {
  it('all confirmed → the segment is deleted and counts are honest', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A, SHA_B));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A, SHA_B] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(out.recovered.sort()).toEqual([SHA_A, SHA_B].sort());
    expect(out.stillMissing).toEqual([]);
    expect(out.retained).toEqual([]);
    expect(fs.exists(SEGMENT)).toBe(false);
    expect(fs.exists(SEGMENT_SIDECAR)).toBe(false);
  });

  it('partially confirmed → RETAINED INTACT, byte-identical, never rewritten', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A, SHA_B));
    // Only SHA_A's note lands on replay; SHA_B stays missing.
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.recovered).toEqual([SHA_A]);
    expect(out.stillMissing).toEqual([SHA_B]);
    expect(out.retained).toEqual([
      { path: SEGMENT, stillMissing: [SHA_B], recovered: [SHA_A], reason: 'partial' },
    ]);
    // The retained file is the WHOLE original stream — no partial rewrite.
    expect(fs.readText(SEGMENT)).toBe(payload());
    expect(fs.readText(SEGMENT_SIDECAR)).toBe(sidecarNaming(SHA_A, SHA_B));
    expect(out.detail).toContain('RETAINED INTACT');
    expect(out.detail).toContain('never partially rewritten');
  });

  it('v1 never automatically re-replays a retained segment — it instructs instead', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A, SHA_B));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    // Exactly ONE send. An automatic retry would show a second.
    expect(d.relay.sends).toHaveLength(1);
    expect(out.detail).toContain('does NOT automatically re-replay');
    expect(out.next_action).toContain(`--buffer ${SEGMENT}`);
  });
});

describe('plan 074 · ac-0006 — a segment that names NO commit is never deleted', () => {
  it('retains an unconfirmable segment rather than deleting on a vacuous confirmation', async () => {
    // The defect a live daemon run exposed: git's trace2 stream names no commit
    // sha, so a segment with no `harness commit` sidecar can confirm NOTHING.
    // "Every named sha carries a note" is trivially true of an empty set — and
    // deleting on that is the confident-wrong-answer shape this plan kills.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload()); // no sidecar: not produced by `harness commit`
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.reason).toBe('unconfirmable');
    expect(fs.readText(SEGMENT)).toBe(payload());
    expect(out.detail).toContain('could NOT be confirmed');
    expect(out.detail).toContain('records no commit sha');
    expect(out.next_action).toContain('attribution-at-risk');
    // The replay itself DID happen — the bytes were accepted.
    expect(d.relay.sends).toHaveLength(1);
    expect(out.bytes).toBeGreaterThan(0);
  });

  it('a sidecar whose commits ALREADY had notes is a clean delete', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notes: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(out.detail).toContain('already carried');
    expect(fs.exists(SEGMENT)).toBe(false);
  });
});

describe('plan 074 · ac-0006 — a failed relay costs nothing', () => {
  it('retains the rotated segment intact when the send fails', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      relay: new FakeSocketRelay({ ok: false, outcome: 'denied' }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.reason).toBe('relay-failed');
    expect(fs.readText(SEGMENT)).toBe(payload());
    expect(fs.readText(SEGMENT_SIDECAR)).toBe(sidecarNaming(SHA_A));
    expect(out.detail).toContain('nothing was lost');
  });
});

describe('plan 074 · ac-0006 — graceful no-ops that move and send NOTHING', () => {
  it('no buffer → an honest skip, and it is the HEALTHY shape', async () => {
    const d = deps({ ingress: await ingress('connected') });
    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('no-buffer');
    expect(out.detail).toContain('healthy shape');
    expect(d.relay.sends).toEqual([]);
  });

  it('empty buffer → skip, nothing rotated', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, '   \n');
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.reason).toBe('empty-buffer');
    expect(fs.exists(BUFFER)).toBe(true);
    expect(d.relay.sends).toEqual([]);
  });

  it.each([
    'denied',
    'refused',
    'absent',
    'timeout',
    'error:EPIPE',
  ] as const)('an unreachable ingress (%s) refuses to rotate — the buffer is left intact', async (outcome) => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    const d = deps({ fs, ingress: await ingress(outcome) });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('no-socket');
    // Rotating here would have cost the buffer for nothing.
    expect(fs.readText(BUFFER)).toBe(payload());
    expect(d.relay.sends).toEqual([]);
  });

  it('a non-af_unix target → skip, with the drain instruction', async () => {
    const d = deps({ ingress: await ingress('connected', '/tmp/agent.jsonl') });
    const out = await telemetryNudge(d);

    expect(out.reason).toBe('non-af-unix');
    expect(out.next_action).toContain('--buffer');
    expect(d.relay.sends).toEqual([]);
  });

  it('an unconfigured target → skip, install instruction', async () => {
    const d = deps({ ingress: await ingress('connected', null as unknown as string) });
    const out = await telemetryNudge(d);

    expect(out.reason).toBe('non-af-unix');
    expect(out.next_action).toContain('--install-collector');
    expect(d.relay.sends).toEqual([]);
  });
});

describe('plan 074 · ac-0006 — an explicit --buffer drains a named segment', () => {
  it('replays the named file rather than the default buffer', async () => {
    const fs = new FakeFs();
    const named = `${REPO}/.harness/temp/trace2/segment-old.jsonl`;
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(named, payload());
    fs.writeText(`${named}.shas`, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      bufferPath: named,
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(d.relay.sends[0]?.payload).toBe(payload());
    expect(fs.exists(named)).toBe(false);
  });
});

describe('plan 074 · ac-0006 — confirmation SETTLES, because git-ai writes notes async', () => {
  it('a note that lands a beat after the replay still counts as recovered', async () => {
    // Observed live: judging the instant `send` resolved reported `stillMissing`
    // for a commit whose note appeared ~2s later, needlessly retaining a segment
    // that had in fact been fully recovered.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      // Misses on the first ask, lands on the second — exactly the live race.
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(out.recovered).toEqual([SHA_A]);
    expect(fs.exists(SEGMENT)).toBe(false);
  });

  it('a note that never lands is still reported missing once the budget expires', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.stillMissing).toEqual([SHA_A]);
  });
});
