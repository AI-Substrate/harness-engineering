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
import { type CommitDeps, harnessCommit } from '../../../../src/services/commit/commit-service.js';
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
const SEGMENT_NAME = 'segment-2026-08-07T01-02-03-000Z-a.jsonl';
const SEGMENT = `${REPO}/.harness/temp/trace2/${SEGMENT_NAME}`;
const SIDECAR = `${BUFFER}.shas`;
const SEGMENT_SIDECAR = `${SEGMENT}.shas`;

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
/** An unrelated historical commit, named only in a commit MESSAGE. */
const FOREIGN_SHA = 'f'.repeat(40);

/**
 * A REALISTIC trace2 stream: it names NO commit sha, because git's events never
 * do (verified against a live daemon). Which commits a buffer covers is carried
 * by the sidecar `harness commit` writes — that is the only thing that knows.
 */
function payload(): string {
  return '{"event":"version"}\n{"event":"cmd_name","name":"commit"}\n{"event":"exit"}\n';
}

/**
 * The same stream with git's own ARGV in it — the shape that broke the old
 * payload scan. `git commit -m "Revert <sha>"` is an ordinary thing to do.
 */
function poisonedPayload(foreign: string): string {
  return `{"event":"start","argv":["git","commit","-m","Revert \\"fix\\"\\n\\nThis reverts commit ${foreign}."]}\n{"event":"cmd_name","name":"commit"}\n{"event":"exit"}\n`;
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
  it('the SIDECAR is the sole identity source — a payload is never scanned', () => {
    // Verified against a live daemon: git emits its events while the commit is
    // still being made, so the sha appears nowhere in the stream.
    expect(commitShasIn(null)).toEqual([]);
    expect(commitShasIn(sidecarNaming(SHA_A, SHA_B)).sort()).toEqual([SHA_A, SHA_B].sort());
  });

  it('dedupes and ignores non-sha lines', () => {
    expect(commitShasIn(`${SHA_A}\n# a comment\n\n${SHA_A}\n`)).toEqual([SHA_A]);
  });

  it('F001 — a REVERT message in the trace2 argv never enrols a foreign commit', async () => {
    // The review's F001: the trace2 `start` event carries git's own argv, so
    // `git commit -m "Revert <sha>"` used to inject an UNRELATED historical
    // commit into the confirmation set. That commit has no AI note (nothing
    // pre-git-ai ever will), so the segment could never fully confirm — retained
    // forever, and an innocent commit reported as missing attribution.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, poisonedPayload(FOREIGN_SHA));
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      // Only the sidecar's own commit gains a note. The foreign sha never will.
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    // Fully confirmed on the sidecar alone → deleted, and the foreign sha is
    // absent from every field. Pre-fix this was `retained`/`stillMissing`.
    expect(out.status).toBe('replayed');
    expect(out.recovered).toEqual([SHA_A]);
    expect(out.stillMissing).toEqual([]);
    expect(out.retained).toEqual([]);
    expect(fs.exists(SEGMENT)).toBe(false);
    expect(d.git.calls.some((c) => c.includes(FOREIGN_SHA))).toBe(false);
  });

  it('F001 — a segment with NO sidecar is unconfirmable even when its payload is full of shas', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, poisonedPayload(FOREIGN_SHA));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.reason).toBe('unconfirmable');
    expect(out.stillMissing).toEqual([]);
    expect(fs.readText(SEGMENT)).toBe(poisonedPayload(FOREIGN_SHA));
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
      {
        path: SEGMENT,
        stillMissing: [SHA_B],
        recovered: [SHA_A],
        handedOff: [],
        reason: 'partial',
      },
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

  it('a non-af_unix target → skip, and the guidance names the RECONFIGURATION FIRST', async () => {
    const d = deps({ ingress: await ingress('connected', '/tmp/agent.jsonl') });
    const out = await telemetryNudge(d);

    expect(out.reason).toBe('non-af-unix');
    // F003: the old text named `--buffer <target>` as if it would just work.
    // It cannot — this very verb rejects a non-af_unix ingress before it ever
    // reads `--buffer` — so the prerequisite has to come first, in order.
    expect(out.next_action).toContain('FIRST');
    expect(out.next_action).toContain('--install-collector');
    const first = out.next_action?.indexOf('--install-collector') ?? -1;
    const then = out.next_action?.indexOf('--buffer') ?? -1;
    expect(first).toBeGreaterThanOrEqual(0);
    expect(then).toBeGreaterThan(first);
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

describe('plan 074 · ac-0006 — F002: EVERY remaining segment is enumerated, every run', () => {
  const OLD_NAME = 'segment-2026-08-01T00-00-00-000Z-a.jsonl';
  const OLD = `${REPO}/.harness/temp/trace2/${OLD_NAME}`;

  /** A trace2 dir whose LISTING already contains an earlier run's segment. */
  function fsWithOldSegment(): FakeFs {
    const fs = new FakeFs({}, { [`${REPO}/.harness/temp/trace2`]: [OLD_NAME] });
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    return fs;
  }

  it('a run with no live buffer is NOT healthy while an earlier segment remains', async () => {
    // The review's F002: the only `retained` value used to be the segment the
    // current run rotated, so a later nudge said "no buffer — this is the
    // healthy shape" while unrecovered commits sat in a file beside it.
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarNaming(SHA_B));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.retained).toEqual([
      { path: OLD, stillMissing: [SHA_B], recovered: [], handedOff: [], reason: 'partial' },
    ]);
    expect(out.next_action).toContain(`--buffer ${OLD}`);
    // Nothing was replayed, and the old segment is untouched.
    expect(d.relay.sends).toEqual([]);
    expect(fs.readText(OLD)).toBe(payload());
  });

  it('this run’s success does not hide an earlier segment', async () => {
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarNaming(SHA_B));
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    // This run fully confirmed and deleted its own segment…
    expect(fs.exists(SEGMENT)).toBe(false);
    expect(out.recovered).toEqual([SHA_A]);
    // …but the machine is NOT clean, so the status says so.
    expect(out.status).toBe('retained');
    expect(out.retained.map((r) => r.path)).toEqual([OLD]);
    expect(out.detail).toContain('earlier segment(s) are ALSO still on disk');
    expect(out.next_action).toContain(`--buffer ${OLD}`);
  });

  it('a segment with no sidecar enumerates as unconfirmable, not as clean', async () => {
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.retained).toEqual([
      { path: OLD, stillMissing: [], recovered: [], handedOff: [], reason: 'unconfirmable' },
    ]);
  });

  it('a truly clean directory still reports the healthy no-buffer shape', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('no-buffer');
    expect(out.retained).toEqual([]);
  });
});

