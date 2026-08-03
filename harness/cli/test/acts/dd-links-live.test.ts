import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-03T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

/**
 * Drive the REAL Phase 4 acts over a REAL corpus in a temp directory.
 *
 * A temp directory rather than a tracked fixture, for one specific reason: the
 * doctor's sweep skips `test/**\/fixtures/**` by contract (OD-1), so a sweep
 * pointed at a committed fixture tree would report a clean run over nothing at
 * all. Outside that path the exclusion is exercised on purpose instead.
 */
async function runDd(argv: string[]): Promise<{ envelope: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]);
    code = process.exitCode ?? 0;
  } catch (error) {
    if (!/^exit:\d+$/.test(error instanceof Error ? error.message : '')) throw error;
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  return { envelope: JSON.parse(out.trim()) as Envelope, code };
}

const PLAN_SCHEMA = {
  dd_schema: 1,
  description: 'A plan with phases, tasks and citations',
  sections: {
    preamble: { shape: { type: 'text' } },
    phases: {
      required: true,
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'brief'],
          fields: {
            id: { type: 'string' },
            brief: { type: 'text' },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'state'],
                fields: {
                  id: { type: 'string' },
                  title: { type: 'text' },
                  state: { type: 'state' },
                  note: { type: 'text' },
                  evidence: { type: 'link', target: 'live/evidence/section/entries' },
                },
              },
            },
          },
        },
      },
    },
    citations: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'cite'],
          fields: { id: { type: 'string' }, cite: { type: 'link' } },
        },
      },
    },
  },
};

const EVIDENCE_SCHEMA = {
  dd_schema: 1,
  description: 'A flat list of evidence entries',
  sections: {
    entries: {
      required: true,
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'state'],
          fields: {
            id: { type: 'string' },
            state: { type: 'state' },
            note: { type: 'text' },
          },
        },
      },
    },
  },
};

let repo = '';
let previousCwd = '';

