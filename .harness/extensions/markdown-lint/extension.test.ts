import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import markdownLint from './extension.ts';

/*
Test Doc:
- Why: plan 081 IMPROVE / DL-001. `markdown-lint` derives its scope from
  `git ls-files`, so a brand-new UNTRACKED `.md` is invisible to it and "passes"
  by never being examined. That is this plan's own subject — a control that
  reports green because it looked at nothing — living inside one of our gates.
- Contract: the verb must not be able to return `ok` while in-scope markdown
  exists that it did not examine. Untracked in-scope markdown is reported as a
  finding (→ degraded, exit 0 — the gate's existing warn-launch posture is NOT
  changed), and the message teaches the repair: `git add -N <file>`.
- THE PLANTED DOC IS DELIBERATELY BROKEN (two H1s — a real MD025 violation), and
  that is load-bearing, not colour. A clean planted file would only prove the
  file LIST got longer. A broken one proves the gate was silent about a genuine
  failure it would have reported had the file been tracked — the difference
  between demonstrating the ENUMERATION and demonstrating the EXAMINATION. The
  paired test below asserts exactly that difference: same bytes, two tracking
  states, and the failure only becomes visible in one of them.
- Note the asymmetry being pinned: the three tool checks report on what they DID
  examine; this one reports on what they COULD NOT. A gate with no such check can
  only ever be as honest as its enumerator.
*/

const TRACKED = 'docs/how/tracked.md';
/** Untracked AND genuinely broken: two top-level headings ⇒ markdownlint MD025. */
const BROKEN = 'docs/how/two-h1s.md';
const BROKEN_BODY = '# First title\n\nSome prose.\n\n# Second title\n\nMore prose.\n';
/** What markdownlint-cli2 really emits for that document. */
const MD025 = `${BROKEN}:5 error MD025/single-title/single-h1 Multiple top-level headings in the same document`;

/** Every dependency the three tool checks preflight, so none reports `unavailable`. */
const TOOLING: Record<string, string> = {
  '/repo/node_modules/.bin/markdownlint-cli2': '#!/bin/sh\n',
  '/repo/node_modules/.bin/remark': '#!/bin/sh\n',
  '/repo/node_modules/remark-validate-links': 'pkg\n',
  '/repo/.remarkrc.json': '{}\n',
  '/repo/node_modules/mermaid': 'pkg\n',
  '/repo/node_modules/jsdom': 'pkg\n',
  '/repo/.harness/extensions/markdown-lint/lib/mermaid-runner.mjs': '// runner\n',
};

const MDL = 'node_modules/.bin/markdownlint-cli2';

/**
 * A context where the tools succeed unless explicitly scripted to fail, so the
 * ONLY thing that can make an otherwise-clean envelope non-ok is the
 * unexamined-markdown check. Seeded docs carry no mermaid fence, so that check
 * passes without an exec and the runner never needs scripting.
 */
function ctxFor(opts: {
  tracked?: string[];
  status?: string;
  statusCode?: number;
  mdlFailFor?: string[];
  options?: Record<string, unknown>;
}) {
  const tracked = opts.tracked ?? [TRACKED];
  const scripts: Record<string, { code: number; stdout?: string; stderr?: string }> = {
    'git ls-files -z *.md *.markdown': { code: 0, stdout: tracked.join('\0') },
    'git status --porcelain --untracked-files=all -z': {
      code: opts.statusCode ?? 0,
      stdout: opts.status ?? '',
    },
  };
  if (opts.mdlFailFor) {
    scripts[[MDL, ...opts.mdlFailFor].join(' ')] = { code: 1, stdout: `${MD025}\n` };
  }
  const seed: Record<string, string> = { ...TOOLING, [`/repo/${BROKEN}`]: BROKEN_BODY };
  for (const f of tracked) seed[`/repo/${f}`] ??= '# Tracked\n\nNo fences here.\n';
  const fs = new FakeFs(seed);
  return buildVerbContext(
    {
      exec: new FakeExec(scripts),
      fs,
      fsWrite: fs,
      env: new FakeEnv(),
      git: new FakeGit({ isRepo: true, branch: 'main' }),
      clock: new FakeClock(),
    },
    { cwd: '/repo', args: {}, options: opts.options ?? {} },
  );
}

interface MdData {
  checks: { name: string; outcome: string; findings: number; examined: number; summary: string }[];
  totals: { findings: number };
}

const checkOf = (res: { data?: unknown }, name: string) =>
  (res.data as MdData).checks.find((c) => c.name === name);

