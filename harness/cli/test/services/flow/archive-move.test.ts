import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, runCliIn } from '../../support/run-cli.js';

/**
 * tk-7165 / dw-0008 — the archive move, proven end to end.
 *
 * Key finding F8, stated plainly: a flow's `dd_link` addresses are REPO-ROOT
 * anchored, so the post-flight `git mv` into `docs/plans/archive/` stales every
 * one of them — and nothing notices. `dd doctor` sweeps `*.dd.json`; a flow is
 * `.harness/flows/<slug>.json`, so the corpus reads perfectly clean while every
 * gate points at a folder that no longer exists. On an archived plan there are no
 * departures left to refuse, so the breakage has no natural discovery moment at
 * all — it is found by a human clicking a link, or never.
 *
 * These controls run the REAL move: a real git repository, a real `git mv`, the
 * real CLI. The planted-bad is not a mutation of the code — it is the state of
 * the world immediately after the move and BEFORE the rewrite, which is exactly
 * the state the old procedure shipped.
 */

const REFERENCES = '../../../../../skills/builder/references';
const TEMPLATE_PATH = fileURLToPath(
  new URL(`${REFERENCES}/flight-plan.template.json`, import.meta.url),
);
const SCHEMA_PATH = fileURLToPath(
  new URL(`${REFERENCES}/flight-plan.schema.json`, import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const PLAN_DIR = 'docs/plans/099-archive-me';
const ARCHIVE_DIR = 'docs/plans/archive/099-archive-me';

let root = '';
let previousCwd = '';

afterEach(() => {
  // Restore the cwd BEFORE deleting the directory it points at: vitest reuses a
  // worker across files, and a process parked in a deleted temp dir poisons
  // whatever runs next in it.
  if (previousCwd.length > 0) process.chdir(previousCwd);
  previousCwd = '';
  if (root.length > 0) rmSync(root, { recursive: true, force: true });
  root = '';
});

const git = (args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      // The POSIX literal is DELIBERATE — do NOT "modernise" this to `os.devNull`. On
      // win32 '/dev/null' is just a missing file, which git treats as no config;
      // `os.devNull` would resolve to the device path '\\.\nul' that git is reported to
      // reject, introducing the defect fixed at the GIT_CONFIG_GLOBAL sites in
      // src/adapters/git/exec-remote-telemetry-git.ts (see nullDeviceForPlatform).
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Harness',
      GIT_AUTHOR_EMAIL: 'h@example.invalid',
      GIT_COMMITTER_NAME: 'Harness',
      GIT_COMMITTER_EMAIL: 'h@example.invalid',
    },
  }).trim();

function write(relative: string, value: unknown): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** A real repository holding a real plan corpus and a real gated flow. */
async function buildRepo(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'archive-move-'));
  cpSync(join(REPO_ROOT, '.dd'), join(root, '.dd'), { recursive: true });

  write(`${PLAN_DIR}/plan.dd.json`, {
    dd: { schema: 'builder/plan' },
    sections: [
      { name: 'meta', value: { title: 'Archive me', slug: 'archive-me', status: 'draft' } },
      { name: 'summary', value: 'A plan that is about to be archived.' },
      {
        name: 'acceptance_criteria',
        value: [{ id: 'ac-9901', claim: 'the gates survive the move', state: 'checked' }],
      },
      {
        name: 'phases',
        value: [
          {
            id: 'ph-9901',
            title: 'do it',
            state: 'checked',
            tasks: 'assets/tasks/phase-1/tasks.dd.json#tasks',
          },
        ],
      },
    ],
  });
  write(`${PLAN_DIR}/assets/tasks/phase-1/tasks.dd.json`, {
    dd: { schema: 'builder/plan' },
    sections: [
      { name: 'meta', value: { title: 'Phase 1', slug: 'phase-1', status: 'in-progress' } },
      { name: 'summary', value: 'Task detail.' },
      {
        name: 'tasks',
        value: [{ id: 'tk-9901', title: 'the work', phase: 'ph-9901', state: 'checked' }],
      },
      { name: 'done_when', value: {} },
    ],
  });

  git(['init', '-q']);
  await runCliIn(root, [
    'flow',
    'create',
    'flight-plan',
    '--slug',
    'archive-me',
    '--path',
    '.harness/flows/archive-me.json',
    '--schema',
    SCHEMA_PATH,
    '--template',
    TEMPLATE_PATH,
    '--plan-dir',
    PLAN_DIR,
  ]);
  git(['add', '-A']);
  git(['commit', '-qm', 'plan + flow']);
  previousCwd = process.cwd();
  process.chdir(root);
}

