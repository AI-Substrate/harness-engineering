import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { Envelope } from '../../../output/envelope.js';
import type { SensorHistoryView, SensorStatusData, SensorStatusRead } from '../types.js';

export interface SensorsTuiTerminal {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export interface SensorsTuiActions {
  rerun(name: string): Promise<Envelope>;
  rerunAll(): Promise<Envelope>;
  snapshot(): Envelope;
  clearAndRun(): Promise<Envelope>;
  stopWatcher(): Envelope;
}

export interface SensorsTuiLaunchInput {
  initialEnvelope: Envelope;
  data: SensorStatusData;
  noColor: boolean;
  ascii: boolean;
  fs: FsPort;
  clock: Clock;
  repoRoot: string;
  terminal?: SensorsTuiTerminal;
  readStatus(): SensorStatusRead;
  readHistory(name: string): SensorHistoryView;
  actions: SensorsTuiActions;
}

export interface SensorsTuiPort {
  launch(input: SensorsTuiLaunchInput): Promise<void>;
}
