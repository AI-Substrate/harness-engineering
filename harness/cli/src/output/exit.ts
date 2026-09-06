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

/**
 * A decorator applied to every outgoing envelope at the single exit chokepoint,
 * registered ONCE by the composition root (plan 019, T007). It may mutate the
 * envelope (e.g. set the additive `update_available` field, which the JSON
 * renderer then serializes) and/or write a side-channel line (e.g. the human-mode
 * update banner to stderr).
 *
 * Centralising it here is deliberate (KF-09): `exitWithEnvelope` is the ONE path
 * every command exits through (43 call sites), and the per-act bespoke human
 * `{ emit }` ports bypass `renderHuman` — so decorating here is the only place
 * that reaches EVERY command with zero per-site plumbing. Default null = no-op.
 */
export type BannerDecorator = (env: Envelope) => void;

let bannerDecorator: BannerDecorator | null = null;

/** Register (or clear, with null) the exit-chokepoint banner decorator. */
export function setBannerDecorator(decorator: BannerDecorator | null): void {
  bannerDecorator = decorator;
}

/**
 * Single exit point for the whole CLI — only the kernel calls process.exit.
 *
 * `process.exit` right after `io.emit` is safe ONLY because the bin entry
 * (`src/index.ts`) makes pipe-backed stdio blocking before main() runs
 * (`output/stdio-blocking.ts`): with an asynchronous pipe (macOS, Windows) an
 * envelope over 64 KiB was truncated at the pipe buffer with exit 0. Do not
 * "fix" this by returning instead of exiting — 130 call sites, many not in tail
 * position, rely on `never`; a returning exit would emit twice.
 */
export function exitWithEnvelope(env: Envelope, io: OutputPort): never {
  // Decorate BEFORE emit so the JSON renderer serializes any field the decorator
  // sets (e.g. update_available) and the human banner precedes the act's output.
  bannerDecorator?.(env);
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
