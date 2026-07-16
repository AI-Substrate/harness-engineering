import type { SensorReading } from '../../extensions/contract.js';
import type {
  SensorHistoryView,
  SensorRunRecord,
  SensorStatusItem,
  SensorTrend,
} from '../types.js';

export type WidthTier = 'full' | 'reduced' | 'minimal';
export type TableColumn = '#' | 'Sensor' | 'When' | 'St' | 'Trend' | 'Last Run' | 'Run' | 'Details';
export type VisualStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'skip'
  | 'error'
  | 'timeout'
  | 'running'
  | 'queued'
  | 'unknown';
export type GlyphColor = 'green' | 'yellow' | 'red' | 'cyan' | 'dim' | null;

export interface GlyphModel {
  glyph: string;
  color: GlyphColor;
  meaning: VisualStatus;
}

export interface TrendModel {
  glyph: '↗' | '→' | '▲' | '—';
  color: 'green' | 'yellow' | 'red' | 'dim';
  trend: SensorTrend;
}

export interface TableRowModel {
  key: string;
  hotkey: string;
  sensor: string;
  when: 'watch' | 'manual';
  status: GlyphModel;
  trend: TrendModel | null;
  lastRun: string;
  run: string | null;
  details: string;
  columns: readonly TableColumn[];
}

export interface TableViewOptions {
  columns: number;
  rows: number;
  noColor?: boolean;
  ascii?: boolean;
  watcherRunning: boolean;
  inFlight?: ReadonlySet<string>;
  queued?: ReadonlySet<string>;
  detailsWidth?: number;
}

export interface DetailViewModel {
  sensor: string;
  summary: string;
  status: GlyphModel;
  trend: TrendModel;
  trigger: 'watch' | 'manual';
  watch: string[];
  timeoutMs: number;
  record: SensorRunRecord | null;
  stats: SensorStatusItem['stats'];
  details: string | null;
  report: string | null;
  guidance: string | null;
  snapshotDelta: number | null;
  snapshotBaseline: number | null;
  historyUnavailable: boolean;
  historyNote: string | null;
  historyIndex: number;
  historyCount: number;
  playbackBanner: string | null;
  historyLabel: string;
}

const COLOR_GLYPHS: Readonly<Record<VisualStatus, Omit<GlyphModel, 'meaning'>>> = {
  pass: { glyph: '●', color: 'green' },
  warn: { glyph: '●', color: 'yellow' },
  fail: { glyph: '●', color: 'red' },
  skip: { glyph: '◌', color: 'dim' },
  error: { glyph: '✖', color: 'red' },
  timeout: { glyph: '⧖', color: 'red' },
  running: { glyph: '◐', color: 'cyan' },
  queued: { glyph: '·', color: 'dim' },
  unknown: { glyph: '·', color: 'dim' },
};

const PLAIN_GLYPHS: Readonly<Record<VisualStatus, string>> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  skip: '-',
  error: 'E',
  timeout: 'T',
  running: '~',
  queued: '.',
  unknown: '-',
};

const COLUMNS: Readonly<Record<WidthTier, readonly TableColumn[]>> = {
  full: ['#', 'Sensor', 'When', 'St', 'Trend', 'Last Run', 'Run', 'Details'],
  reduced: ['#', 'Sensor', 'When', 'St', 'Last Run', 'Run', 'Details'],
  minimal: ['Sensor', 'St', 'Details'],
};

/** A row becomes age-stale after 15 minutes; watcher liveness remains header-only. */
export const STALE_AFTER_MS = 15 * 60_000;

export function widthTier(columns: number): WidthTier {
  if (columns >= 100) return 'full';
  if (columns >= 84) return 'reduced';
  return 'minimal';
}

export function columnsForTier(tier: WidthTier): readonly TableColumn[] {
  return COLUMNS[tier];
}

export function shouldCollapseBanner(input: {
  columns: number;
  rows: number;
  ascii?: boolean;
}): boolean {
  return input.ascii === true || input.rows < 20 || input.columns < 84;
}

export function statusGlyph(status: VisualStatus, plain = false): GlyphModel {
  if (plain) return { glyph: PLAIN_GLYPHS[status], color: null, meaning: status };
  return { ...COLOR_GLYPHS[status], meaning: status };
}

export function trendGlyph(trend: SensorTrend): TrendModel {
  if (trend === 'better') return { glyph: '↗', color: 'green', trend };
  if (trend === 'steady') return { glyph: '→', color: 'yellow', trend };
  if (trend === 'worse') return { glyph: '▲', color: 'red', trend };
  return { glyph: '—', color: 'dim', trend: null };
}

export function visualStatus(
  sensor: Pick<SensorStatusItem, 'runStatus' | 'reading'>,
  inFlight = false,
  queued = false,
): VisualStatus {
  if (inFlight) return 'running';
  if (queued) return 'queued';
  if (sensor.runStatus === 'error') return 'error';
  if (sensor.runStatus === 'timeout') return 'timeout';
  if (sensor.runStatus === 'ok' && sensor.reading !== null) return sensor.reading.state;
  return 'unknown';
}

