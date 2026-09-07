import { describe, expect, it } from 'vitest';
import {
  sha256,
  writeBuilderDocument,
  writeBuilderRecord,
} from '../../src/services/builder/records.js';
import { selfCheckBuilderPacket } from '../../src/services/builder/self-check-service.js';
import type { BuilderResult, Packet, SelfCheckInput } from '../../src/services/builder/types.js';
import {
  BUILDER_FIXTURE_SHA,
  builderFixture,
  fixtureBaseline,
  fixturePacket,
} from '../fixtures/builder-contracts.js';

function value<T>(result: BuilderResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function scenario(historical = false) {
  const git = { code: 0, stdout: `/repo\n${BUILDER_FIXTURE_SHA}\n` };
  const fixture = builderFixture({}, { 'git rev-parse --show-toplevel HEAD': git });
  const { deps, fs } = fixture;
  const baseline = value(writeBuilderRecord(deps, '/repo/baseline.dd.json', fixtureBaseline()));
  const record: Packet = fixturePacket({ workspace: '/repo', baseline: baseline.ref });
  if (historical) {
    delete record.source_sha;
    record.canary = { path: 'historical-canary.txt' };
  }
  const packet = historical
    ? {
        ref: value(
          writeBuilderDocument(deps, '/repo/packet.dd.json', {
            dd: { schema: 'builder/packet' },
            sections: [{ name: 'packet', value: record }],
            references: [],
          }),
        ).ref,
        value: record,
      }
    : value(writeBuilderRecord(deps, '/repo/packet.dd.json', record));
  const input = { packet: packet.ref.path, sha256: packet.ref.sha256 };
  async function check(selected: SelfCheckInput = input) {
    const before = {
      writes: [...fs.writes],
      mkdirs: [...fs.mkdirs],
      deletes: [...fs.deletes],
      renames: [...fs.renames],
      appends: [...fs.appends],
      removedDirs: [...fs.removedDirs],
    };
    const result = value(await selfCheckBuilderPacket(deps, selected));
    expect({
      writes: fs.writes,
      mkdirs: fs.mkdirs,
      deletes: fs.deletes,
      renames: fs.renames,
      appends: fs.appends,
      removedDirs: fs.removedDirs,
    }).toEqual(before);
    expect(fixture.exec.calls.every((call) => call.command === 'git')).toBe(true);
    return result;
  }
  return { ...fixture, baseline, packet, input, check, git };
}

describe('Builder advisory packet self-check', () => {
  it('observes the selected packet, root and HEAD without reading unrelated references or mutating state', async () => {
    const s = scenario();
    s.fs.deleteFile('/repo/baseline.dd.json');
    s.fs.reads.length = 0;
    const report = await s.check();
    expect(report).toEqual({
      packet: s.input.packet,
      expected: {
        packet_sha256: s.packet.ref.sha256,
        root: '/repo',
        source_sha: BUILDER_FIXTURE_SHA,
      },
      observed: {
        packet_sha256: s.packet.ref.sha256,
        root: '/repo',
        source_sha: BUILDER_FIXTURE_SHA,
      },
      warnings: [],
    });
    expect(s.fs.reads.every((path) => path === '/repo/packet.dd.json')).toBe(true);
    expect(s.exec.calls).toHaveLength(1);
  });

  it('returns simultaneous root, HEAD and digest mismatches as named warnings with actual observations', async () => {
    const s = scenario();
    const head = 'b'.repeat(40);
    s.git.stdout = `/different-root\n${head}\n`;
    const report = await s.check({ ...s.input, sha256: '0'.repeat(64) });
    expect(report.observed).toEqual({
      packet_sha256: s.packet.ref.sha256,
      root: '/different-root',
      source_sha: head,
    });
    expect(report.expected.source_sha).toBe(BUILDER_FIXTURE_SHA);
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      'packet-digest-mismatch',
      'root-mismatch',
      'source-mismatch',
    ]);
    expect(report.warnings.every((warning) => warning.message && warning.next_action)).toBe(true);
  });

  it.each([
    ['c:\\work\\repo', 'C:/work/repo'],
    ['\\\\server\\share\\repo', '//server/share/repo'],
  ])('compares native root %s in the shared logical path format', async (workspace, observed) => {
    const s = scenario();
    const doc = JSON.parse(s.fs.readText('/repo/packet.dd.json')!);
    doc.sections[0].value.workspace = workspace;
    const text = JSON.stringify(doc);
    s.fs.writeText('/repo/packet.dd.json', text);
    s.git.stdout = `${observed}\n${BUILDER_FIXTURE_SHA}\n`;
    const report = await s.check({ ...s.input, sha256: sha256(text) });
    expect(report.expected.root).toBe(observed);
    expect(report.observed.root).toBe(observed);
    expect(report.warnings).toEqual([]);
  });

  it.each([
    'missing',
    'symlink',
    'non-file',
    'oversize',
  ] as const)('reports an unavailable %s packet without inventing a digest or expected checkout', async (kind) => {
    const s = scenario();
    if (kind === 'missing') s.fs.deleteFile('/repo/packet.dd.json');
    if (kind === 'symlink') s.fs.symlinkPaths.add('/repo/packet.dd.json');
    if (kind === 'non-file') s.fs.nonRegularPaths.add('/repo/packet.dd.json');
    if (kind === 'oversize') s.fs.reportedSizes.set('/repo/packet.dd.json', 4 * 1024 * 1024 + 1);
    const report = await s.check();
    expect(report.warnings.map((warning) => warning.code)).toEqual(['packet-unavailable']);
    expect(report.observed.packet_sha256).toBeUndefined();
    expect(report.expected.root).toBeUndefined();
    expect(report.expected.source_sha).toBeUndefined();
  });

  it('reports invalid packet contents but still measures the selected bytes', async () => {
    const s = scenario();
    const contents = '{not-json';
    s.fs.writeText('/repo/packet.dd.json', contents);
    const report = await s.check();
    expect(report.observed.packet_sha256).toBe(sha256(contents));
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      'packet-digest-mismatch',
      'packet-invalid',
    ]);
    expect(report.expected.root).toBeUndefined();
  });

  it('hashes invalid UTF-8 as exact bytes rather than replacement-decoded text', async () => {
    const s = scenario();
    const contents = Uint8Array.of(0x7b, 0x22, 0xff, 0x22, 0x7d);
    s.fs.writeBytes('/repo/packet.dd.json', contents);
    const digest = sha256(contents);
    const report = await s.check({ ...s.input, sha256: digest });
    expect(report.observed.packet_sha256).toBe(digest);
    expect(report.warnings.map((warning) => warning.code)).toEqual(['packet-invalid']);
    expect(report.expected.source_sha).toBeUndefined();
  });

  it('inspects only the explicitly selected external packet without following its other references', async () => {
    const s = scenario();
    s.fs.mkdirp('/outside');
    s.fs.writeText('/outside/selected.dd.json', s.fs.readText('/repo/packet.dd.json')!);
    s.fs.reads.length = 0;
    const report = await s.check({ ...s.input, packet: '/outside/selected.dd.json' });
    expect(report.warnings).toEqual([]);
    expect(report.observed.packet_sha256).toBe(s.packet.ref.sha256);
    expect(s.fs.reads.every((path) => path === '/outside/selected.dd.json')).toBe(true);
  });

  it.each([
    'failure',
    'malformed',
    'exception',
  ] as const)('reports unavailable Git inspection after %s without a fabricated root or HEAD', async (kind) => {
    const s = scenario();
    s.git.code = kind === 'failure' ? 1 : 0;
    s.git.stdout = '/repo\nnot-a-commit\n';
    if (kind === 'exception')
      s.deps.exec = {
        run: async (command, args, options) => {
          await s.exec.run(command, args, options);
          throw new Error('Git executable unavailable');
        },
      };
    const report = await s.check();
    expect(report.warnings.map((warning) => warning.code)).toEqual(['git-unavailable']);
    expect(report.observed.root).toBeUndefined();
    expect(report.observed.source_sha).toBeUndefined();
    expect(report.observed.packet_sha256).toBe(s.packet.ref.sha256);
  });

  it('recovers a historical source only from its in-root digest-bound baseline', async () => {
    const s = scenario(true);
    const report = await s.check();
    expect(report.expected.source_sha).toBe(BUILDER_FIXTURE_SHA);
    expect(report.warnings).toEqual([]);
  });

  it.each([
    'missing',
    'outside',
    'changed',
    'invalid',
    'symlink',
  ] as const)('does not infer historical source from a %s baseline', async (kind) => {
    const s = scenario(true);
    let input = s.input;
    if (kind === 'missing') s.fs.deleteFile('/repo/baseline.dd.json');
    if (kind === 'changed') s.fs.writeText('/repo/baseline.dd.json', '{}');
    if (kind === 'symlink') s.fs.symlinkPaths.add('/repo/baseline.dd.json');
    if (kind === 'outside' || kind === 'invalid') {
      const ref =
        kind === 'outside'
          ? { path: '/repo-other/baseline.dd.json', sha256: s.baseline.ref.sha256 }
          : { path: 'baseline.dd.json', sha256: sha256('{}') };
      if (kind === 'invalid') s.fs.writeText('/repo/baseline.dd.json', '{}');
      const changed = value(
        writeBuilderDocument(
          s.deps,
          '/repo/packet.dd.json',
          {
            dd: { schema: 'builder/packet' },
            sections: [{ name: 'packet', value: { ...s.packet.value, baseline: ref } }],
            references: [],
          },
          { expectedSha256: s.packet.ref.sha256 },
        ),
      );
      input = { packet: changed.ref.path, sha256: changed.ref.sha256 };
    }
    s.fs.reads.length = 0;
    const report = await s.check(input);
    const expected =
      kind === 'outside'
        ? 'baseline-outside-root'
        : kind === 'changed'
          ? 'baseline-digest-mismatch'
          : kind === 'invalid'
            ? 'baseline-invalid'
            : 'baseline-unavailable';
    expect(report.warnings.map((warning) => warning.code)).toEqual([expected]);
    expect(report.expected.source_sha).toBeUndefined();
    expect(s.fs.reads.some((path) => path.startsWith('/repo-other/'))).toBe(false);
  });
});
