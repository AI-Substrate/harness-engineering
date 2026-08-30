import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { resolve, type SettingsResolution } from '../../../src/services/settings/settings.js';

const repo = (settings: Record<string, unknown>): string =>
  JSON.stringify({ schema_version: 1, ...settings });
const local = repo;

function expectRefusal(result: SettingsResolution, code: string, nextAction: RegExp): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
  expect(result.message).not.toBe('');
  expect(result.next_action).toMatch(nextAction);
}

describe('settings resolution', () => {
  it('defaults consent off and records the default origin', () => {
    expect(resolve(null, null, new FakeEnv())).toEqual({
      ok: true,
      settings: {
        governance: {},
        machine: {},
        flowspace: { ingest: { enabled: { value: false, origin: 'default' } } },
      },
    });
  });

  it('reads governance and consent only from tracked settings', () => {
    expect(
      resolve(
        repo({
          governance: { review: { required: true } },
          flowspace: { ingest: { enabled: true } },
        }),
        null,
        new FakeEnv(),
      ),
    ).toEqual({
      ok: true,
      settings: {
        governance: { review: { required: { value: true, origin: 'repo' } } },
        machine: {},
        flowspace: { ingest: { enabled: { value: true, origin: 'repo' } } },
      },
    });
  });

  it('lets local machine facts override repo leaves without replacing siblings', () => {
    const result = resolve(
      repo({ machine: { flowspace: { command: 'flowspace3', timeout_ms: 1000 } } }),
      local({ machine: { flowspace: { timeout_ms: 2500 } } }),
      new FakeEnv(),
    );
    expect(result).toMatchObject({
      ok: true,
      settings: {
        machine: {
          flowspace: {
            command: { value: 'flowspace3', origin: 'repo' },
            timeout_ms: { value: 2500, origin: 'local' },
          },
        },
      },
    });
  });

  it('makes HARNESS_NO_TELEMETRY=1 absolute over tracked consent', () => {
    const result = resolve(
      repo({ flowspace: { ingest: { enabled: true } } }),
      null,
      new FakeEnv({ HARNESS_NO_TELEMETRY: '1' }),
    );
    expect(result).toMatchObject({
      ok: true,
      settings: {
        flowspace: { ingest: { enabled: { value: false, origin: 'kill-switch' } } },
      },
    });
  });

  it.each([
    ['governance namespace', local({ governance: { review: { required: false } } })],
    [
      'consent key outside governance namespace',
      local({ flowspace: { ingest: { enabled: false } } }),
    ],
  ])('refuses a governance-class key in local settings: %s', (_case, localText) => {
    expectRefusal(
      resolve(null, localText, new FakeEnv()),
      ErrorCodes.SETTINGS_INVALID,
      /settings\.local\.json/,
    );
  });

  it.each([
    ['repo', '{"schema_version":1,'],
    ['local', '{"machine":'],
  ])('refuses malformed %s JSON instead of falling back', (source, malformed) => {
    const result = resolve(
      source === 'repo' ? malformed : null,
      source === 'local' ? malformed : null,
      new FakeEnv(),
    );
    expectRefusal(result, ErrorCodes.SETTINGS_INVALID, /Fix the JSON/);
  });

  it.each([
    ['repo', repo({ schema_version: 2 })],
    ['local', local({ schema_version: 7, machine: {} })],
  ])('refuses an unknown %s schema major', (source, versioned) => {
    const result = resolve(
      source === 'repo' ? versioned : null,
      source === 'local' ? versioned : null,
      new FakeEnv(),
    );
    expectRefusal(result, ErrorCodes.SETTINGS_SCHEMA_VERSION, /harness update/);
  });
});
