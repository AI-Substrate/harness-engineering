import { readFileSync } from 'node:fs';
import { buildPlanScaffold } from '../../src/acts/plan/scaffold.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { type ExecScript, FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import { builderFailure, sha256 } from '../../src/services/builder/records.js';
import type {
  AckReceipt,
  AllocationRecord,
  BaselineReceipt,
  CheckReceipt,
  CompositionReceipt,
  DispatchReceipt,
  FileDigest,
  Guide,
  Packet,
  PreservationReceipt,
  ReviewReceipt,
  RoleBinding,
  RuntimeObservation,
  TidyDeps,
  Unit,
} from '../../src/services/builder/types.js';

export const BUILDER_FIXTURE_PLAN = 'docs/plans/001-example/plan.dd.json';
export const BUILDER_FIXTURE_GUIDE = 'docs/plans/001-example/assets/impl-guide.dd.json';
export const BUILDER_FIXTURE_SHA = 'a'.repeat(40);
export const BUILDER_FIXTURE_TIME = '2026-09-05T00:00:00.000Z';
const schemaNames = ['plan', 'impl-guide', 'allocation', 'packet', 'team', 'backpressure'];
const schemaFiles = Object.fromEntries(
  schemaNames.map((name) => [
    name,
    readFileSync(
      new URL(`../../../../.dd/schemas/builder/${name}/schema.json`, import.meta.url),
      'utf8',
    ),
  ]),
);

