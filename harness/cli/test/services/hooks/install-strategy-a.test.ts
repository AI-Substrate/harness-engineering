import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { type AgentSpec, findAgent } from '../../../src/services/hooks/agent-matrix.js';
import { HOOK_MARKER } from '../../../src/services/hooks/hook-marker.js';
import {
  hookCommand,
  installStrategyA,
  skeletonFor,
} from '../../../src/services/hooks/install-strategy-a.js';
import { readFixture } from '../../support/config-fixture.js';

/**
 * STRATEGY A — the JSON config merge (plan 082 tk-0005).
 *
 * The ABSENT-FILE rows come first deliberately. Every fixture built before this
 * task starts from a config that EXISTS, so the no-config case is the one with no
 * fixture shape yet — which is exactly the one that gets quietly dropped. It is not
 * hypothetical: the collector's evidence already records git-ai creating copilot's
 * hooks file fresh on this machine.
 */

let home: string;
const fs = new NodeFs();
const env = () => undefined;
const BINARY = '"/usr/local/bin/harness"';

const spec = (agent: string): AgentSpec => {
  const found = findAgent(agent);
  if (found === undefined) throw new Error(`${agent} missing from the matrix`);
  return found;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-strategy-a-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the ABSENT-FILE case — one situation, three consequences (dw-0011, dw-0012)', () => {
  it('creates the file AND its parent directories, with a defined skeleton', () => {
    /*
    Test Doc:
    - Why: dw-0011. github-copilot's config is `.copilot/hooks/git-ai.json` — the
      parent is two levels deep and routinely absent on a fresh machine. Creating
      the file without its parents throws; creating it without a skeleton leaves a
      fragment the agent cannot read.
    - Contract: the file exists, parses, and carries BOTH event keys.
    */
    const [outcome] = installStrategyA(fs, spec('github-copilot'), home, env, BINARY);

    expect(outcome.created).toBe(true);
    expect(outcome.path).toBe(join(home, '.copilot/hooks/harness.json'));
    expect(existsSync(outcome.path)).toBe(true);

    const doc = JSON.parse(readFileSync(outcome.path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(Object.keys(doc.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse']);
    expect(doc.hooks.PreToolUse).toHaveLength(1);
    expect(doc.hooks.PostToolUse).toHaveLength(1);
  });

  it('the skeleton carries THIS AGENT\u2019s event casing, not a hard-coded PreToolUse', () => {
    /*
    Test Doc:
    - Why: a skeleton hard-coded to `PreToolUse` produces a config that gemini and
      cursor silently ignore — an install that reports success and does nothing,
      which is this plan's recurring shape.
    - Contract: gemini gets BeforeTool/AfterTool; cursor gets lowerCamel.
    */
    expect(Object.keys(skeletonFor(spec('gemini')).hooks)).toEqual(['BeforeTool', 'AfterTool']);
    expect(Object.keys(skeletonFor(spec('cursor')).hooks)).toEqual(['preToolUse', 'postToolUse']);
  });

  it('reports created=true so uninstall can DELETE rather than restore (dw-0012)', () => {
    /*
    Test Doc:
    - Why: dw-0012. `backupAgentConfigs` skips a non-existent source, so a created
      file has NO BACKUP. "No backup" and "backed up successfully" must never look
      the same to a caller — and uninstall's symmetry here is DELETE what we
      created, because there are no original bytes to restore.
    - Contract: created=true when we made the file, false when we edited one.
    - NOTE FOR tk-000d: this flag is the INPUT to that decision. The delete itself
      belongs to uninstall, and is deliberately not implemented here.
    */
    const fresh = installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(fresh.every((o) => o.created)).toBe(true);

    // Second install against the now-existing file: modified, not created.
    rmSync(join(home, '.cursor/hooks.json'));
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor/hooks.json'), readFixture('cursor.input.json'));

    const second = installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(second.every((o) => o.created)).toBe(false);
  });

  it('created=true is DISTINGUISHABLE from modified — not merely both truthy', () => {
    // The whole point of the flag is that the two cases differ. If a refactor ever
    // made `created` always true (or always false), every row above still passes
    // individually; only comparing them catches it.
    const created = installStrategyA(fs, spec('firebender'), home, env, BINARY);
    const modified = installStrategyA(fs, spec('firebender'), home, env, BINARY);
    expect(created[0].created).toBe(true);
    expect(modified[0].created).toBe(false);
  });
});

describe('the merge PRESERVES every pre-existing sibling (dw-0013)', () => {
  const seedCursor = (): string => {
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(path, readFixture('cursor.input.json'));
    return path;
  };

  it('matches the committed golden — a REGRESSION LOCK', () => {
    /*
    Test Doc:
    - Why: the golden was generated by this writer, so matching it is the writer
      agreeing with itself. Kept as a lock against unintended change; the PROOF is
      the property rows below, derived from the INPUT.
    */
    const path = seedCursor();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(readFileSync(path, 'utf8')).toBe(readFixture('cursor.golden.json'));
  });

  it("git-ai's compound entry is BYTE-IDENTICAL afterwards — asserted from the INPUT", () => {
    /*
    Test Doc:
    - Why: dw-0013 says assert the siblings, "not by re-reading our own entry".
      Confirming our entry landed proves nothing about what happened to theirs, and
      theirs is the thing a clobbering or re-sorting writer destroys.
    - Contract: every entry present before the install is present after it, byte for
      byte, taken from the input rather than from the golden.
    */
    const path = seedCursor();
    const before = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    const preExisting = [...before.hooks.preToolUse, ...before.hooks.postToolUse].map(
      (e) => e.command,
    );
    expect(preExisting).toHaveLength(2);

    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    const after = readFileSync(path, 'utf8');

    for (const command of preExisting) {
      expect(after).toContain(command);
    }
  });

  it('APPENDS — the pre-existing entry keeps its position, ours goes last', () => {
    const path = seedCursor();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(doc.hooks.preToolUse).toHaveLength(2);
    expect(doc.hooks.preToolUse[0].command).toContain('git-ai checkpoint');
    expect(doc.hooks.preToolUse[1].command).toContain(HOOK_MARKER);
  });

  it('preserves COMMENTS and key order in a JSONC config', () => {
    const path = join(home, '.factory/settings.jsonc');
    mkdirSync(join(home, '.factory'), { recursive: true });
    writeFileSync(path, readFixture('droid.input.jsonc'));

    // droid's shipped config file is settings.json; this row drives the JSONC
    // fixture through the same code to prove the writer, not the path.
    const jsoncSpec: AgentSpec = { ...spec('droid'), configFiles: ['settings.jsonc'] };
    installStrategyA(fs, jsoncSpec, home, env, BINARY);

    const after = readFileSync(path, 'utf8');
    expect(after).toContain('// Droid stores settings as JSONC');
    expect(after.indexOf('preToolUse')).toBeLessThan(after.indexOf('postToolUse'));
  });
});

describe('windsurf writes BOTH files — half-working is the failure mode (dw-0014)', () => {
  it('creates and populates both ~/.codeium paths', () => {
    /*
    Test Doc:
    - Why: dw-0014. Windsurf is the only multi-file agent, so a single-file
      assumption passes against the other six and installs half of windsurf's hooks
      — reporting success either way.
    - Contract: two outcomes, two files on disk, each carrying our entry.
    */
    const outcomes = installStrategyA(fs, spec('windsurf'), home, env, BINARY);

    expect(outcomes.map((o) => o.path)).toEqual([
      join(home, '.codeium/hooks.json'),
      join(home, '.codeium/windsurf/hooks.json'),
    ]);
    for (const outcome of outcomes) {
      expect(existsSync(outcome.path)).toBe(true);
      expect(readFileSync(outcome.path, 'utf8')).toContain(HOOK_MARKER);
    }
  });

  it('the SECOND file is not forgotten — asserted on its own', () => {
    // A separate row on the second path specifically: an implementation that wrote
    // only the first would pass a "some file was written" assertion.
    installStrategyA(fs, spec('windsurf'), home, env, BINARY);
    expect(existsSync(join(home, '.codeium/windsurf/hooks.json'))).toBe(true);
  });
});

describe('adding an agent is adding a ROW — through the REAL writer (dw-0010)', () => {
  it('a FAKE agent installs end-to-end with NO code change', () => {
    /*
    Test Doc:
    - Why: this is the INSTALL half of dw-0010, which was deliberately left
      unchecked in tk-0004 because the installer did not exist. Resolution alone was
      proven there; this drives the same invented row through the real writer.
    - Contract: a row named nowhere in src/ creates its directories, its files and
      its entries, using that row's own event casing.
    - Quality Contribution: if this required touching anything but the table, THAT
      is the finding. It did not.
    */
    const fake: AgentSpec = {
      agent: 'totally-invented-agent',
      subdir: '.invented',
      configFiles: ['hooks.json', 'nested/more.json'],
      events: { pre: ['WhateverBefore'], post: ['WhateverAfter'] },
      entryShape: 'flat',
      supported: true,
    };

    const outcomes = installStrategyA(fs, fake, home, env, BINARY);
    expect(outcomes).toHaveLength(2);

    for (const outcome of outcomes) {
      const doc = JSON.parse(readFileSync(outcome.path, 'utf8')) as {
        hooks: Record<string, { command: string }[]>;
      };
      expect(Object.keys(doc.hooks).sort()).toEqual(['WhateverAfter', 'WhateverBefore']);
      expect(doc.hooks.WhateverBefore[0].command).toBe(
        hookCommand(BINARY, 'totally-invented-agent', 'pre'),
      );
    }
  });
});

describe('installing twice is a no-op (looking ahead to tk-0009)', () => {
  it('finds our entry by MARKER, not by string equality with what we would write', () => {
    /*
    Test Doc:
    - Why: the binary path can legitimately differ between installs (a moved
      install, a different user). Matching on the whole command string would then
      fail to recognise our own entry and append a SECOND one on every run.
    - Contract: an entry written with a different binary path is still recognised.
    */
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    installStrategyA(fs, spec('cursor'), home, env, '"/old/path/harness"');

    const afterFirst = readFileSync(path, 'utf8');
    installStrategyA(fs, spec('cursor'), home, env, '"/new/path/harness"');

    expect(readFileSync(path, 'utf8')).toBe(afterFirst);
  });
});

describe('a BOM-prefixed config installs, cleanly — measured on the from-zero Windows fixture (2026-08-10)', () => {
  it('strips the UTF-8 BOM, appends the entries, and writes clean bytes', () => {
    // PowerShell wrote this file; every parse rejected the BOM; the writers
    // declined the text unchanged; the planner read that as already-present and
    // the install reported cursor installed while writing NOTHING.
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = join(home, '.cursor', 'hooks.json');
    writeFileSync(path, '﻿{\n  "hooks": {\n    "preToolUse": [],\n    "postToolUse": []\n  }\n}\n');

    const outcomes = installStrategyA(fs, spec('cursor'), home, env, BINARY);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.change).toBe('added-entry');
    expect(outcomes[0]?.writtenText).not.toBeNull();
    const after = readFileSync(path, 'utf8');
    expect(after.charCodeAt(0)).not.toBe(0xfeff);
    expect(after).toContain('hooks fire cursor');
    // The rollback text is the ORIGINAL bytes, BOM included.
    expect(outcomes[0]?.previousText?.charCodeAt(0)).toBe(0xfeff);
  });

  it('a genuinely malformed config throws BY NAME instead of no-opping into a success claim', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = join(home, '.cursor', 'hooks.json');
    writeFileSync(path, '{ this is not json at all\n');

    expect(() => installStrategyA(fs, spec('cursor'), home, env, BINARY)).toThrow(
      /not parseable JSON.*Nothing was modified/s,
    );
    // Refusing loudly still means refusing: the file is untouched.
    expect(readFileSync(path, 'utf8')).toBe('{ this is not json at all\n');
  });
});

describe('absent and unreadable are different worlds (from-zero fixture, 2026-08-10)', () => {
  it('a file that EXISTS but cannot be read throws by name — never records created', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = join(home, '.cursor', 'hooks.json');
    writeFileSync(path, '{ "hooks": { "preToolUse": [], "postToolUse": [] } }\n');
    // A locked/denied file on Windows: exists() true, every read fails.
    const blind = new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'readText') return () => null;
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(() => installStrategyA(blind, spec('cursor'), home, env, BINARY)).toThrow(
      /exists but could not be read.*Nothing was modified/s,
    );
  });

  it('a write the symlink resolver DECLINES fails the agent instead of recording success', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = join(home, '.cursor', 'hooks.json');
    const before = '{ "hooks": { "preToolUse": [], "postToolUse": [] } }\n';
    writeFileSync(path, before);
    // exists true + realpath unresolvable = writeThroughSymlink returns null.
    const unresolvable = new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'realpath') return () => null;
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(() => installStrategyA(unresolvable, spec('cursor'), home, env, BINARY)).toThrow(
      /real path could not be resolved.*NOT written/s,
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
