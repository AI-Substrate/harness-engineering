import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, useApp } from 'ink';
import type { SensorsTuiLaunchInput, SensorsTuiTerminal } from './types.js';
import type { SensorHistoryView } from '../types.js';
import { Banner } from './banner.js';
import { SensorDetail } from './detail.js';
import { Footer } from './footer.js';
import { InputRouter, type TuiInputAction, type TuiMode } from './input.js';
import { SensorTable } from './table.js';
import {
  sensorPollPaths,
  spinnerShouldRun,
  useSensorPoll,
  useSpinner,
} from './use-poll.js';
import {
  buildTableRows,
  shouldCollapseBanner,
  widthTier,
  type WidthTier,
} from './view-model.js';

export interface SensorsAppProps extends Omit<SensorsTuiLaunchInput, 'terminal'> {
  terminal: SensorsTuiTerminal;
  repoName?: string;
}

const EMPTY_HISTORY: SensorHistoryView = {
  records: [],
  degraded: true,
  note: 'history unavailable',
};

export const RESIZE_DEBOUNCE_MS = 150;

export interface TerminalSize {
  columns: number;
  rows: number;
}

export function rowsForViewport<T>(rows: readonly T[], selected: number, tier: WidthTier): T[] {
  return tier === 'minimal' && rows[selected] !== undefined ? [rows[selected]] : [...rows];
}

export class ResizeDebouncer {
  private generation = 0;

  constructor(
    private readonly clock: SensorsAppProps['clock'],
    private readonly read: () => TerminalSize,
  ) {}

  async notify(signal: AbortSignal, onResize: (size: TerminalSize) => void): Promise<void> {
    const generation = ++this.generation;
    await this.clock.sleep(RESIZE_DEBOUNCE_MS, signal);
    if (!signal.aborted && generation === this.generation) onResize(this.read());
  }
}

function useTerminalSize(terminal: SensorsTuiTerminal, clock: SensorsAppProps['clock']): TerminalSize {
  const read = useCallback(
    () => ({ columns: terminal.stdout.columns ?? 80, rows: terminal.stdout.rows ?? 24 }),
    [terminal],
  );
  const [size, setSize] = useState<TerminalSize>(read);
  const debouncer = useMemo(() => new ResizeDebouncer(clock, read), [clock, read]);
  useEffect(() => {
    const controller = new AbortController();
    const onResize = (): void => {
      void debouncer.notify(controller.signal, setSize);
    };
    terminal.stdout.on('resize', onResize);
    return () => {
      controller.abort();
      terminal.stdout.off('resize', onResize);
    };
  }, [debouncer, terminal]);
  return size;
}

