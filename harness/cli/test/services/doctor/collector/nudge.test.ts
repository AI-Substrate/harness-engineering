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
  RETAINED_FIELD_RENDERING,
  type RetainedSegment,
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

/** This fake repo's identity — what `FakeGitAttribution` reports for `/repo`. */
const OWN_ID = '/repo/.git';

/**
 * The sidecar `harness commit` writes beside a buffer — `<sha> <repo>` per line
 * (ac-0005). The repo tag is not decoration: since round 4 it is the ONLY thing
 * that can put a sha in the own or handed-off arm. An untagged line is
 * provenance-unknown, whatever directory it sits in — see `sidecarUntagged`.
 */
function sidecarNaming(...shas: string[]): string {
  return `${shas.map((sha) => `${sha} ${OWN_ID}`).join('\n')}\n`;
}

/** A LEGACY sidecar: written before sidecars carried repo identity. */
function sidecarUntagged(...shas: string[]): string {
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

/** The phrase that makes an unprovable retention legible rather than a bare path. */
const UNKNOWN_REASON = 'UNKNOWN provenance';

/**
 * The parity contract, as an assertion. `harness doctor telemetry-nudge`
 * prints `detail` and `next_action` and NOTHING else in its default text mode,
 * so every retained segment the JSON envelope describes must be legible from
 * those two strings alone. A field added to `retained[]` and nowhere else is
 * invisible to the operator who has to act on it.
 *
 * Round 6's F011: this helper used to check `path` and `unknown` because those
 * were the fields that existed the day it was written. The reviewer added a
 * populated optional field to `RetainedSegment`, rendered it nowhere, and all
 * five of these tests stayed green — the guard tested instances, not the
 * contract, so its advertised future-field protection was not real.
 *
 * It now iterates `RETAINED_FIELD_RENDERING` (the src-side total map over
 * `keyof RetainedSegment`), which gives two independent nets:
 *   1. a new field fails `tsc -p harness/cli/tsconfig.json` until its
 *      disposition is declared — the repo's actual typecheck gate, which does
 *      NOT cover this test file, which is why the map lives in `src`;
 *   2. even with the typecheck skipped, the own-keys sweep below goes RED the
 *      moment such a field is POPULATED on a real segment.
 * Declaring a field `text` with no assertion here is itself RED.
 */
const FIELD_ASSERTIONS: Record<string, (segment: RetainedSegment, text: string) => void> = {
  path: (segment, text) => {
    expect(text).toContain(segment.path);
  },
  stillMissing: (segment, text) => {
    if (segment.stillMissing.length === 0) return;
    // Per-segment, never per-sha: the operator's move is to re-run the buffer.
    expect(text).toContain('--buffer');
  },
  handedOff: (segment, text) => {
    for (const repo of new Set(segment.handedOff.map((h) => h.repo))) {
      expect(text).toContain(repo);
    }
  },
  unknown: (segment, text) => {
    if (segment.unknown.length === 0) return;
    expect(text).toContain(UNKNOWN_REASON);
    for (const sha of segment.unknown) expect(text).toContain(sha);
  },
};

function expectTextParity(out: Awaited<ReturnType<typeof telemetryNudge>>): void {
  const text = `${out.detail} ${out.next_action ?? ''}`;
  for (const [field, rendering] of Object.entries(RETAINED_FIELD_RENDERING)) {
    // A field the contract PROMISES to render, with nothing here checking it,
    // is an advertised guarantee with no mechanism — F011's exact shape.
    if (rendering.kind === 'text') expect(FIELD_ASSERTIONS[field]).toBeDefined();
  }
  for (const segment of out.retained) {
    // Runtime completeness. Serialising a field with no declared disposition is
    // the reviewer's mutation; this catches it without needing the typecheck.
    for (const key of Object.keys(segment)) {
      expect(RETAINED_FIELD_RENDERING).toHaveProperty(key);
    }
    for (const [field, rendering] of Object.entries(RETAINED_FIELD_RENDERING)) {
      if (rendering.kind !== 'text') continue;
      FIELD_ASSERTIONS[field]?.(segment, text);
    }
  }
  // Nothing retained may be described as the healthy shape.
  if (out.retained.length > 0) expect(text).not.toContain('healthy shape');
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
        unknown: [],
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
      {
        path: OLD,
        stillMissing: [SHA_B],
        recovered: [],
        handedOff: [],
        unknown: [],
        reason: 'partial',
      },
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
      {
        path: OLD,
        stillMissing: [],
        recovered: [],
        handedOff: [],
        unknown: [],
        reason: 'unconfirmable',
      },
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
        unknown: [],
        reason: 'handed-off',
      },
    ]);
    expect(out.detail).toContain('belong to other repositories');
    // Round 6's F011: the OWNING repo was in the JSON and nowhere the operator
    // looks. Naming the segment without naming who can clear it is a dead end.
    expect(out.detail).toContain(ID_B);
    expectTextParity(out);
    // No retry pointer at a segment this repo cannot clear, and nothing touched.
    expect(out.next_action).toBeUndefined();
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
  });

  it('R2 — a pre-identity sidecar is UNPROVABLE, wherever it sits', async () => {
    // Entries written before identity was recorded carry no repo. Rounds 3 and
    // 4 both tried to let LOCATION break the tie and both were disproved, so
    // there is no tie-break left: an untagged entry is simply unknown. It is
    // replayed, never queried, never accused — and its segment is KEPT, because
    // deleting on a location guess is exactly the wrong answer this plan exists
    // to kill.
    const fs = new FakeFs({}, { [TARGET_DIR]: [SEGMENT_NAME] });
    fs.mkdirp(TARGET_DIR);
    fs.writeText(TARGET_SEGMENT, payload());
    fs.writeText(`${TARGET_SEGMENT}.shas`, sidecarUntagged(SHA_B));
    fs.writeText(`${REPO_A}/.harness/temp/trace2/known-targets`, `${TARGET}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), TARGET);

    const out = await telemetryNudge(d);

    expect(out.retained[0]?.reason).toBe('unconfirmable');
    expect(out.retained[0]?.unknown).toEqual([SHA_B]);
    expect(out.retained[0]?.handedOff).toEqual([]);
    // Never claimed → never queried against notes that could not resolve here.
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    // Never accused, either: an unprovable sha is not "missing attribution".
    expect(out.retained[0]?.stillMissing).toEqual([]);
    expect(fs.deletes).toEqual([]);

    // The same line in the harness's OWN buffer directory reads IDENTICALLY.
    // Round 3 made that directory a fifth arm; round 4's F009 configured a
    // global target straight into it, so the directory proves nothing either.
    const localFs = new FakeFs();
    localFs.mkdirp(`${REPO}/.harness/temp/trace2`);
    localFs.writeText(BUFFER, payload());
    localFs.writeText(SIDECAR, sidecarUntagged(SHA_A));
    const localGit = new FakeGitAttribution({ notesAfterDelay: [SHA_A] });
    const local = await telemetryNudge(
      deps({ fs: localFs, git: localGit, ingress: await ingress('connected') }),
    );

    expect(local.status).toBe('retained');
    expect(local.reason).toBe('unconfirmable');
    expect(local.retained[0]?.unknown).toEqual([SHA_A]);
    expect(local.recovered).toEqual([]);
    expect(local.handedOff).toEqual([]);
    expect(localGit.calls).not.toContain(`hasAiNote:${SHA_A}`);
  });
});

/**
 * Round 4 · F009 — the review DISPROVED the location heuristic by experiment.
 *
 * Round 3 narrowed "a sidecar inside the repo is ours" to "a sidecar in the
 * harness's own default buffer directory is ours". The reviewer set a global
 * `trace2.eventTarget` to exactly that path — git accepts any absolute path and
 * read it back verbatim — so a FOREIGN pre-identity sidecar landed in the one
 * directory the predicate trusted most, was claimed, was queried against a note
 * that cannot exist in this object store, and pinned the segment forever.
 *
 * The heuristic is therefore DELETED, not narrowed a third time: path location
 * cannot prove provenance, and each narrowing only produced a smaller wrong
 * claim. Three arms remain, every one of them provable from the recorded repo
 * identity alone. These tests exist to make a fourth arm impossible to
 * reintroduce — the SAME untagged sha is planted at three different locations
 * and must come out in the SAME arm every time.
 */
describe('plan 074 · ac-0005/ac-0006 — R4: location cannot prove provenance (F009)', () => {
  const REPO_A = '/repoA';
  const ID_A = `${REPO_A}/.git`;
  const ID_B = '/repoB/.git';
  const HARNESS_DIR_A = `${REPO_A}/.harness/temp/trace2`;
  /** The harness's DEFAULT buffer — round 3's "ours by construction" location. */
  const HARNESS_BUFFER = `${HARNESS_DIR_A}/buffer.jsonl`;
  const HARNESS_SEGMENT = `${HARNESS_DIR_A}/${SEGMENT_NAME}`;
  /** A machine-global target that happens to sit inside the worktree (round 3's F008). */
  const GLOBAL_DIR = `${REPO_A}/trace2`;
  const GLOBAL_TARGET = `${GLOBAL_DIR}/agent.jsonl`;
  const GLOBAL_SEGMENT = `${GLOBAL_DIR}/${SEGMENT_NAME}`;

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

  it('F009 — a global target configured INTO the harness buffer path is still unprovable', async () => {
    // The reviewer's probe. Git accepts ANY absolute path for a global
    // `trace2.eventTarget`, including the harness's own default buffer — the
    // review set exactly that value in an isolated `GIT_CONFIG_GLOBAL` and git
    // read it back verbatim. So a FOREIGN pre-identity sidecar can sit at the
    // one path round 3's predicate trusted most. The drain runs under the
    // prescribed recovery shape (target already pointed back at the socket,
    // then drain the file), so the placement below IS that scenario.
    const fs = new FakeFs();
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(HARNESS_BUFFER, payload());
    fs.writeText(`${HARNESS_BUFFER}.shas`, sidecarUntagged(SHA_B));
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'));

    const out = await telemetryNudge(d);

    // Replayed WHOLE — the daemon attributes it in whichever repo made it.
    expect(d.relay.sends.map((s) => s.payload)).toEqual([payload()]);
    // NEVER queried against this repository's notes: nothing here could prove
    // ownership, so the question itself is illegitimate.
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    // Never claimed, never accused, never handed off as if its owner were known.
    expect(out.recovered).toEqual([]);
    expect(out.stillMissing).toEqual([]);
    expect(out.handedOff).toEqual([]);
    // KEPT, and said out loud — visible-and-stuck beats silently-wrong.
    expect(out.status).toBe('retained');
    expect(out.reason).toBe('unconfirmable');
    expect(out.retained[0]?.unknown).toEqual([SHA_B]);
    expect(fs.exists(HARNESS_SEGMENT)).toBe(true);
    expect(fs.deletes).toEqual([]);
    expect(out.detail).toContain('UNKNOWN provenance');
    expect(out.detail).toContain('before sidecars carried repo identity');
    expect(out.next_action).toContain(HARNESS_SEGMENT);
  });

  it('F008 collapses into the same arm — an untagged entry at an in-repo global target', async () => {
    // Round 3's scenario, re-judged. It used to be deleted as handed-off, which
    // was only ever right by luck: nothing proved the sha was foreign either.
    const fs = new FakeFs();
    fs.mkdirp(GLOBAL_DIR);
    fs.writeText(GLOBAL_TARGET, payload());
    fs.writeText(`${GLOBAL_TARGET}.shas`, sidecarUntagged(SHA_B));
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(`${HARNESS_DIR_A}/known-targets`, `${GLOBAL_TARGET}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), GLOBAL_TARGET);

    const out = await telemetryNudge(d);

    expect(d.relay.sends.map((s) => s.payload)).toEqual([payload()]);
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    expect(out.status).toBe('retained');
    expect(out.reason).toBe('unconfirmable');
    expect(out.retained[0]?.unknown).toEqual([SHA_B]);
    expect(out.handedOff).toEqual([]);
    expect(out.stillMissing).toEqual([]);
    expect(fs.exists(GLOBAL_SEGMENT)).toBe(true);
  });

  it('the LOCATION heuristic is gone — the same untagged sha reads the same everywhere', async () => {
    // The structural guard. Round 3's negative control asserted the OPPOSITE of
    // this for the harness directory and had to go: it encoded the rule F009
    // disproved. What replaces it is the invariant that survived — location is
    // not an input at all, so all three placements agree.
    const places = [HARNESS_DIR_A, GLOBAL_DIR, '/tmp/shared-trace2'];
    const reasons: string[] = [];
    for (const dir of places) {
      const segment = `${dir}/${SEGMENT_NAME}`;
      const fs = new FakeFs({}, { [dir]: [SEGMENT_NAME] });
      fs.mkdirp(dir);
      fs.mkdirp(HARNESS_DIR_A);
      fs.writeText(segment, payload());
      fs.writeText(`${segment}.shas`, sidecarUntagged(SHA_A));
      fs.writeText(`${HARNESS_DIR_A}/known-targets`, `${dir}/agent.jsonl\n`);
      const git = new FakeGitAttribution({ commonDir: ID_A });
      const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'), `${dir}/agent.jsonl`);

      const out = await telemetryNudge(d);

      reasons.push(out.retained[0]?.reason ?? 'MISSING');
      expect(out.retained[0]?.unknown).toEqual([SHA_A]);
      expect(git.calls).not.toContain(`hasAiNote:${SHA_A}`);
      expect(fs.deletes).toEqual([]);
    }
    expect(reasons).toEqual(['unconfirmable', 'unconfirmable', 'unconfirmable']);
  });

  it('a TAGGED sidecar is unaffected — identity still decides, and it still deletes', async () => {
    // The collapse must not cost the arms that DO prove something. Same
    // directory as the F009 probe; the only difference is a recorded owner.
    const fs = new FakeFs();
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(HARNESS_BUFFER, payload());
    fs.writeText(`${HARNESS_BUFFER}.shas`, `${SHA_A} ${ID_A}\n${SHA_B} ${ID_B}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A, notesAfterDelay: [SHA_A] });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'));

    const out = await telemetryNudge(d);

    expect(out.status).toBe('replayed');
    expect(out.recovered).toEqual([SHA_A]);
    expect(out.handedOff).toEqual([{ sha: SHA_B, repo: ID_B }]);
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    expect(fs.exists(HARNESS_SEGMENT)).toBe(false);
  });

  it('a MIXED segment confirms what it can prove and keeps what it cannot', async () => {
    // One tagged own sha that confirms, one legacy sha that never can. The
    // confirmation is real and reported; the segment still survives, because a
    // delete would be a claim about the legacy line that nothing supports.
    const fs = new FakeFs();
    fs.mkdirp(HARNESS_DIR_A);
    fs.writeText(HARNESS_BUFFER, payload());
    fs.writeText(`${HARNESS_BUFFER}.shas`, `${SHA_A} ${ID_A}\n${SHA_B}\n`);
    const git = new FakeGitAttribution({ commonDir: ID_A, notesAfterDelay: [SHA_A] });
    const d = nudgeDeps(REPO_A, git, fs, await ingress('connected'));

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.reason).toBe('unconfirmable');
    expect(out.recovered).toEqual([SHA_A]);
    expect(out.stillMissing).toEqual([]);
    expect(out.retained[0]?.unknown).toEqual([SHA_B]);
    expect(git.calls).not.toContain(`hasAiNote:${SHA_B}`);
    expect(fs.exists(HARNESS_SEGMENT)).toBe(true);
    expect(out.next_action).toContain(HARNESS_SEGMENT);
  });
});

describe('plan 074 · ac-0004/ac-0006 — R5: the TEXT surface reports what the JSON knows (F010)', () => {
  const OLD_NAME = 'segment-2026-08-06T00-00-00-000Z-a.jsonl';
  const OLD = `${REPO}/.harness/temp/trace2/${OLD_NAME}`;

  /** A trace2 dir whose LISTING already contains an earlier run's segment. */
  function fsWithOldSegment(): FakeFs {
    const fs = new FakeFs({}, { [`${REPO}/.harness/temp/trace2`]: [OLD_NAME] });
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    return fs;
  }

  it('F010 — a LATER run with no live buffer states the legacy reason, the sha, and the action', async () => {
    // The reviewer's probe. The first replay was always explicit; the run AFTER
    // it enumerated the same segment, put `unknown` in the JSON envelope, and
    // printed the ordinary no-buffer prose — so the default surface read healthy
    // while a segment sat stuck. That is ac-0004's cardinal sin ("green while
    // something is owed") reappearing in the RENDERER instead of the check.
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarUntagged(SHA_A));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    // Nothing was rotated — this run had no buffer of its own.
    expect(out.segment).toBeNull();
    expect(d.relay.sends).toEqual([]);
    // The JSON was already right, and stays right.
    expect(out.status).toBe('retained');
    expect(out.retained[0]?.unknown).toEqual([SHA_A]);
    // …and now the TEXT says all three things.
    expect(out.detail).toContain(UNKNOWN_REASON);
    expect(out.detail).toContain('before sidecars carried repo identity');
    expect(out.detail).toContain(SHA_A);
    expect(out.next_action).toContain('attribution-at-risk');
    expect(out.next_action).toContain(OLD);
    // And it does NOT read healthy.
    expect(out.detail).not.toContain('healthy shape');
    expectTextParity(out);
  });

  it('a purely-unknown segment is never pointed at a re-run that cannot resolve it', async () => {
    // Re-nudging a segment whose every sha is unprovable replays it and retains
    // it again, forever. Sending an operator round that loop is the same false
    // comfort as F010 itself, one layer down: the only real instruction is the
    // legacy one.
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarUntagged(SHA_A));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.next_action).not.toContain('--buffer');
    expect(out.next_action).toContain(`delete ${OLD}`);
  });

  it('a segment with own shas STILL gets its retry pointer, alongside the legacy prose', async () => {
    // The fix must not cost the actionable case. Two segments: one this repo
    // owns and can retry, one legacy that can only be deleted by hand.
    const dir = `${REPO}/.harness/temp/trace2`;
    const OWN_NAME = 'segment-2026-08-06T00-00-01-000Z-a.jsonl';
    const OWN_SEG = `${dir}/${OWN_NAME}`;
    const fs = new FakeFs({}, { [dir]: [OLD_NAME, OWN_NAME] });
    fs.mkdirp(dir);
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarUntagged(SHA_A));
    fs.writeText(OWN_SEG, payload());
    fs.writeText(`${OWN_SEG}.shas`, sidecarNaming(SHA_B));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.next_action).toContain(`--buffer ${OWN_SEG}`);
    expect(out.next_action).toContain(`delete ${OLD}`);
    expect(out.detail).toContain(SHA_A);
    expectTextParity(out);
  });

  it('parity holds on the run that DID the replay, too', async () => {
    // The same contract from the other entry point: `runNudge` writes this run's
    // segment prose, `withRemainingSegments` writes every other segment's. The
    // guard is over the FINAL outcome, so it bites whichever site drops it.
    const fs = fsWithOldSegment();
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, sidecarUntagged(SHA_A));
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, sidecarUntagged(SHA_B));
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.retained.map((r) => r.path).sort()).toEqual([OLD, SEGMENT].sort());
    // BOTH legacy shas are legible from the text, not just this run's.
    expectTextParity(out);
    expect(out.detail).toContain(SHA_A);
    expect(out.detail).toContain(SHA_B);
  });

  it('the negative control — a genuinely clean run still reads healthy', async () => {
    // The fix must not make everything sound alarming. No buffer AND nothing
    // retained is the one shape allowed to claim health, and it still does.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('skipped');
    expect(out.reason).toBe('no-buffer');
    expect(out.retained).toEqual([]);
    expect(out.detail).toContain('healthy shape');
  });
});

/**
 * Review round 6 — F011: the guard must enforce the CONTRACT, not today's fields.
 *
 * Round 5 closed the text/JSON parity gap and advertised a guard against future
 * JSON-only fields. The reviewer disproved the advertisement: a populated optional
 * `RetainedSegment` field, rendered nowhere, left all five R5 tests green, because
 * the helper checked the fields that existed the day it was written.
 *
 * The mechanism now lives in `src`: `RETAINED_FIELD_RENDERING` is a total map over
 * `keyof RetainedSegment`, so a new field fails the repo's typecheck gate until its
 * disposition is stated (the gate covers `src` only — that is why the map is there
 * and not here), and `expectTextParity` iterates it rather than a list of its own.
 *
 * Applying the completed contract immediately found the SECOND instance of F010 it
 * was built to find: `handedOff` named its owning repositories only on the branch
 * that replayed them, so an enumerated foreign segment and a relay-failed one both
 * reported an owner in JSON that no operator would ever see.
 */
describe('plan 074 · ac-0004/ac-0006 — R6: the parity guard enforces the CONTRACT (F011)', () => {
  it('every serialised field has a stated disposition, and every rendered one has an assertion', () => {
    // The contract is what makes the guard generic; an empty or partial map would
    // make `expectTextParity` vacuous without failing anything else.
    const fields = Object.keys(RETAINED_FIELD_RENDERING);
    expect(fields.length).toBeGreaterThan(0);
    for (const [field, rendering] of Object.entries(RETAINED_FIELD_RENDERING)) {
      if (rendering.kind === 'text') {
        expect(rendering.contract.length).toBeGreaterThan(0);
        // A promise with no mechanism is exactly the defect this round is about.
        expect(FIELD_ASSERTIONS[field]).toBeDefined();
      } else {
        expect(rendering.because.length).toBeGreaterThan(0);
      }
    }
  });

  it('a populated field with no disposition is REFUSED at runtime, not just by tsc', () => {
    // The reviewer's mutation, simulated on the assertion itself: a segment
    // carrying a field the contract does not know about must fail. `tsc` is the
    // first net and catches the declaration; this is the second, and catches the
    // VALUE — so the guard still bites in a run where the typecheck was skipped.
    const rogue = {
      path: SEGMENT,
      stillMissing: [],
      recovered: [],
      handedOff: [],
      unknown: [],
      reason: 'unconfirmable',
      reviewOnly: 'a future JSON-only field',
    } as unknown as RetainedSegment;

    expect(() =>
      expectTextParity({
        status: 'retained',
        segment: SEGMENT,
        bytes: 0,
        recovered: [],
        stillMissing: [],
        handedOff: [],
        retained: [rogue],
        detail: `The segment is RETAINED INTACT at ${SEGMENT}.`,
      }),
    ).toThrow();
  });

  it('a relay failure still names the repositories and the unprovable shas it is holding', async () => {
    // Found BY the completed contract. The rotated segment carries a foreign
    // entry and a legacy one; the send failed, so `describeHandedOff`'s
    // "were REPLAYED and handed off" would be a lie — and saying nothing at all
    // was the F010 shape. It now states ownership without claiming a replay.
    const fs = new FakeFs();
    fs.mkdirp(`${REPO}/.harness/temp/trace2`);
    fs.writeText(BUFFER, payload());
    fs.writeText(SIDECAR, `${SHA_A} /elsewhere/.git\n${SHA_B}\n`);
    const d = deps({
      fs,
      ingress: await ingress('connected'),
      relay: new FakeSocketRelay({ ok: false, outcome: 'denied' }),
    });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.reason).toBe('relay-failed');
    expect(out.retained[0]?.handedOff).toEqual([{ sha: SHA_A, repo: '/elsewhere/.git' }]);
    expect(out.retained[0]?.unknown).toEqual([SHA_B]);
    // Ownership named, with NO replay claim attached to it.
    expect(out.detail).toContain('/elsewhere/.git');
    expect(out.detail).not.toContain('were REPLAYED and handed off');
    expect(out.detail).toContain(UNKNOWN_REASON);
    expectTextParity(out);
  });

  it('an ENUMERATED segment that also names foreign commits says whose they are', async () => {
    // The mixed case the R2 hand-off tests never reached: an earlier run left a
    // segment this repo partly owns and partly cannot. `describeHandedOff` runs
    // only on this run's own segment, so the foreign owner reached JSON alone.
    const dir = `${REPO}/.harness/temp/trace2`;
    const OLD_NAME = 'segment-2026-08-06T00-00-00-000Z-a.jsonl';
    const OLD = `${dir}/${OLD_NAME}`;
    const fs = new FakeFs({}, { [dir]: [OLD_NAME] });
    fs.mkdirp(dir);
    fs.writeText(OLD, payload());
    fs.writeText(`${OLD}.shas`, `${SHA_A} ${OWN_ID}\n${SHA_B} /elsewhere/.git\n`);
    const d = deps({ fs, ingress: await ingress('connected') });

    const out = await telemetryNudge(d);

    expect(out.status).toBe('retained');
    expect(out.retained[0]?.handedOff).toEqual([{ sha: SHA_B, repo: '/elsewhere/.git' }]);
    expect(out.retained[0]?.stillMissing).toEqual([SHA_A]);
    expect(out.detail).toContain('/elsewhere/.git');
    // And the owned half still gets its retry pointer.
    expect(out.next_action).toContain(`--buffer ${OLD}`);
    expectTextParity(out);
  });
});
