import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../src/acts/dd/schema-fs.js';
import type { SchemaRoot } from '../../src/services/dd/schema/model.js';
import { scanRoot } from '../../src/services/dd/schema/scan.js';

/**
 * The one suite that must touch the REAL filesystem: it exists to prove a
 * property of the fs boundary itself (review finding F002), which no fake can
 * witness. Everything is confined to a `mkdtemp` directory and removed after.
 */
const PACKAGE = { dd_schema: 1, description: 'probe', sections: {} };

let tmp = '';
let cleanRoot = '';
let loopedRoot = '';

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
  symlinkSync('.', join(loopedRoot, 'loop'));
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
    const fs = new NodeSchemaFs();
    // Long enough to exceed the symlink-resolution limit on both macOS (32) and
    // Linux (40); the kernel answers ELOOP.
    const chain = join(loopedRoot, ...Array(64).fill('loop'));
    expect(() => fs.readdir(chain)).toThrow();
  });
});

describe('scanRoot over a real symlink loop (F002 regression)', () => {
  it('reports ONE scan-failed ERROR instead of silently finding nothing', () => {
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
