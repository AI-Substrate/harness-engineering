import { describe, expect, it } from 'vitest';
import { FakeRemoteTelemetryGit } from '../../../src/adapters/git/fake-remote-telemetry-git.js';
import type {
  RemoteAdvertisementResult,
  RemoteRepository,
  TelemetrySnapshot,
} from '../../../src/adapters/git/remote-telemetry-git-port.js';
import {
  compareUnsignedUtf8,
  groupTelemetryAdvertisements,
  isCommitInInclusiveInterval,
  parseTelemetryAdvertisement,
  type SelectableTelemetrySession,
  selectTelemetrySessionGroups,
  selectTelemetrySnapshotCandidates,
} from '../../../src/services/telemetry/remote-selection.js';

const repo = (key: string, identity = `https://example.com/${key}`): RemoteRepository => ({
  key,
  identity,
  transportUrl: identity,
});

const oid = (ch: string): string => ch.repeat(40);

describe('strict telemetry advertisement parsing', () => {
  it('parses a valid namespace/ref date/safe terminal id and normalizes the OID', () => {
    expect(
      parseTelemetryAdvertisement({
        name: 'refs/harness-telemetry/2026/07/16/session.A-1',
        oid: oid('A'),
      }),
    ).toEqual({
      ok: true,
      value: {
        name: 'refs/harness-telemetry/2026/07/16/session.A-1',
        oid: oid('a'),
        sessionId: 'session.A-1',
        refDate: '2026-07-16',
      },
    });
  });

  it('keeps a safe ref with an invalid/unknown encoded date but never guesses one', () => {
    const result = parseTelemetryAdvertisement({
      name: 'refs/harness-telemetry/not/a/date/session-1',
      oid: oid('b'),
    });
    expect(result).toMatchObject({ ok: true, value: { sessionId: 'session-1', refDate: null } });
  });

  it.each([
    { name: 'refs/heads/main', oid: oid('a') },
    { name: 'refs/harness-telemetry/2026/07/16/two words', oid: oid('a') },
    { name: 'refs/harness-telemetry/2026/07/16/a/bad/session', oid: 'xyz' },
    { name: `refs/harness-telemetry/2026/07/16/${'x'.repeat(257)}`, oid: oid('a') },
  ])('rejects malformed name/OID with a non-echoing reason', (input) => {
    const result = parseTelemetryAdvertisement(input);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(input.name);
    expect(JSON.stringify(result)).not.toContain(input.oid);
  });
});

describe('repository-scoped deterministic grouping', () => {
  it('groups duplicate terminal ids only within a repository and sorts repositories/sessions/refs by unsigned UTF-8 bytes', () => {
    const rows = [
      { repository: repo('repo-b'), name: 'refs/harness-telemetry/2026/07/02/same', oid: oid('b') },
      { repository: repo('repo-a'), name: 'refs/harness-telemetry/2026/07/03/z', oid: oid('c') },
      { repository: repo('repo-a'), name: 'refs/harness-telemetry/2026/07/02/same', oid: oid('d') },
      { repository: repo('repo-a'), name: 'refs/harness-telemetry/2026/07/01/same', oid: oid('a') },
    ];
    const forward = groupTelemetryAdvertisements(rows);
    const shuffled = groupTelemetryAdvertisements([rows[2], rows[0], rows[3], rows[1]]);
    expect(shuffled).toEqual(forward);
    expect(forward.map((group) => `${group.repository.key}:${group.sessionId}`)).toEqual([
      'repo-a:same',
      'repo-a:z',
      'repo-b:same',
    ]);
    expect(forward[0]?.refs.map((ref) => ref.name)).toEqual([
      'refs/harness-telemetry/2026/07/01/same',
      'refs/harness-telemetry/2026/07/02/same',
    ]);
    expect(forward[0]?.gaps).toEqual(['duplicate_session_identity']);
    expect(forward[2]?.gaps).toEqual([]);
  });

  it('compares UTF-8 as unsigned bytes rather than locale order', () => {
    expect(compareUnsignedUtf8('A', 'a')).toBeLessThan(0);
    expect(compareUnsignedUtf8('z', 'é')).toBeLessThan(0);
    expect(compareUnsignedUtf8('same', 'same')).toBe(0);
  });
});