export function fixtureDigest(path: string, contents: string = path): FileDigest {
  return { path, sha256: sha256(contents) };
}
export function fixtureCheck(overrides: Partial<CheckReceipt> = {}): CheckReceipt {
  return {
    id: 'vd-0001',
    command: 'node',
    args: ['check.mjs'],
    cwd: '/repo',
    exit_code: 0,
    stdout: 'checked',
    stderr: '',
    recorded_at: BUILDER_FIXTURE_TIME,
    ...overrides,
  };
}
export function fixtureRole(
  role: 'coder' | 'reviewer' = 'coder',
  overrides: Partial<RoleBinding> = {},
): RoleBinding {
  return {
    role,
    harness: 'omp',
    model: role === 'coder' ? 'github-copilot/gpt-6-astra' : 'github-copilot/claude-opus-5',
    source: { harness: 'guide', model: 'guide' },
    ...overrides,
  };
}
export function fixtureObservation(
  overrides: Partial<RuntimeObservation> = {},
): RuntimeObservation {
  return {
    peer_id: 'peer-coder',
    root: '/workers/example',
    ready: true,
    harness: 'omp',
    model: 'github-copilot/gpt-6-astra',
    native_session: 'native-example',
    evidence: ['native relative-read canary'],
    gaps: ['provider-served-model-attestation'],
    ...overrides,
  };
}
export function fixtureUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'tk-0002',
    name: 'Parser',
    role: 'coder',
    responsibility: 'Turn source text into the frozen document model.',
    paths: ['src/parser.ts', 'test/parser.test.ts'],
    reads: [{ owner: 'tk-0001', paths: ['contracts.ts'] }],
    interface: 'parse(source: string): Document',
    depends_on: ['tk-0001'],
    wave: 1,
    acceptance: ['../plan.dd.json#acceptance_criteria/ac-0001'],
    proof: ['impl-guide.dd.json#checks/vd-0002'],
    ...overrides,
  };
}
export function fixtureGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    meta: { title: 'Parser and renderer delivery', plan: '../plan.dd.json#meta', version: 1 },
    architecture: {
      principles: 'A shared immutable document model separates parsing from rendering.',
      composition_root: 'src/main.ts, owned by the PM',
      contracts: ['contracts.ts exports Document, parse and render signatures.'],
    },
    fan_out: {
      decision: 'coders',
      rationale:
        'Parsing and rendering consume the same frozen model and do not read sibling implementations.',
    },
    capabilities: [
      {
        id: 'cp-0001',
        criterion: '../plan.dd.json#acceptance_criteria/ac-0001',
        owner: 'tk-0002',
        path: 'CLI parses input through the parser.',
        proof: ['impl-guide.dd.json#checks/vd-0002'],
      },
      {
        id: 'cp-0002',
        criterion: '../plan.dd.json#acceptance_criteria/ac-0002',
        owner: 'tk-0003',
        path: 'CLI renders the parsed document through the renderer.',
        proof: ['impl-guide.dd.json#checks/vd-0003'],
      },
    ],
    units: [
      fixtureUnit({
        id: 'tk-0001',
        name: 'Contracts',
        role: 'pm',
        responsibility: 'Freeze the shared document model.',
        paths: ['contracts.ts'],
        reads: [],
        interface: 'Document and role-independent fixture contract',
        depends_on: [],
        wave: 0,
        acceptance: [],
        proof: ['impl-guide.dd.json#checks/vd-0001'],
      }),
      fixtureUnit(),
      fixtureUnit({
        id: 'tk-0003',
        name: 'Renderer',
        responsibility: 'Render the shared document model.',
        paths: ['src/renderer.ts', 'test/renderer.test.ts'],
        interface: 'render(document: Document): Uint8Array',
        acceptance: ['../plan.dd.json#acceptance_criteria/ac-0002'],
        proof: ['impl-guide.dd.json#checks/vd-0003'],
      }),
      fixtureUnit({
        id: 'tk-0004',
        name: 'Composition',
        role: 'pm',
        responsibility: 'Wire parsing and rendering into the CLI.',
        paths: ['src/main.ts'],
        reads: [
          { owner: 'tk-0002', paths: ['src/parser.ts'] },
          { owner: 'tk-0003', paths: ['src/renderer.ts'] },
        ],
        interface: 'CLI input to rendered output',
        depends_on: ['tk-0001', 'tk-0002', 'tk-0003'],
        wave: 2,
        acceptance: [],
        proof: ['impl-guide.dd.json#checks/vd-0004'],
      }),
    ],
    baseline: {
      files: ['contracts.ts'],
      proof: ['impl-guide.dd.json#checks/vd-0001'],
      receipt: 'team/baseline.dd.json',
    },
    isolation: {
      mode: 'clone-per-coder',
      allocation_owner: 'harness',
      note: 'Distinct native roots; workspace kind is not ownership.',
    },
    roles: [
      { id: 'rl-0001', role: 'coder', harness: 'omp', model: 'github-copilot/gpt-6-astra' },
      {
        id: 'rl-0002',
        role: 'reviewer',
        harness: 'omp',
        model: 'github-copilot/claude-opus-5',
        effort: 'high',
      },
    ],
    checks: ['contracts', 'parser', 'renderer', 'integration'].map((name, index) => ({
      id: `vd-000${index + 1}`,
      description: `Exercise ${name}`,
      command: 'node',
      args: [`test/${name}.mjs`],
      cwd: '.',
      timeout_ms: 30000,
    })),
    composition: {
      owner: 'tk-0004',
      order: ['tk-0002', 'tk-0003'],
      steps: ['Import fenced commits.', 'Wire, commit and exercise the CLI.'],
      proof: ['impl-guide.dd.json#checks/vd-0004'],
    },
    review: {
      when: 'Before baseline sealing and after committed composition.',
      inputs: ['plan', 'guide', 'committed subject'],
      proof: ['Independent review bound to the exact subject SHA and input digests.'],
    },
    ...overrides,
  };
}
export function fixtureAllocation(overrides: Partial<AllocationRecord> = {}): AllocationRecord {
  return {
    record_type: 'allocation',
    id: 'al-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    owner: 'harness',
    kind: 'clone',
    purpose: 'unit',
    root: '/workers/example',
    authority_root: '/repo',
    git_dir: '/workers/example/.git',
    branch: 'builder/example/parser',
    base_sha: BUILDER_FIXTURE_SHA,
    ordinal: 1,
    slug: 'example',
    actor: 'peer-pm',
    journal: ['reserved', 'workspace-created'],
    plan_path: BUILDER_FIXTURE_PLAN,
    parent_id: 'al-0000',
    unit_id: 'tk-0002',
    ...overrides,
  };
}
export function fixtureBaseline(overrides: Partial<BaselineReceipt> = {}): BaselineReceipt {
  return {
    record_type: 'baseline',
    id: 'bl-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    source_sha: BUILDER_FIXTURE_SHA,
    plan: fixtureDigest(BUILDER_FIXTURE_PLAN),
    guide: fixtureDigest(BUILDER_FIXTURE_GUIDE),
    files: [fixtureDigest('contracts.ts')],
    checks: [fixtureCheck()],
    review: fixtureDigest('docs/plans/001-example/assets/team/review-decomposition.dd.json'),
    ...overrides,
  };
}
export function fixturePacket(overrides: Partial<Packet> = {}): Packet {
  return {
    record_type: 'packet',
    id: 'pk-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    nonce: 'packet-nonce',
    unit: fixtureUnit(),
    plan: fixtureDigest(BUILDER_FIXTURE_PLAN),
    guide: fixtureDigest(BUILDER_FIXTURE_GUIDE),
    baseline: fixtureDigest('docs/plans/001-example/assets/team/baseline.dd.json'),
    allocation: fixtureDigest('.git/harness/builder/allocations/al-0001.dd.json'),
    workspace: '/workers/example',
    parent: 'peer-pm',
    requested: fixtureRole(),
    forbidden: ['.the-flow-state.json', 'the-flow.json', 'the-flow.md'],
    canary: { path: 'canary.txt' },
    instructions: ['Read the packet and acknowledge before making changes.'],
    ...overrides,
  };
}
export function fixtureAck(overrides: Partial<AckReceipt> = {}): AckReceipt {
  return {
    record_type: 'ack',
    id: 'ak-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    unit_id: 'tk-0002',
    peer_id: 'peer-coder',
    nonce: 'packet-nonce',
    packet_sha256: sha256('packet'),
    baseline_sha: BUILDER_FIXTURE_SHA,
    native_root: '/workers/example',
    shell_cwd: '/workers/example',
    canary_nonce: 'native-root-nonce',
    observed: fixtureObservation(),
    ...overrides,
  };
}
export function fixtureDispatch(overrides: Partial<DispatchReceipt> = {}): DispatchReceipt {
  return {
    record_type: 'dispatch',
    id: 'dp-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    unit_id: 'tk-0002',
    packet: fixtureDigest('packet.dd.json'),
    baseline: fixtureDigest('baseline.dd.json'),
    allocation: fixtureDigest('allocation.dd.json'),
    requested: fixtureRole(),
    observed: fixtureObservation(),
    seed_files: [fixtureDigest('canary.txt', 'native-root-nonce')],
    ...overrides,
  };
}
export function fixtureComposition(
  overrides: Partial<CompositionReceipt> = {},
): CompositionReceipt {
  return {
    record_type: 'composition',
    id: 'co-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    baseline: fixtureDigest('baseline.dd.json'),
    units: [
      {
        unit_id: 'tk-0002',
        peer_id: 'peer-coder',
        workspace: '/workers/example',
        commit_sha: 'b'.repeat(40),
        packet_sha256: sha256('packet'),
        baseline_sha: BUILDER_FIXTURE_SHA,
      },
    ],
    integration_sha: 'c'.repeat(40),
    files: [],
    checks: [],
    ...overrides,
  };
}
export function fixtureReview(overrides: Partial<ReviewReceipt> = {}): ReviewReceipt {
  return {
    record_type: 'review',
    id: 'rv-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    scope: 'decomposition',
    subject_sha: BUILDER_FIXTURE_SHA,
    plan: fixtureDigest(BUILDER_FIXTURE_PLAN),
    guide: fixtureDigest(BUILDER_FIXTURE_GUIDE),
    reviewer_id: 'peer-reviewer',
    requested: fixtureRole('reviewer', { effort: 'high' }),
    observed: fixtureObservation({
      peer_id: 'peer-reviewer',
      model: 'github-copilot/claude-opus-5',
      effort: 'high',
    }),
    verdict: 'approved',
    report: fixtureDigest('review.json'),
    findings: [],
    ...overrides,
  };
}
export function fixturePreservation(
  overrides: Partial<PreservationReceipt> = {},
): PreservationReceipt {
  return {
    record_type: 'preservation',
    id: 'pv-0001',
    recorded_at: BUILDER_FIXTURE_TIME,
    allocation_ids: ['al-0001'],
    source_root: '/workers/example',
    source_sha: BUILDER_FIXTURE_SHA,
    composed_sha: 'c'.repeat(40),
    archived_plan: '/workers/example/docs/plans/archive/001-example',
    survivor_root: '/survivor/example',
    retiring_roots: ['/workers/example'],
    inventory: [
      {
        source: '/workers/example/report.json',
        destination: '/survivor/example/report.json',
        sha256: sha256('{}'),
        bytes: 2,
        category: 'report',
      },
    ],
    refs: [
      {
        source_repo: '/workers/example',
        source_ref: 'HEAD',
        oid: BUILDER_FIXTURE_SHA,
        destination_repo: '/repo',
        destination_ref: 'refs/builder/preserved/al-0001',
      },
    ],
    ...overrides,
  };
}