describe('plan 074 · ac-0006 — F005: --buffer is RESOLVED, CONTAINED, and never throws', () => {
  it('a RELATIVE --buffer resolves against the repo instead of building a nonsense sibling', async () => {
    // Pre-fix: `lastIndexOf('/')` on a bare filename is -1, so the segment path
    // became `buffer.json` (sliced!) and the rename threw out of a verb whose
    // whole contract is that it never does.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      bufferPath: '.harness/temp/trace2/buffer.jsonl',
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(out.segment).toBe(SEGMENT);
    expect(fs.exists(BUFFER)).toBe(false);
  });

  it('an absolute --buffer OUTSIDE the repo is refused — nothing is renamed or deleted', async () => {
    const fs = new FakeFs();
    fs.writeText('/etc/passwd', 'root:x:0:0\n');
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      bufferPath: '/etc/passwd',
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('buffer-refused');
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
    expect(fs.readText('/etc/passwd')).toBe('root:x:0:0\n');
    expect(d.relay.sends).toEqual([]);
  });

  it('a --buffer beside the configured trace2 FILE target passes containment', async () => {
    // The ac-0005 file branch's drain names a path outside the repo. Containment
    // must allow the directory the operator's own git config points at — and
    // must still stop before replaying, because a file target has no ingress
    // (that is the F003 ordering: reconfigure FIRST, then drain).
    const fs = new FakeFs();
    const target = '/var/tmp/trace2/agent.jsonl';
    fs.mkdirp('/var/tmp/trace2');
    fs.writeText(target, payload());
    const d = deps({
      fs,
      ingress: await ingress('connected', target),
      bufferPath: target,
    });

    const out = await telemetryNudge(d);

    // NOT `buffer-refused` — the path was accepted; the ingress is what stops it.
    expect(out.reason).toBe('non-af-unix');
    expect(fs.renames).toEqual([]);
  });

  it('a filesystem error during rotation DEGRADES instead of throwing', async () => {
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.failRenames.add(BUFFER);
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('fs-error');
    expect(out.detail).toContain('NOTHING was moved or sent');
    expect(d.relay.sends).toEqual([]);
  });

  it('a delete that fails leaves the segment reported, not thrown', async () => {
    // The seeded listing stands in for what a real `readdir` would return after
    // the rotation — `FakeFs.rename` deliberately does not mutate directory
    // listings, so the post-rotation state is stated explicitly here.
    const fs = new FakeFs({}, { [`${REPO}/.harness/temp/trace2`]: [SEGMENT_NAME] });
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarNaming(SHA_A));
    fs.failDeletes.add(SEGMENT);
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      git: new FakeGitAttribution({ notesAfterDelay: [SHA_A] }),
    });

    const out = await telemetryNudge(d);

    // The replay DID happen and confirmed; the undeletable segment is reported
    // by the enumeration pass rather than escaping as an exception.
    expect(out.recovered).toEqual([SHA_A]);
    expect(out.status).toBe('retained');
    expect(out.retained.map((r) => r.path)).toContain(SEGMENT);
  });
});

