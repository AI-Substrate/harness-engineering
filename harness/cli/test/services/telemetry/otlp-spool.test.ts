import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents } from '../../../src/services/telemetry/otlp/logs.js';
import type { LogsData, MetricsData } from '../../../src/services/telemetry/otlp/types.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { conformLogs, conformMetrics } from '../../conformance/otlp-conformance.js';

/**
 * T010 — the capture seam writes the transport-agnostic OTLP spool. A real
 * capture (FakeFs/ports) must drop `<seq>.logs.jsonl` + `<seq>.metrics.jsonl`
 * beside the segment buffer entry, both valid OTLP/JSON-Lines, and the logs must
 * reconstruct the exact serialized `event_stream` the buffer stored.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

function testAdapter(harness: string, caps: HarnessCapabilities): HarnessAdapter {
  return {
    harness,
    handles: (id) => id === harness,
    currentPosition: () => caps.event_stream?.length ?? 0,
    extract: () => caps,
  };
}

describe('OTLP spool emit at the capture seam (T010)', () => {
  const events: Event[] = [
    { t: '2026-06-23T04:00:00Z', kind: 'prompt', words: 5 },
    {
      t: '2026-06-23T04:00:10Z',
      kind: 'turn',
      dur_s: 8,
      in: 100,
      out: 40,
      model: 'claude-opus-4-8',
    },
    { t: '2026-06-23T04:00:20Z', kind: 'tools', name: 'Bash', count: 2, span_s: 3 },
  ];

  function capture(): FakeFs {
    const fs = new FakeFs({});
    const d: CaptureDeps = {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sess-1' }),
      clock: new FakeClock('2026-06-23T04:01:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [testAdapter('claude-code', { event_stream: events })],
    };
    captureTelemetry(d);
    return fs;
  }

  it('writes valid OTLP logs.jsonl + metrics.jsonl beside the buffer entry', () => {
    const fs = capture();
    const logsRaw = fs.readText(`${TEL}/sess-1/1.logs.jsonl`);
    const metricsRaw = fs.readText(`${TEL}/sess-1/1.metrics.jsonl`);
    expect(logsRaw).not.toBeNull();
    expect(metricsRaw).not.toBeNull();
    // JSON Lines: exactly one object + trailing newline.
    expect(logsRaw?.endsWith('\n')).toBe(true);
    expect((logsRaw ?? '').trimEnd().split('\n')).toHaveLength(1);

    const logs = JSON.parse((logsRaw ?? '').trim()) as LogsData;
    const metrics = JSON.parse((metricsRaw ?? '').trim()) as MetricsData;
    expect(conformLogs(logs)).toEqual({ ok: true });
    expect(conformMetrics(metrics)).toEqual({ ok: true });
  });

  it('the spooled logs reconstruct the buffer segment’s exact event_stream', () => {
    const fs = capture();
    const seg = JSON.parse(fs.readText(`${TEL}/sess-1/1.json`) ?? 'null') as Segment;
    const logs = JSON.parse((fs.readText(`${TEL}/sess-1/1.logs.jsonl`) ?? '').trim()) as LogsData;
    expect(otlpLogsToEvents(logs)).toEqual(seg.event_stream);
  });
});
