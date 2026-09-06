/**
 * Make a stdio stream's writes synchronous when it is a PIPE.
 *
 * Why this exists: `exitWithEnvelope` (the single exit chokepoint, 130 call
 * sites) exits the process right after `io.emit(env)`. Node's stdout is
 * synchronous for files and for TTYs on POSIX, but for pipes it is
 * asynchronous on macOS (and Windows) — so an envelope larger than the pipe's
 * 64 KiB buffer was written only up to the buffer and the process exited with
 * the rest still queued. `harness plan validate --complete --json | jq` came
 * back as exactly 65 536 bytes of half-JSON with exit 0, on macOS only, and
 * every agent that parsed it saw a truncated proof while CI (Linux, where pipes
 * are synchronous) never reproduced it.
 *
 * The raw-output path already dodged this by returning instead of exiting
 * (`emitRawAndExit`, companion F002). The envelope path cannot: many of its
 * call sites are not in tail position, so a returning `exitWithEnvelope` would
 * let the caller run on and emit twice. Making the pipe BLOCKING at process
 * start is the fix that keeps `never` honest: once the handle is blocking,
 * `write` returns only after the bytes are in the pipe, and `process.exit`
 * can no longer race the flush.
 *
 * `_handle.setBlocking` is an undocumented-but-stable libuv hook (it is what
 * Node itself uses to make TTY stdout synchronous). It exists only on pipe and
 * TTY handles; for files there is nothing to do. The helper is a pure decision
 * over a duck-typed stream so it can be unit-tested without touching
 * `process.stdout`; the ONLY caller is the bin entry (`src/index.ts`).
 */

export interface BlockableStream {
  isTTY?: boolean;
  _handle?: { setBlocking?: (blocking: boolean) => unknown } | null;
}

export type BlockingOutcome = 'made-blocking' | 'already-tty' | 'not-a-pipe';

/**
 * Turn a pipe-backed stream synchronous. Idempotent and safe to call on any
 * stream: a TTY is left alone (Node already writes to it synchronously on
 * POSIX, and forcing it changes nothing), and a stream whose handle has no
 * `setBlocking` (a file, a closed stream, a fake) is reported, never touched.
 */
export function makeBlockingIfPipe(stream: BlockableStream): BlockingOutcome {
  if (stream.isTTY) return 'already-tty';
  const setBlocking = stream._handle?.setBlocking;
  if (typeof setBlocking !== 'function') return 'not-a-pipe';
  setBlocking.call(stream._handle, true);
  return 'made-blocking';
}
