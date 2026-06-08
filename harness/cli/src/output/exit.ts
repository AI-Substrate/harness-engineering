import type { Envelope, Status } from './envelope.js';
import type { OutputPort, Writers } from './output-port.js';

/** Status → exit code (authoritative). Workshop 001 § Status → exit code mapping. */
const EXIT_BY_STATUS: Record<Status, number> = {
  ok: 0,
  degraded: 0,
  unconfigured: 2,
  error: 1,
};

export function exitCodeFor(env: Envelope): number {
  return EXIT_BY_STATUS[env.status];
}

/** Single exit point for the whole CLI — only the kernel calls process.exit. */
export function exitWithEnvelope(env: Envelope, io: OutputPort): never {
  io.emit(env);
  process.exit(exitCodeFor(env));
}

/**
 * Verbatim passthrough exit: write raw text to stdout and let the process exit
 * NATURALLY with `code` (0 by default) — set `process.exitCode` and return, never
 * `process.exit`. A large raw payload (e.g. `harness docs <id>`) piped or
 * redirected must not be truncated by an early `process.exit` that races the
 * stdout flush; a natural return lets Node drain stdout first (companion F002).
 * Envelope-bearing commands still use `exitWithEnvelope`.
 */
export function emitRawAndExit(text: string, writers: Writers, code = 0): void {
  writers.out(text);
  process.exitCode = code;
}