describe('pre-fetch selector candidates', () => {
  it('fetches whole matching date groups, leaves unknown-only groups unresolved, and skips known-out-of-range groups', () => {
    const repository = repo('repo-a');
    const groups = groupTelemetryAdvertisements([
      {
        repository,
        name: 'refs/harness-telemetry/2026/07/10/matched',
        oid: oid('a'),
      },
      {
        repository,
        name: 'refs/harness-telemetry/2026/06/01/matched',
        oid: oid('b'),
      },
      {
        repository,
        name: 'refs/harness-telemetry/not/a/date/unknown',
        oid: oid('c'),
      },
      {
        repository,
        name: 'refs/harness-telemetry/2026/06/01/outside',
        oid: oid('d'),
      },
    ]);
    const result = selectTelemetrySnapshotCandidates(groups, {
      kind: 'date',
      from: '2026-07-10',
      to: '2026-07-10',
    });
    expect(result.candidates.map((group) => group.sessionId)).toEqual(['matched']);
    expect(result.candidates[0]?.refs).toHaveLength(2);
    expect(result.unresolved.map((group) => group.sessionId)).toEqual(['unknown']);
    expect(result.candidates.flatMap((group) => group.refs).map((ref) => ref.name)).not.toContain(
      'refs/harness-telemetry/2026/06/01/outside',
    );
  });

  it('fetches every group for inventory and commit selectors, but only the exact group for session selectors', () => {
    const repository = repo('repo-a');
    const groups = groupTelemetryAdvertisements([
      { repository, name: 'refs/harness-telemetry/2026/07/10/a', oid: oid('a') },
      { repository, name: 'refs/harness-telemetry/2026/07/10/b', oid: oid('b') },
    ]);
    expect(selectTelemetrySnapshotCandidates(groups, null).candidates).toHaveLength(2);
    expect(
      selectTelemetrySnapshotCandidates(groups, {
        kind: 'commit',
        from: oid('0'),
        to: oid('f'),
      }).candidates,
    ).toHaveLength(2);
    expect(
      selectTelemetrySnapshotCandidates(groups, { kind: 'session', session: 'a' }).candidates.map(
        (group) => group.sessionId,
      ),
    ).toEqual(['a']);
  });
});