export function humanizeAge(ageMs: number | null): string {
  if (ageMs === null) return 'never';
  if (ageMs < 1_000) return 'now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const points = Array.from(text.replace(/\s+/g, ' ').trim());
  if (points.length <= maxWidth) return points.join('');
  if (maxWidth === 1) return '…';
  return `${points.slice(0, maxWidth - 1).join('')}…`;
}

function readingDetails(reading: SensorReading | null): string {
  if (reading === null) return '';
  if (reading.details) return reading.details;
  return reading.score === undefined ? reading.state : `${reading.state} (${reading.score})`;
}

function detailsFor(sensor: SensorStatusItem): string {
  if (sensor.runStatus === 'error' || sensor.runStatus === 'timeout') {
    return sensor.error === null
      ? sensor.runStatus
      : `${sensor.error.code} ${sensor.error.message}`;
  }
  return readingDetails(sensor.reading);
}

function lastRunFor(sensor: SensorStatusItem): string {
  const suffixes: string[] = [];
  if ((sensor.stats?.failStreak ?? 0) >= 2) suffixes.push(`✗${sensor.stats?.failStreak}`);
  const ageStale = sensor.ageMs !== null && sensor.ageMs > STALE_AFTER_MS;
  if (sensor.record?.stale === true || ageStale) suffixes.push('⚠');
  return [humanizeAge(sensor.ageMs), ...suffixes].join(' ');
}

function runFor(sensor: SensorStatusItem, inFlight: boolean): string {
  if (inFlight) return `${formatDuration(sensor.stats?.lastWallclockMs ?? 0)}…`;
  if (sensor.stats === null) return '—';
  return `${formatDuration(sensor.stats.lastWallclockMs)} ~${formatDuration(sensor.stats.avgWallclockMs)}`;
}

export function buildTableRows(
  sensors: readonly SensorStatusItem[],
  options: TableViewOptions,
): TableRowModel[] {
  const tier = widthTier(options.columns);
  const columns = columnsForTier(tier);
  const plain = options.noColor === true || options.ascii === true;
  const desiredDetails = tier === 'full' ? 40 : tier === 'reduced' ? 52 : 60;
  const fixedWidth = tier === 'full' ? 69 : tier === 'reduced' ? 63 : 24;
  const maxDetails =
    options.detailsWidth ?? Math.max(1, Math.min(desiredDetails, options.columns - fixedWidth));
  return sensors.map((sensor, index) => {
    const inFlight = options.inFlight?.has(sensor.name) ?? false;
    const queued = options.queued?.has(sensor.name) ?? false;
    return {
      key: sensor.name,
      hotkey: index < 9 && tier !== 'minimal' ? String(index + 1) : '',
      sensor: sensor.name,
      when: sensor.trigger,
      status: statusGlyph(visualStatus(sensor, inFlight, queued), plain),
      trend: columns.includes('Trend') ? trendGlyph(sensor.trend) : null,
      lastRun: lastRunFor(sensor),
      run: columns.includes('Run') ? runFor(sensor, inFlight) : null,
      details: truncate(detailsFor(sensor), maxDetails),
      columns,
    };
  });
}

function selectedRecord(
  sensor: SensorStatusItem,
  history: SensorHistoryView,
  requestedIndex: number,
): { record: SensorRunRecord | null; index: number } {
  const maxIndex = Math.max(0, history.records.length - 1);
  const index = Math.min(Math.max(0, requestedIndex), maxIndex);
  return { record: history.records[index] ?? sensor.record, index };
}

export function buildDetailView(
  sensor: SensorStatusItem,
  history: SensorHistoryView,
  requestedIndex = 0,
  plain = false,
): DetailViewModel {
  const selected = selectedRecord(sensor, history, requestedIndex);
  const record = selected.record;
  const runTotal = sensor.stats?.runCount ?? history.records.length;
  const live = selected.index === 0;
  const currentScore = record?.reading?.score;
  const snapshotBaseline =
    currentScore !== undefined && sensor.delta !== null ? currentScore - sensor.delta : null;
  return {
    sensor: sensor.name,
    summary: sensor.summary,
    status: statusGlyph(
      visualStatus({ runStatus: record?.runStatus ?? null, reading: record?.reading ?? null }),
      plain,
    ),
    trend: trendGlyph(sensor.trend),
    trigger: sensor.trigger,
    watch: [...sensor.watch],
    timeoutMs: sensor.timeoutMs,
    record,
    stats: sensor.stats,
    details: record?.reading?.details ?? null,
    report: record?.reading?.report ?? null,
    guidance: record?.reading?.guidance ?? sensor.guidance,
    snapshotDelta: sensor.delta,
    snapshotBaseline,
    historyUnavailable: history.records.length === 0,
    historyNote: history.note,
    historyIndex: selected.index,
    historyCount: history.records.length,
    playbackBanner:
      live || record === null
        ? null
        : `⏪ viewing run ${record.runId} of ${runTotal} — → to return to live`,
    historyLabel:
      record === null
        ? 'history unavailable'
        : `run ${record.runId} of ${runTotal}${live ? ' (live)' : ''}`,
  };
}
