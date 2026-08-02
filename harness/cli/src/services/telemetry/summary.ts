import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';
import { scanTelemetryBuffer } from './buffer-reader.js';
import { TELEMETRY_DIR, telemetryDir } from './cursor.js';
import { EVENT_KINDS, type Event, type EventKind } from './events.js';
import type { Segment } from './segment.js';
import { normalizeV1ToEvents } from './session-export.js';

export type EventKindCounts = Record<EventKind, number>;

export interface TelemetrySummaryDay {
  day: string;
  total: number;
  by_kind: EventKindCounts;
}

export interface TelemetryBufferSummary {
  source: string;
  sessions_scanned: number;
  segments_counted: number;
  segments_skipped: number;
  events_counted: number;
  events_skipped: number;
  undated_events: number;
  by_kind: EventKindCounts;
  by_day: TelemetrySummaryDay[];
}

export interface TelemetrySummaryDeps {
  fs: Pick<FsPort, 'readText' | 'readdir'>;
  proc: Pick<ProcessPort, 'cwd'>;
}

const EVENT_KIND_SET = new Set<string>(EVENT_KINDS);

function emptyKindCounts(): EventKindCounts {
  return Object.fromEntries(EVENT_KINDS.map((kind) => [kind, 0])) as EventKindCounts;
}

function eventsForSegment(segment: Segment): readonly unknown[] {
  const stream = (segment as unknown as { event_stream?: unknown }).event_stream;
  if (Array.isArray(stream)) return stream;
  if (stream !== undefined) return [stream];
  try {
    return normalizeV1ToEvents(segment);
  } catch {
    return [];
  }
}

function eventKind(value: unknown): EventKind | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && EVENT_KIND_SET.has(kind) ? (kind as EventKind) : null;
}

function eventTimestamp(value: unknown): unknown {
  return (value as Partial<Event>).t;
}

/** Summarize every recognized event currently retained in the local telemetry buffer. */
export function summarizeTelemetryBuffer(deps: TelemetrySummaryDeps): TelemetryBufferSummary {
  const scan = scanTelemetryBuffer(deps.fs, telemetryDir(deps.proc.cwd()));
  const byKind = emptyKindCounts();
  const days = new Map<string, TelemetrySummaryDay>();
  let eventsCounted = 0;
  let eventsSkipped = 0;
  let undatedEvents = 0;

  for (const segment of scan.segments) {
    for (const event of eventsForSegment(segment)) {
      const kind = eventKind(event);
      if (kind === null) {
        eventsSkipped++;
        continue;
      }

      eventsCounted++;
      byKind[kind]++;
      const timestamp = eventTimestamp(event);
      const epoch = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
      if (Number.isNaN(epoch)) {
        undatedEvents++;
        continue;
      }

      const day = new Date(epoch).toISOString().slice(0, 10);
      const entry = days.get(day) ?? { day, total: 0, by_kind: emptyKindCounts() };
      entry.total++;
      entry.by_kind[kind]++;
      days.set(day, entry);
    }
  }

  return {
    source: posixJoin(HARNESS_DIR, TEMP_DIR, TELEMETRY_DIR),
    sessions_scanned: scan.sessions,
    segments_counted: scan.segments.length,
    segments_skipped: scan.skippedSegments,
    events_counted: eventsCounted,
    events_skipped: eventsSkipped,
    undated_events: undatedEvents,
    by_kind: byKind,
    by_day: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