describe('whole-session selector boundaries', () => {
  const group = (
    sessionId: string,
    dates: Array<string | null>,
    product: SelectableTelemetrySession['product'],
  ): SelectableTelemetrySession => ({
    repository: repo('repo-a'),
    sessionId,
    refs: dates.map((date, index) => ({
      name: `refs/harness-telemetry/${date?.replaceAll('-', '/') ?? 'unknown/date/value'}/${sessionId}`,
      oid: oid(String((index + 1) % 10)),
      sessionId,
      refDate: date,
    })),
    gaps: dates.length > 1 ? ['duplicate_session_identity'] : [],
    product,
  });

  it('uses inclusive exact/date boundaries and selects the complete duplicate-ref group', () => {
    const groups = [
      group('s1', ['2026-07-01', '2026-07-10'], { state: 'unavailable', commits: null }),
      group('s2', ['2026-07-11'], { state: 'unavailable', commits: null }),
    ];
    expect(
      selectTelemetrySessionGroups(groups, { kind: 'session', session: 's1' }).selected[0]?.refs,
    ).toHaveLength(2);
    expect(
      selectTelemetrySessionGroups(groups, {
        kind: 'date',
        from: '2026-07-10',
        to: '2026-07-10',
      }).selected.map((item) => item.sessionId),
    ).toEqual(['s1']);
  });

  it('keeps unresolved date-only groups explicit and distinguishes complete from partial empty', () => {
    const known = group('known', ['2026-06-01'], { state: 'unavailable', commits: null });
    const unknown = group('unknown', [null], { state: 'unavailable', commits: null });
    const complete = selectTelemetrySessionGroups([known], {
      kind: 'date',
      from: '2026-07-01',
      to: '2026-07-02',
    });
    expect(complete).toMatchObject({ selected: [], unresolved: [], completeness: 'complete' });
    const partial = selectTelemetrySessionGroups([known, unknown], {
      kind: 'date',
      from: '2026-07-01',
      to: '2026-07-02',
    });
    expect(partial).toMatchObject({ selected: [], completeness: 'partial' });
    expect(partial.unresolved.map((item) => item.sessionId)).toEqual(['unknown']);
    expect(partial.gaps).toContainEqual({
      repositoryKey: 'repo-a',
      sessionId: 'unknown',
      ref: 'refs/harness-telemetry/unknown/date/value/unknown',
      reason: 'date_provenance_unavailable',
    });
  });

  it('selects a known intersection from partial provenance while keeping completeness partial', () => {
    const commit = oid('a');
    const result = selectTelemetrySessionGroups(
      [group('partial', ['2026-07-01'], { state: 'partial', commits: [commit] })],
      { kind: 'commit', from: oid('0'), to: oid('f') },
      { 'repo-a': { [commit]: true } },
    );
    expect(result.selected.map((item) => item.sessionId)).toEqual(['partial']);
    expect(result.completeness).toBe('partial');
    expect(result.gaps).toContainEqual({
      repositoryKey: 'repo-a',
      sessionId: 'partial',
      ref: 'refs/harness-telemetry/2026/07/01/partial',
      reason: 'commit_provenance_unavailable',
    });
  });

  it('keeps same-OID commit membership independent per repository', () => {
    const commit = oid('a');
    const a = {
      ...group('a', ['2026-07-01'], { state: 'known' as const, commits: [commit] }),
      repository: repo('repo-a'),
    };
    const b = {
      ...group('b', ['2026-07-01'], { state: 'partial' as const, commits: [commit] }),
      repository: repo('repo-b'),
    };
    const selector = { kind: 'commit' as const, from: oid('0'), to: oid('f') };
    const membership = {
      'repo-a': { [commit]: true },
      'repo-b': { [commit]: false },
    };
    const forward = selectTelemetrySessionGroups([a, b], selector, membership);
    const reversed = selectTelemetrySessionGroups([b, a], selector, membership);
    expect(forward.selected.map((item) => item.repository.key)).toEqual(['repo-a']);
    expect(reversed.selected.map((item) => item.repository.key)).toEqual(['repo-a']);
    expect(forward.unresolved.map((item) => item.repository.key)).toEqual(['repo-b']);
    expect(forward.completeness).toBe('partial');
  });

  it('does not emit gaps for selector-irrelevant groups and keeps gap identities unique/sorted', () => {
    const selected = group('selected', ['2026-07-01', '2026-07-02'], {
      state: 'unavailable',
      commits: null,
    });
    const irrelevant = group('irrelevant', ['2026-07-01', '2026-07-02'], {
      state: 'unavailable',
      commits: null,
    });
    const result = selectTelemetrySessionGroups([irrelevant, selected], {
      kind: 'session',
      session: 'selected',
    });
    expect(result.gaps).toEqual([
      {
        repositoryKey: 'repo-a',
        sessionId: 'selected',
        ref: null,
        reason: 'duplicate_session_identity',
      },
    ]);
  });

  it('defines merge-aware inclusive membership as both ancestor predicates', () => {
    const calls: string[] = [];
    const ancestor = (from: string, to: string): boolean => {
      calls.push(`${from}->${to}`);
      return true;
    };
    expect(isCommitInInclusiveInterval(oid('a'), oid('0'), oid('f'), ancestor)).toBe(true);
    expect(calls).toEqual([`${oid('0')}->${oid('a')}`, `${oid('a')}->${oid('f')}`]);
    expect(isCommitInInclusiveInterval(oid('a'), oid('0'), oid('f'), () => false)).toBe(false);
  });
});

describe('FakeRemoteTelemetryGit', () => {
  it('returns seeded semantic evidence/failures and records exact calls', async () => {
    const repository = repo('repo-a');
    const advertisement: RemoteAdvertisementResult = {
      ok: true,
      refs: [{ name: 'refs/harness-telemetry/2026/07/16/s', oid: oid('a') }],
      malformedRefCount: 0,
    };
    const snapshot: TelemetrySnapshot = {
      repository,
      refs: [],
      effects: {
        advertisedRefs: 1,
        fetchedRefs: 0,
        telemetryBytes: 0,
        productGraphFetched: false,
        callerRepositoryMutated: false,
        disposableStoreRemoved: true,
      },
    };
    const git = new FakeRemoteTelemetryGit({
      advertisement,
      snapshot: { ok: true, snapshot },
      interval: { ok: true, membership: { [oid('a')]: true }, unavailable: [] },
    });

    await expect(git.advertiseTelemetryRefs(repository)).resolves.toEqual(advertisement);
    await expect(
      git.loadVerifiedTelemetrySnapshot({
        repository,
        advertisedRefs: advertisement.refs,
        candidateRefs: advertisement.refs,
      }),
    ).resolves.toEqual({ ok: true, snapshot });
    await expect(
      git.resolveProductCommitInterval({
        repository,
        from: oid('0'),
        to: oid('f'),
        candidates: [oid('a')],
      }),
    ).resolves.toMatchObject({ ok: true, membership: { [oid('a')]: true } });
    expect(git.calls.map((call) => call.kind)).toEqual(['advertise', 'snapshot', 'interval']);
  });
});
