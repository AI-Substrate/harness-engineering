import type { Envelope } from './envelope.js';

/**
 * The sink the kernel exits through. Concrete human/JSON renderers (output-port.ts
 * § T008) implement this; defining it here keeps `exit.ts` free of renderer details.
 */
export interface OutputPort {
  emit(env: Envelope): void;
}

export type OutputMode = 'json' | 'human';

/**
 * Where rendered text goes. Injected so renderers are unit-testable without
 * touching real process streams.
 */
export interface Writers {
  out(text: string): void;
  err(text: string): void;
}

/** Default writers — the real process streams. */
export const processWriters: Writers = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
};

/**
 * Human-vs-JSON selection precedence (highest wins):
 *   1. explicit --json / --no-json flag
 *   2. HARNESS_JSON=1 env (CI, where TTY detection is unreliable)
 *   3. TTY detection: piped (!isTty) => json, interactive => human
 */
export function selectMode(
  flags: { json?: boolean },
  env: NodeJS.ProcessEnv,
  isTty: boolean,
): OutputMode {
  if (flags.json === true) {
    return 'json';
  }
  if (flags.json === false) {
    return 'human';
  }
  if (env.HARNESS_JSON === '1') {
    return 'json';
  }
  return isTty ? 'human' : 'json';
}

/** JSON renderer — one parseable line to stdout. */
export function renderJson(env: Envelope, writers: Writers = processWriters): void {
  writers.out(`${JSON.stringify(env)}\n`);
}

/**
 * Human renderer — progress/diagnostics (here, the next_action) go to stderr;
 * the final one-line summary goes to stdout (so `harness ... | …` pipes the summary).
 */
export function renderHuman(env: Envelope, writers: Writers = processWriters): void {
  if (env.next_action) {
    writers.err(`→ ${env.next_action}\n`);
  }
  writers.out(`${env.command}: ${env.status}\n`);
}

/** Build an OutputPort for a selected mode. */
export function createOutputPort(mode: OutputMode, writers: Writers = processWriters): OutputPort {
  return {
    emit(env: Envelope): void {
      if (mode === 'json') {
        renderJson(env, writers);
      } else {
        renderHuman(env, writers);
      }
    },
  };
}

/**
 * Convenience composition of `selectMode` + `createOutputPort` — the one call
 * acts use to turn resolved flags/env/TTY into an OutputPort. Keeps acts free
 * of mode-selection details.
 */
export function makeOutputPort(
  flags: { json?: boolean },
  env: NodeJS.ProcessEnv,
  isTty: boolean,
  writers: Writers = processWriters,
): OutputPort {
  return createOutputPort(selectMode(flags, env, isTty), writers);
}
