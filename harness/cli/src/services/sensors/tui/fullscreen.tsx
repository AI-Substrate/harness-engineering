import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Box, useApp } from 'ink';
import type { SensorsTuiTerminal } from './types.js';

export const ALT_SCREEN_ENTER = '\u001B[?1049h';
export const ALT_SCREEN_LEAVE = '\u001B[?1049l';

export interface TerminalSession {
  enter(): void;
  cleanup(): void;
}

/** Idempotent terminal ownership used by both React cleanup and process exit paths. */
export function createTerminalSession(terminal: SensorsTuiTerminal): TerminalSession {
  const originalRaw = terminal.stdin.isRaw === true;
  let active = false;
  return {
    enter(): void {
      if (active) return;
      active = true;
      terminal.stdout.write(ALT_SCREEN_ENTER);
    },
    cleanup(): void {
      if (!active) return;
      active = false;
      if (terminal.stdin.isTTY && typeof terminal.stdin.setRawMode === 'function') {
        try {
          terminal.stdin.setRawMode(originalRaw);
        } catch {
          // Best-effort on a stream already closing; alt-screen restoration still runs.
        }
      }
      terminal.stdin.pause();
      terminal.stdout.write(ALT_SCREEN_LEAVE);
    },
  };
}

export interface FullScreenProps {
  terminal: SensorsTuiTerminal;
  session: TerminalSession;
  children: ReactNode;
}

/** Restore alternate-buffer/raw-mode ownership on every supported exit path. */
export function FullScreen({ terminal, session, children }: FullScreenProps) {
  const { exit } = useApp();

  useEffect(() => {
    const onExit = (): void => session.cleanup();
    const onSigint = (): void => {
      session.cleanup();
      process.exitCode = 130;
      exit();
    };
    const onUncaught = (error: Error): void => {
      session.cleanup();
      process.off('uncaughtException', onUncaught);
      throw error;
    };
    process.on('exit', onExit);
    process.on('SIGINT', onSigint);
    process.on('uncaughtException', onUncaught);
    return () => {
      process.off('exit', onExit);
      process.off('SIGINT', onSigint);
      process.off('uncaughtException', onUncaught);
      session.cleanup();
    };
  }, [exit, session]);

  return (
    <Box
      flexDirection="column"
      width={terminal.stdout.columns ?? 80}
      minHeight={terminal.stdout.rows ?? 24}
    >
      {children}
    </Box>
  );
}