function write(relative: string, value: unknown): void {
  const path = join(repo, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha(relative: string): string {
  return createHash('sha256')
    .update(readFileSync(join(repo, relative), 'utf8'))
    .digest('hex');
}

function evidenceDoc(note: string) {
  return {
    dd: { schema: 'live/evidence', spec: 'dd@1' },
    sections: [{ name: 'entries', value: [{ id: 'ev-1a2b', state: 'checked', note }] }],
    references: [],
  };
}

function seedCorpus(): void {
  write('.dd/schemas/live/plan/schema.json', PLAN_SCHEMA);
  write('.dd/schemas/live/evidence/schema.json', EVIDENCE_SCHEMA);
  write('docs/evidence.dd.json', evidenceDoc('the first recorded state'));
  write('docs/plan.dd.json', {
    dd: { schema: 'live/plan', spec: 'dd@1' },
    sections: [
      { name: 'preamble', value: 'A live corpus, driven through the real acts.' },
      {
        name: 'phases',
        value: [
          {
            id: 'ph-1a2b',
            brief: 'Links, ledger and doctor',
            tasks: [
              {
                id: 'tk-3c4d',
                title: 'Resolve an address end to end',
                state: 'checked',
                evidence: 'evidence.dd.json#entries',
              },
            ],
          },
        ],
      },
      { name: 'citations', value: [{ id: 'ct-5e6f', cite: 'evidence.dd.json#entries/ev-1a2b' }] },
    ],
    references: [{ path: 'evidence.dd.json', sha: sha('docs/evidence.dd.json'), mode: 'pinned' }],
  });
  write('docs/cycle-a.dd.json', {
    dd: { schema: 'live/plan', spec: 'dd@1' },
    sections: [
      { name: 'phases', value: [{ id: 'ph-7081', brief: 'Half of the loop' }] },
      { name: 'citations', value: [{ id: 'ct-8192', cite: 'cycle-b.dd.json#phases/ph-92a3' }] },
    ],
    references: [],
  });
  write('docs/cycle-b.dd.json', {
    dd: { schema: 'live/plan', spec: 'dd@1' },
    sections: [
      { name: 'phases', value: [{ id: 'ph-92a3', brief: 'The other half of the loop' }] },
      { name: 'citations', value: [{ id: 'ct-a3b4', cite: 'cycle-a.dd.json#phases/ph-7081' }] },
    ],
    references: [],
  });
}

function writeBroken(sweepExclude: boolean): void {
  write('docs/broken.dd.json', {
    dd: { schema: 'live/evidence', spec: 'dd@1', ...(sweepExclude && { sweep_exclude: true }) },
    sections: [{ name: 'entries', value: [{ id: 'ev-9a1b', state: 'blocked' }] }],
    references: [],
  });
}

describe('dd links family — live over a real corpus', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'dd-links-live-'));
    seedCorpus();
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    // Every Phase 4 verb takes the repo root from process.cwd(), so the corpus
    // only means what it says while cwd is pinned to it (the P2 idiom).
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('AC-05: generate → validate → resolve round-trips a qualified address', async () => {
    const generated = await runDd([
      'dd',
      'address',
      'generate',
      'phases/ph-1a2b/tasks/tk-3c4d/title',
      '--path',
      'docs/plan.dd.json',
    ]);
    expect(generated.code).toBe(0);
    const address = (generated.envelope.data as { address: string }).address;
    expect(address).toBe('docs/plan.dd.json#phases/ph-1a2b/tasks/tk-3c4d/title');

    const syntax = await runDd(['dd', 'address', 'validate', address]);
    expect(syntax.code).toBe(0);
    expect(syntax.envelope.data).toMatchObject({ classified: false, form: 'qualified' });

    const classified = await runDd(['dd', 'address', 'validate', address, '--resolve']);
    expect(classified.code).toBe(0);
    expect(classified.envelope.data).toMatchObject({
      classified: true,
      segments: [
        { value: 'phases', kind: 'section' },
        { value: 'ph-1a2b', kind: 'instance' },
        { value: 'tasks', kind: 'part' },
        { value: 'tk-3c4d', kind: 'instance' },
        { value: 'title', kind: 'part' },
      ],
    });

    const resolved = await runDd(['dd', 'link', 'resolve', address]);
    expect(resolved.code).toBe(0);
    expect((resolved.envelope.data as { target: { value: unknown } }).target.value).toBe(
      'Resolve an address end to end',
    );
  });

  it('AC-05: the bare-# form generates and validates, and says why it cannot resolve alone', async () => {
    const generated = await runDd(['dd', 'address', 'generate', 'phases/ph-1a2b']);
    expect(generated.envelope.data).toMatchObject({ address: '#phases/ph-1a2b', form: 'bare' });

    const syntax = await runDd(['dd', 'address', 'validate', '#phases/ph-1a2b']);
    expect(syntax.code).toBe(0);

    const resolved = await runDd(['dd', 'link', 'resolve', '#phases/ph-1a2b']);
    expect(resolved.code).toBe(1);
    expect(resolved.envelope.error?.code).toBe('E430');
    expect(resolved.envelope.next_action).toContain('<path>#<interior>');
  });

  it('rejects a malformed address before it can reach the repository', async () => {
    const result = await runDd(['dd', 'address', 'generate', 'phases/ph-1a2b@deadbeef']);
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe('E405');
  });

  it('AC-06: verify-basis reads fresh, then stale after the target changes', async () => {
    const recorded = sha('docs/evidence.dd.json');
    const fresh = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      recorded,
    ]);
    expect(fresh.code).toBe(0);
    expect(fresh.envelope.status).toBe('ok');
    expect(fresh.envelope.data).toMatchObject({ state: 'fresh' });

    write('docs/evidence.dd.json', evidenceDoc('an upstream edit nobody told the citer about'));
    const stale = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      recorded,
    ]);
    expect(stale.code).toBe(0);
    expect(stale.envelope.status).toBe('degraded');
    expect(stale.envelope.data).toMatchObject({ state: 'stale', code: 'E434' });
  });

  it('AC-06: explicit re-verification moves the recorded basis and nothing else', async () => {
    const before = JSON.parse(readFileSync(join(repo, 'docs/plan.dd.json'), 'utf8'));
    const updated = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      before.references[0].sha,
      '--update',
      'docs/plan.dd.json',
    ]);
    expect(updated.code).toBe(0);
    expect(updated.envelope.data).toMatchObject({ state: 'stale', updated: true, mode: 'pinned' });

    const after = JSON.parse(readFileSync(join(repo, 'docs/plan.dd.json'), 'utf8'));
    expect(after.references[0].sha).toBe(sha('docs/evidence.dd.json'));
    expect(after.references[0].mode).toBe('pinned');
    expect(after.sections).toEqual(before.sections);

    const recheck = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      after.references[0].sha,
    ]);
    expect(recheck.envelope.data).toMatchObject({ state: 'fresh' });
  });

  it('T004: a THROWING adapter surfaces in the doctor sweep as a WARN, with the render E-code', async () => {
    // The seam Phase 4 left injectable and Phase 5 wires: the doctor repeats a
    // degraded render repo-wide (AC-04). `runtime-failed` is the class that
    // proves the collector RENDERS rather than merely loading \u2014 no load-time
    // check could ever discover an adapter that throws while rendering.
    const dir = 'adapters-gap';
    write(`.dd/schemas/live/report/schema.json`, {
      dd_schema: 1,
      description: 'One custom type whose adapter throws, one with no adapter at all.',
      sections: {
        meta: {
          required: true,
          shape: {
            type: 'object',
            required: ['title'],
            fields: {
              title: { type: 'string' },
              spent: { type: 'duration' },
              trend: { type: 'sparkline' },
            },
          },
        },
      },
    });
    mkdirSync(join(repo, '.dd/schemas/live/report/adapters'), { recursive: true });
    writeFileSync(
      join(repo, '.dd/schemas/live/report/adapters/duration.ts'),
      "export default function duration(): string {\n  throw new Error('adapter blew up');\n}\n",
      'utf8',
    );
    write(`${dir}/report.dd.json`, {
      dd: { schema: 'live/report', spec: 'dd@1' },
      sections: [{ name: 'meta', value: { title: 'Gap demo', spent: 4200, trend: [1, 2, 3] } }],
      references: [],
    });

    const swept = await runDd(['dd', 'doctor', '--path', dir]);
    expect(swept.code).toBe(0);
    expect(swept.envelope.status).toBe('degraded');
    const findings = (swept.envelope.data as { findings: Array<Record<string, unknown>> }).findings;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'adapter-gap',
          severity: 'WARN',
          adapterKind: 'runtime-failed',
          code: 'E425',
        }),
        expect.objectContaining({
          class: 'adapter-gap',
          severity: 'WARN',
          adapterKind: 'not-found',
          code: 'E423',
        }),
      ]),
    );

    rmSync(join(repo, dir), { recursive: true, force: true });
    rmSync(join(repo, '.dd/schemas/live/report'), { recursive: true, force: true });
  });

  it('T004: re-verification regenerates the touched document\u2019s sibling markdown', async () => {
    // `autoRegenerateSibling` shipped in Phase 3 with no call site, because every
    // dd verb until now was read-only. This is the first verb that MUTATES a
    // document, so it is the first that owes its `.dd.md` a regeneration \u2014 and
    // without it `dd build --check` would later report the ledger move as drift.
    const before = JSON.parse(readFileSync(join(repo, 'docs/plan.dd.json'), 'utf8'));
    write('docs/evidence.dd.json', evidenceDoc('another upstream edit'));

    const updated = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      before.references[0].sha,
      '--update',
      'docs/plan.dd.json',
    ]);
    expect(updated.code).toBe(0);
    expect(updated.envelope.data).toMatchObject({ updated: true, sibling_regenerated: true });

    // The sibling carries the NEW basis, and it is byte-identical to what
    // `dd build` itself would have produced \u2014 the drift gate agrees.
    const sibling = readFileSync(join(repo, 'docs/plan.dd.md'), 'utf8');
    expect(sibling).toContain(sha('docs/evidence.dd.json'));
    const check = await runDd(['dd', 'build', 'docs/plan.dd.json', '--check']);
    expect(check.code).toBe(0);
    expect(check.envelope.data).toMatchObject({ drift: false });
  });

  it('refuses to mint a ledger entry that was never recorded', async () => {
    const result = await runDd([
      'dd',
      'link',
      'verify-basis',
      'docs/evidence.dd.json#entries',
      '--sha',
      'whatever',
      '--update',
      'docs/cycle-a.dd.json',
    ]);
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe('E435');
    expect(result.envelope.next_action).toContain('never mints one');
  });

  it('AC-14: dd links reports inbound and outbound edges by local scan', async () => {
    const evidence = await runDd(['dd', 'links', 'docs/evidence.dd.json']);
    expect(evidence.code).toBe(0);
    const data = evidence.envelope.data as {
      counts: { inbound: number; outbound: number };
      inbound: { from: string }[];
    };
    expect(data.counts.outbound).toBe(0);
    expect(data.inbound.some((edge) => edge.from.endsWith('docs/plan.dd.json'))).toBe(true);

    const plan = await runDd(['dd', 'links', 'docs/plan.dd.json']);
    expect((plan.envelope.data as { counts: { outbound: number } }).counts.outbound).toBe(2);
  });

  it('AC-14: dd graph emits mermaid directly, and scopes without changing the radius', async () => {
    const graph = await runDd(['dd', 'graph']);
    expect(graph.code).toBe(0);
    const mermaid = (graph.envelope.data as { mermaid: string }).mermaid;
    expect(mermaid.startsWith('flowchart LR\n')).toBe(true);
    expect(mermaid).toContain('docs/plan.dd.json');
    expect(mermaid).toContain('-->');

    const scoped = await runDd(['dd', 'graph', '--path', 'docs']);
    expect(scoped.code).toBe(0);
    expect((scoped.envelope.data as { counts: { nodes: number } }).counts.nodes).toBeGreaterThan(0);
  });

  it('AC-07: doctor sweeps the cyclic corpus clean and terminates', async () => {
    const result = await runDd(['dd', 'doctor']);
    expect([0]).toContain(result.code);
    const data = result.envelope.data as {
      swept: number;
      counts: { error: number };
      findings: { class: string }[];
    };
    expect(data.swept).toBeGreaterThanOrEqual(4);
    expect(data.counts.error).toBe(0);
    expect(data.findings.some((finding) => finding.class === 'link-scan-failed')).toBe(false);
  });

  it('AC-07: an ERROR-class finding is error/exit 1 under E438; WARN-class stays degraded/exit 0', async () => {
    writeBroken(false);
    const errored = await runDd(['dd', 'doctor']);
    expect(errored.code).toBe(1);
    expect(errored.envelope.status).toBe('error');
    expect(errored.envelope.error?.code).toBe('E438');
    const findings = (
      errored.envelope.error?.details as {
        findings: { class: string; code: string }[];
      }
    ).findings;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class: 'state-note-required', code: 'E408' }),
      ]),
    );

    rmSync(join(repo, 'docs/broken.dd.json'));
    write('docs/warned.dd.json', {
      dd: { schema: 'live/plan', spec: 'dd@1' },
      sections: [
        { name: 'phases', value: [{ id: 'ph-b4c5', brief: 'Points at a file that is not there' }] },
        { name: 'citations', value: [{ id: 'ct-c5d6', cite: 'nowhere.dd.json#entries' }] },
      ],
      references: [],
    });
    const warned = await runDd(['dd', 'doctor']);
    expect(warned.code).toBe(0);
    expect(warned.envelope.status).toBe('degraded');
    expect((warned.envelope.data as { counts: { warn: number } }).counts.warn).toBeGreaterThan(0);
    rmSync(join(repo, 'docs/warned.dd.json'));
  });

  it('AC-15: the sweep honours the exclusion contract, and direct validation never does', async () => {
    writeBroken(true);
    const swept = await runDd(['dd', 'doctor']);
    expect(swept.code).toBe(0);
    expect(
      (swept.envelope.data as { findings: { owner: string }[] }).findings.some((finding) =>
        finding.owner.endsWith('docs/broken.dd.json'),
      ),
    ).toBe(false);

    // OD-1: pointing the validator straight at the same known-bad document still
    // fails. That is what lets a repository keep a bad corpus committed and a
    // green `harness checks` at the same time.
    const direct = await runDd(['dd', 'validate', 'docs/broken.dd.json', '--depth', '0']);
    expect(direct.code).toBe(1);
    expect(direct.envelope.error?.code).toBe('E408');
    rmSync(join(repo, 'docs/broken.dd.json'));
  });

  it('scopes the doctor sweep to a subtree', async () => {
    const scoped = await runDd(['dd', 'doctor', '--path', 'docs']);
    expect(scoped.code).toBe(0);
    expect((scoped.envelope.data as { root: string }).root.endsWith('/docs')).toBe(true);
  });
});
