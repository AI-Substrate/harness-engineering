import type { Envelope, Status } from './envelope.js';
import type { OutputPort } from './output-port.js';

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
