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
 * Resolved per-invocation I/O, computed ONCE by the entrypoint and threaded to
 * acts. Acts must NOT re-derive the mode from `program.opts()` — commander
 * collapses `--json`/`--no-json` to a boolean and loses the "flag absent" state
 * that lets env/TTY decide. The entrypoint resolves it via `jsonFlag(argv)`.
 */
export interface CliIo {
  mode: OutputMode;
  writers: Writers;
  /**
   * Whether this invocation may attach an interactive renderer. The entrypoint
   * resolves `stdout.isTTY && TERM !== 'dumb'` once; acts never inspect process streams.
   * Optional only for legacy injected call sites, where omission means false.
   */
  interactive?: boolean;
  /** Force the sensors TUI's ASCII borders and shape-distinct glyph set. */
  ascii?: boolean;
  /**
   * Whether the hand-rolled `harness help` renderer should emit ANSI color.
   * Resolved ONCE by the entrypoint (human + interactive TTY, minus NO_COLOR);
   * optional so test call sites that omit it default to plain text. Commander's
   * own `--help` does its own color detection and ignores this.
   */
  useColor?: boolean;
  /**
   * Flow-local lean output (plan 057, D1/AC-02): `true` slims the repeated
   * flow-MUTATION `summary()` data echo down to `{path}`. Resolved ONCE by the
   * entrypoint via `quietFlag(argv)` (same tri-state discipline as `mode`);
   * consumed ONLY by `acts/flow.ts` `runMutation` — read verbs and non-flow
   * commands never look at it (never a CLI-wide renderer change).
   */
  quiet?: boolean;
}

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
export function resolveInteractive(isTty: boolean, env: NodeJS.ProcessEnv): boolean {
  return isTty && env.TERM !== 'dumb';
}

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
