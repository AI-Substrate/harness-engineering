import { describe, expect, it } from 'vitest';
import {
  classifyOwnership,
  commandTokens,
  fileIsOwnedByUs,
  gitAiWouldClaim,
  HOOK_MARKER,
  HOOK_MARKER_FLAG,
  isOwnedByUs,
  mayRemove,
} from '../../../src/services/hooks/hook-marker.js';

/**
 * THE MARKER PREDICATE (plan 082 tk-0003).
 *
 * The rows that matter most are built from the LIVE `~/.cursor/hooks.json` on this
 * machine, read before phase 3 writes anything. Not a workshop paraphrase — the
 * actual bytes, which turned out to disagree with what anyone had assumed: git-ai's
 * checkpoint call is a pipeline stage inside somebody else's compound command, not
 * an entry of its own.
 */

/** The MEASURED live entry — git-ai's checkpoint inside a POC-authored pipeline. */
const LIVE_GIT_AI_ENTRY =
  'python3 /Users/x/substrate/harness-engineering/scratch/attrib-probe/hook-probe.py PRE >/dev/null 2>&1; ' +
  'tee -a /tmp/cursor-hook-pre.jsonl | /Users/x/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin 2>>/tmp/cursor-hook-err.log';

/** What we install. */
const OUR_ENTRY = `/usr/local/bin/harness hooks fire cursor --phase pre --hook-input stdin ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;

describe('the owned marker — exact-token, never substring (dw-000a)', () => {
  it('claims our own entry', () => {
    expect(isOwnedByUs(OUR_ENTRY)).toBe(true);
  });

  it.each([
    [
      'a longer token that merely starts with the marker',
      `run --owner ${HOOK_MARKER}-experimental`,
    ],
    ['a longer token that merely ends with it', `run --owner legacy-${HOOK_MARKER}`],
    ['the marker as a path fragment', `/opt/${HOOK_MARKER}/bin/other-tool --go`],
    ['the marker inside a larger word', `run --owner x${HOOK_MARKER}x`],
  ])('does NOT claim %s', (_name, command) => {
    /*
    Test Doc:
    - Why: dw-000a. `includes()` claims every one of these. Uninstall deletes what
      the predicate claims, so a substring match deletes other people's hooks.
    - Contract: false for all of them.
    */
    expect(command).toContain(HOOK_MARKER); // the substring test WOULD match
    expect(isOwnedByUs(command)).toBe(false); // exact-token does not
  });

  it('claims the marker even when quoted', () => {
    expect(isOwnedByUs(`harness hooks fire cursor "${HOOK_MARKER}"`)).toBe(true);
    expect(isOwnedByUs(`harness hooks fire cursor '${HOOK_MARKER}'`)).toBe(true);
  });
});

describe('the marker across the boundary with git-ai — BOTH directions (dw-000c)', () => {
  it('does NOT claim the live git-ai entry — which is a COMPOUND command', () => {
    /*
    Test Doc:
    - Why: MEASURED from the live config. This one entry contains THREE tools:
      a POC probe, tee, and git-ai's checkpoint. Claiming it would delete all three.
    - Contract: not ours.
    */
    expect(isOwnedByUs(LIVE_GIT_AI_ENTRY)).toBe(false);
  });

  it('git-ai WOULD claim that entire compound entry — the defect we are avoiding', () => {
    /*
    Test Doc:
    - Why: this is the argument for exact-token matching, converted into a
      measurement. git-ai's own predicate claims an entry it did not write.
    - Contract: true — asserted so the contrast is executable rather than narrated.
      If this ever goes false, the comparison in the module doc is stale.
    */
    expect(gitAiWouldClaim(LIVE_GIT_AI_ENTRY)).toBe(true);
  });

  it("git-ai's predicate does NOT claim our entry", () => {
    // Our command contains neither `git-ai` nor `checkpoint`, deliberately.
    expect(gitAiWouldClaim(OUR_ENTRY)).toBe(false);
  });

  it('a marker MENTION does not transfer ownership', () => {
    /*
    Test Doc:
    - Why: a third party could name our marker in a comment, a log line or an echo.
    - Contract: a LONGER token containing the marker's text is not the marker.
    - WHAT THIS ROW DOES *NOT* PROVE, named because its earlier title claimed it:
      this passes via the longer-token rule already proven above, NOT via any
      compound-attribution logic — `<marker>-ish` is simply a different token. The
      compound case is the next two rows, and it needed a different mechanism.
    */
    const foreign = `echo "installed by ${HOOK_MARKER}-ish tooling" && other-tool --run`;
    expect(foreign).toContain(HOOK_MARKER);
    expect(isOwnedByUs(foreign)).toBe(false);
  });

  it('OUR INVOCATION CHAINED WITH SOMEONE ELSE\u2019S is ours-with-foreign, and is NOT removable', () => {
    /*
    Test Doc:
    - Why: the case the mention row was mistaken for, and the one that matters.
      MEASURED as the observed normal: on this machine a third party wrapped
      git-ai's standalone hook invocation into a chained command. It will happen to
      ours. Our marker IS genuinely present, so `isOwnedByUs` is correctly true —
      and deleting the entry on that basis would destroy `other-tool --run`.
    - Contract: classified `ours-with-foreign`, and mayRemove is FALSE.
    - Quality Contribution: this is git-ai's own defect pointed at us. Their
      predicate claims the POC's compound entry here and would delete two other
      tools with it; a boolean `isOwnedByUs` gating deletion would do the same.
    */
    const chained = `other-tool --run && harness hooks fire cursor --hook-owner ${HOOK_MARKER}`;

    expect(isOwnedByUs(chained)).toBe(true);
    expect(classifyOwnership(chained)).toBe('ours-with-foreign');
    expect(mayRemove(chained)).toBe(false);
  });

  it('an entry that is WHOLLY ours is removable', () => {
    // The positive control for the row above: if nothing were ever removable,
    // "refuses to remove" would be satisfied by an uninstall that does nothing.
    expect(classifyOwnership(OUR_ENTRY)).toBe('wholly-ours');
    expect(mayRemove(OUR_ENTRY)).toBe(true);
  });

  it('a bare MENTION of the exact marker beside foreign work is also refused', () => {
    // An echo naming the marker exactly. Not our invocation — but REFUSE gives the
    // safe answer here without needing to tell the two apart.
    const mention = `echo "${HOOK_MARKER}" && other-tool --run`;
    expect(mayRemove(mention)).toBe(false);
  });
});

describe('the marker survives path quoting and Windows normalisation (dw-000b)', () => {
  it.each([
    ['a POSIX path', '/usr/local/bin/harness'],
    ['a path containing a SPACE, quoted', '"/Users/ada lovelace/bin/harness"'],
    ['a Windows path, normalised and quoted', '"C:/Program Files/harness/harness.exe"'],
    ['a UNC-ish path with the \\\\?\\ prefix already stripped', '"C:/Users/ada/harness.exe"'],
  ])('is still found with %s', (_name, binary) => {
    /*
    Test Doc:
    - Why: dw-000b. This is WHY the marker is its own argument rather than part of
      the path — quoting and normalisation rewrite the path and would mangle a
      marker embedded in it. Asserted, not assumed.
    - Contract: the marker token is unaffected by whatever the path does.
    */
    const command = `${binary} hooks fire cursor --phase pre --hook-input stdin ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;
    expect(isOwnedByUs(command)).toBe(true);
  });

  it('a space-bearing quoted path does not fragment into bogus tokens that match', () => {
    // The path splits on whitespace inside the quotes — a known limit of the cheap
    // tokeniser. It must not accidentally produce the marker, and it does not.
    const tokens = commandTokens('"/Users/ada lovelace/bin/harness" hooks fire cursor');
    expect(tokens).toContain('hooks');
    expect(tokens).not.toContain(HOOK_MARKER);
  });
});

describe('file-based strategies carry the SAME literal (dw-0009)', () => {
  it('finds the marker in a shell comment line (Strategy D)', () => {
    const script = `#!/bin/sh\n# ${HOOK_MARKER}\nexec harness hooks fire cline --phase pre\n`;
    expect(fileIsOwnedByUs(script)).toBe(true);
  });

  it('finds the marker in a TypeScript header comment (Strategy C)', () => {
    const plugin = `// ${HOOK_MARKER}\nexport const hook = () => {};\n`;
    expect(fileIsOwnedByUs(plugin)).toBe(true);
  });

  it('REFUSES a file that does not carry it — the refuse-to-clobber posture', () => {
    /*
    Test Doc:
    - Why: Strategies C and D own a whole FILE. cline.rs refuses to overwrite a file
      lacking its marker; amp.rs removes the file with no marker check at all, and
      that is the behaviour being rejected. The predicate is what makes the refusal
      possible.
    - Contract: an unmarked file is never ours.
    */
    expect(fileIsOwnedByUs('#!/bin/sh\n# someone else wrote this\nexec their-tool\n')).toBe(false);
  });
});
