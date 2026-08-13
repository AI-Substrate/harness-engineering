import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { AGENT_MATRIX } from '../../../src/services/hooks/agent-matrix.js';
import { installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';
import { copilotSchemaViolations } from '../../support/copilot-published-schema.js';

/**
 * OUR EMITTED SHAPE, CHECKED AGAINST THE VENDOR'S PUBLISHED CONTRACT (plan 084).
 *
 * THE DEFECT CLASS THIS CLOSES. Every check we owned for copilot compared our entry
 * with git-ai's (`writer-shape-parity.ts`). Both writers emit `{command, type,
 * powershell}` and neither emits `bash` — so a differential check between them
 * reports agreement no matter what copilot requires. A check between two things we
 * wrote cannot see a defect they share, and that is why this class was invisible for
 * the whole of plan 082 while a named question about it (Q1) sat open.
 *
 * READ THE NEGATIVE ROWS FIRST. A checker that returned `[]` unconditionally would
 * pass the conformance row below and tell us nothing — the same shape as the
 * predicate this plan already found with zero production callers, green forever
 * while protecting nothing. So the refusals are asserted BEFORE the conformance, and
 * each names the rule it exercises.
 *
 * LOCATION-INDEPENDENT BY CONSTRUCTION, and checked rather than assumed: the binary
 * is a fixture string and the home is a fresh temp dir, so nothing here reads the
 * path this checkout happens to sit at. Two location-bound failures turned up in one
 * stream (20 install tests, and `pty-input.test.ts` on main), so location is treated
 * as a variable by default now, not as an explanation of last resort.
 */

const fs = new NodeFs();
const COPILOT = AGENT_MATRIX.find((spec) => spec.agent === 'github-copilot');
if (COPILOT === undefined) throw new Error('github-copilot missing from AGENT_MATRIX');

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-copilot-schema-'));
  mkdirSync(join(home, '.copilot'), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('THE CHECKER REFUSES — proven before any green is trusted', () => {
  it.each([
    [
      'a powershell-ONLY entry — the shape that cannot run on unix',
      { hooks: { PreToolUse: [{ type: 'command', powershell: "& 'x' hooks fire" }] } },
      'No unix invocation',
    ],
    [
      'an entry with no invocation at all',
      { hooks: { PreToolUse: [{ type: 'command' }] } },
      'at least one of',
    ],
    [
      'a bad `version` — named by the vendor as rejecting the whole file',
      { version: 2, hooks: { PreToolUse: [{ command: 'x' }] } },
      'a bad version rejects the whole file',
    ],
    [
      'a non-array event list — a structural error',
      { hooks: { PreToolUse: { command: 'x' } } },
      'Expected an array',
    ],
    [
      'an unimplemented hook kind',
      { hooks: { PreToolUse: [{ type: 'shell', bash: 'x' }] } },
      'Expected "command", "http" or "prompt"',
    ],
    [
      'a non-numeric timeout',
      { hooks: { PreToolUse: [{ type: 'command', bash: 'x', timeoutSec: '30' }] } },
      'Expected a number',
    ],
  ])('REFUSES %s', (_name, doc, expected) => {
    const violations = copilotSchemaViolations(doc);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.problem).join(' | ')).toContain(expected);
  });

  it("ACCEPTS the vendor's own documented example — it is not refusing everything", () => {
    // The positive control for the checker itself, lifted from the published page.
    expect(
      copilotSchemaViolations({
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: 'command',
              bash: './scripts/security-check.sh',
              powershell: './scripts/security-check.ps1',
              cwd: 'scripts',
              timeoutSec: 15,
            },
          ],
        },
      }),
    ).toEqual([]);
  });
});

describe('what WE write conforms to the published contract', () => {
  const emitted = (binary: string): unknown => {
    installStrategyA(fs, COPILOT, home, () => undefined, binary);
    return JSON.parse(readFileSync(join(home, '.copilot', 'hooks', 'harness.json'), 'utf8'));
  };

  it('our real emitted document has NO violations', () => {
    /*
    Test Doc:
    - Why: this is the assertion nobody had. `writer-shape-parity.ts` proves we match
      git-ai; nothing proved we match COPILOT, and the two are not the same claim.
    - Contract: the document `installStrategyA` actually writes conforms.
    - LIMIT, stated so a green is not over-read: this is the vendor's DOCUMENTED
      contract, not their runtime. It cannot prove a hook fires. The live probe of
      copilot 1.0.79 recorded in `copilot-published-schema.ts` is the runtime
      evidence, and it covers one version on one platform.
    */
    expect(copilotSchemaViolations(emitted('"/usr/local/bin/harness"'))).toEqual([]);
  });

  it('the UNIX SLOT is populated — the rule a git-ai parity check cannot see', () => {
    // Named separately from the row above because it is the specific property at
    // issue: git-ai emits no `bash` either, so parity with git-ai is satisfied by an
    // entry that has no unix invocation at all.
    const doc = emitted('"/usr/local/bin/harness"') as {
      hooks: Record<string, Record<string, unknown>[]>;
    };

    for (const entries of Object.values(doc.hooks)) {
      for (const entry of entries) {
        const unix = typeof entry.bash === 'string' || typeof entry.command === 'string';
        expect(unix).toBe(true);
      }
    }
  });

  it('an interpreter-first invocation conforms too — the npx/node case', () => {
    // The shape a `npx harness` install produces: interpreter AND script, which is
    // where the powershell reconstruction diverged from the command string (F008).
    // git-ai is a single native binary and has no worked example of this at all, so
    // it is precisely where upstream parity has nothing to say.
    expect(
      copilotSchemaViolations(emitted('"/usr/local/bin/node" --no-warnings "/opt/h/harness.js"')),
    ).toEqual([]);
  });
});