export function builderFixture(
  files: Record<string, string> = {},
  scripts: Record<string, ExecScript> = {},
) {
  const plan = buildPlanScaffold({
    slug: 'example',
    title: 'Example',
    ordinal: 1,
    phases: ['Implementation'],
  });
  const guide = fixtureGuide();
  const draftGuide = {
    ...guide,
    capabilities: [],
    units: [],
    checks: [],
    baseline: { ...guide.baseline, files: [], proof: [] },
  };
  const templates: Record<string, string> = {
    'impl-guide.template.json': JSON.stringify({
      dd: { schema: 'builder/impl-guide' },
      sections: Object.entries(draftGuide).map(([name, value]) => ({ name, value })),
      references: [],
    }),
    'backpressure.template.json': JSON.stringify({
      dd: { schema: 'builder/backpressure' },
      sections: [
        {
          name: 'meta',
          value: {
            title: 'Backpressure draft',
            plan: '../plan.dd.json#meta',
            certainty: 'Partial',
          },
        },
        { name: 'rows', value: [] },
        { name: 'sensors', value: [] },
      ],
      references: [],
    }),
    'coder-packet.template.md':
      '# Coder briefing template\n\nBind scope and proof before release.\n',
    'reviewer-packet.template.md':
      '# Reviewer briefing template\n\nBind the exact subject and evidence.\n',
    'roles.template.json': JSON.stringify({
      coder: { harness: 'omp', model: 'fixture/coder' },
      reviewer: { harness: 'omp', model: 'fixture/reviewer' },
    }),
  };
  const seeded: Record<string, string> = {
    '/repo/contracts.ts': 'export interface Document { text: string }\n',
    [`/repo/${BUILDER_FIXTURE_PLAN}`]: plan.plan.json,
    [`/repo/${BUILDER_FIXTURE_GUIDE}`]: `${JSON.stringify({ dd: { schema: 'builder/impl-guide' }, sections: Object.entries(guide).map(([name, value]) => ({ name, value })) }, null, 2)}\n`,
  };
  for (const [name, text] of Object.entries(templates)) seeded[`/package/templates/${name}`] = text;
  for (const [name, text] of Object.entries(schemaFiles)) {
    seeded[`/repo/.dd/schemas/builder/${name}/schema.json`] = text;
    seeded[`/package/.dd/schemas/builder/${name}/schema.json`] = text;
  }
  for (const document of plan.taskFiles)
    seeded[`/repo/docs/plans/001-example/${document.relativePath}`] = document.json;
  const directories: Record<string, string[]> = {};
  directories['/package/templates'] = Object.keys(templates);
  for (const root of ['/repo', '/package']) {
    directories[`${root}/.dd`] = ['schemas'];
    directories[`${root}/.dd/schemas`] = ['builder'];
    directories[`${root}/.dd/schemas/builder`] = schemaNames;
    for (const name of schemaNames)
      directories[`${root}/.dd/schemas/builder/${name}`] = ['schema.json'];
  }
  const fs = new FakeFs({ ...seeded, ...files }, directories);
  for (const directory of Object.keys(directories)) fs.mkdirp(directory);
  fs.mkdirp('/repo');
  fs.mkdirp('/repo/.git');
  const clock = new FakeClock(BUILDER_FIXTURE_TIME);
  const exec = new FakeExec(scripts, clock);
  const env = new FakeEnv({}, '/empty-home');
  let nonce = 0;
  const deps: TidyDeps = {
    fs,
    exec,
    clock,
    env,
    repoRoot: '/repo',
    schemasDir: '/package/.dd/schemas/builder',
    templatesDir: '/package/templates',
    harness: { command: 'node', args: ['/package/harness/cli/bin/harness.js'] },
    ddocs: { command: '/package/node_modules/.bin/ddocs', args: [] },
    pij: { command: 'pij-rs', args: [] },
    nonce: () => `nonce-${++nonce}`,
    peerReleased: async () =>
      builderFailure(
        ErrorCodes.BUILDER_RUNTIME,
        'Peer-release observation is unavailable in this fixture.',
        'Inject an observed release capability before testing managed-peer teardown.',
      ),
  };
  return { deps, fs, exec, clock, env, guide };
}
