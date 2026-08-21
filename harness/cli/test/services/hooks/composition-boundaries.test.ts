import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FsPort } from '../../../src/adapters/fs/fs-port.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { type AgentSpec, findAgent } from '../../../src/services/hooks/agent-matrix.js';
import {
  type HooksDeps,
  installHooks,
  listAgents,
} from '../../../src/services/hooks/hooks-verbs.js';
import {
  installStrategyA,
  type PartialInstallError,
} from '../../../src/services/hooks/install-strategy-a.js';
import { uninstallStrategyA } from '../../../src/services/hooks/uninstall-strategy-a.js';

/**
 * COMPOSITION BOUNDARIES (plan 082 F010).
 *
 * Every row here reproduces a case from the whole-surface review of the ASSEMBLED
 * installer at 19b46019. Five defects were found and fixed in this surface in one
 * day, each in its own diff, each reviewed by a reviewer scoped to that diff —
 * and none of these was visible to any of them, because **nobody had read the
 * assembled result**. That is the property this file is here to keep: these cases
 * only fail when legacy migration, provenance, multiple files, repeated installs
 * and path overrides are exercised TOGETHER.
 *
 * The synthesis, which is worth more than any single row: the installer was **not
 * transactional at the unit it reported**, and its **identity checks were too broad
 * for the state it mutated**. It reported per agent and committed per file; it
 * compensated writes without distinguishing creation from migration; it treated a
 * shared marker as proof of a complete, agent-specific install.
 *
 * Four distinctions lost at composition boundaries, one per describe below:
 * new vs rewritten · first-file vs agent · harness-owned vs THIS agent's ·
 * one marked entry vs complete configuration.
 */

let home: string;
const fs = new NodeFs();
const NODE = process.execPath;
/** The interpreter-first form F008 ships. */
const BINARY = `"${NODE}" "/usr/local/lib/harness/bin/harness.js"`;
/** The pre-F008 bare-script form, which the upgrade path migrates. */
const LEGACY_BINARY = '"/usr/local/lib/harness/bin/harness.js"';

const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: BINARY,
  ...over,
});

const present = (marker: string) => mkdirSync(join(home, marker), { recursive: true });
const read = (path: string) => readFileSync(path, 'utf8');

/**
 * One spelling for a path, so a FIXTURE cannot be disarmed by canonicalisation.
 *
 * The fault-injection fixtures in this file decide whether to inject by looking at
 * the path they were handed. That makes their correctness a path-comparison
 * problem, and this file has now been bitten by it twice from two platforms — see
 * the peer-rewrite fixture below. A fixture that fails to match does not fail; it
 * silently injects nothing, the operation succeeds, and the row reports a green
 * that means the opposite of what it appears to mean.
 */
