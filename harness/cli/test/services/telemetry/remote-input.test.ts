import { describe, expect, it } from 'vitest';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import type { HashPort } from '../../../src/adapters/hash/hash-port.js';
import {
  canonicalizeRemoteRepository,
  parseRemoteRepositories,
  parseRemoteSelector,
  type RepositoryFileInput,
} from '../../../src/services/telemetry/remote-input.js';

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

class CollisionHash implements HashPort {
  sha256Hex(input: string | Uint8Array): string {
    const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    return `0123456789abcdef${text.includes('one') ? '1' : '2'}`.padEnd(64, '0');
  }
}

function file(path: string, contents: string | Uint8Array | null): RepositoryFileInput {
  return {
    path,
    bytes: typeof contents === 'string' ? utf8(contents) : contents,
  };
}

function generatedCredentialUsernames(): Array<{ label: string; value: string }> {
  return [
    { label: 'GitHub classic shape', value: `${['g', 'h', 'p'].join('')}_${'A'.repeat(20)}` },
    {
      label: 'GitHub fine-grained shape',
      value: `${['github', 'pat'].join('_')}_${'B'.repeat(20)}`,
    },
    { label: 'AWS access-key shape', value: `${['A', 'K', 'I', 'A'].join('')}${'C'.repeat(16)}` },
    {
      label: 'provider API-key shape',
      value: `${['s', 'k'].join('')}_${['li', 've'].join('')}_${'D'.repeat(16)}`,
    },
    { label: 'Google API-key shape', value: `${['AI', 'za'].join('')}${'E'.repeat(20)}` },
  ];
}

function percentEncodeEveryByte(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
    .join('');
}

function generatedEncodedUsernames(): Array<{ label: string; value: string }> {
  const direct = generatedCredentialUsernames()[0]?.value ?? '';
  const bearer = `${['Bear', 'er'].join('')} ${'F'.repeat(12)}`;
  const assignment = `${['to', 'ken'].join('')}=${'G'.repeat(12)}`;
  const privateKey = [['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '), 'H'].join('');
  return [
    { label: 'encoded safe username', value: percentEncodeEveryByte('deploy-user') },
    { label: 'encoded credential shape', value: percentEncodeEveryByte(direct) },
    { label: 'encoded bearer shape', value: percentEncodeEveryByte(bearer) },
    { label: 'encoded assignment shape', value: percentEncodeEveryByte(assignment) },
    { label: 'encoded private-key shape', value: percentEncodeEveryByte(privateKey) },
    { label: 'malformed percent escape', value: 'user%2' },
  ];
}

