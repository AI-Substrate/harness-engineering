import { describe, expect, it } from 'vitest';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';

describe('FakeProcess', () => {
  it('given_seeded_tools_when_which_called_then_returns_path_and_records_lookups', () => {
    /*
    Test Doc:
    - Why: doctor's toolchain layer must be testable without spawning real processes.
    - Contract: FakeProcess.which returns the seeded path (or null) and records each command.
    - Usage Notes: construct with a {command: path} map; assert on `lookups`.
    - Quality Contribution: proves the toolchain probe seam works with zero process spawn.
    - Worked Example: new FakeProcess({node: '/usr/bin/node'}).which('node') === '/usr/bin/node'.
    */
    const proc = new FakeProcess({ node: '/usr/bin/node', just: '/opt/bin/just' });
    expect(proc.which('node')).toBe('/usr/bin/node');
    expect(proc.which('missing')).toBeNull();
    expect(proc.lookups).toEqual(['node', 'missing']);
  });

  it('cwd returns the seeded working directory (defaults to /repo)', () => {
    /*
    Test Doc:
    - Why: discovery resolves `<cwd>/.harness/extensions/` — the cwd must come through a port
      so the service is unit-testable without depending on the real process cwd (plan D1).
    - Contract: FakeProcess.cwd() returns the seeded value; an unseeded fake falls back to a
      stable default so tests never couple to the runner's actual directory.
    - Usage Notes: pass `{ cwd: '/some/repo' }` as the second constructor arg.
    - Quality Contribution: pins the cwd seam discovery + ctx rely on.
    - Worked Example: new FakeProcess({}, '/my/repo').cwd() === '/my/repo'.
    */
    expect(new FakeProcess({}, '/my/repo').cwd()).toBe('/my/repo');
    expect(new FakeProcess().cwd()).toBe('/repo');
  });
});

describe('NodeProcess', () => {
  it('finds node on PATH and returns null for a non-existent command', () => {
    const proc = new NodeProcess();
    expect(proc.which('node')).not.toBeNull();
    expect(proc.which('definitely-not-a-real-binary-xyz')).toBeNull();
  });
});
