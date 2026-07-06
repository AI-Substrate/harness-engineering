import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import type { ShardBlob } from '../../../src/adapters/git/git-read-port.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../../src/output/output-port.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import type { TelemetryReport } from '../../../src/services/telemetry/report.js';
import {
  concatJsonl,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
  ROLLED_METRICS_NAME,
  ROLLUP_FORMAT,
  serializeManifest,
} from '../../../src/services/telemetry/rolled-shard.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
} from '../../../src/services/telemetry/session-export.js';

/**
 * Plan 049 · T003 — DUAL-SHAPE reads (AC-08) + sweep START-MONTH membership. Proves
 * `combineSession` reconstructs a session identically from a LEGACY per-seq committed
 * shard (`<seq>.logs.jsonl` + `<seq>.metrics.jsonl`) and from a ROLLED ref
 * (`session.logs.jsonl` concatenated seq-ordered + `manifest.json`), and that a
 * multi-day session's rolled ref sweeps into its START month only.
 */

const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function oneSegLogs(sessionId: string, ev: Event[], timecode: string): string {
  const s = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: sessionId,
      timecode,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: ev,
    },
    '/repo',
  );
  return `${JSON.stringify(segmentToOtlpLogs(s))}\n`;
}
function oneSegMetrics(sessionId: string, ev: Event[], timecode: string): string {
  const s = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: sessionId,
      timecode,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: ev,
    },
    '/repo',
  );
  return `${JSON.stringify(rollupToOtlpMetrics(s))}\n`;
}

/** The LEGACY per-seq committed shape. */
function legacyShard(seqLogs: string[], seqMetrics: string[]): ShardBlob[] {
  const blobs: ShardBlob[] = [];
  seqLogs.forEach((l, i) => {
    blobs.push({ name: `${i}.logs.jsonl`, content: l });
    blobs.push({ name: `${i}.metrics.jsonl`, content: seqMetrics[i] });
  });
  return blobs;
}

/** The ROLLED shape — one concatenated logs/metrics pair + manifest. */
function rolledShard(
  sessionId: string,
  seqLogs: string[],
  seqMetrics: string[],
  startDate: string,
): ShardBlob[] {
  return [
    { name: ROLLED_LOGS_NAME, content: concatJsonl(seqLogs) },
    { name: ROLLED_METRICS_NAME, content: concatJsonl(seqMetrics) },
    {
      name: ROLLED_MANIFEST_NAME,
      content: serializeManifest({
        format: ROLLUP_FORMAT,
        session: sessionId,
        start_date: startDate,
        max_seq: seqLogs.length - 1,
      }),
    },
  ];
}

/** A FakeFs holding ONLY a session's blobs under the git-ref buffer dir. */
function shardFs(blobs: ShardBlob[], sessionId = SID, cwd = '/repo'): CombineSessionDeps {
  const dir = `${cwd}/.harness/temp/telemetry/${sessionId}`;
  const files: Record<string, string> = {};
  for (const b of blobs) files[`${dir}/${b.name}`] = b.content;
  return {
    fs: new FakeFs(files, { [dir]: blobs.map((b) => b.name) }),
    proc: new FakeProcess({}, cwd),
    env: new FakeEnv({}, '/home/dev'),
  };
}

const EV1: Event[] = [
  { t: '2026-07-01T09:01:00Z', kind: 'turn', dur_s: 10, in: 100, out: 50 } as Event,
];
const EV2: Event[] = [
  { t: '2026-07-01T09:02:00Z', kind: 'turn', dur_s: 20, in: 200, out: 80 } as Event,
];

