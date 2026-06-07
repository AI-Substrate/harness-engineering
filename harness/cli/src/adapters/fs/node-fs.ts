import { existsSync, readFileSync } from 'node:fs';
import type { FsPort } from './fs-port.js';

/** Real filesystem — the only place `node:fs` is touched. */
export class NodeFs implements FsPort {
  exists(path: string): boolean {
    return existsSync(path);
  }

  readText(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
}
