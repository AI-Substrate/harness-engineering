import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { FsPort } from '../../../src/adapters/fs/fs-port.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';

/**
 * `appendText` PARITY — the same assertions against BOTH adapters (plan 082 tk-0011).
 *
 * WHY THIS FILE EXISTS. A fake that disagrees with the real adapter is worse than
 * no fake: every unit test above it passes while the production path fails, and
 * nothing reports the difference until a real filesystem is involved. This was not
 * hypothetical here — MEASURED when the port was first added, a missing parent
 * directory gave `NodeFs: false` and `FakeFs: true`. The fake has since been made
 * to model the refusal, and this file is what stops it drifting apart again.
 *
 * So every row below runs against both, from one table. A behaviour that cannot be
 * modelled by the fake does not get a weaker row here — it is named in the port's
 * doc as unproven except against `NodeFs`, which is the honest alternative to a
 * green that means nothing.
 */

let dir: string;

/** The two adapters under one interface, each with a scratch path factory. */
const adapters: { name: string; make: () => { fs: FsPort; path: (rel: string) => string } }[] = [
  {
    name: 'NodeFs (real filesystem)',
    make: () => {
      const fs = new NodeFs();
      fs.mkdirp(join(dir, 'state'));
      return { fs, path: (rel) => join(dir, rel) };
    },
  },
  {
    name: 'FakeFs (in-memory)',
    make: () => {
      const fs = new FakeFs();
      fs.mkdirp('/state');
      return { fs, path: (rel) => `/${rel.split(/[\\/]/).join('/')}` };
    },
  },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-append-parity-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.each(adapters)('appendText — $name', ({ make }) => {
  it('CREATES the file when it does not exist', () => {
    const { fs, path } = make();
    const target = path('state/f.jsonl');

    expect(fs.appendText(target, 'one\n')).toBe(true);
    expect(fs.readText(target)).toBe('one\n');
  });

  it('APPENDS to an existing file rather than replacing it', () => {
    /*
    Test Doc:
    - Why: the whole point of the port. A `writeText`-shaped implementation would
      pass the row above and fail this one.
    - Contract: earlier bytes survive, in order.
    */
    const { fs, path } = make();
    const target = path('state/f.jsonl');

    fs.appendText(target, 'one\n');
    fs.appendText(target, 'two\n');
    fs.appendText(target, 'three\n');

    expect(fs.readText(target)).toBe('one\ntwo\nthree\n');
  });

  it('REFUSES when the parent directory is missing, and writes nothing', () => {
    /*
    Test Doc:
    - Why: THE MEASURED DIVERGENCE. NodeFs returned false (open(2) ENOENT) while
      FakeFs returned true, so a service tested only against the fake would have
      believed a record landed that never did.
    - Contract: false, and no file appears.
    - Quality Contribution: the row that stops the two adapters drifting apart.
    */
    const { fs, path } = make();
    const target = path('state/nested/deeper/f.jsonl');

    expect(fs.appendText(target, 'one\n')).toBe(false);
    expect(fs.exists(target)).toBe(false);
  });

  it('is byte-exact — no added, trimmed or re-encoded content', () => {
    /*
    Test Doc:
    - Why: the journal is JSONL, so a stray newline or a trimmed one corrupts a
      record boundary. A fake that normalises whitespace would hide that.
    - Contract: what went in is what comes back, including a record with no
      trailing newline and one carrying multi-byte UTF-8.
    */
    const { fs, path } = make();
    const target = path('state/f.jsonl');

    fs.appendText(target, '{"a":1}\n');
    fs.appendText(target, '{"b":"héllo ✅"}\n');
    fs.appendText(target, 'no trailing newline');

    expect(fs.readText(target)).toBe('{"a":1}\n{"b":"héllo ✅"}\nno trailing newline');
  });
});

describe('appendText — properties provable only against the REAL filesystem', () => {
  it('appends to the SAME inode, so a concurrent reader never sees a rewrite', () => {
    /*
    Test Doc:
    - Why: `FakeFs` has no inodes, so this cannot be a parity row — and it is the
      property that makes rotation-by-rename safe: a process holding an open
      descriptor keeps writing to the file it opened. Asserting it against NodeFs
      and saying so is better than a parity row that proves nothing on one side.
    - Contract: the file's identity is stable across appends.
    */
    const fs = new NodeFs();
    fs.mkdirp(join(dir, 'state'));
    const target = join(dir, 'state', 'f.jsonl');

    fs.appendText(target, 'one\n');
    const before = statSync(target).ino;
    fs.appendText(target, 'two\n');
    const after = statSync(target).ino;

    expect(after).toBe(before);
    expect(readFileSync(target, 'utf8')).toBe('one\ntwo\n');
  });
});
