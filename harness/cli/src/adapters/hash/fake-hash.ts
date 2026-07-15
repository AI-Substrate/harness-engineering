import type { HashPort } from './hash-port.js';

export interface FakeHashCall {
  input: string | Uint8Array;
}

/**
 * Deterministic hash fake for tests. Records copied inputs (fakes over mocks)
 * and returns a stable 64-character hexadecimal stand-in without runtime crypto.
 */
export class FakeHash implements HashPort {
  readonly calls: FakeHashCall[] = [];

  sha256Hex(input: string | Uint8Array): string {
    const recorded = typeof input === 'string' ? input : Uint8Array.from(input);
    this.calls.push({ input: recorded });
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    let value = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      value ^= BigInt(byte);
      value = BigInt.asUintN(64, value * 0x100000001b3n);
    }
    return value.toString(16).padStart(16, '0').repeat(4);
  }
}
