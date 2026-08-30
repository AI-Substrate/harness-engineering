import { spawnSync } from 'node:child_process';

export interface FlowspacePingResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}

export type FlowspacePingSpawn = (
  command: string,
  args: string[],
  options: { encoding: 'utf8'; timeout: number; shell: false; windowsHide: true },
) => FlowspacePingResult;

/**
 * A positive daemon-response probe. Exit 0 alone is not evidence: only the
 * measured `healthy - fs3 daemon …` response marker proves the daemon answered.
 */
export function spawnFlowspacePing(
  spawn: FlowspacePingSpawn = spawnSync as unknown as FlowspacePingSpawn,
): boolean {
  const result = spawn('flowspace3', ['ping', '--json'], {
    encoding: 'utf8',
    // Measured healthy probes complete in 0–10ms; one second is generous but
    // keeps a wedged daemon from hanging `harness commit` or boot.
    timeout: 1_000,
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) return false;
  const stdout =
    typeof result.stdout === 'string' ? result.stdout : result.stdout?.toString('utf8');
  return stdout !== undefined && /^healthy - fs3 daemon\b/m.test(stdout);
}