describe('markdown-lint cannot report green over markdown it never examined (DL-001)', () => {
  it('an untracked, GENUINELY BROKEN .md makes the envelope degraded — it must not pass silently', async () => {
    const ctx = ctxFor({ status: `?? ${BROKEN}\0` });

    const res = await markdownLint.run(ctx);

    // THE DEFECT: the document has a real MD025 violation, and all three tool
    // checks pass — because none of them was ever handed the file. Before the
    // unexamined check existed this returned `ok`: a clean green envelope over a
    // document that would have failed the moment anyone looked at it.
    expect(res.status).toBe('degraded');
    expect(checkOf(res, 'markdownlint')?.findings).toBe(0);
  });

  it('the file it could not see WOULD have failed — same bytes, two tracking states', async () => {
    // This pair is the whole argument. If only the untracked leg existed, the
    // test would prove the gate noticed a longer file list. The tracked leg
    // proves what that silence was hiding: a real finding the gate reports the
    // instant the file becomes visible to `git ls-files`.
    const untracked = await markdownLint.run(ctxFor({ status: `?? ${BROKEN}\0` }));
    const nowTracked = await markdownLint.run(
      ctxFor({ tracked: [TRACKED, BROKEN], mdlFailFor: [TRACKED, BROKEN] }),
    );

    // Untracked: markdownlint is silent, and ONLY the unexamined check speaks.
    expect(checkOf(untracked, 'markdownlint')?.findings).toBe(0);
    expect(checkOf(untracked, 'unexamined')?.findings).toBe(1);

    // Tracked (`git add -N`): the identical document now produces the real
    // violation, and there is nothing left unexamined.
    expect(checkOf(nowTracked, 'markdownlint')?.findings).toBe(1);
    expect(checkOf(nowTracked, 'markdownlint')?.summary).toContain('MD025');
    expect(checkOf(nowTracked, 'unexamined')?.findings).toBe(0);

    // Both states are non-green — which is the point. The old gate had exactly
    // one green and one red here; it should always have had two reds.
    expect(untracked.status).toBe('degraded');
    expect(nowTracked.status).toBe('degraded');
  });

  it('names the file and teaches the repair (`git add -N`), not just the fact', async () => {
    const res = await markdownLint.run(ctxFor({ status: `?? ${BROKEN}\0` }));
    const check = checkOf(res, 'unexamined');

    expect(check).toBeDefined();
    expect(check?.outcome).toBe('findings');
    expect(check?.summary).toContain(BROKEN);
    expect(check?.summary).toContain('git add -N');
  });

  it('counts EVERY untracked entry it parsed, not just the in-scope ones — the vacuity guard', async () => {
    // A reader that silently returned [] would report "nothing unexamined" and
    // pass every negative assertion in this file. So pin the DENOMINATOR: five
    // untracked entries were seen, two of which are in-scope markdown. A broken
    // parser fails here (examined 0), not silently everywhere else.
    const ctx = ctxFor({
      status: [
        `?? ${BROKEN}`,
        '?? docs/how/second-new.md',
        '?? src/thing.ts', // not markdown
        '?? docs/plans/081/notes.md', // markdown, but an IGNORED scope
        '?? .harness/records/retro/x.md', // markdown, but an IGNORED scope
        '',
      ].join('\0'),
    });

    const res = await markdownLint.run(ctx);
    const check = checkOf(res, 'unexamined');

    expect(check?.examined).toBe(5);
    expect(check?.findings).toBe(2);
    expect(check?.summary).toContain(BROKEN);
    expect(check?.summary).toContain('docs/how/second-new.md');
  });

  it('a clean tree still reports ok — the check is not a blanket', async () => {
    const res = await markdownLint.run(ctxFor({ status: '?? src/thing.ts\0' }));
    const check = checkOf(res, 'unexamined');

    expect(res.status).toBe('ok');
    expect(check?.outcome).toBe('pass');
    expect(check?.findings).toBe(0);
    expect(check?.examined).toBe(1);
  });

  it('a git status that FAILS is reported, never read as "nothing untracked"', async () => {
    // The failure this whole packet is about, one layer down: an enumerator that
    // errors must not be indistinguishable from an enumerator that found nothing.
    const res = await markdownLint.run(ctxFor({ status: '', statusCode: 128 }));
    const check = checkOf(res, 'unexamined');

    expect(check?.outcome).toBe('unavailable');
    expect(res.status).toBe('unconfigured');
  });

  it('--dir scopes the unexamined check the same way it scopes the tools', async () => {
    const res = await markdownLint.run(
      ctxFor({
        status: [`?? ${BROKEN}`, '?? harness-foundations/elsewhere.md', ''].join('\0'),
        options: { dir: 'docs/how' },
      }),
    );
    const check = checkOf(res, 'unexamined');

    // The foundations file is untracked and in the frozen scope, but outside the
    // requested --dir, so this run does not claim anything about it.
    expect(check?.findings).toBe(1);
    expect(check?.summary).toContain(BROKEN);
    expect(check?.summary).not.toContain('harness-foundations/elsewhere.md');
  });
});
