import { render } from 'ink';
import type { SensorsTuiLaunchInput } from './types.js';
import { SensorsApp } from './app.js';
import { createTerminalSession, FullScreen } from './fullscreen.js';

/** Lazy ESM entrypoint; no non-TUI module imports this statically. */
export async function launchSensorsTui(input: SensorsTuiLaunchInput): Promise<void> {
  if (input.terminal === undefined) {
    throw new Error('Interactive sensors require the composition-root terminal carrier.');
  }
  const terminal = input.terminal;
  const session = createTerminalSession(terminal);
  session.enter();
  try {
    const instance = render(
      <FullScreen terminal={terminal} session={session}>
        <SensorsApp {...input} terminal={terminal} />
      </FullScreen>,
      {
        stdin: terminal.stdin,
        stdout: terminal.stdout,
        stderr: terminal.stderr,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    try {
      await instance.waitUntilExit();
    } finally {
      instance.cleanup();
    }
  } finally {
    session.cleanup();
  }
}