function flowDoc(): {
  plan_dir?: string;
  nodes: Array<{ id: string; dd_link?: { address: string } }>;
} {
  return JSON.parse(readFileSync(join(root, '.harness/flows/archive-me.json'), 'utf8')) as never;
}

function gateAddresses(): string[] {
  return flowDoc()
    .nodes.map((node) => node.dd_link?.address)
    .filter((address): address is string => typeof address === 'string')
    .sort();
}

/**
 * Does this gate address reach something real?
 *
 * The two gate kinds address differently and must be probed differently. A
 * COMPLETION gate names an interior (`…/tasks.dd.json#tasks`), which is a dd
 * address and resolves through `dd link resolve`. A CHECK gate names a whole plan
 * (`…/plan.dd.json`) with no `#` at all — deliberately, since a check gate almost
 * always means "this plan", and that is not a dd address. Probing the bare path
 * with the address resolver would report a failure that says nothing about
 * whether the move worked.
 */
async function reaches(address: string): Promise<boolean> {
  // `dd` verbs are their OWN composition roots — they build a NodeFs and read
  // `process.cwd()` rather than taking the injected process port, so `runCliIn`'s
  // root reaches the flow act and not this one. Driving them from the fixture's
  // cwd is what makes the probe measure the fixture instead of the test runner's
  // own directory; without the chdir in `buildRepo` this whole control passes
  // vacuously, which is exactly how it first "passed".
  if (address.includes('#')) {
    const resolved = await runCli(['dd', 'link', 'resolve', address]);
    return resolved.code === 0;
  }
  return existsSync(join(root, address));
}

/** The post-flight move, exactly as the stage runs it. */
function archiveMove(): void {
  mkdirSync(join(root, 'docs/plans/archive'), { recursive: true });
  git(['mv', PLAN_DIR, ARCHIVE_DIR]);
}

