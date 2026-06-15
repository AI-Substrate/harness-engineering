import { homedir } from 'node:os';
import type { EnvPort } from './env-port.js';

/** Real environment — wraps `process.env`. */
export class NodeEnv implements EnvPort {
  get(name: string): string | undefined {
    return process.env[name];
  }

  home(): string | undefined {
    // Prefer the explicit env vars ($HOME on POSIX, %USERPROFILE% on Windows),
    // then fall back to os.homedir(). Empty string ⇒ unresolved ⇒ undefined.
    const fromEnv = process.env.HOME ?? process.env.USERPROFILE;
    const resolved = fromEnv ?? homedir();
    return resolved ? resolved : undefined;
  }
}
