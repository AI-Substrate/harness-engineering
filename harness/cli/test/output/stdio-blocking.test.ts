import { describe, expect, it } from 'vitest';
import { type BlockableStream, makeBlockingIfPipe } from '../../src/output/stdio-blocking.js';

/*
Test Doc:
- Why: `exitWithEnvelope` calls process.exit right after emitting; on macOS a PIPE stdout
  is asynchronous, so any envelope over 64 KiB was cut at exactly 65 536 bytes with exit 0.
  The bin entry makes pipe stdio blocking before main() runs; this pins the decision.
- Contract: a stream with a `_handle.setBlocking` and no TTY flag is made blocking (the
  hook is called with `true`, bound to the handle); a TTY is left alone; a stream with no
  usable hook (file, closed, fake) is reported as not-a-pipe and never touched.
- Usage Notes: duck-typed fakes — the helper never reads process.stdout itself.
- Quality Contribution: the only unit that can see the opposite (a hook NOT called) —
  the integration test proves the bytes, this proves the wiring decision.
*/

describe('makeBlockingIfPipe', () => {
  it('calls setBlocking(true) on a pipe handle, bound to the handle', () => {
    const calls: Array<{ blocking: boolean; self: unknown }> = [];
    const handle = {
      setBlocking(this: unknown, blocking: boolean) {
        calls.push({ blocking, self: this });
      },
    };
    const stream: BlockableStream = { isTTY: undefined, _handle: handle };
    expect(makeBlockingIfPipe(stream)).toBe('made-blocking');
    expect(calls).toEqual([{ blocking: true, self: handle }]);
  });

  it('leaves a TTY alone even when its handle exposes setBlocking', () => {
    let called = false;
    const stream: BlockableStream = {
      isTTY: true,
      _handle: {
        setBlocking: () => {
          called = true;
        },
      },
    };
    expect(makeBlockingIfPipe(stream)).toBe('already-tty');
    expect(called).toBe(false);
  });

  it('reports not-a-pipe for a file-backed, closed, or fake stream and touches nothing', () => {
    expect(makeBlockingIfPipe({})).toBe('not-a-pipe');
    expect(makeBlockingIfPipe({ _handle: null })).toBe('not-a-pipe');
    expect(makeBlockingIfPipe({ _handle: {} })).toBe('not-a-pipe');
    expect(makeBlockingIfPipe({ _handle: { setBlocking: undefined } })).toBe('not-a-pipe');
  });
});
