import { memo } from 'react';
import { Box, Text } from 'ink';
import type { TableRowModel } from './view-model.js';

export interface SensorRowProps {
  row: TableRowModel;
  selected: boolean;
  spinnerFrame?: string;
}

function StatusText({ row, spinnerFrame }: Pick<SensorRowProps, 'row' | 'spinnerFrame'>) {
  const color = row.status.color === 'dim' ? undefined : (row.status.color ?? undefined);
  return (
    <Text color={color} dimColor={row.status.color === 'dim'}>
      {row.status.meaning === 'running' && spinnerFrame ? spinnerFrame : row.status.glyph}
    </Text>
  );
}

/** Memoized fixed-width row; unchanged sensor data does not re-render on a poll tick. */
export const SensorRow = memo(function SensorRow({ row, selected, spinnerFrame }: SensorRowProps) {
  const full = row.columns.includes('Run');
  const reduced = row.columns.includes('#');
  return (
    <Box>
      {reduced && <Text>{`${row.hotkey.padStart(2)} `}</Text>}
      <Text color={selected ? 'cyan' : undefined} bold={selected}>
        {row.sensor.padEnd(full ? 16 : 18).slice(0, full ? 16 : 18)}
      </Text>
      {reduced && <Text>{`${row.when.padEnd(8)} `}</Text>}
      <Box width={4}>
        <StatusText row={row} spinnerFrame={spinnerFrame} />
      </Box>
      {row.trend && (
        <Text color={row.trend.color === 'dim' ? undefined : row.trend.color}>
          {`${row.trend.glyph.padEnd(6)}`}
        </Text>
      )}
      {reduced && <Text>{`${row.lastRun.padEnd(13).slice(0, 13)} `}</Text>}
      {row.run !== null && <Text>{`${row.run.padEnd(14).slice(0, 14)} `}</Text>}
      <Text>{row.details}</Text>
    </Box>
  );
});

export interface SensorTableProps {
  rows: readonly TableRowModel[];
  selectedIndex: number;
  spinnerFrame?: string;
}

export function SensorTable({ rows, selectedIndex, spinnerFrame }: SensorTableProps) {
  if (rows.length === 0) {
    return (
      <Box justifyContent="center" paddingY={1}>
        <Text>No sensor state yet — press c to run all, or start the watcher.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <SensorRow
          key={row.key}
          row={row}
          selected={index === selectedIndex}
          spinnerFrame={spinnerFrame}
        />
      ))}
    </Box>
  );
}
