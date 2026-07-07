import { describe, expect, it } from 'vitest';
import type { Event, FileEvent } from '../../../../src/services/telemetry/events.js';
import {
  otlpLogsToEvents,
  segmentToOtlpLogs,
} from '../../../../src/services/telemetry/otlp/logs.js';
import { A } from '../../../../src/services/telemetry/otlp/semconv.js';
import { type Segment, serializeSegment } from '../../../../src/services/telemetry/segment.js';

/**
 * plan 056 · T004 — the `file` event's OTLP log round-trip + the frozen attribute
 * contract. A `file` event must survive segment → OTLP Logs → reconstruct byte-
 * faithfully (encode + decode are inverses), and its `harness.file.*` attributes
 * must be part of the frozen `A` vocabulary the schema pins.
 */

const REPO = '/repo';

function segmentWithFile(file: FileEvent): Segment {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'file-otlp',
      timecode: '2026-07-07T09:00:00Z',
      window: { since: 'session-start', from: 0, to: 3 },
      branch: null,
      event_stream: [
        { t: '2026-07-07T09:00:00Z', kind: 'prompt', words: 5 },
        file,
        { t: '2026-07-07T09:00:02Z', kind: 'turn', dur_s: 2 },
      ],
    },
    REPO,
  );
}

describe('OTLP file event round-trip (T004)', () => {
  const file: FileEvent = {
    t: '2026-07-07T09:00:01Z',
    kind: 'file',
    path: 'src/app.ts',
    change: 'edited',
    delta: { lines_added: 4, lines_removed: 2, bytes_added: 40, bytes_removed: 18 },
  };

  it('AC-05: a file event reconstructs byte-faithfully through OTLP Logs', () => {
    const seg = segmentWithFile(file);
    const recon: Event[] = otlpLogsToEvents(segmentToOtlpLogs(seg));
    expect(recon).toEqual(seg.event_stream);
    const reconFile = recon.find((e) => e.kind === 'file') as FileEvent;
    expect(reconFile).toEqual(file);
  });

  it('AC-05: a written file (delta removed=0) survives the round-trip', () => {
    const written: FileEvent = {
      t: '2026-07-07T09:00:01Z',
      kind: 'file',
      path: 'src/new.ts',
      change: 'written',
      delta: { lines_added: 10, lines_removed: 0, bytes_added: 120, bytes_removed: 0 },
    };
    const seg = segmentWithFile(written);
    const recon = otlpLogsToEvents(segmentToOtlpLogs(seg));
    expect(recon).toEqual(seg.event_stream);
  });

  it('freeze: the semconv A vocabulary carries all six harness.file.* attrs', () => {
    const fileAttrs = Object.values(A).filter((a) => a.startsWith('harness.file.'));
    expect(new Set(fileAttrs)).toEqual(
      new Set([
        'harness.file.path',
        'harness.file.change',
        'harness.file.lines_added',
        'harness.file.lines_removed',
        'harness.file.bytes_added',
        'harness.file.bytes_removed',
      ]),
    );
  });
});
