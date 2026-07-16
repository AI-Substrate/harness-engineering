import { createHash } from 'node:crypto';
import type { HashPort } from './hash-port.js';

/** Real SHA-256 adapter — the only hash adapter coupled to Node crypto. */
export class NodeHash implements HashPort {
  sha256Hex(input: string | Uint8Array): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
