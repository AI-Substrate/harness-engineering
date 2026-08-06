import { chmodSync } from 'node:fs';
import type { ExecutableBitPort } from './executable-bit-port.js';

/**
 * The real executable bit (plan 073 · ac-0016).
 *
 * Windows is a deliberate no-op returning `false`: there is no mode bit to set,
 * and reporting `true` there would let a caller record "executable" about a
 * platform where the word means nothing. `false` is not a failure on win32 — the
 * collector's own download path never asks on that platform.
 */
export class NodeExecutableBit implements ExecutableBitPort {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  setExecutable(path: string): boolean {
    if (this.platform === 'win32') return false;
    try {
      chmodSync(path, 0o755);
      return true;
    } catch {
      // A binary we cannot mark executable is still a binary we verified: the
      // caller warns and carries on rather than discarding a good download.
      return false;
    }
  }
}
