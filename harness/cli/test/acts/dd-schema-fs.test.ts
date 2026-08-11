import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../src/acts/dd/schema-fs.js';
import type { SchemaRoot } from '../../src/services/dd/schema/model.js';
import { scanRoot } from '../../src/services/dd/schema/scan.js';
import { trySymlink } from '../support/symlink-capability.js';

/**
 * The one suite that must touch the REAL filesystem: it exists to prove a
 * property of the fs boundary itself (review finding F002), which no fake can
 * witness. Everything is confined to a `mkdtemp` directory and removed after.
 */
const PACKAGE = { dd_schema: 1, description: 'probe', sections: {} };

let tmp = '';
let cleanRoot = '';
let loopedRoot = '';

/**
 * HOW — or whether — the unreadable loop inside `loopedRoot` got staged.
 *
 * THE BUG THIS EXISTS FOR IS NOT A FAILING ROW, IT IS AN ABSENT FILE. `beforeAll`
 * used to call `symlinkSync` bare. Creating a symlink REQUIRES PRIVILEGE ON
 * WINDOWS, so on an unelevated host it threw `EPERM` **in collection** and this
 * entire file never loaded: its rows were not passed, not failed, not
 * skipped — ABSENT, while every reported total stayed self-consistent. That is
 * why `Failed Suites: 1` survived six measured runs unnoticed. A file that cannot
 * collect reports nothing at all, which is strictly worse than one reporting a
 * weaker property.
 *
 * `null` means no loop could be staged; the rows that need one then degrade and
 * SAY they degraded, rather than taking the file down with them.
 */
let loopMechanism: 'symlink' | 'junction' | null = null;

/**
 * Does a RAW `readdir` fail here with a code this boundary must NOT treat as
 * benign?
 *
 * Deliberately calls `node:fs` DIRECTLY rather than the subject under test, and
 * that is what keeps the row honest rather than circular: this establishes the
 * FIXTURE — that the OS really does refuse this path with something other than
 * `ENOENT`/`ENOTDIR` — while the assertion in the row tests OUR wrapper's
 * response to it. Asking `NodeSchemaFs` both questions would be asking the
 * subject to grade itself.
 */
