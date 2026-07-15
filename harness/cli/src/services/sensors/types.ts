import type { SensorDecl, SensorReading } from '../extensions/contract.js';

export type SensorRunStatus = 'ok' | 'error' | 'timeout';
export type SensorRunTrigger = 'watch' | 'manual-run' | 'check';
export type SensorTrend = 'better' | 'worse' | 'steady' | null;

export interface SensorRuntimeItem {
  name: string;
  declaration: SensorDecl;
}

export interface SensorRunError {
  code: 'E211' | 'E212';
  message: string;
}

/** Persisted run outcome; runStatus and reading.state are intentionally separate (S3). */
export interface SensorRunRecord {
  sensor: string;
  runId: number;
  runStatus: SensorRunStatus;
  reading: SensorReading | null;
  error: SensorRunError | null;
  startedAt: string;
  wallclockMs: number;
  trigger: SensorRunTrigger;
  stale: boolean;
  lastTriggerHash: string | null;
}

export interface SensorStats {
  runCount: number;
  lastRunAt: string;
  lastWallclockMs: number;
  avgWallclockMs: number;
  failStreak: number;
}

export interface SensorStateFile {
  schema: 1;
  record: SensorRunRecord;
  stats: SensorStats;
}

export interface SensorStateView extends SensorStateFile {
  ageMs: number;
}

/** Playback history is newest-first in memory; the JSONL file remains newest-last. */
export interface SensorHistoryView {
  records: SensorRunRecord[];
  degraded: boolean;
  note: string | null;
}

export interface SensorDaemonFile {
  schema: 1;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  version: string;
}

export interface SensorDaemonView {
  running: boolean;
  pid: number | null;
  since: string | null;
  heartbeatAt: string | null;
  version: string | null;
}

export interface SensorSnapshotReading {
  state: SensorReading['state'];
  score?: number;
}

export interface SensorSnapshotFile {
  schema: 1;
  takenAt: string;
  readings: Record<string, SensorSnapshotReading>;
}

export interface SensorServiceError {
  code: 'E213' | 'E214';
  message: string;
  next_action: string;
}

/** Shared status truth consumed by both the JSON envelope and the TUI renderer. */
export interface SensorStatusItem {
  name: string;
  summary: string;
  trigger: 'watch' | 'manual';
  watch: string[];
  timeoutMs: number;
  record: SensorRunRecord | null;
  runStatus: SensorRunStatus | null;
  reading: SensorReading | null;
  error: SensorRunError | null;
  stats: SensorStats | null;
  ageMs: number | null;
  stale: boolean;
  delta: number | null;
  trend: SensorTrend;
  guidance: string | null;
}

export interface SensorStatusData {
  daemon: SensorDaemonView;
  snapshot: { takenAt: string } | null;
  sensors: SensorStatusItem[];
  errors?: SensorServiceError[];
}

export interface SensorStatusRead {
  data: SensorStatusData;
  stateCount: number;
}

export type SensorServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SensorServiceError };
