import { vi } from 'vitest';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';

/**
 * Make the REAL filesystem give way HALF WAY THROUGH a write — the failure an
 * all-or-nothing fake cannot model, and the only one that can tell a staged write
 * from a hopeful one.
 *
 * The distinction is not academic. `writeFileSync` opens with `O_TRUNC`: the
 * moment it touches an existing file the old bytes are gone, before a single new
 * byte lands. So a write that throws part-way — ENOSPC, a disk error, a process
 * killed mid-`write(2)` — leaves a TRUNCATED file behind. A fake that throws
 * *before* writing leaves the file whole by luck, and a caller that merely
 * catches the throw looks correct against it while being wrong on a real disk.
 *
 * The `dd` acts construct `NodeFs` internally (they are composition roots in
 * their own right, so there is no port to inject), and the CLI harnesses run the
 * program in-process. Patching the prototype is therefore the seam that reaches
 * the production write path of EVERY dd mutator without bending the production
 * signature to suit a test.
 *
 * `match` should cover the staging temp as well as the live name — `foo.dd.md`
 * AND `foo.dd.md.tmp`. A matcher pinned to the final filename stops injecting
 * anything the moment the fix stages its write, and the control goes green while
 * proving nothing.
 */
export function failWriteMidWay(match: RegExp): void {
  const real = NodeFs.prototype.writeText;
  vi.spyOn(NodeFs.prototype, 'writeText').mockImplementation(function (
    this: NodeFs,
    path: string,
    contents: string,
  ): void {
    if (!match.test(path)) {
      real.call(this, path, contents);
      return;
    }
    real.call(this, path, contents.slice(0, Math.max(1, Math.floor(contents.length / 2))));
    throw new Error('ENOSPC: no space left on device, write');
  });
}