export function SensorsApp(props: SensorsAppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<TuiMode>('table');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<SensorHistoryView>(EMPTY_HISTORY);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [quitArmed, setQuitArmed] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const { columns, rows } = useTerminalSize(props.terminal, props.clock);
  const plain = props.noColor === true || props.ascii === true;
  const readData = useCallback(() => props.readStatus().data, [props.readStatus]);
  const paths = useMemo(
    () => sensorPollPaths(props.repoRoot, props.data.sensors.map(({ name }) => name)),
    [props.data.sensors, props.repoRoot],
  );
  const data = useSensorPoll({
    initial: props.data,
    fs: props.fs,
    clock: props.clock,
    paths,
    read: readData,
  });
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  const queued = useMemo(() => new Set<string>(), []);
  const spinnerFrame = useSpinner(spinnerShouldRun(inFlight.size), props.clock);
  const tableRows = useMemo(() => {
    const built = buildTableRows(data.sensors, {
      columns,
      rows,
      noColor: props.noColor,
      ascii: props.ascii,
      watcherRunning: data.daemon.running,
      inFlight,
      queued,
    });
    return rowsForViewport(built, selectedIndex, widthTier(columns));
  }, [columns, data, inFlight, props.ascii, props.noColor, queued, rows, selectedIndex]);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, data.sensors.length - 1)));
  }, [data.sensors.length]);

  const handleAction = useCallback(
    async (action: TuiInputAction): Promise<void> => {
      if (action.type !== 'quit-request' && action.type !== 'quit-confirm') setQuitArmed(false);
      if (action.type === 'select') setSelectedIndex(action.index);
      else if (action.type === 'detail') {
        const sensor = data.sensors[selectedIndex];
        if (sensor) {
          setHistory(props.readHistory(sensor.name));
          setHistoryIndex(0);
          setMode('detail');
        }
      } else if (action.type === 'back') {
        setHistoryIndex(0);
        setMode('table');
      } else if (action.type === 'older') {
        setHistoryIndex((current) => Math.min(current + 1, Math.max(0, history.records.length - 1)));
      } else if (action.type === 'newer') {
        setHistoryIndex((current) => Math.max(0, current - 1));
      } else if (action.type === 'rerun') {
        const sensor = data.sensors[action.index];
        if (!sensor) return;
        setInFlight((current) => new Set(current).add(sensor.name));
        try {
          const result = await props.actions.rerun(sensor.name);
          setFlash(result.next_action ?? `${sensor.name}: ${result.status}`);
        } finally {
          setInFlight((current) => {
            const next = new Set(current);
            next.delete(sensor.name);
            return next;
          });
        }
      } else if (action.type === 'rerun-all') {
        setInFlight(new Set(data.sensors.map(({ name }) => name)));
        try {
          const result = await props.actions.rerunAll();
          setFlash(result.next_action ?? `rerun all: ${result.status}`);
        } finally {
          setInFlight(new Set());
        }
      } else if (action.type === 'snapshot') {
        const result = props.actions.snapshot();
        setFlash(result.next_action ?? `snapshot: ${result.status}`);
      } else if (action.type === 'clear-rerun') {
        setInFlight(new Set(data.sensors.map(({ name }) => name)));
        try {
          const result = await props.actions.clearAndRun();
          setFlash(result.next_action ?? `clear+rerun: ${result.status}`);
        } finally {
          setInFlight(new Set());
        }
      } else if (action.type === 'quit-request') {
        setQuitArmed(true);
        setFlash('q again to stop sensors');
      } else if (action.type === 'quit-confirm') {
        props.actions.stopWatcher();
        exit();
      } else if (action.type === 'close') {
        exit();
      }
    },
    [
      data.sensors,
      exit,
      history.records.length,
      props.actions,
      props.readHistory,
      selectedIndex,
    ],
  );
  const onAction = useCallback(
    (action: TuiInputAction): void => {
      void handleAction(action);
    },
    [handleAction],
  );
  const selected = data.sensors[selectedIndex];

  return (
    <Box
      flexDirection="column"
      borderStyle={props.ascii ? 'classic' : 'single'}
      borderColor={plain ? undefined : 'cyan'}
      width={columns}
      minHeight={rows}
    >
      <Banner
        collapsed={shouldCollapseBanner({ columns, rows, ascii: props.ascii })}
        repoName={props.repoName ?? 'repository'}
        daemon={data.daemon}
        snapshotAt={data.snapshot?.takenAt ?? null}
        noColor={plain}
      />
      {mode === 'detail' && selected ? (
        <SensorDetail
          sensor={selected}
          history={history}
          historyIndex={historyIndex}
          plain={plain}
        />
      ) : (
        <SensorTable
          rows={tableRows}
          selectedIndex={widthTier(columns) === 'minimal' ? 0 : selectedIndex}
          spinnerFrame={spinnerFrame}
        />
      )}
      <Footer
        mode={mode}
        rowCount={data.sensors.length}
        guidance={flash ?? (mode === 'table' ? (selected?.guidance ?? null) : null)}
        plain={plain}
      />
      <InputRouter
        mode={mode}
        selectedIndex={selectedIndex}
        rowCount={data.sensors.length}
        quitArmed={quitArmed}
        onAction={onAction}
      />
    </Box>
  );
}
