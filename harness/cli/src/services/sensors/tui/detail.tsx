import { Box, Text } from 'ink';
import type { SensorHistoryView, SensorStatusItem } from '../types.js';
import { buildDetailView } from './view-model.js';

export interface SensorDetailProps {
  sensor: SensorStatusItem;
  history: SensorHistoryView;
  historyIndex: number;
  plain: boolean;
}

function line(label: string, value: string) {
  return (
    <Box>
      <Box width={12}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

/** Full-width detail overlay; no side-by-side layout at narrow widths. */
export function SensorDetail({ sensor, history, historyIndex, plain }: SensorDetailProps) {
  const model = buildDetailView(sensor, history, historyIndex, plain);
  const record = model.record;
  const reading = record?.reading;
  const state = record?.runStatus === 'ok' ? (reading?.state ?? 'unknown') : record?.runStatus;
  const stats = model.stats;
  const snapshot =
    model.snapshotDelta === null
      ? 'no comparable snapshot'
      : `${model.snapshotBaseline ?? '—'} → ${reading?.score ?? '—'} (Δ ${model.snapshotDelta >= 0 ? '+' : ''}${model.snapshotDelta})`;
  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between">
        <Text bold color={plain ? undefined : 'cyan'}>{model.sensor}</Text>
        <Text>{`${model.status.glyph} ${state ?? 'never'} · ${model.trend.glyph} ${model.trend.trend ?? 'no trend'}`}</Text>
      </Box>
      {model.playbackBanner && <Text color={plain ? undefined : 'yellow'}>{model.playbackBanner}</Text>}
      {line('summary', model.summary)}
      {line(
        'trigger',
        `${model.trigger}${model.watch.length > 0 ? `: ${model.watch.join(', ')}` : ''} · timeout ${model.timeoutMs}ms`,
      )}
      {line(
        'last run',
        record === null
          ? 'never'
          : `${record.startedAt} · ${record.runStatus} · ${record.wallclockMs}ms${stats ? ` (avg ${Math.round(stats.avgWallclockMs)}ms over ${stats.runCount} runs)` : ''}`,
      )}
      {line('streak', `${stats?.failStreak ?? 0} consecutive failures`)}
      {line('snapshot', snapshot)}
      {model.details && line('details', model.details)}
      {model.guidance && line('guidance', model.guidance)}
      {model.report && (
        <Box flexDirection="column">
          <Text dimColor>report ─────────────────────────────────────────────────────────</Text>
          <Text>{model.report}</Text>
        </Box>
      )}
      <Text dimColor>{`history ── ${model.historyLabel}`}</Text>
      {model.historyUnavailable ? (
        <Text>history unavailable</Text>
      ) : (
        <Text>{history.records.map((entry) => `${entry.runId}:${entry.runStatus}`).join('  ')}</Text>
      )}
      {model.historyNote && <Text color={plain ? undefined : 'yellow'}>{model.historyNote}</Text>}
    </Box>
  );
}
