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
  GIT_AI_SEED_ENTRY,
  shapeOf,
  WRITER_SHAPE_CHECKS,
} from '../../support/writer-shape-parity.js';

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

/** This run's root-extra provenance, in the shape uninstall reads it. */
const rootExtrasOf = (
  outcomes: readonly { path: string; createdRootExtras: string[][] }[],
): Map<string, string[][]> => new Map(outcomes.map((o) => [o.path, o.createdRootExtras]));

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

describe('THE WHOLE FILE IS CHECKED, NOT JUST OUR ENTRY — the assertion nobody had', () => {
  it.each(
    installable.map((spec) => spec.agent),
  )('%s: the config still matches the shape git-ai writes, after install', (agent) => {
    /*
      Test Doc:
      - Why: F005. This is the row that would have stopped the defect reaching
        Jordan's machine. It is deliberately NOT about our entry: it checks the
        WHOLE document, which is the only property that distinguishes "our hook is
        installed" from "this file still works".
      - Contract: zero divergences from git-ai's shape, for every agent we install
        into.
      - WHAT THIS IS EVIDENCE OF (phase-5 review F3). For CLAUDE-CODE it is
        runtime-measured: a divergence was OBSERVED to disable the whole file.
        For every other agent it is WRITER PARITY — git-ai writes and asserts this
        shape and we now match it. No agent runtime was exercised here, so a
        divergence elsewhere is a divergence, not a proven breakage.
      - Proven RED: with the matrix collapsed back to one flat shape, claude-code,
        gemini and droid all report
        `hooks.PreToolUse.1.hooks: Expected array, but received undefined` —
        byte-for-byte the message Claude Code showed Jordan.
      */
    const spec = installable.find((s) => s.agent === agent) as AgentSpec;
    const paths = seedWithGitAi(spec);
    installStrategyA(fs, spec, home, env, BINARY);

    for (const path of paths) {
      expect(WRITER_SHAPE_CHECKS[agent](readDoc(path))).toEqual([]);
    }
  });

  it('the CHECK itself REFUSES the flat shape in a nested config', () => {
    /*
    Test Doc:
    - Why: a check that never fails would make every row above green while proving
      nothing. This points it at the exact broken document Jordan had.
    - Contract: it reports the real message, at the real index. This one row IS a
      runtime claim: the text is what Claude Code printed, verbatim.
    */
    const broken = {
      hooks: {
        PreToolUse: [GIT_AI_SEED_ENTRY['claude-code']('PreToolUse'), { command: 'ours' }],
      },
    };
    expect(WRITER_SHAPE_CHECKS['claude-code'](broken)).toEqual([
      { at: 'hooks.PreToolUse.1.hooks', problem: 'Expected array, but received undefined' },
    ]);
  });

  it('and REFUSES the nested shape in a flat config — the mirror image', () => {
    // firebender treats a matcher-bearing entry as not-installed (firebender.rs:66)
    // and strips it (firebender.rs:179). Nested is as wrong there as flat is here.
    const broken = { hooks: { preToolUse: [{ matcher: '*', hooks: [] }] } };
    expect(WRITER_SHAPE_CHECKS.firebender(broken).map((v) => v.at)).toEqual([
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
      - Contract: our entry is gone, git-ai's is byte-present, and the document
        still matches git-ai's shape afterwards — an uninstall that leaves the file
        diverged is the same class of defect as the install that started this.
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
      expect(WRITER_SHAPE_CHECKS[agent](JSON.parse(text))).toEqual([]);
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
    // The damage, reproduced — and for claude-code specifically this IS a runtime
    // claim: this is the document state Claude Code refused to load.
    expect(WRITER_SHAPE_CHECKS['claude-code'](readDoc(path))).not.toEqual([]);

    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    const removed = uninstallStrategyA({ fs, home, env, createdKeys }, correct);

    expect(removed.reduce((sum, o) => sum + o.removed, 0)).toBe(eventKeys(correct).length);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(HOOK_MARKER);
    // ...and the file loads again, with git-ai's entry untouched.
    expect(WRITER_SHAPE_CHECKS['claude-code'](JSON.parse(text))).toEqual([]);
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
    expect(WRITER_SHAPE_CHECKS.cursor(readDoc(outcomes[0].path))).not.toEqual([]);

    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    const removed = uninstallStrategyA({ fs, home, env, createdKeys }, correct);

    expect(removed.reduce((sum, o) => sum + o.removed, 0)).toBe(eventKeys(correct).length);
    const text = readFileSync(outcomes[0].path, 'utf8');
    expect(text).not.toContain(HOOK_MARKER);
    expect(WRITER_SHAPE_CHECKS.cursor(JSON.parse(text))).toEqual([]);
  });
});

describe('ROOT FIELDS THE UPSTREAM WRITER EMITS — git-ai sets them, so we match', () => {
  it('gemini gets tools.enableHooks — git-ai writes it on every install, so we do', () => {
    /*
    Test Doc:
    - Why: F005's finding A, and its OWN row rather than folded into a shape
      assertion, because they fail for different reasons and a shared row would hide
      one behind the other. `gemini.rs:99-106` sets `tools.enableHooks` on EVERY
      install and `gemini.rs:478-480` asserts it. We never wrote it at all.
    - Contract: a config we create carries it.
    - Proven RED: without `rootExtras` on the gemini row this reads `undefined`.
    - MATCHED-NOT-VERIFIED (phase-5 review F3, and the wording matters). The claim
      this row supports is *git-ai writes and asserts this flag, and we now match
      it*. It is NOT *gemini requires it* and NOT *a hook without it never fires* —
      no gemini runtime has been exercised here, with or without the flag. The
      earlier wording upgraded structural parity to a dispatch guarantee, which is
      more than the evidence carries.
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

  it('an agent git-ai emits NO root fields for gains no root keys', () => {
    // The negative control: without it, a writer that stamped `version` into every
    // config would pass every row above.
    const spec = installable.find((s) => s.agent === 'droid') as AgentSpec;
    const [outcome] = installStrategyA(fs, spec, home, env, BINARY);
    expect(Object.keys(readDoc(outcome.path) as object)).toEqual(['hooks']);
  });

  it('UNINSTALL DELIBERATELY LEAVES root fields behind WHEN A PEER REMAINS', () => {
    /*
    Test Doc:
    - Why: this row exists because the uninstall symmetry rows FAILED here, and the
      failure was the right question rather than a defect. Install adds
      `tools.enableHooks`, so symmetry argues uninstall should remove it.
      **It must not, WHILE A PEER IS STILL IN THE FILE.** That flag is a
      document-level field git-ai sets for its own gemini hooks
      (`gemini.rs:99-106`) — a peer's write as much as ours, and not ours to clear.
      Whether gemini's runtime gates dispatch on it is UNVERIFIED here, and that
      uncertainty is itself the argument for retention: clearing it can only ever
      risk a peer, never help one.
    - Contract: after uninstall our entries are gone and, BECAUSE git-ai's entry
      remains, the root field remains with it.
    - NARROWED by the phase-5 review. This row seeds a foreign entry, so it always
      described the protect-a-peer case; the IMPLEMENTATION it certified retained
      unconditionally, which is a different and larger claim. See the provenance
      rows below for the case this fixture never modelled: a file with NO peer at
      all, where the retained flag protects nobody and is simply a write of ours we
      did not reverse.
    */
    const spec = installable.find((s) => s.agent === 'gemini') as AgentSpec;
    seedWithGitAi(spec);
    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    const createdKeys = new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)]));
    uninstallStrategyA(
      { fs, home, env, createdKeys, createdRootExtras: rootExtrasOf(outcomes) },
      spec,
    );

    const doc = readDoc(outcomes[0].path) as { tools?: { enableHooks?: unknown } };
    expect(doc.tools?.enableHooks).toBe(true);
  });
});

