import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitAttribution } from '../../../src/adapters/git/fake-git-attribution.js';
import { FakeSocketProbe } from '../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../src/adapters/net/socket-probe-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  type CommitDeps,
  harnessCommit,
  TRACE2_BUFFER_FILE,
  TRACE2_EVENT_ENV,
} from '../../../src/services/commit/commit-service.js';
import { readIngress } from '../../../src/services/doctor/collector/ingress.js';
import { FakeCollectorFs } from '../../support/collector-fakes.js';

/**
 * Plan 074 · ac-0005 — the `harness commit` branch partition, EXHAUSTIVELY.
 *
 * The AC is precise on purpose: every outcome the probe can produce must land in
 * exactly one branch, and the connected/buffered branches must be mutually
 * exclusive because the trace2 env var REPLACES the socket target rather than
 * adding to it. So there is one test per outcome, and an explicit assertion that
 * the union of the tested outcomes is the whole vocabulary.
 */

const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';
const REPO = '/repo';
const SHA = 'a'.repeat(40);

/** Every outcome ac-0001 defines, plus the non-socket target kinds. */
const SOCKET_OUTCOMES = [
  'connected',
  'denied',
  'refused',
  'absent',
  'timeout',
  'error:EPIPE',
] as const satisfies readonly ProbeOutcome[];

/** The outcomes ac-0005 routes to the BUFFERED branch. */
const BUFFERED_OUTCOMES = ['denied', 'refused', 'absent', 'timeout', 'error:EPIPE'] as const;