const logical = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^([a-z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);

/**
 * An fs that behaves EXACTLY like the real one except where overridden.
 *
 * `Object.create`, deliberately, and not `{ ...fs }`. A spread of a class instance
 * copies own enumerable properties only, so every prototype method vanishes and
 * the fake answers `fs.realpath is not a function` deep inside a rollback. That is
 * not a hypothetical: the first version of THIS FILE did exactly that, and the
 * headline F1 row PASSED — the compensation never ran, so nothing was deleted, so
 * the bytes matched. **A crippled instrument produced a green that meant the
 * opposite of what it appeared to mean**, which is the same error this plan has
 * now met three times from three directions.
 */
const derive = (over: Partial<FsPort>): FsPort => Object.assign(Object.create(fs) as FsPort, over);

/**
 * An fs that fails the install-record write while letting the PROBE succeed.
 *
 * The distinction is the whole point of the fixture: `ensureRecordWritable` runs
 * before any config is touched, so failing it proves nothing about compensation —
 * nothing was ever written. The defect lives on the path where the probe passed
 * and the real record write then failed (a disk that filled, a directory removed
 * underneath us), which is the only path on which `compensate` runs at all.
 */
function failRecordAfterProbe(): FsPort {
  let probed = false;
  return derive({
    writeText: (p: string, text: string) => {
      if (p.endsWith('install-record.json')) {
        if (!probed) {
          probed = true;
          fs.writeText(p, text);
          return;
        }
        throw new Error('ENOSPC: no space left on device');
      }
      fs.writeText(p, text);
    },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-composition-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('F1 — compensation must not DELETE the entry it says it rolled back', () => {
  const cursorConfig = () => join(home, '.cursor', 'hooks.json');

  it('restores the PRE-EXISTING legacy entry when the provenance write fails', () => {
    /*
    Test Doc:
    - Why: THE WORST FINDING OF THE DAY — data loss on a user's machine during a
      failure path, while the report says `rolled back`. Two locally-correct
      mechanisms compose into it: the legacy migration REPLACES an existing entry
      and reports `alreadyPresent: false` (correctly — it did write this run), and
      the provenance-failure branch reads every `!alreadyPresent` outcome as "we
      created this, so uninstall reverses it". Uninstall then removes an entry the
      USER already had.
    - Contract: after the failed run, the config is byte-identical to what it was
      before. A rollback that ends with less than it started with is not a rollback.
    - Quality Contribution: asserts BYTES, not entry counts. A rollback that
      preserved the count while rewriting the command would pass a count assertion
      and still have lost the user's configuration.
    */
    present('.cursor');
    // A legacy install: the bare-script form, which is what the upgrade migrates.
    installHooks(deps({ binary: LEGACY_BINARY }));
    const beforeUpgrade = read(cursorConfig());
    expect(beforeUpgrade).toContain('harness.js');

    // Now install with the interpreter-first binary, so the upgrade path REWRITES
    // the existing entries — and fail the provenance write it depends on.
    const report = installHooks(deps({ fs: failRecordAfterProbe() }));

    expect(report.failed.map((f) => f.agent)).toContain('cursor');
    expect(read(cursorConfig())).toBe(beforeUpgrade);
  });

  it('says ROLLED BACK only when the previous state was actually restored', () => {
    /*
    Test Doc:
    - Why: the report is the operator's only view of a failure path they cannot
      observe directly. `rolled back` while the user's entries are gone is worse
      than no message, because it stops them looking.
    - Contract: the reason string and the disk agree.
    */
    present('.cursor');
    installHooks(deps({ binary: LEGACY_BINARY }));
    const beforeUpgrade = read(cursorConfig());

    const report = installHooks(deps({ fs: failRecordAfterProbe() }));
    const reason = report.failed.find((f) => f.agent === 'cursor')?.reason ?? '';

    if (reason.includes('rolled back')) {
      expect(read(cursorConfig())).toBe(beforeUpgrade);
    } else {
      // Any other ending must NAME the state it left behind rather than imply success.
      expect(reason).toMatch(/left alone|by hand|stranded|restored/);
    }
  });

  it('still removes a genuinely NEW entry — the counter-row', () => {
    /*
    Test Doc:
    - Why: the fix must not become "never compensate". An entry this run created in
      a config that had none is ours to remove, and leaving it behind would strand
      an install whose provenance we could not keep — the orphan the probe exists
      to prevent.
    - Contract: a fresh install whose record write fails leaves NO entry of ours.
    */
    present('.cursor');
    const report = installHooks(deps({ fs: failRecordAfterProbe() }));

    expect(report.failed.map((f) => f.agent)).toContain('cursor');
    const text = existsSync(cursorConfig()) ? read(cursorConfig()) : '';
    expect(text).not.toContain('hooks fire cursor');
  });
});

describe('F2 — a failure on the SECOND file must not strand the first', () => {
  const first = () => join(home, '.codeium', 'hooks.json');
  const second = () => join(home, '.codeium', 'windsurf', 'hooks.json');

  /** An fs that writes the first windsurf config and refuses the second. */
  const failSecondFile = (): FsPort =>
    derive({
      writeText: (p: string, text: string) => {
        if (p === logical(second())) throw new Error(`EACCES: permission denied, open '${p}'`);
        fs.writeText(p, text);
      },
    });

  it('reports and commits at the SAME UNIT — a failed agent leaves no installed file', () => {
    /*
    Test Doc:
    - Why: windsurf is the only agent with two config files, and `installStrategyA`
      mapped over them. The first write COMMITTED, the second threw, and the
      outcome array was never returned — so `installHooks` caught at the agent
      boundary with nothing to roll back and nothing to record. The agent reports
      FAILED while a file is installed and UNKNOWN TO PROVENANCE, which means
      uninstall will never clean it up: the one state this family promises cannot
      exist.
    - Contract: the agent reports failed AND the first file carries no entry of
      ours. Report and commit at the same unit.
    - Quality Contribution: asserts the DISK, not the report. A report-only fix
      would satisfy a message assertion and leave the orphan exactly where it is.
    */
    present('.codeium');
    const report = installHooks(deps({ fs: failSecondFile() }));

    expect(report.failed.map((f) => f.agent)).toContain('windsurf');
    const text = existsSync(first()) ? read(first()) : '';
    expect(text).not.toContain('hooks fire windsurf');
  });

  it('never reports windsurf as INSTALLED when one of its two files failed', () => {
    /*
    Test Doc:
    - Why: half of windsurf's hooks is not windsurf installed. `installed` is what
      an operator reads to stop worrying.
    - Contract: windsurf appears in `failed` and in neither half of `installed`.
    */
    present('.codeium');
    const report = installHooks(deps({ fs: failSecondFile() }));

    expect(report.installed.filter((i) => i.agent === 'windsurf')).toEqual([]);
  });

  it('RECORDS and NAMES a file it could not roll back — never silently held', () => {
    /*
    Test Doc:
    - Why: the second half of the ruling. Atomicity is preferable, but a rollback
      can itself fail, and a file that is written, unrecorded and unreported is
      invisible to every tool we ship: uninstall will not remove it because
      provenance never heard of it, and status will not explain it. That is the
      exact state this family promises cannot exist.
    - Contract: the install record carries the stranded path, and the failure
      reason names the path AND the command that clears it.
    - Quality Contribution: asserts the RECORD FILE, not just the message — a
      report-only fix would satisfy an operator and still leave the file
      unremovable.
    */
    present('.codeium');
    const stubborn = derive({
      writeText: (p: string, text: string) => {
        if (p === logical(second())) throw new Error(`EACCES: permission denied, open '${p}'`);
        fs.writeText(p, text);
      },
      // The rollback of the first file cannot complete either.
      deleteFile: () => {
        throw new Error('EPERM: operation not permitted');
      },
    });

    const report = installHooks(deps({ fs: stubborn }));
    const reason = report.failed.find((f) => f.agent === 'windsurf')?.reason ?? '';

    expect(reason).toContain(logical(first()));
    expect(reason).toContain('harness hooks uninstall');
    const record = read(join(home, '.harness', 'hooks', 'install-record.json'));
    expect(record).toContain(logical(first()));
  });

  it('installs BOTH files when nothing fails — the counter-row', () => {
    /*
    Test Doc:
    - Why: atomicity must not be bought by installing less. This is the row that
      fails if a staged-commit rewrite drops windsurf's second path.
    - Contract: both files exist and both carry our command.
    */
    present('.codeium');
    const report = installHooks(deps());

    expect(report.failed).toEqual([]);
    expect(read(first())).toContain('hooks fire windsurf');
    expect(read(second())).toContain('hooks fire windsurf');
  });
});

describe('F3 — the shared marker must not credit one agent with another\u2019s command', () => {
  /**
   * `CLAUDE_CONFIG_DIR` is read VERBATIM by the matrix, with no `.claude`
   * appended, so pointing it at `.factory` makes claude-code and droid resolve to
   * the SAME `settings.json` AND the same `PreToolUse`/`PostToolUse` arrays. This
   * is legal under the matrix and the path resolver; it is not a contrived state.
   */
  const shared = () => join(home, '.factory', 'settings.json');
  const collide = (name: string) =>
    name === 'CLAUDE_CONFIG_DIR' ? join(home, '.factory') : undefined;

  it('installs DROID\u2019s command even though CLAUDE\u2019s marker is already in the file', () => {
    /*
    Test Doc:
    - Why: `containsOurEntry` asks "is any HARNESS-OWNED entry here", not "is THIS
      AGENT's command here". Claude installs first; droid sees the shared marker,
      reports installed/already-present, and writes nothing. The user has droid
      detected, droid reported healthy, and no droid hook — a false green produced
      by an identity check broader than the state it guards.
    - Contract: the shared file carries BOTH agents' commands.
    - Quality Contribution: asserts on the command text per agent, which is the
      only thing that distinguishes "a harness entry exists" from "this agent is
      installed".
    */
    present('.claude');
    present('.factory');

    const report = installHooks(deps({ env: collide }));

    expect(report.failed).toEqual([]);
    const text = read(shared());
    expect(text).toContain('hooks fire claude-code');
    expect(text).toContain('hooks fire droid');
  });

  it('STATUS does not credit droid with claude\u2019s command in the shared file', () => {
    /*
    Test Doc:
    - Why: the same broad read feeds the operator surface, and this row exists
      because a mutation survived without it. `status` answers a PER-AGENT
      question — "is this agent installed" — and `ourCommands` answered a
      per-HARNESS one. An agent with no hook of its own reads as healthy, which is
      the false green this whole family is about.
    - Contract: with only claude-code's entries in the shared file, droid reports
      NOT installed while claude-code reports installed.
    - Quality Contribution: asserts BOTH agents from the SAME file, so a fix that
      simply reported everyone uninstalled would fail here too.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));

    // Remove droid's entries only, leaving a file that is still harness-owned.
    const doc = JSON.parse(read(shared())) as {
      hooks: Record<string, { hooks?: { command: string }[] }[]>;
    };
    for (const key of ['PreToolUse', 'PostToolUse']) {
      doc.hooks[key] = (doc.hooks[key] ?? []).filter(
        (entry) => !(entry.hooks ?? []).some((h) => h.command.includes('hooks fire droid')),
      );
    }
    writeFileSync(shared(), `${JSON.stringify(doc, null, 2)}\n`);

    const rows = listAgents(deps({ env: collide }));
    expect(rows.find((r) => r.agent === 'droid')?.installed).toBe(false);
    expect(rows.find((r) => r.agent === 'claude-code')?.installed).toBe(true);
  });

  it('uninstalling ONE agent leaves the other\u2019s entry in the shared file', () => {
    /*
    Test Doc:
    - Why: THE INVERSE COLLISION, and this row exists because a mutation survived
      without it. `entryMayRemove` alone means "wholly ours", which in a shared
      config also matches the PEER's entry — so uninstalling droid would take
      claude-code's hook with it. Worse, the install compensation runs this same
      removal path, so a FAILED droid install could delete a HEALTHY claude one.
    - Contract: droid's entries go, claude-code's stay, in the same file.
    - Quality Contribution: drives `uninstallStrategyA` for ONE spec, which is how
      compensation calls it — the full `uninstall` verb loops every agent and would
      hide the distinction by removing both anyway.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));
    expect(read(shared())).toContain('hooks fire droid');

    const droid = findAgent('droid');
    expect(droid).toBeDefined();
    uninstallStrategyA({ fs, home, env: () => undefined }, droid as NonNullable<typeof droid>);

    const after = read(shared());
    expect(after, "the peer's hook must survive a neighbour's uninstall").toContain(
      'hooks fire claude-code',
    );
    expect(after).not.toContain('hooks fire droid');
  });

  it('is idempotent PER AGENT — a second run duplicates neither command', () => {
    /*
    Test Doc:
    - Why: the obvious over-correction. Narrowing the predicate so droid installs
      must not make claude-code install AGAIN on every run: two identical entries
      is a second defect wearing the first one's clothes.
    - Contract: exactly one entry per agent per event array after two installs.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));
    installHooks(deps({ env: collide }));

    const doc = JSON.parse(read(shared())) as {
      hooks: Record<string, { hooks?: { command: string }[] }[]>;
    };
    for (const key of ['PreToolUse', 'PostToolUse']) {
      const commands = (doc.hooks[key] ?? []).flatMap((e) => e.hooks ?? []).map((h) => h.command);
      expect(commands.filter((c) => c.includes('hooks fire claude-code'))).toHaveLength(1);
      expect(commands.filter((c) => c.includes('hooks fire droid'))).toHaveLength(1);
    }
  });
});

describe('F4 — idempotency must mean the COMPLETE configuration is present', () => {
  const geminiConfig = () => join(home, '.gemini', 'settings.json');

  it('repairs a root extra that was removed after the first install', () => {
    /*
    Test Doc:
    - Why: the entries exist, so the idempotency branch returns BEFORE
      `missingRootExtras` and the config is never converged. The installer claims
      to emit the upstream writer's required shape and cannot repair its own
      output — a self-healing surface that cannot heal itself.
    - EVIDENCE DISCIPLINE: `tools.enableHooks` remains MATCHED-NOT-VERIFIED. This
      row asserts CONVERGENCE to the shape we say we write; it makes no claim about
      whether gemini's runtime gates dispatch on the flag, and must not be read as
      one.
    - Contract: a second install restores the missing root field.
    */
    present('.gemini');
    installHooks(deps());
    expect(read(geminiConfig())).toContain('enableHooks');

    const doc = JSON.parse(read(geminiConfig())) as Record<string, unknown>;
    delete doc.tools;
    writeFileSync(geminiConfig(), `${JSON.stringify(doc, null, 2)}\n`);

    installHooks(deps());

    expect(read(geminiConfig())).toContain('"enableHooks": true');
  });

  it('leaves a root extra the USER changed exactly as they wrote it', () => {
    /*
    Test Doc:
    - Why: the counter-row, and the reason convergence is not "rewrite the root".
      A root key is shared with settings we have no business touching; repair must
      add what is ABSENT and never overwrite a value someone chose.
    - Contract: `enableHooks: false` survives a re-install untouched.
    */
    present('.gemini');
    installHooks(deps());
    const doc = JSON.parse(read(geminiConfig())) as { tools?: Record<string, unknown> };
    doc.tools = { ...doc.tools, enableHooks: false, somethingOfTheirs: 42 };
    writeFileSync(geminiConfig(), `${JSON.stringify(doc, null, 2)}\n`);

    installHooks(deps());

    const after = JSON.parse(read(geminiConfig())) as { tools: Record<string, unknown> };
    expect(after.tools.enableHooks).toBe(false);
    expect(after.tools.somethingOfTheirs).toBe(42);
  });

  it('does not churn a config that is already complete', () => {
    /*
    Test Doc:
    - Why: convergence must be a no-op when there is nothing to converge. An
      install that rewrites every run would make `installHooks` roll back a HEALTHY
      hook to compensate for an unrelated failure — the same composition that
      produced F1.
    - Contract: byte-identical file across a second install.
    */
    present('.gemini');
    installHooks(deps());
    const before = read(geminiConfig());

    installHooks(deps());

    expect(read(geminiConfig())).toBe(before);
  });
});

describe('F2 x F3 — a rollback must not revert a PEER agent sharing the file', () => {
  /**
   * THE COMPOSED HAZARD, constructed deliberately (asked for by the orchestrator).
   *
   * F2's answer to a mid-commit failure is to restore the files this agent already
   * committed. F3 established that TWO AGENTS CAN RESOLVE TO THE SAME FILE. Put
   * them together and the question is whether agent B's rollback can write back
   * bytes that predate agent A's successful install — un-installing A to tidy up
   * after B.
   *
   * WHY IT IS UNREACHABLE THROUGH TODAY'S MATRIX, said plainly so the next person
   * does not have to re-derive it: only claude-code and gemini have path
   * overrides, both are SINGLE-FILE, and a single-file agent has nothing committed
   * to roll back when its only write fails. The one multi-file agent, windsurf,
   * has no override and a filename (`hooks.json`) that no override can collide
   * with a `settings.json` on.
   *
   * THAT IS AN ARGUMENT ABOUT A TABLE, AND TABLES GET ROWS. So the guarantee is
   * enforced structurally instead: a restore requires the file to still hold
   * exactly what we wrote. These rows drive a SYNTHETIC agent spec — the same
   * fake-row technique the strategy is already proven with (dw-0010) — so the
   * property is pinned independently of what the matrix happens to contain today.
   */
  const shared = () => join(home, '.cursor', 'hooks.json');
  const secondFile = () => join(home, '.cursor', 'second.json');

  /** A two-file agent whose FIRST file is one another agent already owns. */
  const twoFileSpec = (): AgentSpec => ({
    agent: 'peer-test',
    detectId: 'cursor',
    subdir: '.cursor',
    configFiles: ['hooks.json', 'second.json'],
    events: { pre: ['preToolUse'], post: ['postToolUse'] },
    entryShape: 'flat',
    supported: true,
  });

  it('leaves the PEER\u2019s committed entry in place when its own second file fails', () => {
    /*
    Test Doc:
    - Why: the interaction this whole round exists to catch — two locally-correct
      mechanisms (restore-on-partial-failure, shared config files) composing into
      a new defect. A blanket byte-restore is only correct while the bytes are
      still ours.
    - Contract: cursor's entry survives the peer's rollback, and the peer's own
      entry is gone from the shared file.
    - Quality Contribution: asserts BOTH directions. A rollback that skipped its
      own cleanup would also leave cursor intact and would not be a rollback.
    */
    present('.cursor');
    installHooks(deps());
    expect(read(shared())).toContain('hooks fire cursor');

    const failSecond = derive({
      writeText: (p: string, text: string) => {
        if (p === logical(secondFile())) throw new Error('EACCES: permission denied');
        fs.writeText(p, text);
      },
    });

    expect(() =>
      installStrategyA(failSecond, twoFileSpec(), home, () => undefined, BINARY),
    ).toThrow();

    const after = read(shared());
    expect(after, "the peer's install must survive").toContain('hooks fire cursor');
    expect(after, "the failed agent's own entry must be gone").not.toContain(
      'hooks fire peer-test',
    );
  });

  it('the PROVENANCE compensation obeys the same rule — pinned after a mutant survived', () => {
    /*
    Test Doc:
    - Why: this row exists because a MUTATION SURVIVED. Removing the still-ours
      check from the compensation path broke nothing, because the rule was
      implemented TWICE — once for a mid-commit rollback, once for a failed
      provenance write — and only the first was pinned. Two copies of a safety
      rule is one copy and a rumour; they are now one function, and this is the
      row that proves the second caller is covered.
    - Contract: a migration compensated after a third party has touched the file
      REFUSES to restore, and the report says so rather than claiming a rollback.
    - Quality Contribution: asserts the operator string AND the bytes, because
      "rolled back" while the file still carries our write is the exact shape of
      the F1 defect, inverted.
    */
    present('.cursor');
    const config = join(home, '.cursor', 'hooks.json');
    installHooks(deps({ binary: LEGACY_BINARY }));

    let probed = false;
    let peerRewrote = false;
    const meddling = derive({
      writeText: (p: string, text: string) => {
        if (p.endsWith('install-record.json')) {
          if (!probed) {
            probed = true;
            fs.writeText(p, text);
            return;
          }
          throw new Error('ENOSPC: no space left on device');
        }
        fs.writeText(p, text);
        /*
         * A peer rewrites the shared file between our write and our compensation.
         *
         * MATCHED BY SUFFIX, NOT BY EQUALITY, AND SEPARATOR-AGNOSTICALLY.
         * `writeThroughSymlink` resolves an EXISTING path through `realpath`, which
         * rewrites the path in two platform-specific ways — and BOTH of them have
         * now silently disarmed this fixture:
         *
         *   - macOS turns `/var/folders/...` into `/private/var/folders/...`, so a
         *     `p === config` fixture never fires. That is why this is a suffix match.
         *   - Windows returns a NATIVE path, so `.cursor\hooks.json` never matched
         *     the forward-slashed suffix and the fixture never fired THERE either —
         *     the compensation ran unopposed, reported `rolled back`, and the row
         *     failed on Windows only (plan 083).
         *
         * The same trap twice, from two directions, on the same line: an instrument
         * that quietly measures nothing. Comparing in one spelling is what fixes it,
         * so neither platform's canonicalisation can disarm the fixture again.
         */
        if (logical(p).endsWith('.cursor/hooks.json')) {
          peerRewrote = true;
          fs.writeText(p, `${text}\n`);
        }
      },
    });

    const report = installHooks(deps({ fs: meddling }));
    const reason = report.failed.find((f) => f.agent === 'cursor')?.reason ?? '';

    /*
     * THE FIXTURE MUST HAVE FIRED — asserted before anything it enables.
     *
     * Twice now this row has been disarmed by a `realpath` rewrite it did not
     * anticipate, and BOTH times the symptom was an assertion further down failing
     * for a reason that had nothing to do with the contract. Without this line the
     * third occurrence looks like a product regression and costs another
     * investigation. `peerRewrote` is what actually happened, not what we assumed.
     */
    expect(
      peerRewrote,
      'the peer-rewrite fixture never fired — nothing meddled with the file, so this row proves NOTHING about the still-ours check',
    ).toBe(true);

    expect(reason).not.toContain('rolled back');
    expect(reason).toContain('by hand');
    /*
     * AND IT NAMES THE FILE. This row's own comment claimed the report "says so
     * rather than claiming a rollback", and for two rounds it asserted only the
     * WORDING — so the reason could name the install-record path, never the config
     * path, and pass. An operator was told a file of theirs still carries our entry
     * and had to guess which one, on a machine with up to seven agent configs.
     *
     * A CONTRACT IS ENFORCED BY A ROW OR IT IS PROSE — my own log entry, arriving
     * in my own round, on the fourth occurrence in this surface.
     */
    expect(reason).toContain(logical(config));
  });

  it('REFUSES to restore — and says so — when the file moved under it', () => {
    /*
    Test Doc:
    - Why: the structural guarantee, isolated. If anything changed the file after
      our write, previous bytes are no longer a safe thing to put back; the honest
      answer is to leave it and NAME it, not to guess.
    - Contract: the thrown error carries the file as STRANDED, so the caller can
      record provenance for it and an operator is told a file was left behind.
    - Quality Contribution: this is what makes the peer guarantee hold for cases
      the matrix has not invented yet — it does not depend on knowing who the peer
      is, only on the bytes not being ours any more.
    */
    present('.cursor');
    const meddling = derive({
      writeText: (p: string, text: string) => {
        if (p === logical(secondFile())) throw new Error('EACCES: permission denied');
        fs.writeText(p, text);
        // A third party rewrites the file between our commit and our rollback.
        if (p === logical(shared())) fs.writeText(p, `${text}\n`);
      },
    });

    let stranded: string[] = [];
    try {
      installStrategyA(meddling, twoFileSpec(), home, () => undefined, BINARY);
    } catch (error) {
      stranded = (error as PartialInstallError).stranded?.map((o) => o.path) ?? [];
    }

    expect(stranded).toEqual([logical(shared())]);
  });
});

describe('F010-R1 — removing on ONE agent\u2019s behalf must be UNIVERSAL, not existential', () => {
  /**
   * THE DEFECT THIS ROUND WAS SENT TO FIX, REPRODUCED INSIDE THE FIX FOR IT.
   *
   * The first agent-qualified predicate was
   * `entryMayRemove(entry) && entryIsOwnedByAgent(entry, agent)` — which proves
   * every command in the entry is OURS and that SOME command is the TARGET's. It
   * does not prove every command is the target's, and uninstall removes the WHOLE
   * entry. So one nested block carrying two agents' commands was removable on
   * behalf of either: the broad predicate was replaced by a narrower one that was
   * still broad in the dimension that mattered.
   */
  const shared = () => join(home, '.factory', 'settings.json');
  const collide = (name: string) =>
    name === 'CLAUDE_CONFIG_DIR' ? join(home, '.factory') : undefined;

  /** Merge both agents' commands into ONE valid nested matcher block. */
  const mergeIntoOneBlock = () => {
    const doc = JSON.parse(read(shared())) as {
      hooks: Record<string, { matcher?: string; hooks?: { type: string; command: string }[] }[]>;
    };
    for (const key of ['PreToolUse', 'PostToolUse']) {
      const inner = (doc.hooks[key] ?? []).flatMap((entry) => entry.hooks ?? []);
      doc.hooks[key] = [{ matcher: '*', hooks: inner }];
    }
    writeFileSync(shared(), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  };

  it('leaves the PEER\u2019s command when both live in ONE entry', () => {
    /*
    Test Doc:
    - Why: the reviewer's exact case. Both commands are wholly ours and the block
      is valid, so nothing about it is malformed — it is simply an entry that two
      agents share, which our own writer permits when their paths collide.
    - Contract: uninstalling droid must not take claude-code with it.
    - Quality Contribution: asserts on the SURVIVOR. Asserting only that droid's
      command is gone passes when the whole array is emptied.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));
    mergeIntoOneBlock();

    const droid = findAgent('droid');
    uninstallStrategyA({ fs, home, env: () => undefined }, droid as NonNullable<typeof droid>);

    expect(read(shared())).toContain('hooks fire claude-code');
  });

  it('REPORTS the entry it could not remove — a refusal, never a silent skip', () => {
    /*
    Test Doc:
    - Why: an entry that is neither removable nor replaceable by one agent is
      exactly as invisible as the false install this plan started with, unless it
      is named. We already report an entry chained with FOREIGN work; a peer's
      harness command is the same shape of refusal with a different cause.
    - Contract: the outcome carries a refusal naming the entry.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));
    mergeIntoOneBlock();

    const droid = findAgent('droid');
    const outcomes = uninstallStrategyA(
      { fs, home, env: () => undefined },
      droid as NonNullable<typeof droid>,
    );

    const refusals = outcomes.flatMap((o) => o.refused);
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals[0]?.reason).toMatch(/another agent|peer|different agent/i);
  });

  it('still removes a SINGLE-AGENT entry — the counter-row', () => {
    /*
    Test Doc:
    - Why: universality must not become "never remove anything". The ordinary
      case is one entry, one agent, and it must still be surgically removed.
    - Contract: droid's own entries go when they are droid's alone.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));

    const droid = findAgent('droid');
    uninstallStrategyA({ fs, home, env: () => undefined }, droid as NonNullable<typeof droid>);

    const after = read(shared());
    expect(after).not.toContain('hooks fire droid');
    expect(after).toContain('hooks fire claude-code');
  });

  it('the UPGRADE loop refuses a mixed-agent entry rather than replacing it', () => {
    /*
    Test Doc:
    - Why: the same broad-to-narrow mismatch on the write side. The upgrade enters
      on "some command is this agent's" and then REPLACES THE WHOLE ENTRY with this
      agent's command — so a shared block would lose the peer's command entirely.
      Deleting a peer by rewriting is worse than deleting it by removing: the file
      still looks installed.
    - Contract: the peer's command survives an upgrade run, and the refusal is
      reported with something an operator can act on.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ binary: LEGACY_BINARY, env: collide }));
    mergeIntoOneBlock();

    const report = installHooks(deps({ env: collide }));

    expect(read(shared())).toContain('hooks fire claude-code');
    expect(report.refusedUpgrades.length).toBeGreaterThan(0);
  });
});

describe('F010-R1c — we never MANUFACTURE the entry we refuse to touch', () => {
  /**
   * THE CREATE SIDE OF THE SAME QUESTION, and it decides whether the refusal above
   * is a rare edge or a trap we build for ourselves. Two agents can resolve to one
   * file; if the second agent MERGED its command into the first's existing block,
   * every install would manufacture the exact mixed-agent entry that uninstall and
   * upgrade must now refuse — and each one would be stranded forever.
   *
   * We always append OUR OWN separate entry. `buildEntry` says why in its own
   * words: appending into a `matcher: "*"` block somebody else wrote would mean
   * editing an entry we do not own, and every nested-shape agent accepts multiple
   * blocks per event. These rows hold that property to the create path, because a
   * docstring is not a guard.
   */
  const shared = () => join(home, '.factory', 'settings.json');
  const collide = (name: string) =>
    name === 'CLAUDE_CONFIG_DIR' ? join(home, '.factory') : undefined;

  it('gives each agent its OWN entry in a shared file — never a merged one', () => {
    /*
    Test Doc:
    - Why: if we merged, the refusal for a mixed-agent entry would fire on
      configurations WE created, on every machine where two agents collide.
    - Contract: every entry in the shared file names exactly one agent.
    - Quality Contribution: asserts the invariant over EVERY entry rather than
      counting them, so a future writer that merges only sometimes still fails.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));

    const doc = JSON.parse(read(shared())) as {
      hooks: Record<string, { hooks?: { command: string }[] }[]>;
    };
    for (const key of ['PreToolUse', 'PostToolUse']) {
      const entries = doc.hooks[key] ?? [];
      expect(entries.length).toBe(2);
      for (const entry of entries) {
        const agents = new Set(
          (entry.hooks ?? []).map((h) => h.command.split('hooks fire ')[1]?.split(' ')[0]),
        );
        expect(agents.size, 'one entry, one agent').toBe(1);
      }
    }
  });

  it('so each agent remains INDEPENDENTLY removable — the property that matters', () => {
    /*
    Test Doc:
    - Why: the reason the invariant above is worth having. Separate entries mean
      the universal removal predicate matches, so neither agent is stranded.
    - Contract: uninstalling droid removes droid and refuses nothing.
    */
    present('.claude');
    present('.factory');
    installHooks(deps({ env: collide }));

    const droid = findAgent('droid');
    const outcomes = uninstallStrategyA(
      { fs, home, env: () => undefined },
      droid as NonNullable<typeof droid>,
    );

    expect(outcomes.flatMap((o) => o.refused)).toEqual([]);
    expect(read(shared())).not.toContain('hooks fire droid');
    expect(read(shared())).toContain('hooks fire claude-code');
  });
});

describe('F010-R2 — completeness must cover ENTRIES, not just root extras', () => {
  const cursorConfig = () => join(home, '.cursor', 'hooks.json');

  it('restores a MISSING EVENT ENTRY on re-install', () => {
    /*
    Test Doc:
    - Why: `containsOurEntry` is true when ANY event array carries this agent, so
      the early branch fired and only upgrades and root extras ran. Delete cursor's
      post-tool entry and no later install would ever put it back — half the
      bracket gone, and `status` reports installed. This is the same synthesis the
      previous round named — one marked entry vs complete configuration — fixed in
      the root-extra half only.
    - Contract: a second install re-adds the missing phase entry.
    */
    present('.cursor');
    installHooks(deps());
    const doc = JSON.parse(read(cursorConfig())) as { hooks: Record<string, unknown[]> };
    doc.hooks.postToolUse = [];
    writeFileSync(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);

    installHooks(deps());

    expect(read(cursorConfig())).toContain('hooks fire cursor --phase post');
  });

  it('does not DUPLICATE the entry that was already there', () => {
    /*
    Test Doc:
    - Why: the obvious over-correction — repairing the missing half by appending a
      second copy of the half that was fine.
    - Contract: exactly one entry per event array after the repair.
    */
    present('.cursor');
    installHooks(deps());
    const doc = JSON.parse(read(cursorConfig())) as { hooks: Record<string, unknown[]> };
    doc.hooks.postToolUse = [];
    writeFileSync(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);

    installHooks(deps());

    const after = JSON.parse(read(cursorConfig())) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(after.hooks.preToolUse).toHaveLength(1);
    expect(after.hooks.postToolUse).toHaveLength(1);
  });
});

describe('F010-R3 — an UNTOUCHED file must never be reported as a stranded write', () => {
  const first = () => join(home, '.codeium', 'hooks.json');
  const second = () => join(home, '.codeium', 'windsurf', 'hooks.json');

  it('names nothing when the file that failed is the only one this run would write', () => {
    /*
    Test Doc:
    - Why: `commitOneFile` correctly writes nothing for a no-op plan, and the
      caller pushed that outcome into the rollback set anyway. `revertWrite` then
      compared the file's bytes against `null`, refused, and the operator was told
      an UNTOUCHED file "was written and could not be rolled back". The prose was
      right; the caller made it false.
    - Contract: the untouched file is byte-identical AND is not named as stranded.
    - Quality Contribution: asserts the OPERATOR STRING against the disk. Reading
      the prose catches what it says; only a test catches when it is said.
    */
    present('.codeium');
    installHooks(deps());
    const before = read(first());
    // Remove ONLY the second file, so a re-install is a no-op for the first.
    rmSync(second(), { force: true });

    const failSecond = derive({
      writeText: (p: string, text: string) => {
        if (p.endsWith('windsurf/hooks.json')) throw new Error('EACCES: permission denied');
        fs.writeText(p, text);
      },
    });
    const report = installHooks(deps({ fs: failSecond }));
    const reason = report.failed.find((f) => f.agent === 'windsurf')?.reason ?? '';

    expect(read(first())).toBe(before);
    expect(reason).not.toContain(first());
  });
});

describe('F010-R4 — COMPENSATION MAY NEVER TOUCH WHAT THIS RUN DID NOT WRITE', () => {
  /**
   * THE CLASS, NOT THE ROUTE — and this describe exists because three rounds fixed
   * three doors into one room.
   *
   * Round 1: the legacy UPGRADE reported `!alreadyPresent`, and compensation ran a
   * whole-agent uninstall over an entry the user already had. Fixed with an explicit
   * discriminant.
   * Round 3: the completeness REPAIR of a partial config is an `added-entry`, and
   * compensation ran the same whole-agent uninstall — removing the phase that was
   * already there along with the phase this run added.
   *
   * Each fix was correct and each opened the same door from a new direction,
   * because **the discriminant answers HOW to reverse and never answers WHAT to
   * reverse**. A reversal scoped to what the AGENT OWNS will always be able to
   * reach something this run did not write; only a reversal scoped to what THIS
   * RUN WROTE cannot.
   *
   * So the property is asserted DIRECTLY and PARAMETERISED over every discriminant
   * value, rather than once per defect: after a failed provenance write, the file
   * is byte-identical to its pre-run state — where "no file" is a valid pre-run
   * state. A fourth door has to fail one of these rows.
   */
  const cursorConfig = () => join(home, '.cursor', 'hooks.json');

  /** Each row returns the state the file must be restored to — `null` for absent. */
  const cases: [name: string, discriminant: string, setup: () => string | null][] = [
    [
      'created-file — the file did not exist, so the reversal is its absence',
      'created-file',
      () => null,
    ],
    [
      'added-entry — a config with FOREIGN entries we appended beside',
      'added-entry',
      () => {
        const doc = {
          hooks: {
            preToolUse: [{ command: 'other-tool --run' }],
            postToolUse: [{ command: 'other-tool --post' }],
          },
          version: 1,
        };
        writeFileSync(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);
        return read(cursorConfig());
      },
    ],
    [
      'added-entry (REPAIR) — a PARTIAL config of ours, one phase already present',
      'added-entry',
      () => {
        // The reviewer's reproduction: install, delete only the post-tool entry,
        // and let the completeness repair put it back.
        installHooks(deps());
        const doc = JSON.parse(read(cursorConfig())) as { hooks: Record<string, unknown[]> };
        doc.hooks.postToolUse = [];
        writeFileSync(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);
        return read(cursorConfig());
      },
    ],
    [
      'rewritten-entry — a legacy entry the upgrade migrates in place',
      'rewritten-entry',
      () => {
        installHooks(deps({ binary: LEGACY_BINARY }));
        return read(cursorConfig());
      },
    ],
    [
      'already-present — nothing to write, so nothing to reverse',
      'already-present',
      () => {
        installHooks(deps());
        return read(cursorConfig());
      },
    ],
  ];

  it.each(cases)('%s', (_name, _discriminant, setup) => {
    /*
    Test Doc:
    - Why: the question asked ONCE of every discriminant value — can this reversal
      touch anything this run did not write? If the answer is not structurally no,
      it is another door. Written as one parameterised property rather than a row
      per defect, because a row per defect is what produced three rounds.
    - Contract: after an install whose provenance write fails, the config is
      byte-identical to its pre-run state.
    - Quality Contribution: asserts BYTES against a state captured before the run,
      so it cannot be satisfied by a reversal that happens to leave the right
      number of entries.
    */
    present('.cursor');
    const before = setup();

    const report = installHooks(deps({ fs: failRecordAfterProbe() }));

    expect(report.failed.map((f) => f.agent)).toContain('cursor');
    const after = existsSync(cursorConfig()) ? read(cursorConfig()) : null;
    expect(after).toBe(before);
  });

  it('and the REPORT agrees with the disk on every one of them', () => {
    /*
    Test Doc:
    - Why: `rolled back` while the file has lost content is the shape of the
      original defect; the inverse — reporting a strand after a clean restore —
      would send an operator hunting for a file that is fine.
    - Contract: the reason says rolled back exactly when the bytes came back.
    */
    present('.cursor');
    installHooks(deps());
    const doc = JSON.parse(read(cursorConfig())) as { hooks: Record<string, unknown[]> };
    doc.hooks.postToolUse = [];
    writeFileSync(cursorConfig(), `${JSON.stringify(doc, null, 2)}\n`);
    const before = read(cursorConfig());

    const report = installHooks(deps({ fs: failRecordAfterProbe() }));
    const reason = report.failed.find((f) => f.agent === 'cursor')?.reason ?? '';

    expect(reason).toContain('rolled back');
    expect(read(cursorConfig())).toBe(before);
  });
});