/**
 * Review round 2 — one root cause, two symptoms.
 *
 * A `file` trace2 target is MACHINE-GLOBAL: `trace2.eventTarget` is read from
 * global config only, so the buffer and its sidecar live outside the repository
 * and are shared by every repo on the box. Two mechanisms assumed the opposite.
 */
describe('plan 074 · ac-0005/ac-0006 — R2: the buffer is machine-global, not repo-local', () => {
  const TARGET_DIR = '/var/tmp/trace2';
  const TARGET = `${TARGET_DIR}/agent.jsonl`;
  const TARGET_SEGMENT = `${TARGET_DIR}/${SEGMENT_NAME}`;
  const REPO_A = '/repoA';
  const REPO_B = '/repoB';
  const ID_A = `${REPO_A}/.git`;
  const ID_B = `${REPO_B}/.git`;

  /** `harnessCommit` deps for a repo at `cwd`, sharing one filesystem. */
  function commitDeps(cwd: string, git: FakeGitAttribution, fs: FakeFs, ing: never): CommitDeps {
    return {
      git,
      ingress: ing,
      fs,
      proc: new FakeProcess({ node: '/usr/bin/node' }, cwd),
      clock: new FakeClock(NOW),
      sleep: () => Promise.resolve(),
      verifyTimeoutMs: 500,
    };
  }

  /** `telemetryNudge` deps for a repo at `cwd`, sharing one filesystem. */
  function nudgeDeps(
    cwd: string,
    git: FakeGitAttribution,
    fs: FakeFs,
    ing: Awaited<ReturnType<typeof ingress>>,
    bufferPath: string,
  ): NudgeDeps & { relay: FakeSocketRelay } {
    const relay = new FakeSocketRelay();
    return {
      fs,
      relay,
      git,
      proc: new FakeProcess({ node: '/usr/bin/node' }, cwd),
      clock: new FakeClock(NOW),
      ingress: ing,
      bufferPath,
      sleep: () => Promise.resolve(),
      confirmTimeoutMs: 500,
    };
  }

  it('F003 — reconfigure THEN drain actually works: the recorded target is authorized', async () => {
    // The composed path the file branch prescribes, end to end. Pre-fix it was
    // unexecutable: containment only authorized the CURRENTLY configured file
    // target, so the moment step 2 pointed trace2 back at the socket, step 3 was
    // refused as `buffer-refused` — the verb rejected the exact path it had just
    // told the operator to drain.

    // 1. A commit while trace2.eventTarget names a plain FILE outside the repo.
    const fs = new FakeFs();
    const git = new FakeGitAttribution({ commitSha: SHA_A, commonDir: `${REPO}/.git` });
    const fileIngress = (await ingress('connected', TARGET)) as never;
    const commit = await harnessCommit(commitDeps(REPO, git, fs, fileIngress), 'msg', ['a.ts']);
    expect(commit.mode).toBe('file-buffered');
    // It wrote BOTH records: which commit the target covers, and that this repo
    // buffered into that path at all.
    expect(fs.readText(`${TARGET}.shas`)).toBe(`${SHA_A} ${REPO}/.git\n`);
    expect(fs.readText(`${REPO}/.harness/temp/trace2/known-targets`)).toBe(`${TARGET}\n`);

    // git wrote its events there while the commit ran.
    fs.mkdirp(TARGET_DIR);
    fs.writeText(TARGET, payload());

    // 2. The prescribed reconfiguration: the live target is now the socket, and
    //    TARGET is no longer named by git config anywhere.
    const socketIngress = await ingress('connected');
    expect(socketIngress.target.kind).toBe('af_unix');

    // 3. The drain.
    const drainGit = new FakeGitAttribution({
      commonDir: `${REPO}/.git`,
      notesAfterDelay: [SHA_A],
    });
    const d = nudgeDeps(REPO, drainGit, fs, socketIngress, TARGET);
    const out = await telemetryNudge(d);

    expect(out.reason).toBeUndefined();
    expect(out.status).toBe('replayed');
    expect(out.segment).toBe(TARGET_SEGMENT);
    expect(out.recovered).toEqual([SHA_A]);
    expect(d.relay.sends.map((s) => s.payload)).toEqual([payload()]);
    // Confirmed in full, so the segment and its sidecar are gone.
    expect(fs.exists(TARGET_SEGMENT)).toBe(false);
    expect(fs.exists(`${TARGET_SEGMENT}.shas`)).toBe(false);
  });

  it('F005 — the containment guard is NOT weakened: an unrecorded path is still refused', async () => {
    // Authorizing by RECORD must not become "any absolute path is fine now".
    // A repo with a perfectly good recorded target still refuses a path nothing
    // ever wrote down.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(`${REPO}/.harness/temp/trace2/known-targets`, `${TARGET}\n`);
    fs.writeText('/etc/passwd', 'root:x:0:0\n');
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      bufferPath: '/etc/passwd',
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('buffer-refused');
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
    expect(fs.readText('/etc/passwd')).toBe('root:x:0:0\n');
    expect(d.relay.sends).toEqual([]);
  });

  /**
   * Two repositories, one machine-global file target, one shared sidecar.
   *
   * Pre-fix the nudge confirmed EVERY sha in that sidecar against the current
   * repo's `refs/notes/ai`. Another repository's commit cannot resolve there —
   * the object is not in this object store — so it was reported missing forever,
   * the segment was retained forever, and unrelated commits showed up as
   * unattributed in a repo that never made them.
   */
  for (const [label, mine, theirs, myId, theirId, mySha, theirSha] of [
    ['repo A drains', REPO_A, REPO_B, ID_A, ID_B, SHA_A, SHA_B],
    ['repo B drains', REPO_B, REPO_A, ID_B, ID_A, SHA_B, SHA_A],
  ] as const) {
    it(`R2 — two repos share one target: ${label}, confirms only its own, and terminates`, async () => {
      const fs = new FakeFs();
      const fileIngress = (await ingress('connected', TARGET)) as never;

      // Both repos commit through the same machine-global file target.
      await harnessCommit(
        commitDeps(
          REPO_A,
          new FakeGitAttribution({ commitSha: SHA_A, commonDir: ID_A }),
          fs,
          fileIngress,
        ),
        'a',
        ['a.ts'],
      );
      await harnessCommit(
        commitDeps(
          REPO_B,
          new FakeGitAttribution({ commitSha: SHA_B, commonDir: ID_B }),
          fs,
          fileIngress,
        ),
        'b',
        ['b.ts'],
      );
      expect(fs.readText(`${TARGET}.shas`)).toBe(`${SHA_A} ${ID_A}\n${SHA_B} ${ID_B}\n`);

      fs.mkdirp(TARGET_DIR);
      fs.writeText(TARGET, payload());

      // One of them drains, after the prescribed reconfiguration to the socket.
      // Only ITS OWN commit ever gains a note here — the other repo's cannot.
      const git = new FakeGitAttribution({ commonDir: myId, notesAfterDelay: [mySha] });
      const d = nudgeDeps(mine, git, fs, await ingress('connected'), TARGET);

      const out = await telemetryNudge(d);

      // The WHOLE segment was replayed — the daemon attributes each commit in
      // its own repo, so replaying a foreign event is correct, not a leak.
      expect(d.relay.sends.map((s) => s.payload)).toEqual([payload()]);
      // Only this repo's sha is confirmed…
      expect(out.recovered).toEqual([mySha]);
      // …and the other repo's is NEVER accused.
      expect(out.stillMissing).toEqual([]);
      expect(out.retained).toEqual([]);
      expect(out.handedOff).toEqual([{ sha: theirSha, repo: theirId }]);
      expect(out.detail).toContain(theirId);
      expect(out.detail).toContain('handed off');
      // The other repo's sha was never even looked up here.
      expect(git.calls).not.toContain(`hasAiNote:${theirSha}`);
      // The lifecycle TERMINATES: nothing is retained on a foreign sha.
      expect(out.status).toBe('replayed');
      expect(fs.exists(TARGET_SEGMENT)).toBe(false);
      expect(fs.exists(`${TARGET_SEGMENT}.shas`)).toBe(false);
      // Not the repo running the drain — so `${theirs}` never appears as an
      // owner of anything this run claims.
      expect(out.recovered).not.toContain(theirSha);
      expect(theirs).not.toBe(mine);
    });
  }

  it('R2 — a segment whose every commit is foreign is enumerated as handed off, never retained', async () => {
    // The leftover shape: another repo rotated a segment and left it. This repo
    // must NAME it without owning it — flipping to `retained` here would be the
    // same false alarm, one invocation later.
    const fs = new FakeFs({}, { [TARGET_DIR]: [SEGMENT_NAME] });
    fs.mkdirp(TARGET_DIR);
    fs.writeText(TARGET_SEGMENT, payload());
    fs.writeText(`${TARGET_SEGMENT}.shas`, `${SHA_B} ${ID_B}\n`);
    fs.writeText(`${REPO_A}/.harness/temp/trace2/known-targets`, `${TARGET}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), TARGET);

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('no-buffer');
    expect(out.retained).toEqual([
      {
        path: TARGET_SEGMENT,
        stillMissing: [],
        recovered: [],
        handedOff: [{ sha: SHA_B, repo: ID_B }],
        reason: 'handed-off',
      },
    ]);
    expect(out.detail).toContain('belong to other repositories');
    // No retry pointer at a segment this repo cannot clear, and nothing touched.
    expect(out.next_action).toBeUndefined();
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
  });

  it('R2 — a pre-identity sidecar is read by LOCATION: the harness dir is ours, global is not', async () => {
    // Entries written before identity was recorded carry no repo. Guessing
    // either way is wrong, so location decides — and only the harness's own
    // default buffer directory counts as ours (R3/F008): a machine-global
    // target could belong to anybody, wherever it happens to sit.
    const fs = new FakeFs({}, { [TARGET_DIR]: [SEGMENT_NAME] });
    fs.mkdirp(TARGET_DIR);
    fs.writeText(TARGET_SEGMENT, payload());
    fs.writeText(`${TARGET_SEGMENT}.shas`, sidecarNaming(SHA_B));
    fs.writeText(`${REPO_A}/.harness/temp/trace2/known-targets`, `${TARGET}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), TARGET);

    const out = await telemetryNudge(d);

    expect(out.retained[0]?.reason).toBe('handed-off');
    expect(out.retained[0]?.handedOff).toEqual([{ sha: SHA_B, repo: null }]);
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    expect(out.detail).toContain('belong to other repositories');
    expect(out.detail).not.toContain(SHA_B);

    // The other half of the same rule: an untagged sidecar in the harness's OWN
    // buffer directory is this repository's — that is the pre-identity
    // `.harness/temp/trace2/` case, and reading it as foreign would stop
    // confirming commits we made.
    const localFs = new FakeFs();
    localFs.mkdirp(`${REPO}/.harness/temp/trace2`);
    localFs.writeText(BUFFER, payload());
    localFs.writeText(SIDECAR, sidecarNaming(SHA_A));
    const localGit = new FakeGitAttribution({ notesAfterDelay: [SHA_A] });
    const local = await telemetryNudge(
      deps({ fs: localFs, git: localGit, ingress: await ingress('connected') }),
    );

    expect(local.status).toBe('replayed');
    expect(local.recovered).toEqual([SHA_A]);
    expect(local.handedOff).toEqual([]);
  });
});

