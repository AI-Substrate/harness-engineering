import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { buildGovernanceSkeleton } from '../../../src/services/init/governance-template.js';
import {
  GOVERNANCE_DOC,
  type InitDeps,
  initGovernance,
} from '../../../src/services/init/init-service.js';

/*
Test Doc:
- Why: `init-service` is the pure heart of `harness init` — the governance-doc INCEPTION writer. It
  bootstraps `.harness/` itself (unlike record's unconfigured), must NEVER clobber an existing doc,
  and must surface a write/permission failure as E190. All side effects go through injected fakes (P2/P3).
- Contract: initGovernance({fs,proc}) → ok {path:'.harness/engineering-harness.md', created}; created:true
  stamps the skeleton (mkdirp .harness FIRST), created:false on an existing doc (no write, byte-identical);
  a write/mkdirp failure → error E190 with a next_action.
- Quality Contribution: pins the never-clobber + bootstrap + E190 behaviour deterministically with fakes.
*/

const DOC_ABS = `/repo/.harness/${GOVERNANCE_DOC}`;
const DOC_REL = `.harness/${GOVERNANCE_DOC}`;

/** Deps with a cwd at /repo; fs seeded per-test. (No Clock — the service is static.) */
function depsAt(fs: FakeFs): InitDeps {
  return { fs, proc: new FakeProcess({}, '/repo') };
}

describe('initGovernance — create path', () => {
  it('in an empty repo: mkdirp .harness/, writes the skeleton, returns created:true', () => {
    const fs = new FakeFs(); // nothing seeded — not even .harness/
    const outcome = initGovernance(depsAt(fs));
    expect(outcome).toEqual({ ok: true, path: DOC_REL, created: true });
    expect(fs.mkdirs).toContain('/repo/.harness');
    expect(fs.writes).toContain(DOC_ABS);
    // The pure skeleton (not an empty file) was written, byte-for-byte.
    expect(fs.readText(DOC_ABS)).toBe(buildGovernanceSkeleton());
  });
});

describe('initGovernance — idempotent / never-clobber', () => {
  it('an existing doc → created:false, writes nothing, leaves it byte-identical', () => {
    const existing = 'PRE-EXISTING doc with the REAL maturity + injection map by now\n';
    const fs = new FakeFs({ [DOC_ABS]: existing });
    const outcome = initGovernance(depsAt(fs));
    expect(outcome).toEqual({ ok: true, path: DOC_REL, created: false });
    expect(fs.writes).toEqual([]); // never wrote
    expect(fs.mkdirs).toEqual([]); // exists-check FIRST → no mkdirp
    expect(fs.readText(DOC_ABS)).toBe(existing); // untouched
  });
});

describe('initGovernance — write failure → E190', () => {
  it('a write/permission failure surfaces as E190 (not a generic throw)', () => {
    class ThrowingFs extends FakeFs {
      override writeText(): void {
        throw new Error('EACCES: permission denied');
      }
    }
    const outcome = initGovernance(depsAt(new ThrowingFs()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe(ErrorCodes.INIT_WRITE_FAILED);
      expect(outcome.next_action).toMatch(/writable/);
      expect(outcome.message).toContain(DOC_REL);
    }
  });

  it('a mkdirp failure also surfaces as E190 (both side-effects under one guard)', () => {
    class ThrowingDir extends FakeFs {
      override mkdirp(): void {
        throw new Error('EACCES: mkdir');
      }
    }
    const outcome = initGovernance(depsAt(new ThrowingDir()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe(ErrorCodes.INIT_WRITE_FAILED);
    }
  });
});
