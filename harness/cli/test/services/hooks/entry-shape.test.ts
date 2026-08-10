import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import {
  AGENT_MATRIX,
  type AgentSpec,
  eventKeys,
  resolveConfigFiles,
} from '../../../src/services/hooks/agent-matrix.js';
import { entryIsOwnedByUs, HOOK_MARKER } from '../../../src/services/hooks/hook-marker.js';
import { installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';
import { uninstallStrategyA } from '../../../src/services/hooks/uninstall-strategy-a.js';
import {
  CONFIG_VALIDATORS,
  GIT_AI_SEED_ENTRY,
  shapeOf,
} from '../../support/agent-config-schema.js';

/**
 * THE ENTRY SHAPE IS NOT UNIFORM — and getting it wrong DISABLES THE HOST
 * APPLICATION'S CONFIG (plan 082 F005).
 *
 * Found in the wild by Jordan, in a Claude Code instance that refused to start
 * cleanly. We wrote Cursor's flat `{command}` into `~/.claude/settings.json`, which
 * requires `{matcher, hooks:[{type, command}]}`. Claude Code SKIPS A FILE WITH
 * ERRORS ENTIRELY — so the cost was not a dead hook, it was every permission and
 * notification setting in that file, silently, since the live install. The same
 * entry went into `~/.gemini/settings.json` and `~/.factory/settings.json`.
 *
 * WHY NOTHING CAUGHT IT. Every install fixture asserts that OUR entry is present and
 * that the SIBLINGS survived — properties of the PARTS. **Preservation is not
 * correctness.** Every entry survived; the document stopped working anyway, because
 * validity is a property of the whole file. The rows below assert the whole file.
 *
 * FOURTH TIME THIS PLAN ASSUMED UNIFORMITY ACROSS AGENTS AND WAS WRONG: event-name
 * casing, config paths, windsurf's two files, copilot's file belonging to somebody
 * else — and now the entry shape. Unlike the others, this one damages the host.
 */

let home: string;
const fs = new NodeFs();
const env = () => undefined;
const BINARY = '"/usr/local/bin/harness"';

/** Agents we actually install into. firebender is held out — see its matrix row. */
const installable = AGENT_MATRIX.filter((spec) => spec.supported);

const readDoc = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Just the `hooks` block — what uninstall promises to return to its original state. */
const hooksBlockOf = (text: string): unknown => (JSON.parse(text) as { hooks: unknown }).hooks;

/** Seed every one of this agent's config files with git-ai's own real entry. */
function seedWithGitAi(spec: AgentSpec): string[] {
  return resolveConfigFiles(spec, home, env).map((path) => {
    const hooks: Record<string, unknown[]> = {};
    for (const key of eventKeys(spec)) hooks[key] = [GIT_AI_SEED_ENTRY[spec.agent](key)];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ hooks }, null, 2)}\n`);
    return path;
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-entry-shape-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('THE FILE IS STILL VALID TO ITS OWN CONSUMER — the assertion nobody had', () => {
  it.each(
    installable.map((spec) => spec.agent),
  )('%s: the config still satisfies that agent\u2019s own schema after install', (agent) => {
    /*
      Test Doc:
      - Why: F005. This is the row that would have stopped the defect reaching
        Jordan's machine. It is deliberately NOT about our entry: it validates the
        WHOLE document against what that agent requires, which is the only property
        that distinguishes "our hook is installed" from "this file still works".
      - Contract: zero schema violations, for every agent we install into.
      - Proven RED: with the matrix collapsed back to one flat shape, claude-code,
        gemini and droid all report
        `hooks.PreToolUse.1.hooks: Expected array, but received undefined` —
        byte-for-byte the message Claude Code showed Jordan.
      */
    const spec = installable.find((s) => s.agent === agent) as AgentSpec;
    const paths = seedWithGitAi(spec);
    installStrategyA(fs, spec, home, env, BINARY);

    for (const path of paths) {
      expect(CONFIG_VALIDATORS[agent](readDoc(path))).toEqual([]);
    }
  });

  it('the validator itself REFUSES the flat shape in a nested config', () => {
    /*
    Test Doc:
    - Why: a validator that never fails would make every row above green while
      proving nothing. This points it at the exact broken document Jordan had.
    - Contract: it reports the real message, at the real index.
    */
    const broken = {
      hooks: {
        PreToolUse: [GIT_AI_SEED_ENTRY['claude-code']('PreToolUse'), { command: 'ours' }],
      },
    };
    expect(CONFIG_VALIDATORS['claude-code'](broken)).toEqual([
      { at: 'hooks.PreToolUse.1.hooks', problem: 'Expected array, but received undefined' },
    ]);
  });

  it('and REFUSES the nested shape in a flat config — the mirror image', () => {
    // firebender treats a matcher-bearing entry as not-installed (firebender.rs:66)
    // and strips it (firebender.rs:179). Nested is as wrong there as flat is here.
    const broken = { hooks: { preToolUse: [{ matcher: '*', hooks: [] }] } };
    expect(CONFIG_VALIDATORS.firebender(broken).map((v) => v.at)).toEqual([
      'hooks.preToolUse.0.command',
      'hooks.preToolUse.0.matcher',
      'hooks.preToolUse.0.hooks',
    ]);
  });
});

describe('OUR ENTRY MATCHES THE WORKED EXAMPLE ALREADY IN THE FILE', () => {
  it.each(
    installable.map((spec) => spec.agent),
  )('%s: our entry is structurally identical to git-ai\u2019s sibling', (agent) => {
    /*
      Test Doc:
      - Why: THE GENERAL GUARD, and the one that outlives this bug. A sibling entry
        is a worked example of the required shape, sitting in the file we are about
        to edit. We had it — git-ai's correctly-shaped entry was ONE LINE ABOVE ours
        in `~/.claude/settings.json` — and we did not read it.
      - Contract: for every agent, the shape signature of our appended entry equals
        the shape signature of the entry that was already there. It compares
        STRUCTURE only, so the different commands, matchers and flags do not matter.
      - Quality Contribution: this needs no per-agent expectation written down. A
        future eighth agent is covered by seeding its own real entry, so the guard
        cannot go stale the way a hard-coded shape table can.
      */
    const spec = installable.find((s) => s.agent === agent) as AgentSpec;
    const paths = seedWithGitAi(spec);
    installStrategyA(fs, spec, home, env, BINARY);

    for (const path of paths) {
      const hooks = (readDoc(path) as { hooks: Record<string, unknown[]> }).hooks;
      for (const key of eventKeys(spec)) {
        const entries = hooks[key];
        expect(entries).toHaveLength(2);
        const [theirs, ours] = entries;
        expect(shapeOf(ours)).toBe(shapeOf(theirs));
      }
    }
  });

  it('shapeOf DISCRIMINATES — flat and nested do not share a signature', () => {
    // Without this, "same shape" could be satisfied by a function that returns a
    // constant, and every row above would be green against the original defect.
    expect(shapeOf({ command: 'x' })).not.toBe(
      shapeOf({ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }),
    );
    // ...and it ignores values and key order, which is what makes it usable here.
    expect(shapeOf({ command: 'x' })).toBe(shapeOf({ command: 'totally different' }));
    expect(shapeOf({ a: 1, b: 'x' })).toBe(shapeOf({ b: 'y', a: 2 }));
  });
});

describe('UNINSTALL HANDLES THE SHAPE IT WROTE', () => {
  it.each(
    installable.map((spec) => spec.agent),
  )('%s: install then uninstall removes our entry and leaves git-ai\u2019s', (agent) => {
    /*
      Test Doc:
      - Why: our marker matching reads `entry.command`, which does not exist in the
        nested form — there the command lives at `entry.hooks[].command`. So an
        uninstall written for the flat shape would silently find nothing, and Jordan
        would have been unable to clean up with our own tool. He removed the entries
        by hand precisely because that was not trusted.
      - Contract: our entry is gone, git-ai's is byte-present, and the file is STILL
        VALID afterwards — an uninstall that corrupts the document is the same class
        of defect as the install that started this.
      */
    const spec = installable.find((s) => s.agent === agent) as AgentSpec;
    const paths = seedWithGitAi(spec);
    const before = paths.map((path) => readFileSync(path, 'utf8'));

    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    expect(outcomes.every((o) => !o.alreadyPresent)).toBe(true);

    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    const removed = uninstallStrategyA({ fs, home, env, createdKeys }, spec);
    // One removal per event key PER FILE — windsurf has five keys across two files,
    // so ten. (This expectation was originally written as if every agent had one
    // config file; the arithmetic was mine, not the code's.)
    expect(removed.reduce((sum, o) => sum + o.removed, 0)).toBe(
      eventKeys(spec).length * paths.length,
    );

    paths.forEach((path, index) => {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain(HOOK_MARKER);
      // THE `hooks` BLOCK returns to its original bytes — that is uninstall's
      // promise, and it holds in both entry shapes.
      expect(hooksBlockOf(text)).toEqual(hooksBlockOf(before[index]));
      expect(CONFIG_VALIDATORS[agent](JSON.parse(text))).toEqual([]);
    });
  });

  it('finds our NESTED entry by the marker inside hooks[].command', () => {
    // The specific mechanism: a nested entry carries no top-level `command`, so an
    // ownership test reading only `entry.command` sees nothing to remove.
    const nested = {
      matcher: '*',
      hooks: [
        { type: 'command', command: `harness hooks fire claude-code --hook-owner ${HOOK_MARKER}` },
      ],
    };
    expect(entryIsOwnedByUs(nested)).toBe(true);
    expect(entryIsOwnedByUs({ command: 'somebody else' })).toBe(false);
  });

  it('REMOVES AN ENTRY WE WROTE IN THE WRONG SHAPE — the recoverability property', () => {
    /*
    Test Doc:
    - Why: this is the property whose ABSENCE forced a human to repair three configs
      by hand. Our old ownership test read `entry.command`, which does not exist in a
      nested entry — so had we ever written the wrong shape (and we did), our own
      uninstall could not see it. A tool that can break a config but not un-break it
      is worse than one that refuses to write.
    - Contract: install with claude-code's row deliberately set to the WRONG shape,
      then uninstall with the correct row. It is still found and removed.
    - Quality Contribution: this holds for any future shape error, not just this one.
      Detection is deliberately WIDER than production — `entryCommands` reads both
      shapes — so recoverability does not depend on the matrix being right.
    */
    const correct = installable.find((s) => s.agent === 'claude-code') as AgentSpec;
    const wrongShape: AgentSpec = { ...correct, entryShape: 'flat' };

    seedWithGitAi(correct);
    const outcomes = installStrategyA(fs, wrongShape, home, env, BINARY);
    const path = outcomes[0].path;
    // The damage, reproduced: the file is now INVALID to claude-code.
    expect(CONFIG_VALIDATORS['claude-code'](readDoc(path))).not.toEqual([]);

    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    const removed = uninstallStrategyA({ fs, home, env, createdKeys }, correct);

    expect(removed.reduce((sum, o) => sum + o.removed, 0)).toBe(eventKeys(correct).length);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(HOOK_MARKER);
    // ...and the file is valid again, with git-ai's entry untouched.
    expect(CONFIG_VALIDATORS['claude-code'](JSON.parse(text))).toEqual([]);
    expect(text).toContain('git-ai checkpoint claude');
  });

  it('...and in the REVERSE direction — nested written into a flat agent', () => {
    /*
    Test Doc:
    - Why: the row above installs the FLAT shape, so flat-only ownership reading is
      enough to clean it up — it does not exercise the nested path. MEASURED: with
      `entryCommands`' nested branch deleted, that row stayed GREEN. A recoverability
      claim needs BOTH directions or it only covers the mistake we happened to make.
    - Contract: cursor's row set to `nested`, installed, then removed by the correct
      flat row.
    */
    const correct = installable.find((s) => s.agent === 'cursor') as AgentSpec;
    const wrongShape: AgentSpec = { ...correct, entryShape: 'nested', matcher: '*' };

    seedWithGitAi(correct);
    const outcomes = installStrategyA(fs, wrongShape, home, env, BINARY);
    expect(CONFIG_VALIDATORS.cursor(readDoc(outcomes[0].path))).not.toEqual([]);

    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    const removed = uninstallStrategyA({ fs, home, env, createdKeys }, correct);

    expect(removed.reduce((sum, o) => sum + o.removed, 0)).toBe(eventKeys(correct).length);
    const text = readFileSync(outcomes[0].path, 'utf8');
    expect(text).not.toContain(HOOK_MARKER);
    expect(CONFIG_VALIDATORS.cursor(JSON.parse(text))).toEqual([]);
  });
});

describe('ROOT FIELDS THE AGENT REQUIRES — well-formed and DEAD without them', () => {
  it('gemini gets tools.enableHooks — without it a perfect hook never fires', () => {
    /*
    Test Doc:
    - Why: F005's finding A, and its OWN row rather than folded into a shape
      assertion, because they fail for different reasons and a shared row would hide
      one behind the other. `gemini.rs:99-106` sets `tools.enableHooks` on EVERY
      install and `gemini.rs:478-480` asserts it — its own installer treats it as
      mandatory. We never wrote it, so our gemini entry could be perfectly shaped and
      never dispatched: F004's class (registered nowhere, fires never) for the third
      time in this plan.
    - Contract: a config we create carries it.
    - Proven RED: without `rootExtras` on the gemini row this reads `undefined`.
    - MATCHED-NOT-VERIFIED: git-ai writes it, so we write it. We have not observed
      gemini refusing to dispatch without it.
    */
    const spec = installable.find((s) => s.agent === 'gemini') as AgentSpec;
    const [outcome] = installStrategyA(fs, spec, home, env, BINARY);
    const doc = readDoc(outcome.path) as { tools?: { enableHooks?: unknown } };
    expect(doc.tools?.enableHooks).toBe(true);
  });

  it('NEVER overwrites a root value the user already has', () => {
    /*
    Test Doc:
    - Why: a root key is shared with settings we have no business touching. This is
      the same promise as the entry-level one — we add what is ours and rewrite
      nothing else — and it is the property that makes writing to a root key safe at
      all.
    - Contract: an existing `enableHooks: false` survives, and a SIBLING key inside
      the same `tools` object survives with it. The sibling is the load-bearing half:
      replacing the whole object rather than merging into it would preserve nothing
      and still pass an assertion about `enableHooks` alone.
    */
    const spec = installable.find((s) => s.agent === 'gemini') as AgentSpec;
    const path = join(home, '.gemini/settings.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ tools: { enableHooks: false, sandbox: 'docker' }, hooks: {} }, null, 2)}\n`,
    );

    installStrategyA(fs, spec, home, env, BINARY);
    const doc = readDoc(path) as { tools: { enableHooks: unknown; sandbox: unknown } };
    expect(doc.tools.enableHooks).toBe(false);
    expect(doc.tools.sandbox).toBe('docker');
  });

  it('a file WE CREATE for cursor/firebender carries the top-level version', () => {
    /*
    Test Doc:
    - Why: F005's finding B, on its own row. Both installers stamp `version: 1` when
      absent (`cursor.rs:172-174`, `firebender.rs:143-148`). Cursor's real file on
      this machine already has it, so an assertion against a PRE-EXISTING config
      could never go red — the case that needed building is the file we create
      ourselves, which is exactly where the field would be missing.
    - Contract: a created config carries `version: 1`.
    - Proven RED: without `rootExtras` on the cursor row this reads `undefined`.
    - SCOPE: insert-when-absent only. We never rewrite a version a user's file
      already carries — asserted by the row below.
    - MATCHED-NOT-VERIFIED: git-ai writes it, so we write it.
    */
    const spec = installable.find((s) => s.agent === 'cursor') as AgentSpec;
    const [outcome] = installStrategyA(fs, spec, home, env, BINARY);
    expect(outcome.created).toBe(true);
    expect((readDoc(outcome.path) as { version?: unknown }).version).toBe(1);
  });

  it('but LEAVES a version the user already wrote', () => {
    const spec = installable.find((s) => s.agent === 'cursor') as AgentSpec;
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ version: 99, hooks: {} }, null, 2)}\n`);

    installStrategyA(fs, spec, home, env, BINARY);
    expect((readDoc(path) as { version: unknown }).version).toBe(99);
  });

  it('an agent with NO root requirement gains no root keys', () => {
    // The negative control: without it, a writer that stamped `version` into every
    // config would pass every row above.
    const spec = installable.find((s) => s.agent === 'droid') as AgentSpec;
    const [outcome] = installStrategyA(fs, spec, home, env, BINARY);
    expect(Object.keys(readDoc(outcome.path) as object)).toEqual(['hooks']);
  });

  it('UNINSTALL DELIBERATELY LEAVES root fields behind — removing them breaks git-ai', () => {
    /*
    Test Doc:
    - Why: this row exists because the uninstall symmetry rows FAILED here, and the
      failure was the right question rather than a defect. Install adds
      `tools.enableHooks`, so symmetry argues uninstall should remove it.
      **It must not.** That flag is a document-level enablement switch shared by
      EVERY hook consumer in the file — git-ai sets it for its own gemini hooks
      (`gemini.rs:99-106`). Removing it on our way out would silently disable
      somebody else's working hooks, which is precisely the "never delete work we
      did not write" posture the marker exists to enforce. `version` is a document
      format declaration, not an entry of ours, and the same reasoning applies.
    - Contract: after uninstall our entries are gone and the root fields remain.
    - The cost is a leftover root key. That is recoverable cruft; disabling another
      tool's attribution is not — the same trade F003 settled for event-array keys.
    */
    const spec = installable.find((s) => s.agent === 'gemini') as AgentSpec;
    seedWithGitAi(spec);
    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    uninstallStrategyA({ fs, home, env, createdKeys }, spec);

    const doc = readDoc(outcomes[0].path) as { tools?: { enableHooks?: unknown } };
    expect(doc.tools?.enableHooks).toBe(true);
  });
});

describe('AGENTS WE CANNOT MEASURE ARE REFUSED, NOT GUESSED', () => {
  it('firebender is held OUT of the install set, with a stated reason', () => {
    /*
    Test Doc:
    - Why: PM ruling. We have just learned that a wrong shape does not merely fail
      to install — it can disable a host application's whole config. Guessing on an
      agent nobody has exercised risks exactly that on a user's machine.
    - Contract: it is present in the matrix (so `status` can report it honestly) and
      excluded from the installable set, carrying a reason a human can read.
    - NOTE: its SHAPE is known from `firebender.rs:126-141` and is asserted by the
      validator rows above. What is unverified is the install END TO END — no
      firebender exists on any machine we have touched.
    */
    const spec = AGENT_MATRIX.find((s) => s.agent === 'firebender') as AgentSpec;
    expect(spec).toBeDefined();
    expect(spec.supported).toBe(false);
    expect(spec.unsupportedReason).toMatch(/unverified/i);
    expect(installable.map((s) => s.agent)).not.toContain('firebender');
  });
});

describe('WINDSURF LISTENS ON ITS OWN EVENT NAMES', () => {
  it('installs into cascade events, NOT PreToolUse/PostToolUse', () => {
    /*
    Test Doc:
    - Why: F005's sibling finding. We wrote `PreToolUse`/`PostToolUse` into
      `~/.codeium/hooks.json`. Both entries are structurally valid so the file still
      parses — and if windsurf dispatches only on its own key names, our hook is
      installed, well-formed and DEAD. That is F004's class (registered nowhere,
      fires never) arriving through the event table instead of the flag table, and
      it is the fifth uniformity assumption in this plan.
    - Contract: the five cascade events from `windsurf.rs:17-23`, and no ToolUse key.
    */
    const spec = AGENT_MATRIX.find((s) => s.agent === 'windsurf') as AgentSpec;
    expect(eventKeys(spec)).toEqual([
      'pre_write_code',
      'pre_run_command',
      'post_write_code',
      'post_run_command',
      'post_cascade_response_with_transcript',
    ]);

    installStrategyA(fs, spec, home, env, BINARY);
    for (const path of resolveConfigFiles(spec, home, env)) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain('PreToolUse');
      expect(text).toContain('pre_write_code');
    }
  });
});