describe('remote repository inputs', () => {
  it('merges repeatable direct/file inputs, ignores trimmed comments/blanks/CRLF, canonicalizes, dedupes, and sorts by repository key', () => {
    const result = parseRemoteRepositories(
      {
        repos: ['HTTPS://Example.COM:443/Team/One.git/', 'git@example.com:Team/Two.git'],
        repoFiles: [
          file(
            '/inputs/repos.txt',
            '  # generated list\r\n\r\nhttps://example.com/Team/One\r\nssh://git@example.com/Team/Two/\r\ngit://EXAMPLE.com/Team/Three.git\r\n',
          ),
        ],
      },
      new FakeHash(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repositories).toHaveLength(3);
    expect(result.repositories.map((repo) => repo.key)).toEqual(
      [...result.repositories.map((repo) => repo.key)].sort(),
    );
    expect(result.repositories.map((repo) => repo.identity)).toEqual(
      expect.arrayContaining([
        'https://example.com/Team/One',
        'ssh://git@example.com/Team/Two',
        'git://example.com/Team/Three',
      ]),
    );
  });

  it('preserves no username and bounded non-secret URL/scp usernames', () => {
    const safe = [
      'https://example.com/team/repo.git',
      'https://git@example.com/team/repo.git',
      'ssh://git@example.com/team/repo.git',
      'git@example.com:team/repo.git',
      'https://deploy@example.com/team/repo.git',
      'deploy-user@example.com:team/repo.git',
      'https://user.name@example.com/team/repo.git',
      'user_name@example.com:team/repo.git',
      `https://${'a'.repeat(64)}@example.com/team/repo.git`,
    ];
    for (const repository of safe) {
      expect(canonicalizeRemoteRepository(repository) !== null).toBe(true);
    }
  });

  it.each(generatedCredentialUsernames())('rejects generated URL credential username: $label', ({
    value,
  }) => {
    const rejected =
      canonicalizeRemoteRepository(`https://${value}@example.com/team/repo.git`) === null;
    expect(rejected).toBe(true);
  });

  it.each(generatedCredentialUsernames())('rejects generated scp credential username: $label', ({
    value,
  }) => {
    const rejected = canonicalizeRemoteRepository(`${value}@example.com:team/repo.git`) === null;
    expect(rejected).toBe(true);
  });

  it.each(generatedEncodedUsernames())('rejects percent-bearing URL username: $label', ({
    value,
  }) => {
    const rejected =
      canonicalizeRemoteRepository(`https://${value}@example.com/team/repo.git`) === null;
    expect(rejected).toBe(true);
  });

  it.each([
    ['overlength URL username', `https://${'a'.repeat(65)}@example.com/team/repo.git`],
    ['overlength scp username', `${'a'.repeat(65)}@example.com:team/repo.git`],
    ['URL punctuation outside the closed grammar', 'https://user!name@example.com/team/repo.git'],
    ['URL control character', 'https://user\u0001name@example.com/team/repo.git'],
  ])('rejects invalid username grammar: %s', (_label, repository) => {
    expect(canonicalizeRemoteRepository(repository) === null).toBe(true);
  });

  it('uses static E108 without retaining a rejected generated username', () => {
    const username = generatedCredentialUsernames()[0]?.value ?? '';
    const result = parseRemoteRepositories(
      { repos: [`https://${username}@example.com/team/repo.git`], repoFiles: [] },
      new FakeHash(),
    );
    const summary = result.ok
      ? { ok: true }
      : {
          ok: false,
          code: result.code,
          staticMessage: result.message === 'repository must be a safe network Git URL',
          rawEcho: result.message.includes(username),
        };
    expect(summary).toEqual({
      ok: false,
      code: 'E108',
      staticMessage: true,
      rawEcho: false,
    });
  });

  it.each([
    './repo',
    '../repo',
    '/srv/repo.git',
    'C:\\repo',
    'file:///srv/repo.git',
    'ext::sh -c evil',
    'https://user:secret@example.com/team/repo.git',
    'https://example.com/team/repo.git?token=nope',
    'ssh://example.com/team/repo.git#main',
  ])('rejects unsafe/local repository %s before producing repositories', (value) => {
    const result = parseRemoteRepositories({ repos: [value], repoFiles: [] }, new FakeHash());
    expect(result).toMatchObject({ ok: false, code: 'E108' });
  });

  it('rejects missing repositories, unreadable files, and malformed UTF-8 without echoing file contents', () => {
    expect(parseRemoteRepositories({ repos: [], repoFiles: [] }, new FakeHash())).toMatchObject({
      ok: false,
      code: 'E108',
    });
    expect(
      parseRemoteRepositories(
        { repos: [], repoFiles: [file('/inputs/missing.txt', null)] },
        new FakeHash(),
      ),
    ).toMatchObject({ ok: false, code: 'E108' });
    const malformed = parseRemoteRepositories(
      { repos: [], repoFiles: [file('/inputs/bad.txt', new Uint8Array([0xc3, 0x28]))] },
      new FakeHash(),
    );
    expect(malformed).toMatchObject({ ok: false, code: 'E108' });
    expect(JSON.stringify(malformed)).not.toContain('\ufffd');
  });

  it('fails closed when distinct canonical identities collide on the 16-hex repository key', () => {
    const result = parseRemoteRepositories(
      {
        repos: ['https://example.com/one.git', 'https://example.com/two.git'],
        repoFiles: [],
      },
      new CollisionHash(),
    );
    expect(result).toMatchObject({ ok: false, code: 'E108' });
  });
});

describe('remote selector grammar', () => {
  it('allows ls without a selector but requires exactly one selector for pull', () => {
    expect(parseRemoteSelector('ls', {})).toEqual({ ok: true, selector: null });
    expect(parseRemoteSelector('pull', {})).toMatchObject({ ok: false, code: 'E108' });
  });

  it('accepts exact safe terminal ids and rejects unsafe or overlong ids', () => {
    expect(parseRemoteSelector('pull', { session: 'session.A-1' })).toEqual({
      ok: true,
      selector: { kind: 'session', session: 'session.A-1' },
    });
    for (const session of ['', 'two words', 'a/b', 'x'.repeat(257)]) {
      expect(parseRemoteSelector('pull', { session })).toMatchObject({ ok: false, code: 'E108' });
    }
  });

  it('accepts paired inclusive real calendar dates and rejects partial, reversed, invalid, or mixed selectors', () => {
    expect(parseRemoteSelector('pull', { fromDate: '2024-02-29', toDate: '2024-03-01' })).toEqual({
      ok: true,
      selector: { kind: 'date', from: '2024-02-29', to: '2024-03-01' },
    });
    for (const raw of [
      { fromDate: '2026-01-01' },
      { toDate: '2026-01-01' },
      { fromDate: '2026-02-30', toDate: '2026-03-01' },
      { fromDate: '2026-03-02', toDate: '2026-03-01' },
      { session: 's', fromDate: '2026-03-01', toDate: '2026-03-02' },
    ]) {
      expect(parseRemoteSelector('pull', raw)).toMatchObject({ ok: false, code: 'E108' });
    }
  });

  it('accepts paired full 40/64 hex commit OIDs, normalizes case, and rejects partial/reversed-width/mixed selectors', () => {
    const oid40 = 'A'.repeat(40);
    const oid64 = 'b'.repeat(64);
    expect(parseRemoteSelector('pull', { fromCommit: oid40, toCommit: 'F'.repeat(40) })).toEqual({
      ok: true,
      selector: { kind: 'commit', from: 'a'.repeat(40), to: 'f'.repeat(40) },
    });
    expect(parseRemoteSelector('pull', { fromCommit: oid64, toCommit: 'c'.repeat(64) })).toEqual({
      ok: true,
      selector: { kind: 'commit', from: oid64, to: 'c'.repeat(64) },
    });
    for (const raw of [
      { fromCommit: 'a'.repeat(40) },
      { toCommit: 'b'.repeat(40) },
      { fromCommit: 'a'.repeat(39), toCommit: 'b'.repeat(40) },
      { fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(64) },
      { session: 's', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40) },
    ]) {
      expect(parseRemoteSelector('pull', raw)).toMatchObject({ ok: false, code: 'E108' });
    }
  });
});
