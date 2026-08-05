import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  findExtensionAncestor,
  type NoExtensionContext,
  noExtensionContextMessage,
  noExtensionContextNextAction,
} from '../../../src/services/extensions/no-extension-context.js';

/*
FX004 — "you are not in a harness repo" was never the fact.

Pre-fix, `harness checks` from a directory with no loadable extensions reported
`E108: Expected 0 arguments but got 1: checks` — a SYNTAX error for a diagnosable
state — and `harness checks --help` printed top-level usage and exited 0.

THE DISCRIMINATOR IS ESTABLISHED, NOT INHERITED (packet ruling #3.3). The
inside-vs-outside-a-repo theory survived three tellings because every case anyone
tried held "is a repo" and "cwd has extensions" TOGETHER — the repo root is where
`.harness/extensions` lives. These tests deliberately break the confound in both
directions, because a control set of only inside-at-root vs outside-anywhere
cannot see it:

  - inside a repo but NOT at the root  -> still no extensions (the case a
    "not in a repo" message would lie to)
  - outside any repo but WITH extensions -> works fine

Neither case involves git at all, which is the point.
*/

const EXT = (root: string) => `${root}/.harness/extensions`;

/** A fake tree whose ONLY loadable extension lives at `<root>/.harness/extensions/checks`. */
function treeWithExtensionsAt(root: string) {
  return new FakeFs(
    { [`${EXT(root)}/checks/extension.ts`]: '// checks' },
    { [EXT(root)]: ['checks'] },
  );
}

describe('FX004 — an unregistered verb reports the reason, not a syntax error', () => {
  describe('findExtensionAncestor — the remedy is FOUND and VERIFIED, never guessed', () => {
    it('CONTROL: finds the ancestor that actually holds a loadable extension', () => {
      /*
      Test Doc:
      - Why: ruling #3.2 — a diagnostic may search where the loader does not, but only
        if it VERIFIES what it names. "Try the repo root" would re-teach the retracted
        mechanism under our own name.
      - Contract: findExtensionAncestor walks UP from cwd and returns the first dir
        confirmed by discoverExtensionsAt to hold >=1 loadable extension.
      - Worked Example: cwd /repo/harness/cli, extensions at /repo -> {ancestor,'/repo'}.
      */
      const fs = treeWithExtensionsAt('/repo');
      expect(findExtensionAncestor(fs, '/repo/harness/cli')).toEqual({
        kind: 'ancestor',
        dir: '/repo',
      });
    });

    it('CONTROL: says `none` rather than guessing when NO ancestor holds one', () => {
      /*
      Test Doc:
      - Why: the fix must not fall back to a guess about a repo root — that is the
        retracted theory, and a user who followed it and succeeded would learn it
        from us. Ruling #3.2(b) makes "there is none" a first-class answer.
      - Contract: no ancestor with a loadable extension -> { kind: 'none' }.
      */
      expect(findExtensionAncestor(new FakeFs(), '/tmp/somewhere/deep')).toEqual({ kind: 'none' });
    });

    it('GUARD: an ancestor with an EMPTY extensions dir is not named', () => {
      /*
      Test Doc:
      - Why: presence of the DIRECTORY is not evidence of a loadable extension — the
        exact "structure mistaken for the thing" defect FX003 hit four times. The
        remedy must assert loadability, not layout.
      - Contract: `.harness/extensions/` present but empty -> still { kind: 'none' }.
      */
      const fs = new FakeFs({}, { [EXT('/repo')]: [] });
      expect(findExtensionAncestor(fs, '/repo/harness/cli')).toEqual({ kind: 'none' });
    });

    it('GUARD: terminates at the filesystem root instead of looping', () => {
      expect(findExtensionAncestor(new FakeFs(), '/')).toEqual({ kind: 'none' });
    });

    it('GUARD: does not re-probe cwd itself (the loader already found nothing there)', () => {
      /*
      Test Doc:
      - Why: the caller only reaches the remedy because discovery at cwd was empty;
        re-probing cwd could only produce a contradiction. The nearest ANCESTOR is
        the answer, so a cwd that somehow has extensions is still not "above".
      */
      const fs = treeWithExtensionsAt('/repo');
      expect(findExtensionAncestor(fs, '/repo')).toEqual({ kind: 'none' });
    });
  });

  describe('the message asserts only what was established', () => {
    const withAncestor: NoExtensionContext = {
      cwd: '/work/harness/cli',
      requested: 'checks',
      remedy: { kind: 'ancestor', dir: '/work' },
    };
    const withNone: NoExtensionContext = {
      cwd: '/tmp/elsewhere',
      requested: 'checks',
      remedy: { kind: 'none' },
    };

    it('CONTROL: never claims the user is "not in a harness repo"', () => {
      /*
      Test Doc:
      - Why: THE control for this defect. That sentence is FALSE from /repo/harness/cli
        — a user standing inside a harness repo told they are not in one. Shipping it
        would replace a wrong diagnostic with a differently wrong one, which is this
        packet's own defect class committed by the fix.
      - Contract: no rendered message mentions a repo at all; it names the cwd and the
        directory actually consulted. The fixture paths avoid the substring "repo"
        deliberately, so this asserts the CLAIM and not an accident of the path.
      */
      for (const ctx of [withAncestor, withNone]) {
        const msg = noExtensionContextMessage(ctx);
        expect(msg).not.toMatch(/repo/i);
        expect(msg).not.toMatch(/git/i);
        expect(msg).toContain(ctx.cwd);
      }
    });

    it('CONTROL: names the verified ancestor, and the next action is runnable', () => {
      expect(noExtensionContextMessage(withAncestor)).toContain('/work');
      expect(noExtensionContextNextAction(withAncestor)).toBe('cd /work && harness checks');
    });

    it('CONTROL: when there is no ancestor it SAYS so, and names no directory', () => {
      /*
      Test Doc:
      - Why: ruling #3.2(b). The absence of a remedy must be stated, not softened into
        a suggestion the fix never checked.
      */
      expect(noExtensionContextMessage(withNone)).toContain('No directory above this one');
      expect(noExtensionContextNextAction(withNone)).not.toContain('cd /');
    });
  });

  describe('the discriminator, both directions (the confound the dossier could not see)', () => {
    it('CONTROL: INSIDE a repo but not at the root — no extensions in scope', () => {
      /*
      Test Doc:
      - Why: probes 2/3. This is the case that killed the inside-vs-outside theory, and
        the case a "not in a repo" message lies to. Note the fake has NO git concept at
        all — being "in a repo" is not representable here, which is precisely the point.
      - Contract: discovery is cwd-relative, so a subdir of a repo has no extensions.
      */
      const fs = treeWithExtensionsAt('/repo');
      const proc = new FakeProcess({}, '/repo/harness/cli');
      expect(fs.readdir(EXT(proc.cwd()))).toEqual([]);
      expect(findExtensionAncestor(fs, proc.cwd())).toEqual({ kind: 'ancestor', dir: '/repo' });
    });

    it('GUARD: OUTSIDE any repo but WITH extensions — perfectly usable', () => {
      /*
      Test Doc:
      - Why: probe 4, the other direction. Extensions load with no repo anywhere,
        proving git is irrelevant to the discriminator in BOTH directions. A control
        set with only inside-at-root vs outside-anywhere cannot see this.
      */
      const fs = treeWithExtensionsAt('/tmp/not-a-repo');
      expect(fs.readdir(EXT('/tmp/not-a-repo'))).toEqual(['checks']);
    });
  });
});
