import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin } from '../shared/posix-path.js';
import type { Segment } from './segment.js';

export type TelemetryBufferFs = Pick<FsPort, 'readText' | 'readdir'>;

export interface TelemetryBufferScan {
  sessions: number;
  segments: Segment[];
  skippedSegments: number;
}

function isSegment(value: unknown): value is Segment {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read every numeric segment JSON file under a telemetry buffer in stable
 * session/sequence order. Unreadable, invalid, and non-object JSON files are
 * counted and skipped; the buffer is never mutated.
 */
export function scanTelemetryBuffer(
  fs: TelemetryBufferFs,
  telemetryRoot: string,
): TelemetryBufferScan {
  const segments: Segment[] = [];
  let skippedSegments = 0;
  const sessions = fs
    .readdir(telemetryRoot)
    .filter((name) => !name.includes('.'))
    .sort();

  for (const session of sessions) {
    const sessionDir = posixJoin(telemetryRoot, session);
    const files = fs
      .readdir(sessionDir)
      .map((name) => {
        const match = /^(\d+)\.json$/.exec(name);
        return match === null ? null : { name, seq: Number.parseInt(match[1], 10) };
      })
      .filter((entry): entry is { name: string; seq: number } => entry !== null)
      .sort((a, b) => a.seq - b.seq);

    for (const file of files) {
      const raw = fs.readText(posixJoin(sessionDir, file.name));
      if (raw === null) {
        skippedSegments++;
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isSegment(parsed)) {
          segments.push(parsed);
        } else {
          skippedSegments++;
        }
      } catch {
        skippedSegments++;
      }
    }
  }

  return { sessions: sessions.length, segments, skippedSegments };
}