describe('combineSession — dual-shape reads (plan 049 T003, AC-08)', () => {
  it('reconstructs a rolled ref identically to a legacy per-seq ref (parity)', () => {
    const L = [oneSegLogs(SID, EV1, '2026-07-01T09:01:00Z')];
    const M = [oneSegMetrics(SID, EV1, '2026-07-01T09:01:00Z')];

    const legacy = combineSession(SID, shardFs(legacyShard(L, M)), { kind: 'git-ref' });
    const rolled = combineSession(SID, shardFs(rolledShard(SID, L, M, '2026/07/01')), {
      kind: 'git-ref',
    });

    // Both non-vacuous, identity-bearing, and structurally identical.
    expect(legacy.source.segment_count).toBe(1);
    expect(rolled.source.segment_count).toBe(1);
    expect(rolled.identity).toEqual(legacy.identity);
    expect(rolled.summary.tokens).toEqual(legacy.summary.tokens);
    expect(rolled.signals.logs.resourceLogs[0].scopeLogs[0].logRecords.length).toBe(
      legacy.signals.logs.resourceLogs[0].scopeLogs[0].logRecords.length,
    );
  });

  it('reconstructs EVERY seq from a multi-line rolled logs blob (not just the tip)', () => {
    const L = [
      oneSegLogs(SID, EV1, '2026-07-01T09:01:00Z'),
      oneSegLogs(SID, EV2, '2026-07-01T09:02:00Z'),
    ];
    const M = [
      oneSegMetrics(SID, EV1, '2026-07-01T09:01:00Z'),
      oneSegMetrics(SID, EV2, '2026-07-01T09:02:00Z'),
    ];
    const rolled = combineSession(SID, shardFs(rolledShard(SID, L, M, '2026/07/01')), {
      kind: 'git-ref',
    });
    // Two concatenated logs records ⇒ two segments (the whole session, not the tip).
    expect(rolled.source.segment_count).toBe(2);
    // Tokens sum across both rolled seqs (100+200 in, 50+80 out).
    expect(rolled.summary.tokens.in).toBe(300);
    expect(rolled.summary.tokens.out).toBe(130);
  });
});

// ── sweep start-month membership over a rolled ref ───────────────────────────────

function ioFor(mode: OutputMode): { io: CliIo; out: () => string } {
  let o = '';
  const writers: Writers = { out: (t) => (o += t), err: () => {} };
  return { io: { mode, writers }, out: () => o };
}

function runSweep(args: string[], io: CliIo, fs: FakeFs, gitRead: FakeGitRead): number {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerTelemetryAct(program, io, {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-08-01T00:00:00.000Z'),
    env: new FakeEnv(),
    gitWrite: new FakeGitWrite(),
    gitRead,
  });
  expect(() => program.parse(['node', 'harness', 'telemetry', 'sweep', ...args])).toThrow(/^exit:/);
  return code;
}

describe('telemetry sweep — rolled ref start-month membership (plan 049 T003, AC-07)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a multi-day session rolled at its START date sweeps into its START month only', () => {
    // The session started 2026-06-30 and ran into 2026-07-01 → its rolled ref is
    // keyed at the START date (2026/06/30), so it belongs to JUNE, not July.
    const L = [
      oneSegLogs(SID, EV1, '2026-06-30T23:50:00Z'),
      oneSegLogs(SID, EV2, '2026-07-01T00:10:00Z'),
    ];
    const M = [
      oneSegMetrics(SID, EV1, '2026-06-30T23:50:00Z'),
      oneSegMetrics(SID, EV2, '2026-07-01T00:10:00Z'),
    ];
    const gr = new FakeGitRead({
      [telemetryRefFor('2026/06/30', SID)]: rolledShard(SID, L, M, '2026/06/30'),
    });

    // JUNE sweep INCLUDES the session (start month).
    const june = new FakeFs();
    expect(runSweep(['--month', '2026-06', '--out', '/june'], ioFor('json').io, june, gr)).toBe(0);
    const juneReport = JSON.parse(
      june.readText('/june/2026-06.report.json') as string,
    ) as TelemetryReport;
    expect(juneReport.scope.session_ids).toContain(SID);

    // JULY sweep EXCLUDES it (its ref date is in June, even though work spilled into July).
    const july = new FakeFs();
    expect(runSweep(['--month', '2026-07', '--out', '/july'], ioFor('json').io, july, gr)).toBe(0);
    const julyReport = JSON.parse(
      july.readText('/july/2026-07.report.json') as string,
    ) as TelemetryReport;
    expect(julyReport.scope.session_ids).not.toContain(SID);
  });
});
