import { spawnSync } from 'node:child_process';
import type { WrapperResolution } from '../../services/hooks/hooks-verbs.js';

/**
 * Run a shipped hook wrapper's check mode and report what it resolved.
 *
 * INVOKING RATHER THAN STATTING is the whole point. `fs.exists` on a wrapper answers
 * "is the file there"; a wrapper that is there and cannot find an interpreter is the
 * false green this plan exists to remove, rebuilt one layer up. Only running it
 * answers the question actually being asked.
 *
 * ON WINDOWS IT EARNS A SECOND KEEP: a `.ps1` blocked by execution policy fails here,
 * visibly, where a stat would report the file present and healthy.
 *
 * Affordable by default — the wrapper's check mode is pure shell and starts no node,
 * so this is a fork rather than a CLI boot, unlike `spawnInvocationProbe`.
 */
export const spawnWrapperCheck = (wrapper: string): WrapperResolution => {
  const isPs1 = wrapper.endsWith('.ps1');
  const [command, args] = isPs1
    ? ['powershell', ['-NoProfile', '-File', wrapper, '--harness-hook-check']]
    : ['/bin/sh', [wrapper, '--harness-hook-check']];

  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  const stdout = result.stdout ?? '';
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}=(.*)$`, 'm').exec(stdout)?.[1];

  // A non-zero exit is the wrapper TELLING us it found nothing — its check mode is
  // deliberately asymmetric with its fire path, which always exits 0. A spawn that
  // never ran (result.error) is also not-ok, and must not be read as a pass.
  return {
    ok: result.error === undefined && result.status === 0,
    step: field('step') ?? 'none',
    ...(field('path') === undefined ? {} : { interpreter: field('path') as string }),
  };
};
