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

export type SensorServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SensorServiceError };
