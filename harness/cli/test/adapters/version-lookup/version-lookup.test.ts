import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../src/adapters/exec/fake-exec.js';
import { FakeVersionLookup } from '../../../src/adapters/version-lookup/fake-version-lookup.js';
import { NodeVersionLookup } from '../../../src/adapters/version-lookup/node-version-lookup.js';

const PKG = '@ai-substrate/engineering-harness';
const KEY = `npm view ${PKG} version --json`;

describe('FakeVersionLookup', () => {
  it('given_scripted_result_when_latest_called_then_returns_it_and_counts_calls', async () => {
    /*
    Test Doc:
    - Why: the update service must be unit-testable without hitting a registry.
    - Contract: FakeVersionLookup returns the scripted latest (or null) and counts calls.
    - Usage Notes: pass the latest string; pass an Error to force rejection.
    - Quality Contribution: deterministic throttle/check tests (T005).
    - Worked Example: new FakeVersionLookup('0.3.0').latest() === '0.3.0'.
    */
    const lookup = new FakeVersionLookup('0.3.0');
    await expect(lookup.latest()).resolves.toBe('0.3.0');
    expect(lookup.calls).toBe(1);
    await expect(new FakeVersionLookup(null).latest()).resolves.toBeNull();
  });

  it('given_scripted_error_when_latest_called_then_rejects', async () => {
    const lookup = new FakeVersionLookup(null, new Error('ENETUNREACH'));
    await expect(lookup.latest()).rejects.toThrow('ENETUNREACH');
  });
});

describe('NodeVersionLookup', () => {
  it('builds the npm view argv and parses a JSON string version', async () => {
    /*
    Test Doc:
    - Why: registry lookup must shell `npm view` (no HTTP adapter, §2.1) via ExecPort.
    - Contract: latest() runs `npm view <pkg> version --json` and returns the parsed version.
    - Usage Notes: scripted FakeExec stdout drives the parse; assert on `calls` for argv.
    - Quality Contribution: pins the exact registry command + JSON-string parsing.
    - Worked Example: stdout '"0.3.0"' ⇒ latest() === '0.3.0'.
    */
    const exec = new FakeExec({ [KEY]: { code: 0, stdout: '"0.3.0"\n' } });
    const lookup = new NodeVersionLookup(exec, PKG, '/repo');
    await expect(lookup.latest()).resolves.toBe('0.3.0');
    expect(exec.calls).toEqual([
      { command: 'npm', args: ['view', PKG, 'version', '--json'], cwd: '/repo' },
    ]);
  });

  it('takes the last entry when npm returns a JSON array of versions', async () => {
    const exec = new FakeExec({ [KEY]: { code: 0, stdout: '["0.1.0","0.2.0"]' } });
    await expect(new NodeVersionLookup(exec, PKG, '/repo').latest()).resolves.toBe('0.2.0');
  });

  it('maps a non-zero exit (auth/not-found) to null — never throws', async () => {
    const exec = new FakeExec({ [KEY]: { code: 1, stderr: 'E401 Unauthorized' } });
    await expect(new NodeVersionLookup(exec, PKG, '/repo').latest()).resolves.toBeNull();
  });

  it('maps empty / non-JSON output to null', async () => {
    const empty = new FakeExec({ [KEY]: { code: 0, stdout: '   ' } });
    await expect(new NodeVersionLookup(empty, PKG, '/repo').latest()).resolves.toBeNull();
    const garbage = new FakeExec({ [KEY]: { code: 0, stdout: 'not json' } });
    await expect(new NodeVersionLookup(garbage, PKG, '/repo').latest()).resolves.toBeNull();
  });
});
