import { describe, expect, it } from 'vitest';
import {
  type FlowspacePingResult,
  type FlowspacePingSpawn,
  spawnFlowspacePing,
} from '../../../src/adapters/exec/spawn-flowspace-probe.js';

function runner(result: Partial<FlowspacePingResult>) {
  const calls: unknown[][] = [];
  const run: FlowspacePingSpawn = (...args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return { run, calls };
}

describe('spawnFlowspacePing', () => {
  it('requires the daemon response marker and uses a bounded shell-free probe', () => {
    const fake = runner({
      status: 0,
      stdout: 'healthy - fs3 daemon 0.5.0 at http://127.0.0.1:7373\n',
    });
    expect(spawnFlowspacePing(fake.run)).toBe(true);
    expect(fake.calls).toEqual([
      [
        'flowspace3',
        ['ping', '--json'],
        { encoding: 'utf8', timeout: 1_000, shell: false, windowsHide: true },
      ],
    ]);
  });

  it('refuses exit 0 without positive response evidence', () => {
    expect(spawnFlowspacePing(runner({ status: 0, stdout: '' }).run)).toBe(false);
    expect(spawnFlowspacePing(runner({ status: 0, stdout: 'command accepted\n' }).run)).toBe(false);
  });

  it('refuses marker text from a failed or unspawned process', () => {
    expect(
      spawnFlowspacePing(
        runner({ status: 1, stdout: 'healthy - fs3 daemon 0.5.0 at http://127.0.0.1:7373' }).run,
      ),
    ).toBe(false);
    expect(spawnFlowspacePing(runner({ status: null, error: new Error('timed out') }).run)).toBe(
      false,
    );
  });
});
