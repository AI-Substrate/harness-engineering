import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: plan 080 phase 2 (tk-0008 / dw-000f / bp-000d). The promoted plan-semantics
  module is harness-owned by Jordan's ontology ruling (2026-08-09, dd governance
  `d8950eb`), and it carries a small set of DELIBERATE temporary copies of dd
  mechanisms that have no published home. That arrangement is only safe while the
  line between the two is enforced: a symbol dd publishes must be IMPORTED, and a
  copy of it is drift waiting to happen — dd changes, our copy does not, and
  nothing types. The re-cut made that line a done_when ("a deterministic grep
  proves the promoted module COPIES no symbol that has a public
  `@ai-substrate/dd` home") and the ledger made it a drift-ownership trigger.
- Contract: (1) every temporary copy is enumerated with provenance at its own
  declaration and in the directory README; (2) the copies live ONLY under
  `dd-mechanisms/`, so the blast radius is one directory rather than a habit;
  (3) each copied module's dd origin is genuinely unreachable through the package
  exports map, checked against the INSTALLED package with Node's own resolver;
  (4) the promoted module reaches dd exclusively through public subpaths.
- Usage Notes: this is a REPO-STRUCTURE test, not a behaviour test — the
  behavioural pin is the goldens suite. It reads real files under `src/` and the
  real `node_modules/@ai-substrate/dd`; it fakes nothing, because a fake would
  defeat the only question it asks.

  D-4 (plan 080 tk-0010) — WHAT THIS TEST IS NOT. It is the last architecture
  guard standing near the harness→dd seam, so read its scope precisely before
  assuming it covers the retired one. The flow→dd boundary had two enforcers and
  BOTH are gone: `flow-dd-sdk-seam.test.ts` (which skipped package specifiers by
  construction — `if (!spec.startsWith('.')) continue`) and the
  `flow-consumes-dd-sdk-only` dependency-cruiser rule. They policed reaches into
  `src/services/dd`, a tree that no longer exists.

  Nothing replaced them, deliberately. dd's `exports` map is now the enforcer,
  and it is stronger than either: Node REFUSES an unpublished subpath at runtime
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`) rather than warning about it. This test
  MEASURES that refusal for the copied mechanisms — it does not re-implement the
  boundary, and it must not grow into a package-aware successor to those guards.
  If you find yourself adding a rule here about what `services/flow` may import
  from the package, stop: that is the guard D-4 ruled out.
- Quality Contribution: the failure mode is silent and slow — someone copies one
  more dd symbol because a copy already sits next door, and the "temporary" set
  quietly becomes a second implementation of dd. This fails on the first such
  copy, by name.
- Worked Example: add `parseAddress` (which IS public, on the root barrel) to
  `dd-mechanisms/`, and the third test fails naming it — copying a symbol with a
  public home is exactly the thing dw-000f forbids.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '../..');
const MODULE_DIR = join(CLI_ROOT, 'src/services/plan-semantics');
const MECHANISMS_DIR = join(MODULE_DIR, 'dd-mechanisms');

const require_ = createRequire(import.meta.url);

/** The copies sanctioned by the re-cut — the enumeration itself, pinned. */
const ENUMERATED_COPIES = ['constants.ts', 'derive.ts', 'rel.ts', 'value.ts'] as const;

/** Their dd origins, which the package must NOT publish. */
const ORIGINS: Record<string, string> = {
  'constants.ts': '@ai-substrate/dd/core/constants',
  'derive.ts': '@ai-substrate/dd/core/derive',
  'rel.ts': '@ai-substrate/dd/core/rel',
  'value.ts': '@ai-substrate/dd/core/value',
};

function moduleFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('plan-semantics — the promoted module owns its boundary', () => {
  it('confines every temporary dd copy to dd-mechanisms/, and that set is exactly the enumeration', () => {
    expect(moduleFiles(MECHANISMS_DIR)).toStrictEqual([...ENUMERATED_COPIES]);
  });

  it('reaches dd only through PUBLIC subpaths — no fork, no deep dist, no node_modules path', () => {
    for (const name of moduleFiles(MODULE_DIR)) {
      const source = read(join(MODULE_DIR, name));
      expect(source, `${name} must not import the fork`).not.toMatch(
        /from '[^']*services\/dd|from '[^']*acts\/dd/,
      );
      expect(source, `${name} must not reach past the exports map`).not.toMatch(
        /@ai-substrate\/dd\/dist|node_modules/,
      );
    }
  });

  /**
   * The dw-000f line itself. A copy is legitimate ONLY while dd refuses to
   * publish the thing — so the justification is re-measured against the
   * installed package rather than trusted from a comment written months ago.
   */
  it('copies nothing dd actually publishes: every origin is unreachable at the pin', () => {
    // The enumeration and the origin map must stay in lockstep, or a new copy
    // could be added to one and silently skip this check in the other.
    expect(Object.keys(ORIGINS).sort()).toStrictEqual([...ENUMERATED_COPIES].sort());

    for (const [file, origin] of Object.entries(ORIGINS)) {
      let resolved: string | null = null;
      try {
        resolved = require_.resolve(origin);
      } catch {
        resolved = null;
      }
      expect(
        resolved,
        `${file} copies ${origin}, but dd now PUBLISHES it — import it instead of copying it`,
      ).toBeNull();
    }
  });

  it('states provenance and the planned replacement at every copy, not just in the README', () => {
    for (const name of ENUMERATED_COPIES) {
      const source = read(join(MECHANISMS_DIR, name));
      expect(source, `${name} must name itself a temporary copy`).toMatch(/TEMPORARY COPY/);
      expect(source, `${name} must cite dd's seam as the planned replacement`).toMatch(/6aaef35/);
    }
    const readme = read(join(MECHANISMS_DIR, 'README.md'));
    for (const name of ENUMERATED_COPIES) {
      expect(readme, `README must enumerate ${name}`).toMatch(name.replace('.ts', ''));
    }
  });

  /**
   * The vocabulary copy is the one whose justification is a RULING rather than a
   * missing export, and it is the exact inversion of phase 1's rule. If that is
   * not written at the declaration, the next reader applies the old rule and
   * "fixes" it back.
   */
  it('records that the vocabulary copy is sanctioned by ruling, not tolerated as a gap', () => {
    const constants = read(join(MECHANISMS_DIR, 'constants.ts'));
    expect(constants).toMatch(/sanctioned/i);
    expect(constants).toMatch(/d8950eb/);
  });
});
