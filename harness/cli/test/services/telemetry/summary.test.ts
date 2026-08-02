import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { EVENT_KINDS } from '../../../src/services/telemetry/events.js';
import { summarizeTelemetryBuffer } from '../../../src/services/telemetry/summary.js';

const TEL = '/repo/.harness/temp/telemetry';

function segment(event_stream: unknown[], timecode = '2026-07-01T00:00:00Z'): string {
  return JSON.stringify({ timecode, event_stream });
}

describe('summarizeTelemetryBuffer', () => {
  it('counts recognized events by kind and UTC day in deterministic order', () => {
    const fs = new FakeFs(
      {
        [`${TEL}/a/2.json`]: segment([
          { t: '2026-07-02T00:30:00+02:00', kind: 'prompt', words: 3 },
          { t: 'not-a-time', kind: 'turn', dur_s: 1 },
          { t: '2026-07-01T23:00:00Z', kind: 'future-kind' },
        ]),
        [`${TEL}/z/1.json`]: segment([
          { t: '2026-07-02T01:00:00Z', kind: 'tools', name: 'Bash', count: 2, span_s: 1 },
        ]),
      },
      {
        [TEL]: ['z', '.cursor', 'a'],
        [`${TEL}/a`]: ['2.json'],
        [`${TEL}/z`]: ['1.json'],
      },
    );

    const result = summarizeTelemetryBuffer({
      fs,
      proc: new FakeProcess({}, '/repo'),
    });

    expect(result).toMatchObject({
      source: '.harness/temp/telemetry',
      sessions_scanned: 2,
      segments_counted: 2,
      segments_skipped: 0,
      events_counted: 3,
      events_skipped: 1,
      undated_events: 1,
    });
    expect(Object.keys(result.by_kind)).toEqual(EVENT_KINDS);
    expect(result.by_kind).toMatchObject({ prompt: 1, turn: 1, tools: 1 });
    expect(result.by_day.map((entry) => entry.day)).toEqual(['2026-07-01', '2026-07-02']);
    expect(result.by_day[0]).toMatchObject({
      day: '2026-07-01',
      total: 1,
      by_kind: { prompt: 1 },
    });
    expect(result.by_day[1]).toMatchObject({
      day: '2026-07-02',
      total: 1,
      by_kind: { tools: 1 },
    });
    expect(Object.keys(result.by_day[0].by_kind)).toEqual(EVENT_KINDS);
  });

  it('returns an honest zero summary for an absent buffer', () => {
    const result = summarizeTelemetryBuffer({
      fs: new FakeFs(),
      proc: new FakeProcess({}, '/repo'),
    });

    expect(result).toEqual({
      source: '.harness/temp/telemetry',
      sessions_scanned: 0,
      segments_counted: 0,
      segments_skipped: 0,
      events_counted: 0,
      events_skipped: 0,
      undated_events: 0,
      by_kind: Object.fromEntries(EVENT_KINDS.map((kind) => [kind, 0])),
      by_day: [],
    });
  });

  it('normalizes legacy segments and reports malformed segments and events', () => {
    const legacy = JSON.stringify({
      timecode: '2026-07-03T09:00:00Z',
      tokens: { input: 10, output: 2 },
      skills: { builder: 2 },
      tools: { Bash: 3 },
      harness_commands: ['doctor'],
    });
    const fs = new FakeFs(
      {
        [`${TEL}/a/1.json`]: legacy,
        [`${TEL}/a/2.json`]: '{bad',
        [`${TEL}/a/3.json`]: '[]',
        [`${TEL}/a/4.json`]: segment([
          null,
          { t: '2026-07-03T10:00:00Z', kind: 'unknown' },
          { t: 'invalid', kind: 'prompt', words: 1 },
        ]),
      },
      {
        [TEL]: ['a'],
        [`${TEL}/a`]: ['4.json', '2.json', '1.json', '3.json'],
      },
    );

    const result = summarizeTelemetryBuffer({
      fs,
      proc: new FakeProcess({}, '/repo'),
    });

    expect(result).toMatchObject({
      sessions_scanned: 1,
      segments_counted: 2,
      segments_skipped: 2,
      events_counted: 6,
      events_skipped: 2,
      undated_events: 1,
      by_kind: { turn: 1, skill: 2, tools: 1, harness: 1, prompt: 1 },
    });
    expect(result.by_day).toHaveLength(1);
    expect(result.by_day[0]).toMatchObject({ day: '2026-07-03', total: 5 });
  });

  it('uses filesystem reads only', () => {
    const fs = new FakeFs(
      { [`${TEL}/a/1.json`]: segment([{ t: '2026-07-01T00:00:00Z', kind: 'prompt' }]) },
      { [TEL]: ['a'], [`${TEL}/a`]: ['1.json'] },
    );

    summarizeTelemetryBuffer({ fs, proc: new FakeProcess({}, '/repo') });

    expect(fs.reads.length).toBeGreaterThan(0);
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
    expect(fs.removedDirs).toEqual([]);
    expect(fs.copies).toEqual([]);
    expect(fs.copyDirs).toEqual([]);
  });
});
