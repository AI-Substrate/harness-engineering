import { Box, Text } from 'ink';
import type { SensorDaemonView } from '../types.js';

export const SENSORS_WORDMARK = `█▀▀▀▀  █▀▀▀▀  █▄  █  █▀▀▀▀  ▄▀▀▀▄  █▀▀▀▄  █▀▀▀▀
▀▀▀▀█  █▀▀▀▀  █ ▀▄█  ▀▀▀▀█  █   █  █▀█▀   ▀▀▀▀█
▀▀▀▀▀  ▀▀▀▀▀  ▀   ▀  ▀▀▀▀▀   ▀▀▀   ▀  ▀   ▀▀▀▀▀`;

export interface BannerProps {
  collapsed: boolean;
  repoName: string;
  daemon: SensorDaemonView;
  snapshotAt: string | null;
  noColor: boolean;
}

function watcherText(daemon: SensorDaemonView): string {
  if (!daemon.running) return 'watcher ○ STOPPED — readings stale';
  return `watcher ● running (pid ${daemon.pid ?? '?'})`;
}

export function Banner({ collapsed, repoName, daemon, snapshotAt, noColor }: BannerProps) {
  if (collapsed) {
    return (
      <Box flexDirection="column">
        <Text bold>SENSORS</Text>
        <Text dimColor={!noColor}>{`${repoName} · ${watcherText(daemon)}`}</Text>
        <Text dimColor={!noColor}>
          {snapshotAt === null
            ? 'no snapshot — press s to set a baseline'
            : `snapshot: ${snapshotAt}`}
        </Text>
      </Box>
    );
  }
  const lines = SENSORS_WORDMARK.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={line}>
          <Text color={noColor ? undefined : 'cyan'} dimColor={!noColor}>
            {line}
          </Text>
          <Text>{`  ${index === 0 ? repoName : index === 1 ? watcherText(daemon) : ''}`}</Text>
        </Box>
      ))}
      <Text dimColor={!noColor}>
        {snapshotAt === null
          ? 'no snapshot — press s to set a baseline'
          : `snapshot: ${snapshotAt}`}
      </Text>
    </Box>
  );
}
