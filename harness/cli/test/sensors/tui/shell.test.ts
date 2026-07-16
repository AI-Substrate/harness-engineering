import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  RESIZE_DEBOUNCE_MS,
  ResizeDebouncer,
  rowsForViewport,
} from '../../../src/services/sensors/tui/app.js';
import { Footer, footerRegions } from '../../../src/services/sensors/tui/footer.js';
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  createTerminalSession,
} from '../../../src/services/sensors/tui/fullscreen.js';
import { type InputRouteState, routeInput } from '../../../src/services/sensors/tui/input.js';
import { SensorRow } from '../../../src/services/sensors/tui/table.js';
import type { SensorsTuiTerminal } from '../../../src/services/sensors/tui/types.js';
import {
  CoalescedPoller,
  POLL_MS,
  SPINNER_FRAMES,
  SPINNER_MS,
  sensorPollPaths,
  spinnerShouldRun,
} from '../../../src/services/sensors/tui/use-poll.js';

const NO_KEY = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: false,
  escape: false,
};
const TABLE: InputRouteState = {
  mode: 'table',
  selectedIndex: 1,
  rowCount: 3,
  quitArmed: false,
};

describe('TUI shell traps (workshop 003 D9)', () => {
  it('enters/leaves alt-screen once and restores the original raw-mode state', () => {
    const output: string[] = [];
    const rawCalls: boolean[] = [];
    const terminal = {
      stdin: {
        isTTY: true,
        isRaw: false,
        setRawMode(value: boolean) {
          rawCalls.push(value);
          this.isRaw = value;
          return this;
        },
        pause() {
          return this;
        },
      },
      stdout: { write: (text: string) => output.push(text) },
      stderr: { write: () => true },
    } as unknown as SensorsTuiTerminal;
    const session = createTerminalSession(terminal);

    session.enter();
    session.enter();
    terminal.stdin.setRawMode?.(true);
    session.cleanup();
    session.cleanup();

    expect(output).toEqual([ALT_SCREEN_ENTER, ALT_SCREEN_LEAVE]);
    expect(rawCalls).toEqual([true, false]);
  });

  it('routes all global keys through one pure mode-aware decision', () => {
    expect(routeInput('', { ...NO_KEY, upArrow: true }, TABLE)).toEqual({
      type: 'select',
      index: 0,
    });
    expect(routeInput('', { ...NO_KEY, downArrow: true }, TABLE)).toEqual({
      type: 'select',
      index: 2,
    });
    expect(routeInput('', { ...NO_KEY, return: true }, TABLE)).toEqual({ type: 'detail' });
    expect(routeInput('2', NO_KEY, TABLE)).toEqual({ type: 'rerun', index: 1 });
    expect(routeInput('a', NO_KEY, TABLE)).toEqual({ type: 'rerun-all' });
    expect(routeInput('q', NO_KEY, TABLE)).toEqual({ type: 'quit-request' });
    expect(routeInput('q', NO_KEY, { ...TABLE, quitArmed: true })).toEqual({
      type: 'quit-confirm',
    });
    expect(routeInput('', { ...NO_KEY, leftArrow: true }, { ...TABLE, mode: 'detail' })).toEqual({
      type: 'older',
    });
    expect(routeInput('', { ...NO_KEY, escape: true }, { ...TABLE, mode: 'detail' })).toEqual({
      type: 'back',
    });
  });

  it('renders actual numbered-row range and guidance in a separate footer region', () => {
    const regions = footerRegions('table', 4, 'Fix the selected sensor.');
    expect(regions).toEqual({
      guidance: 'Fix the selected sensor.',
      hints: expect.stringContaining('1-4 re-run'),
    });
    expect(regions.hints).toContain('a run all');
    expect(footerRegions('table', 12, null).hints).toContain('1-9 re-run');

    const element = Footer({
      mode: 'table',
      rowCount: 4,
      guidance: regions.guidance,
      plain: false,
    }) as unknown as { props: { flexDirection: string; children: unknown[] } };
    expect(element.props.flexDirection).toBe('column');
    expect(element.props.children).toHaveLength(2);
  });

  it('polls only status-truth files and ignores sensor-owned coverage artifacts', () => {
    const paths = sensorPollPaths('/repo', ['tests', 'coverage-branch']);
    expect(paths).toEqual([
      '/repo/.harness/temp/sensors/daemon.json',
      '/repo/.harness/temp/sensors/snapshot.json',
      '/repo/.harness/temp/sensors/state/tests.json',
      '/repo/.harness/temp/sensors/state/coverage-branch.json',
    ]);
    expect(paths.some((path) => path.includes('/coverage/'))).toBe(false);
  });

  it('coalesces multiple changed mtimes into one read/update per fake-clock poll', async () => {
    const daemon = '/repo/.harness/temp/sensors/daemon.json';
    const state = '/repo/.harness/temp/sensors/state/lint.json';
    const fs = new FakeFs({ [daemon]: '{}', [state]: '{}' }, {}, { [daemon]: 1, [state]: 1 });
    const clock = new FakeClock('2026-07-15T02:11:04.512Z');
    let reads = 0;
    const updates: number[] = [];
    const poller = new CoalescedPoller(fs, [daemon, state], () => {
      reads += 1;
      return reads;
    });
    const controller = new AbortController();
    const running = poller.run(clock, controller.signal, (value) => updates.push(value));

    fs.setMtime(daemon, 2);
    fs.setMtime(state, 3);
    clock.advance(POLL_MS);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await running;

    expect(reads).toBe(1);
    expect(updates).toEqual([1]);
    expect(fs.mtimeReads).toEqual([daemon, state, daemon, state]);
  });

  it('debounces rapid resize events to one latest fake-clock update', async () => {
    const clock = new FakeClock('2026-07-15T02:11:04.512Z');
    let columns = 100;
    const updates: Array<{ columns: number; rows: number }> = [];
    const debouncer = new ResizeDebouncer(clock, () => ({ columns, rows: 24 }));
    const controller = new AbortController();

    const first = debouncer.notify(controller.signal, (size) => updates.push(size));
    columns = 90;
    const second = debouncer.notify(controller.signal, (size) => updates.push(size));
    columns = 70;
    const third = debouncer.notify(controller.signal, (size) => updates.push(size));
    clock.advance(RESIZE_DEBOUNCE_MS);
    await Promise.all([first, second, third]);

    expect(updates).toEqual([{ columns: 70, rows: 24 }]);
  });

  it('shows only the selected sensor in the minimal tier', () => {
    expect(rowsForViewport(['a', 'b', 'c'], 1, 'minimal')).toEqual(['b']);
    expect(rowsForViewport(['a', 'b', 'c'], 1, 'reduced')).toEqual(['a', 'b', 'c']);
  });

  it('memoizes sensor rows and enables the spinner only for in-flight work', () => {
    expect((SensorRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
    expect(spinnerShouldRun(0)).toBe(false);
    expect(spinnerShouldRun(1)).toBe(true);
  });

  it('pins the spinner cadence and single-width braille sequence', () => {
    expect(SPINNER_MS).toBe(120);
    expect(SPINNER_FRAMES).toHaveLength(10);
    expect(SPINNER_FRAMES.every((frame) => Array.from(frame).length === 1)).toBe(true);
  });
});