describe('A ROOT FIELD IS REMOVED ONLY IF WE CREATED IT AND NOBODY ELSE NEEDS IT', () => {
  /*
    Test Doc:
    - Why: phase-5 review F2, which REVERSED an endorsement. Unconditional retention
      was a lazy implementation of a sound principle. The principle — never disable a
      peer — only ever justified retention when a peer EXISTS. On a config with no
      foreign hooks at all, install + uninstall left
      `{"tools":{"enableHooks":true},"hooks":{}}` behind: a write of ours, rationalised
      as shared, on a file where it protects nothing.
    - The two conditions, both required, FAILING TOWARD RETENTION:
        (a) provenance says WE created it — absent record means not ours;
        (b) zero foreign hook entries remain anywhere in that file's hook sections
            after our removal.
      Any doubt at all — unparseable document, missing record, an entry we cannot
      classify — retains. The cost of retaining wrongly is recoverable cruft; the
      cost of removing wrongly is editing a peer's configuration for it, blind, with
      no runtime exercised either way.
    - Contract: the four rows below are the whole truth table.
  */
  const gemini = () => AGENT_MATRIX.find((s) => s.agent === 'gemini') as AgentSpec;
  const geminiPath = () => join(home, '.gemini/settings.json');

  const writeConfig = (doc: unknown): string => {
    const path = geminiPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    return path;
  };

  /** Install then uninstall, carrying this run's provenance across. */
  const roundTrip = (spec: AgentSpec, provenance = true) => {
    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    uninstallStrategyA(
      {
        fs,
        home,
        env,
        createdKeys: new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)])),
        // `undefined` is the no-record case — an older install, or a deleted record.
        ...(provenance ? { createdRootExtras: rootExtrasOf(outcomes) } : {}),
      },
      spec,
    );
    return outcomes;
  };

  const enableHooksOf = (path: string): unknown =>
    (readDoc(path) as { tools?: { enableHooks?: unknown } }).tools?.enableHooks;

  it('CREATED + NO FOREIGN HOOKS \u2192 REMOVED', () => {
    /*
    Test Doc:
    - Why: the row the review reproduced. A config with no other hook consumer in
      it: our flag protects nobody, so leaving it is not caution, it is a write we
      failed to reverse.
    - Contract: our entries gone AND `tools` gone with them — the whole object,
      because `tools` itself did not exist before us.
    - Proven RED on 62b86e96: `tools.enableHooks` reads `true` after uninstall.
    */
    const outcomes = roundTrip(gemini());
    const doc = readDoc(outcomes[0].path) as Record<string, unknown>;
    expect(doc.tools).toBeUndefined();
    expect(readFileSync(outcomes[0].path, 'utf8')).not.toContain(HOOK_MARKER);
  });

  it('CREATED + A FOREIGN HOOK REMAINS \u2192 RETAINED, and the peer really is in the file', () => {
    /*
    Test Doc:
    - Why: THE SAFETY CLAIM, finally modelled by the fixture that asserts it. The
      old retention row seeded a sibling with NO `enableHooks`, so it never modelled
      a peer sharing the field at all — it asserted retention on a file where the
      flag was ours alone. Here git-ai's gemini entry is in the file, the file had no
      `enableHooks`, WE turned it on, and after our uninstall git-ai's hook is still
      there. Clearing the flag now would edit a peer's config for it — and since no
      gemini runtime has been exercised, we cannot know that is harmless.
    - Contract: our entries gone, git-ai's entry present, `enableHooks` still true.
    - This is condition (b) alone: (a) is satisfied — we DID create the flag.
    */
    const spec = gemini();
    const path = writeConfig({
      hooks: {
        BeforeTool: [GIT_AI_SEED_ENTRY.gemini('BeforeTool')],
        AfterTool: [GIT_AI_SEED_ENTRY.gemini('AfterTool')],
      },
    });
    // The seed genuinely lacks the flag, so our install is what creates it.
    expect(enableHooksOf(path)).toBeUndefined();

    roundTrip(spec);

    expect(readFileSync(path, 'utf8')).not.toContain(HOOK_MARKER);
    expect(readFileSync(path, 'utf8')).toContain('git-ai checkpoint gemini');
    expect(enableHooksOf(path)).toBe(true);
  });

  it('CREATED + AN OURS-WITH-FOREIGN ENTRY REMAINS \u2192 RETAINED, both of them', () => {
    /*
    Test Doc:
    - Why: phase-5 re-verdict. `foreignHooksRemain` deliberately asks
      `entryMayRemove`, NOT `entryIsOwnedByUs`, so that an `ours-with-foreign` entry
      — one we refused to delete precisely BECAUSE it chains somebody else's work —
      counts as a peer still in the file. The comment said so; no row exercised it.
      The reviewer mutated `entryMayRemove` \u2192 `entryIsOwnedByUs` at
      `uninstall-strategy-a.ts:259-264` and the whole file stayed GREEN: the rows
      here modelled WHOLLY-FOREIGN and UNREADABLE, and the third state of our own
      ownership model had no test.
    - The scenario is the observed normal, not an exotic one (dw-0041): a third
      party wraps our invocation into a chained command, exactly as our own
      attribution POC did to git-ai's. So: install into a clean config (we create
      `tools.enableHooks`), a peer then chains our BeforeTool invocation into its
      own, then the user uninstalls.
    - Contract: BOTH survive. The chained entry, because we never delete work we did
      not write; and the flag, because that entry is a peer still in the file and a
      field a peer also writes is not ours to clear on the way out. Our unchained AfterTool entry still goes.
    - Proven RED under `entryMayRemove` \u2192 `entryIsOwnedByUs`: the chained entry is
      owned by us, so the mutant reads the file as peer-free and removes `tools`.
    */
    const spec = gemini();
    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    const path = outcomes[0].path;

    const doc = readDoc(path) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const chained = doc.hooks.BeforeTool[0];
    chained.hooks[0].command = `other-tool --run && ${chained.hooks[0].command}`;
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);

    uninstallStrategyA(
      {
        fs,
        home,
        env,
        createdKeys: new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)])),
        createdRootExtras: rootExtrasOf(outcomes),
      },
      spec,
    );

    const text = readFileSync(path, 'utf8');
    expect(text).toContain('other-tool --run');
    expect(text).toContain(HOOK_MARKER);
    const after = readDoc(path) as { hooks: Record<string, unknown[]> };
    expect(after.hooks.AfterTool ?? []).toEqual([]);
    expect(enableHooksOf(path)).toBe(true);
  });

  it('PRE-EXISTING + NO FOREIGN HOOKS \u2192 RETAINED', () => {
    /*
    Test Doc:
    - Why: condition (a) alone. The user wrote this flag. That we happen to want it
      too has never made it ours, and an empty `hooks` block is not licence to
      delete a setting somebody typed.
    - Contract: it survives a full round trip, with the user's sibling key.
    */
    const path = writeConfig({ tools: { enableHooks: true, sandbox: 'docker' }, hooks: {} });
    roundTrip(gemini());

    expect(enableHooksOf(path)).toBe(true);
    expect((readDoc(path) as { tools: { sandbox: unknown } }).tools.sandbox).toBe('docker');
  });

  it('NO PROVENANCE AT ALL \u2192 RETAINED', () => {
    /*
    Test Doc:
    - Why: the direction the whole record fails in. An install from an older build,
      or a record a user deleted, leaves us unable to say whether the flag is ours.
      "Unknown" resolves to "not ours", exactly as it already does for event-array
      keys (F003) — the safe reading, never the convenient one.
    - Contract: identical to row 1 in every respect EXCEPT that no provenance is
      passed, and the outcome inverts.
    */
    const outcomes = roundTrip(gemini(), false);
    expect(enableHooksOf(outcomes[0].path)).toBe(true);
  });

  it('and a root field we created OVER a user\u2019s object keeps the user\u2019s keys', () => {
    /*
    Test Doc:
    - Why: the two provenance shapes are different removals and collapsing them
      would delete a user's settings. When `tools` is ABSENT we create the whole
      object and may remove the whole object; when `tools` EXISTS and only
      `enableHooks` is missing we create ONE KEY and may remove only that key.
    - Contract: `tools.sandbox` survives while `tools.enableHooks` goes.
    */
    const path = writeConfig({ tools: { sandbox: 'docker' }, hooks: {} });
    roundTrip(gemini());

    const doc = readDoc(path) as { tools: Record<string, unknown> };
    expect(doc.tools.enableHooks).toBeUndefined();
    expect(doc.tools.sandbox).toBe('docker');
  });

  it('an UNPARSEABLE hooks section retains, rather than guessing', () => {
    /*
    Test Doc:
    - Why: "any doubt retains" needs a row, or it is a sentence in a comment. A hook
      section we cannot classify is a peer we cannot rule out.
    - Contract: with a hooks array replaced by a non-array we cannot read, the flag
      stays.
    */
    const spec = gemini();
    const outcomes = installStrategyA(fs, spec, home, env, BINARY);
    const path = outcomes[0].path;
    const doc = readDoc(path) as { hooks: Record<string, unknown> };
    doc.hooks.SomethingElse = 'not an array at all';
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);

    uninstallStrategyA(
      {
        fs,
        home,
        env,
        createdKeys: new Map(outcomes.map((o) => [o.path, new Set(o.createdKeys)])),
        createdRootExtras: rootExtrasOf(outcomes),
      },
      spec,
    );
    expect(enableHooksOf(path)).toBe(true);
  });

  it('cursor\u2019s created `version` follows the same rule', () => {
    // Not a gemini special case: the rule is about root fields, not about one field.
    const spec = AGENT_MATRIX.find((s) => s.agent === 'cursor') as AgentSpec;
    const outcomes = roundTrip(spec);
    expect((readDoc(outcomes[0].path) as { version?: unknown }).version).toBeUndefined();
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
    - NOTE: its SHAPE is known from `firebender.rs:126-141` and is covered by the
      writer-parity rows above. What is unverified is the install END TO END — no
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
      `~/.codeium/hooks.json`. Both entries are well-formed so the file still
      parses — and git-ai dispatches windsurf on five cascade names and never on
      `PreToolUse` (`windsurf.rs:17-23`), so on the upstream writer's reading our
      hook was registered under keys the upstream writer treats as wrong for this
      agent. That is F004's class (registered nowhere, fires never) arriving through
      the event table instead of the flag table, and it is the fifth uniformity
      assumption in this plan. Windsurf's runtime is unexercised, so the dead-hook
      consequence is INFERRED from the writer, not observed.
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
