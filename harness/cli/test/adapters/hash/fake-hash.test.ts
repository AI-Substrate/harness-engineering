import { describe, expect, it } from 'vitest';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('FakeHash', () => {
  it('returns deterministic distinct hex stand-ins and records copied inputs', () => {
    /*
    Test Doc:
    - Why: services need a deterministic hash seam without importing runtime crypto.
    - Contract: equal inputs return equal 64-character hex values, distinct inputs differ,
      and calls record each input (copying byte arrays so later mutation cannot rewrite history).
    - Quality Contribution: pins the reusable fakes-over-mocks seam for sensor and stream tests.
    */
    const hash = new FakeHash();
    const bytes = new TextEncoder().encode('bytes');

    const first = hash.sha256Hex('same');
    const repeated = hash.sha256Hex('same');
    const distinct = hash.sha256Hex('different');
    hash.sha256Hex(bytes);
    bytes[0] = 0;

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toBe(first);
    expect(distinct).not.toBe(first);
    expect(hash.calls).toEqual([
      { input: 'same' },
      { input: 'same' },
      { input: 'different' },
      { input: new TextEncoder().encode('bytes') },
    ]);
  });
});

describe('NodeHash', () => {
  it('computes the known SHA-256 vector for text and raw bytes', () => {
    /*
    Test Doc:
    - Why: production persisted hashes must remain interoperable with standard SHA-256.
    - Contract: UTF-8 text and equivalent bytes produce the lowercase standard digest.
    - Worked Example: sha256("abc") is the NIST-known ba7816bf…0015ad vector.
    */
    const hash = new NodeHash();
    expect(hash.sha256Hex('abc')).toBe(ABC_SHA256);
    expect(hash.sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC_SHA256);
  });
});
