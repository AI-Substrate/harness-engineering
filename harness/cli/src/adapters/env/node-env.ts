import type { EnvPort } from './env-port.js';

/** Real environment — wraps `process.env`. */
export class NodeEnv implements EnvPort {
  get(name: string): string | undefined {
    return process.env[name];
  }
}
