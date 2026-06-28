import { homedir } from 'node:os';
import type { EnvPort } from './env-port.js';

/** Real environment — wraps `process.env`. */
export class NodeEnv implements EnvPort {
  get(name: string): string | undefined {
    return process.env[name];
  }

  entries(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  home(): string | undefined {
    // Prefer the explicit env vars ($HOME on POSIX, %USERPROFILE% on Windows),
    // then fall back to os.homedir(). `||` (not `??`) so an EMPTY string falls
    // through to the next source rather than being treated as a resolved value
    // (companion F001). Empty after all sources ⇒ unresolved ⇒ undefined.
    const resolved = process.env.HOME || process.env.USERPROFILE || homedir();
    return resolved ? resolved : undefined;
  }
}
