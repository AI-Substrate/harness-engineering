import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { type AgentSpec, findAgent } from '../../../src/services/hooks/agent-matrix.js';
import { HOOK_MARKER, HOOK_MARKER_FLAG } from '../../../src/services/hooks/hook-marker.js';
import { installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';
import { uninstallStrategyA } from '../../../src/services/hooks/uninstall-strategy-a.js';
import { readFixture } from '../../support/config-fixture.js';

/**
 * UNINSTALL (plan 082 tk-000d).
 *
 * The symmetry is SURGICAL REMOVAL through the same writer install used, not a
 * restore from backup — the file returns to its original bytes because every byte we
 * did not write was never rewritten.
 */

let home: string;
const fs = new NodeFs();
const env = () => undefined;
const BINARY = '"/usr/local/bin/harness"';

/** Strip `//` line comments so a JSONC document can be structurally compared. */
const stripJsonComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

const spec = (agent: string): AgentSpec => {
  const found = findAgent(agent);
  if (found === undefined) throw new Error(`${agent} missing from the matrix`);
  return found;
};

const seedCursor = (): string => {
  const path = join(home, '.cursor/hooks.json');
  mkdirSync(join(home, '.cursor'), { recursive: true });
  writeFileSync(path, readFixture('cursor.input.json'));
  return path;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-uninstall-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('install then uninstall returns the ORIGINAL BYTES (dw-002f)', () => {
  it('whole-file equality — a reordered sibling would fail this', () => {
    /*
    Test Doc:
    - Why: dw-002f. Whole-file byte equality is the only assertion that catches a
      writer which preserves every VALUE while rearranging the document — git-ai's
      BTreeMap behaviour. A deep-equal on the parsed docs would pass through it.
    - Contract: the bytes after the round trip are identical to the bytes before.
    */
    const path = seedCursor();
    const before = readFileSync(path, 'utf8');

    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(readFileSync(path, 'utf8')).not.toBe(before); // the install really happened

    uninstallStrategyA({ fs, home, env }, spec('cursor'));
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it("git-ai's compound entry is untouched, and comments survive the round trip", () => {
    // The committed JSONC fixture is cursor-SHAPED (lowerCamel keys), so it is
    // driven with a spec whose event names match it. Pointing the droid spec (Pascal)
    // at it would have `appendToArray` CREATE new keys — which is a different case,
    // covered by its own row below.
    const path = join(home, '.factory/settings.jsonc');
    mkdirSync(join(home, '.factory'), { recursive: true });
    writeFileSync(path, readFixture('droid.input.jsonc'));
    const before = readFileSync(path, 'utf8');
    const jsonc: AgentSpec = {
      ...spec('droid'),
      configFiles: ['settings.jsonc'],
      events: { pre: 'preToolUse', post: 'postToolUse' },
    };

    installStrategyA(fs, jsonc, home, env, BINARY);
    uninstallStrategyA({ fs, home, env }, jsonc);
    const after = readFileSync(path, 'utf8');

    // MEASURED LIMIT, and the reason this row does not assert byte equality: the
    // writer NORMALISES the formatting of containers it touches. This fixture's
    // entries are written on ONE line (`{ "command": "echo droid-pre" }`); install
    // re-indents that array and uninstall does not put the compact form back. Every
    // VALUE, every COMMENT, the key ORDER and every untouched byte are restored —
    // the array's internal whitespace is not.
    // FOUR NAMED PROPERTIES, not "structurally equal" — that phrase is the kind a
    // real regression hides inside. Each of a reordered sibling, a lost comment, a
    // changed value and a surviving marker must turn this row RED on its own.
    //
    // 1. VALUES
    expect(JSON.parse(stripJsonComments(after))).toEqual(JSON.parse(stripJsonComments(before)));
    // 2. COMMENTS — every one of them, counted, not merely "some comment survived"
    const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('//'));
    expect(comments(after)).toEqual(comments(before));
    // 3. KEY ORDER — the property byte-equality was really protecting, since a
    //    silently re-sorted sibling is git-ai's actual defect
    const keyOrder = (text: string) => [...text.matchAll(/"([A-Za-z]\w*)":/g)].map((m) => m[1]);
    expect(keyOrder(after)).toEqual(keyOrder(before));
    // 4. NO MARKER ANYWHERE
    expect(after).not.toContain(HOOK_MARKER);
  });

  it('is idempotent — a second uninstall changes nothing', () => {
    const path = seedCursor();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    uninstallStrategyA({ fs, home, env }, spec('cursor'));
    const after = readFileSync(path, 'utf8');

    const second = uninstallStrategyA({ fs, home, env }, spec('cursor'));
    expect(readFileSync(path, 'utf8')).toBe(after);
    expect(second[0].removed).toBe(0);
  });
});

describe('an events key WE CREATED is removed too', () => {
  it('a config lacking the events key round-trips to its ORIGINAL bytes', () => {
    /*
    Test Doc:
    - Why: MEASURED asymmetry. When a config exists but has no events key — a
      settings.json carrying only `model` and `permissions`, which is the common
      shape — install CREATES that key. Removing only our entry left
      `"PreToolUse": []` behind, so the file was not the bytes it started as:
      install created something uninstall did not remove.
    - Contract: whole-file byte equality for that shape.
    */
    const path = join(home, '.claude/settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ model: 'opus', hooks: {} }, null, 2)}\n`);
    const before = readFileSync(path, 'utf8');

    installStrategyA(fs, spec('claude-code'), home, env, BINARY);
    expect(readFileSync(path, 'utf8')).toContain('PreToolUse');

    uninstallStrategyA({ fs, home, env }, spec('claude-code'));
    const after = readFileSync(path, 'utf8');

    // The KEYS we created are gone — that is the asymmetry this row exists for.
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
    expect(after).not.toContain('PreToolUse');
    expect(after).not.toContain('ai-substrate-harness-hook-v1');
    // Same measured limit as above: `"hooks": {}` comes back as an expanded empty
    // object, because the writer normalises the container it emptied. Structure and
    // values are identical; the whitespace inside that one container is not.
    expect(after.replace(/\s+/g, '')).toBe(before.replace(/\s+/g, ''));
  });

  it('a PRE-EXISTING empty array is removed too — the over-reach, asserted not hidden', () => {
    // The narrower error than leaving a key we created, and semantically identical
    // to absent for hook loading — but it IS a change to something we did not add,
    // so it is written down as a row rather than left to be discovered.
    const path = join(home, '.claude/settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ model: 'opus', hooks: { PreToolUse: [], PostToolUse: [] } }, null, 2)}\n`,
    );

    installStrategyA(fs, spec('claude-code'), home, env, BINARY);
    uninstallStrategyA({ fs, home, env }, spec('claude-code'));

    const after = JSON.parse(readFileSync(path, 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(after.hooks)).toEqual([]);
  });
});

describe('a file WE CREATED is deleted, not restored (dw-0030)', () => {
  it('deletes it, because there are no original bytes to return to', () => {
    /*
    Test Doc:
    - Why: dw-0030. `install` on an agent with no config creates the file and its
      parents. "Restore the original bytes" is undefined when there were none, so
      the honest inverse of *we made this file* is *we remove it*.
    - Contract: deleted=true and the file is gone.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const outcomes = installStrategyA(fs, spec('cursor'), home, env, BINARY);
    const created = new Set(outcomes.filter((o) => o.created).map((o) => o.path));
    expect(created.size).toBe(1);

    const result = uninstallStrategyA({ fs, home, env, createdFiles: created }, spec('cursor'));
    expect(result[0].deleted).toBe(true);
    expect(existsSync(join(home, '.cursor/hooks.json'))).toBe(false);
  });

  it('EDITS rather than deletes when the file pre-existed — the discriminator', () => {
    // Without this, "deletes what we created" is satisfied by an uninstall that
    // deletes everything.
    const path = seedCursor();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);

    const result = uninstallStrategyA({ fs, home, env, createdFiles: new Set() }, spec('cursor'));
    expect(result[0].deleted).toBe(false);
    expect(result[0].removed).toBe(2);
    expect(existsSync(path)).toBe(true);
  });
});

describe('REFUSE, never clobber (dw-0032)', () => {
  it('a file lacking our marker is left byte-identical', () => {
    /*
    Test Doc:
    - Why: dw-0032. This is the guard git-ai implemented in exactly ONE of fifteen
      installers (cline.rs); amp.rs calls remove_file with no marker check at all,
      and that is the behaviour being rejected.
    - Contract: unmarked=true, nothing removed, the bytes unchanged.
    */
    const path = seedCursor(); // git-ai's entries only — none of ours
    const before = readFileSync(path, 'utf8');

    const result = uninstallStrategyA({ fs, home, env }, spec('cursor'));
    expect(result[0].unmarked).toBe(true);
    expect(result[0].removed).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('an unparseable config is refused rather than rewritten', () => {
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(path, '{ not json at all');

    const result = uninstallStrategyA({ fs, home, env }, spec('cursor'));
    expect(result[0].unmarked).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('{ not json at all');
  });
});

describe('ours-with-foreign is REPORTED and left alone (dw-0041)', () => {
  it('an entry chaining our invocation with foreign work is byte-identical afterwards', () => {
    /*
    Test Doc:
    - Why: dw-0041, and the reason `classifyOwnership` returns three states rather
      than a boolean. MEASURED as the normal shape: on this machine a third party
      wrapped git-ai's standalone hook invocation into a chained command. Deleting
      such an entry destroys work we did not write — precisely what git-ai's own
      predicate does to the POC entry here.
    - Contract: reported in `refused`, nothing removed, bytes unchanged.
    */
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const chained = `other-tool --run && harness hooks fire cursor ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;
    writeFileSync(
      path,
      `${JSON.stringify({ hooks: { preToolUse: [{ command: chained }], postToolUse: [] } }, null, 2)}\n`,
    );
    const before = readFileSync(path, 'utf8');

    const result = uninstallStrategyA({ fs, home, env }, spec('cursor'));

    expect(result[0].removed).toBe(0);
    expect(result[0].refused).toEqual([
      { command: chained, reason: 'our invocation is chained with foreign work in the same entry' },
    ]);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readFileSync(path, 'utf8')).toContain('other-tool --run');
  });

  it('a WHOLLY-OURS entry IS removed — the positive control', () => {
    /*
    Test Doc:
    - Why: dw-0041 names this explicitly. "Refuses to remove" is satisfied equally
      well by an uninstall that does nothing at all, so the refusal row means
      nothing without a row proving removal happens.
    */
    seedCursor();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    const result = uninstallStrategyA({ fs, home, env }, spec('cursor'));

    expect(result[0].removed).toBe(2);
    expect(result[0].refused).toEqual([]);
  });

  it('a MIXED file removes ours and keeps theirs', () => {
    // Both behaviours in one file, which is the case a per-file boolean would get
    // wrong in whichever direction it chose.
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const chained = `other-tool --run && harness hooks fire cursor ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;
    const ours = `"/usr/local/bin/harness" hooks fire cursor --phase pre --hook-input stdin ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;
    writeFileSync(
      path,
      `${JSON.stringify({ hooks: { preToolUse: [{ command: chained }, { command: ours }], postToolUse: [] } }, null, 2)}\n`,
    );

    const result = uninstallStrategyA({ fs, home, env }, spec('cursor'));
    expect(result[0].removed).toBe(1);
    expect(result[0].refused).toHaveLength(1);

    const after = readFileSync(path, 'utf8');
    expect(after).toContain('other-tool --run');
    expect(after).not.toContain('--phase pre');
  });
});

describe('flags install flips (dw-0031)', () => {
  it('ENUMERATES the flags per agent — currently NONE, stated rather than assumed', () => {
    /*
    Test Doc:
    - Why: dw-0031. The workshop names concrete failures — Gemini never reverts
      tools.enableHooks, VS Code never reverts chat.useHooks, Droid leaves
      claudeHooksImported: true. The other half nobody stated: if a flag is REQUIRED
      for hooks to run at all, install must FLIP it, or Strategy A produces an
      installed-but-inert hook.
    - Contract, and it is an honest negative: our installer flips NO flags. It writes
      one entry into an events array and nothing else, so there is nothing to revert.
      Asserted on the bytes — the round-trip rows above already prove whole-file
      equality, which would fail if any flag had been touched.
    - THE OPEN QUESTION IS RECORDED, NOT ANSWERED: whether gemini requires
      tools.enableHooks true for hooks to fire is UNVERIFIED here. We cannot read
      gemini's loader, and inventing a flag into a user's settings to satisfy a
      requirement we have not observed is how a config gets silently changed. It goes
      to tk-0010 with the copilot type/powershell question.
    */
    const path = join(home, '.gemini/settings.json');
    mkdirSync(join(home, '.gemini'), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ tools: { enableHooks: false }, hooks: { BeforeTool: [], AfterTool: [] } }, null, 2)}\n`,
    );
    const before = readFileSync(path, 'utf8');

    installStrategyA(fs, spec('gemini'), home, env, BINARY);
    const afterInstall = JSON.parse(readFileSync(path, 'utf8')) as {
      tools: { enableHooks: boolean };
    };
    // Install did NOT flip it — which is the honest current behaviour, and the
    // reason the question above matters.
    expect(afterInstall.tools.enableHooks).toBe(false);

    uninstallStrategyA({ fs, home, env }, spec('gemini'));
    const after = JSON.parse(readFileSync(path, 'utf8')) as {
      tools: { enableHooks: boolean };
      hooks: Record<string, unknown>;
    };
    // THE FLAG is what this row is about: untouched by install, untouched by
    // uninstall. Asserted on the flag itself rather than on the whole document,
    // because this fixture seeds PRE-EXISTING empty event arrays and uninstall
    // removes an array it emptied — the documented over-reach, firing exactly where
    // the row above says it does. Comparing whole documents here would conflate two
    // properties and fail for a reason that has nothing to do with flags.
    expect(after.tools.enableHooks).toBe(false);
    expect((JSON.parse(before) as { tools: { enableHooks: boolean } }).tools.enableHooks).toBe(
      false,
    );
    expect(Object.keys(after.hooks)).toEqual([]);
  });
});