function rawUnreadable(path: string): boolean {
  try {
    readdirSync(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== undefined && code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

function seedPackage(root: string): void {
  const pkg = join(root, 'schemas', 'builder', 'plan');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'schema.json'), JSON.stringify(PACKAGE), 'utf8');
}

function gitroot(path: string): SchemaRoot {
  return { kind: 'gitroot', path };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dd-schema-fs-'));

  cleanRoot = join(tmp, 'clean', '.dd');
  seedPackage(cleanRoot);

  // The reviewer's probe shape: a root that also holds a real package, so a
  // silent scan reports "no schemas here" about a tree that HAS one.
  loopedRoot = join(tmp, 'looped', '.dd');
  seedPackage(loopedRoot);

  /*
   * STAGED WITHOUT THROWING — see `loopMechanism`. Two mechanisms, tried in order,
   * because they are creatable under different privileges:
   *
   *   1. A RELATIVE SYMLINK (`.dd/loop -> .`). The reviewer's original F002 shape,
   *      and the mechanism on macOS/Linux, where it always succeeds. Unchanged, so
   *      the platforms that can build a real ELOOP keep the FULL property exactly
   *      as before.
   *   2. A WINDOWS DIRECTORY JUNCTION pointing at its own parent. Junctions do NOT
   *      require elevation, unlike symlinks, so this is the one mechanism an
   *      ordinary Windows account can use to build the same recursive structure. A
   *      junction target must be ABSOLUTE, hence `loopedRoot` rather than `'.'`.
   *      EXPECTED-UNVERIFIED: no host available here can create one, so whether a
   *      junction chain actually exhausts Windows' reparse-point limit is untested.
   *      It is ATTEMPTED rather than assumed, and the row below asserts only after
   *      independently confirming the path is genuinely unreadable.
   */
  if (trySymlink('.', join(loopedRoot, 'loop'))) loopMechanism = 'symlink';
  else if (trySymlink(loopedRoot, join(loopedRoot, 'loop'), 'junction')) loopMechanism = 'junction';
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('NodeSchemaFs — "nothing here" and "could not look" are different answers', () => {
  it('returns [] for the two benign cases the scan probes with', () => {
    const fs = new NodeSchemaFs();
    expect(fs.readdir(join(tmp, 'no-such-directory'))).toEqual([]); // ENOENT
    expect(fs.readdir(join(cleanRoot, 'schemas', 'builder', 'plan', 'schema.json'))).toEqual([]); // ENOTDIR
  });

  it('throws rather than reporting emptiness when the path cannot be read', () => {
    /*
    Test Doc:
    - Why: the THROW side of the property. `scanRoot` reads an empty `readdir` as
      "no entries", so a swallowed ELOOP/ENAMETOOLONG/EACCES silently becomes "this
      root holds no schemas" and the act reports a confident, false E410 instead of
      E416. Row 1 proves the `[]` side; this proves the other.
    - Contract: a path the OS refuses with a NON-benign code propagates rather than
      flattening to `[]`.
    - Quality Contribution: the unreadable path is CHOSEN by asking the real OS
      which candidate it actually refuses, and the assertion runs against that one.
      So the row cannot silently assert nothing, and it cannot pass because a
      candidate happened to be missing — `ENOENT` is explicitly not accepted as
      "unreadable".

    TWO CANDIDATES, IN PREFERENCE ORDER, AND THE FALLBACK COSTS THE FIRST NOTHING:

      1. The SYMLINK/JUNCTION LOOP — 64 deep, past the resolution limit on macOS
         (32) and Linux (40); the kernel answers ELOOP. This is the F002 condition
         and it is what runs wherever a loop could be staged.
      2. An OVER-LONG PATH COMPONENT, which needs no privilege of any kind. The
         boundary's own docstring names `ENAMETOOLONG` alongside `ELOOP` as a code
         that must propagate, so this is the SAME property reached by a second
         unreadable condition — not a weaker one.

    Where neither is genuinely unreadable the row degrades and says so, rather than
    asserting a throw the platform was never going to produce.
    */
    const fs = new NodeSchemaFs();
    const candidates = [
      ...(loopMechanism !== null ? [join(loopedRoot, ...Array(64).fill('loop'))] : []),
      join(tmp, 'n'.repeat(300)),
    ];
    const unreadable = candidates.find(rawUnreadable);

    if (unreadable === undefined) {
      expect(
        loopMechanism,
        'no unreadable path could be constructed on this host, so the THROW side of the property is NOT proven here — the file still COLLECTED, which is the point',
      ).toBeNull();
      return;
    }

    expect(() => fs.readdir(unreadable)).toThrow();
  });
});

describe('scanRoot over a real symlink loop (F002 regression)', () => {
  it('reports ONE scan-failed ERROR instead of silently finding nothing', () => {
    /*
    GENUINELY ALL-OR-NOTHING, and said so rather than disguised. This row is about
    what `scanRoot` does when a root it is WALKING cannot be read, so the
    unreadable thing has to be INSIDE `loopedRoot` — the over-long-path fallback
    used by the row above cannot help, because the scan only visits names it
    actually finds. With no loop staged there is no weaker version of the claim:
    the root would simply scan cleanly, which proves nothing about the guard.

    So it degrades to the honest minimum — the fixture is what we believe it is —
    and the file COLLECTS either way, which is the defect this change exists to fix.
    */
    if (loopMechanism === null) {
      expect(
        scanRoot(new NodeSchemaFs(), gitroot(loopedRoot)).hits.map((hit) => hit.name),
        'without a staged loop this root is merely ordinary; the scan-failed path is NOT proven here',
      ).toEqual(['builder/plan']);
      return;
    }

    const scan = scanRoot(new NodeSchemaFs(), gitroot(loopedRoot));

    expect(scan.issues).toHaveLength(1);
    expect(scan.issues[0]?.class).toBe('scan-failed');
    expect(scan.issues[0]?.severity).toBe('ERROR');
    expect(scan.issues[0]?.message).toContain('discovery failed');
    // Hits are discarded on failure: a partial scan must not masquerade as a
    // complete one. What matters is that the caller is TOLD, so the act maps
    // this to E416 rather than reporting a confident, false E410.
    expect(scan.hits).toEqual([]);
  });

  it('still scans a loop-free root normally — the guard costs nothing honest', () => {
    const scan = scanRoot(new NodeSchemaFs(), gitroot(cleanRoot));

    expect(scan.issues).toEqual([]);
    expect(scan.hits.map((hit) => hit.name)).toEqual(['builder/plan']);
  });
});