describe('plan 074 · ac-0005/ac-0006 — R3: a global target can live INSIDE the repo (F008)', () => {
  const REPO_A = '/repoA';
  const ID_A = `${REPO_A}/.git`;
  // `trace2.eventTarget` is read from SYSTEM and GLOBAL config only, but nothing
  // stops the path it names from sitting inside a worktree. This one does.
  const GLOBAL_DIR = `${REPO_A}/trace2`;
  const GLOBAL_TARGET = `${GLOBAL_DIR}/agent.jsonl`;
  const GLOBAL_SEGMENT = `${GLOBAL_DIR}/${SEGMENT_NAME}`;
  const HARNESS_DIR_A = `${REPO_A}/.harness/temp/trace2`;

  function nudgeDeps(
    cwd: string,
    git: FakeGitAttribution,
    fs: FakeFs,
    ing: Awaited<ReturnType<typeof ingress>>,
    bufferPath?: string,
  ): NudgeDeps & { relay: FakeSocketRelay } {
    const relay = new FakeSocketRelay();
    return {
      fs,
      relay,
      git,
      proc: new FakeProcess({ node: '/usr/bin/node' }, cwd),
      clock: new FakeClock(NOW),
      ingress: ing,
      bufferPath,
      sleep: () => Promise.resolve(),
      confirmTimeoutMs: 500,
    };
  }

  it('F008 — an untagged entry at a global target inside the repo is handed off, not claimed', async () => {
    // The review's probe. "Anywhere under the repo is ours" is true of the
    // harness's own directory and FALSE of a machine-global target that happens
    // to live there: the untagged sha below belongs to another repository, so
    // claiming it means querying a note that cannot exist in this object store,
    // reporting a structural impossibility as a finding, and retaining the
    // segment forever — the permanent retention this plan exists to kill.
    const fs = new FakeFs();
    fs.mkdirp(GLOBAL_DIR);
    fs.writeText(GLOBAL_TARGET, payload());
    fs.writeText(`${GLOBAL_TARGET}.shas`, sidecarNaming(SHA_B));
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(`${HARNESS_DIR_A}/known-targets`, `${GLOBAL_TARGET}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), GLOBAL_TARGET);

    const out = await telemetryNudge(d);

    // Replayed whole — the daemon still attributes it in whatever repo owns it.
    expect(d.relay.sends.map((s) => s.payload)).toEqual([payload()]);
    expect(out.handedOff).toEqual([{ sha: SHA_B, repo: null }]);
    // NEVER queried against this repository's notes.
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    expect(out.stillMissing).toEqual([]);
    // The lifecycle TERMINATES: nothing is retained on a sha this repo can
    // neither confirm nor disprove.
    expect(out.status).toBe('replayed');
    expect(out.retained).toEqual([]);
    expect(fs.exists(GLOBAL_SEGMENT)).toBe(false);
    expect(fs.exists(`${GLOBAL_SEGMENT}.shas`)).toBe(false);
  });

  it('F008 — the same rule holds on the enumeration path, not just the run path', async () => {
    // A leftover segment at the in-repo global target, seen by a later run with
    // no live buffer. It must be NAMED without being owned.
    const fs = new FakeFs({}, { [GLOBAL_DIR]: [SEGMENT_NAME] });
    fs.mkdirp(GLOBAL_DIR);
    fs.writeText(GLOBAL_SEGMENT, payload());
    fs.writeText(`${GLOBAL_SEGMENT}.shas`, sidecarNaming(SHA_B));
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), GLOBAL_TARGET);

    const out = await telemetryNudge(d);

    expect(out.retained[0]?.reason).toBe('handed-off');
    expect(out.retained[0]?.handedOff).toEqual([{ sha: SHA_B, repo: null }]);
    expect(out.retained[0]?.stillMissing).toEqual([]);
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    // Naming a foreign segment is honest; owning it is not.
    expect(out.status).toBe('skipped');
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
  });

  it('F008 negative control — an untagged entry in the HARNESS default dir is still ours', async () => {
    // The migration case the narrowing must not break: `harness commit` created
    // this directory, wrote this buffer, and gitignored it. No configured
    // eventTarget can land here, so an untagged entry is ours BY CONSTRUCTION —
    // reading it as foreign would stop confirming commits we really made.
    const fs = new FakeFs({}, { [HARNESS_DIR_A]: [SEGMENT_NAME] });
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(`${HARNESS_DIR_A}/${SEGMENT_NAME}`, payload());
    fs.writeText(`${HARNESS_DIR_A}/${SEGMENT_NAME}.shas`, sidecarNaming(SHA_A));
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'));

    const out = await telemetryNudge(d);

    expect(out.retained[0]?.reason).toBe('partial');
    expect(out.retained[0]?.stillMissing).toEqual([SHA_A]);
    expect(out.retained[0]?.handedOff).toEqual([]);
    expect(git.calls).toContain(`hasAiNote:${SHA_A}`);
    // Still owed here, so the run says so.
    expect(out.status).toBe('retained');
  });
});