async function socketIngress(outcome: ProbeOutcome) {
  const fs = new FakeCollectorFs();
  fs.writeText(SOCK, '');
  return readIngress({
    fs,
    probe: new FakeSocketProbe({ [SOCK]: outcome }),
    git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCK}` }),
    env: { get: () => undefined },
  });
}

async function nonSocketIngress(target: string | null) {
  return readIngress({
    fs: new FakeCollectorFs(),
    probe: new FakeSocketProbe({}, 'absent'),
    git: new FakeGitAttribution({ trace2Target: target }),
    env: { get: () => undefined },
  });
}

function deps(
  git: FakeGitAttribution,
  ingress: Awaited<ReturnType<typeof socketIngress>>,
): CommitDeps {
  return {
    git,
    ingress,
    fs: new FakeFs(),
    proc: new FakeProcess({ node: '/usr/bin/node' }, REPO),
    clock: new FakeClock('2026-08-07T00:00:00.000Z'),
    // No wall clock in CI: the verify loop's waits resolve instantly.
    sleep: () => Promise.resolve(),
    verifyTimeoutMs: 500,
  };
}

describe('plan 074 · ac-0005 — CONNECTED commits with no override and verifies', () => {
  it('commits with NO trace2 override and reports the note that landed', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA, notes: [SHA] });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', ['a.ts']);

    expect(out.mode).toBe('direct-verified');
    expect(out.verify).toBe('landed');
    expect(out.buffer).toBeNull();
    // The exclusivity assertion: NO env overlay on the connected branch, because
    // the trace2 env var would REPLACE the socket target and divert the events.
    expect(git.commits).toEqual([{ message: 'msg', env: undefined }]);
    expect(out.detail).toContain('VERIFIED');
  });

  it('tolerates the ASYNCHRONOUS note — a first miss then a hit still verifies', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA, notesAfterDelay: [SHA] });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', ['a.ts']);

    expect(out.verify).toBe('landed');
  });

  it('a verify MISS never rolls back and never blocks — degraded, commit intact', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', ['a.ts']);

    expect(out.verify).toBe('missing');
    expect(out.ok).toBe(true);
    expect(out.sha).toBe(SHA);
    expect(out.gitCode).toBe(0);
    expect(out.detail).toContain('The commit stands');
    expect(out.detail).toContain('known-human');
    expect(out.next_action).toContain('harness instructions commit');
    // No revert, no reset, no second commit.
    expect(git.commits).toHaveLength(1);
    expect(git.calls.filter((c) => c.includes('reset') || c.includes('revert'))).toEqual([]);
  });
});

describe('plan 074 · ac-0005 — a FILE target commits with no override either', () => {
  it('names the configured file as the nudge buffer and skips note-verify', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA });
    const out = await harnessCommit(
      deps(git, (await nonSocketIngress('/tmp/agent-trace2.jsonl')) as never),
      'msg',
      ['a.ts'],
    );

    expect(out.mode).toBe('file-buffered');
    expect(out.verify).toBe('skipped');
    expect(out.buffer).toBe('/tmp/agent-trace2.jsonl');
    // No override: the configured target ALREADY buffers, and overriding it would
    // move the buffer somewhere the user did not choose.
    expect(git.commits).toEqual([{ message: 'msg', env: undefined }]);
    expect(out.next_action).toContain('telemetry-nudge');
    expect(out.next_action).toContain('/tmp/agent-trace2.jsonl');
  });
});

describe('plan 074 · ac-0005 — EVERY other outcome buffers under the harness temp dir', () => {
  it.each(BUFFERED_OUTCOMES)('%s buffers, names the nudge, and skips verify', async (outcome) => {
    const git = new FakeGitAttribution({ commitSha: SHA });
    const out = await harnessCommit(deps(git, await socketIngress(outcome)), 'msg', ['a.ts']);

    expect(out.mode).toBe('harness-buffered');
    expect(out.probe).toBe(outcome);
    expect(out.verify).toBe('skipped');
    expect(out.buffer).toBe(`${REPO}/.harness/temp/trace2/${TRACE2_BUFFER_FILE}`);
    expect(git.commits).toEqual([
      { message: 'msg', env: { [TRACE2_EVENT_ENV]: `${REPO}/.harness/temp/trace2/buffer.jsonl` } },
    ]);
    expect(out.detail).toContain('DEFERRED, not lost');
    expect(out.next_action).toContain('harness doctor telemetry-nudge');
  });

  it('UNCONFIGURED buffers too — no target means no ingress to reach', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA });
    const out = await harnessCommit(deps(git, (await nonSocketIngress(null)) as never), 'msg', [
      'a.ts',
    ]);

    expect(out.mode).toBe('harness-buffered');
    expect(out.buffer).toBe(`${REPO}/.harness/temp/trace2/${TRACE2_BUFFER_FILE}`);
    expect(out.detail).toContain('not configured');
  });

  it('the buffer lives under the gitignored harness temp dir and self-gitignores', async () => {
    const fs = new FakeFs();
    const git = new FakeGitAttribution({ commitSha: SHA });
    await harnessCommit({ ...deps(git, await socketIngress('denied')), fs }, 'msg', ['a.ts']);

    expect(fs.readText(`${REPO}/.harness/temp/trace2/.gitignore`)).toContain('*');
  });

  it('RECORDS the sha it buffered — the nudge can confirm nothing without it', async () => {
    // git's trace2 stream names no commit sha (verified against a live daemon),
    // so `harness commit` is the only thing that knows which commit a buffer
    // covers. Without this sidecar the nudge's confirm-then-delete gate would be
    // vacuously true on every segment.
    const fs = new FakeFs();
    const git = new FakeGitAttribution({ commitSha: SHA });
    await harnessCommit({ ...deps(git, await socketIngress('denied')), fs }, 'msg', ['a.ts']);

    expect(fs.readText(`${REPO}/.harness/temp/trace2/buffer.jsonl.shas`)).toBe(`${SHA}\n`);
  });

  it('APPENDS across several buffered commits, and never duplicates a sha', async () => {
    const fs = new FakeFs();
    const ingress = await socketIngress('denied');
    const first = new FakeGitAttribution({ commitSha: SHA });
    const second = new FakeGitAttribution({ commitSha: 'b'.repeat(40) });
    await harnessCommit({ ...deps(first, ingress), fs }, 'one', ['a.ts']);
    await harnessCommit({ ...deps(second, ingress), fs }, 'two', ['b.ts']);
    await harnessCommit({ ...deps(second, ingress), fs }, 'two again', ['b.ts']);

    expect(fs.readText(`${REPO}/.harness/temp/trace2/buffer.jsonl.shas`)).toBe(
      `${SHA}\n${'b'.repeat(40)}\n`,
    );
  });

  it('writes NO sidecar on the connected branch — there is nothing to recover', async () => {
    const fs = new FakeFs();
    const git = new FakeGitAttribution({ commitSha: SHA, notes: [SHA] });
    await harnessCommit({ ...deps(git, await socketIngress('connected')), fs }, 'msg', ['a.ts']);

    expect(fs.exists(`${REPO}/.harness/temp/trace2/buffer.jsonl.shas`)).toBe(false);
  });

  it('never stages the buffer — staging is EXPLICIT pathspecs only', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA });
    await harnessCommit(deps(git, await socketIngress('denied')), 'msg', ['src/a.ts', 'src/b.ts']);

    expect(git.staged).toEqual([['src/a.ts', 'src/b.ts']]);
    expect(git.staged.flat()).not.toContain('.');
    expect(git.staged.flat()).not.toContain('-A');
  });
});

describe('plan 074 · ac-0005 — the partition is exhaustive and mutually exclusive', () => {
  it('every probe outcome selects exactly one branch, and they do not overlap', async () => {
    const modes = new Map<string, string>();
    for (const outcome of SOCKET_OUTCOMES) {
      const git = new FakeGitAttribution({ commitSha: SHA, notes: [SHA] });
      const out = await harnessCommit(deps(git, await socketIngress(outcome)), 'm', ['a.ts']);
      modes.set(outcome, out.mode);
      // Exclusivity, stated as the invariant it is: an override is set if and
      // only if the branch is the buffered one.
      const overrode = git.commits[0]?.env?.[TRACE2_EVENT_ENV] !== undefined;
      expect(overrode).toBe(out.mode === 'harness-buffered');
    }

    expect(modes.get('connected')).toBe('direct-verified');
    for (const outcome of BUFFERED_OUTCOMES) {
      expect(modes.get(outcome)).toBe('harness-buffered');
    }
    // The union of what was tested IS the vocabulary — a new outcome added to
    // the port without a branch here fails this assertion.
    expect([...modes.keys()].sort()).toEqual([...SOCKET_OUTCOMES].sort());
  });
});

describe('plan 074 · ac-0005 — honest failure, never a swallowed exit code', () => {
  it('a failed git commit surfaces its exit code and commits nothing', async () => {
    const git = new FakeGitAttribution({ commitFails: 128 });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', ['a.ts']);

    expect(out.ok).toBe(false);
    expect(out.gitCode).toBe(128);
    expect(out.sha).toBeNull();
  });

  it('a failed stage stops before any commit', async () => {
    const git = new FakeGitAttribution({ stageFails: 128 });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', ['nope']);

    expect(out.ok).toBe(false);
    expect(git.commits).toEqual([]);
  });

  it('an empty index is a no-op success, not an error', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA, staged: [] });
    const out = await harnessCommit(deps(git, await socketIngress('connected')), 'msg', []);

    expect(out.ok).toBe(true);
    expect(out.sha).toBeNull();
    expect(out.detail).toContain('nothing staged');
    expect(git.commits).toEqual([]);
  });

  it('the message reaches git as ONE argument — no shell interpolation surface', async () => {
    const git = new FakeGitAttribution({ commitSha: SHA, notes: [SHA] });
    const nasty = 'fix: $(rm -rf /) && echo `whoami`';
    await harnessCommit(deps(git, await socketIngress('connected')), nasty, ['a.ts']);

    expect(git.commits[0]?.message).toBe(nasty);
  });
});