describe('dw-0008 — the archive move re-points the gates it would otherwise strand', () => {
  it('FIRES on an unrewritten link: after the move, every gate address is dead', async () => {
    await buildRepo();
    const before = gateAddresses();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((address) => address.startsWith(PLAN_DIR))).toBe(true);

    archiveMove();

    // This is the planted-bad, and it is the SHIPPED state of the old procedure:
    // the addresses still name the pre-move folder, and every one of them now
    // resolves to nothing.
    expect(gateAddresses()).toEqual(before);
    // BOTH gate kinds are dead, each probed the way its own address shape works.
    for (const address of before) {
      expect(await reaches(address)).toBe(false);
    }
    // And the reason it goes unnoticed: the corpus itself is perfectly healthy.
    const doctor = await runCli(['dd', 'doctor']);
    expect(doctor.code).toBe(0);
  });

  it('rewrites every in-folder address and leaves the corpus doctor-clean', async () => {
    await buildRepo();
    const before = gateAddresses();
    archiveMove();

    const relocated = await runCliIn(root, [
      'flow',
      'relocate',
      '--path',
      '.harness/flows/archive-me.json',
      '--to',
      ARCHIVE_DIR,
    ]);

    expect(relocated.code).toBe(0);
    const data = relocated.envelope?.data as {
      count: number;
      plan_dir: { from: string; to: string };
    };
    expect(data.plan_dir).toEqual({ from: PLAN_DIR, to: ARCHIVE_DIR });
    expect(data.count).toBe(before.length);

    // Every gate now resolves against the archived corpus.
    const after = gateAddresses();
    expect(after.every((address) => address.startsWith(ARCHIVE_DIR))).toBe(true);
    const reachable: Record<string, boolean> = {};
    for (const address of after) reachable[address] = await reaches(address);
    expect(reachable).toEqual(Object.fromEntries(after.map((a) => [a, true])));
    const doctor = await runCli(['dd', 'doctor']);
    expect(doctor.code).toBe(0);
    // The flow's own record of where it belongs moved too — otherwise a second
    // relocation would have the wrong anchor to rewrite FROM.
    expect(flowDoc().plan_dir).toBe(ARCHIVE_DIR);
  });

  it('rebuilds the sibling markdown as part of the same move', async () => {
    await buildRepo();
    archiveMove();
    await runCliIn(root, [
      'flow',
      'relocate',
      '--path',
      '.harness/flows/archive-me.json',
      '--to',
      ARCHIVE_DIR,
    ]);

    const check = await runCliIn(root, [
      'flow',
      'render',
      '--path',
      '.harness/flows/archive-me.json',
      '--check',
    ]);
    expect(check.code).toBe(0);
    expect((check.envelope?.data as { drift: boolean }).drift).toBe(false);
  });

  it('leaves addresses that point OUTSIDE the moved folder alone', async () => {
    await buildRepo();
    // A gate deliberately citing something elsewhere in the repo did not move.
    const doc = flowDoc() as unknown as {
      nodes: Array<{ id: string; dd_link?: { address: string } }>;
    };
    const outsider = doc.nodes.find((node) => node.dd_link !== undefined);
    if (outsider?.dd_link === undefined) throw new Error('fixture lost its gate');
    outsider.dd_link.address = 'docs/how/dd/exemplar/plan.dd.json#acceptance_criteria';
    writeFileSync(
      join(root, '.harness/flows/archive-me.json'),
      `${JSON.stringify(doc, null, 2)}\n`,
      'utf8',
    );
    archiveMove();

    await runCliIn(root, [
      'flow',
      'relocate',
      '--path',
      '.harness/flows/archive-me.json',
      '--to',
      ARCHIVE_DIR,
    ]);

    expect(gateAddresses()).toContain('docs/how/dd/exemplar/plan.dd.json#acceptance_criteria');
  });

  it('is DISCOVERABLE from flow list — the archive step can find the flow it must move', async () => {
    await buildRepo();
    const listed = await runCliIn(root, ['flow', 'list']);

    expect(listed.code).toBe(0);
    const flows = (
      listed.envelope?.data as { flows: Array<{ slug: string; plan_dir: string | null }> }
    ).flows;
    // The post-flight stage picks its flow by matching plan_dir to the folder it
    // is archiving. Without this field the instruction is unfollowable, and the
    // relocate silently never runs.
    expect(flows.find((flow) => flow.plan_dir === PLAN_DIR)?.slug).toBe('archive-me');
  });

  it('REFUSES a flow with no plan_dir — there is no anchor to rewrite from', async () => {
    await buildRepo();
    const doc = flowDoc() as unknown as Record<string, unknown>;
    doc.plan_dir = undefined;
    writeFileSync(
      join(root, '.harness/flows/archive-me.json'),
      `${JSON.stringify(doc, null, 2)}\n`,
      'utf8',
    );

    const relocated = await runCliIn(root, [
      'flow',
      'relocate',
      '--path',
      '.harness/flows/archive-me.json',
      '--to',
      ARCHIVE_DIR,
    ]);

    expect(relocated.code).not.toBe(0);
    expect(relocated.envelope?.error?.code).toBe('E108');
    expect(relocated.envelope?.error?.message).toContain('no plan_dir');
  });

  it('REFUSES an absolute or repo-escaping --to, exactly as --plan-dir does', async () => {
    await buildRepo();
    for (const bad of ['/tmp/elsewhere', '../outside-the-repo']) {
      const relocated = await runCliIn(root, [
        'flow',
        'relocate',
        '--path',
        '.harness/flows/archive-me.json',
        '--to',
        bad,
      ]);
      expect(relocated.code).not.toBe(0);
      expect(relocated.envelope?.error?.code).toBe('E108');
      expect(relocated.envelope?.error?.message).toContain('--to');
      // Nothing was written on a refusal.
      expect(flowDoc().plan_dir).toBe(PLAN_DIR);
    }
  });
});
