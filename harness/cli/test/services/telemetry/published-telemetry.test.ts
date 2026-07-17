import { describe, expect, it } from 'vitest';
import type {
  RemoteRepository,
  RemoteTelemetryBlob,
  RemoteTelemetryRefSnapshot,
} from '../../../src/adapters/git/remote-telemetry-git-port.js';
import {
  LOG_EVENT_DEFINITION_BY_KIND,
  segmentToOtlpLogs,
} from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import {
  decodePublishedTelemetrySession,
  type PublishedTelemetrySessionInput,
} from '../../../src/services/telemetry/published-telemetry.js';
import type { SelectableTelemetrySession } from '../../../src/services/telemetry/remote-selection.js';
import { ROLLUP_FORMAT, serializeManifest } from '../../../src/services/telemetry/rolled-shard.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

const encoder = new TextEncoder();
const repo: RemoteRepository = {
  key: 'repo-aaaaaaaaaaaaaaaa',
  identity: 'https://example.com/team/repo',
  transportUrl: 'https://example.com/team/repo',
};
const oid = (char: string): string => char.repeat(40);

function blob(path: string, text: string, mode = '100644'): RemoteTelemetryBlob {
  return { path, mode, type: 'blob', oid: oid('b'), bytes: encoder.encode(text) };
}

function segmentText(sessionId: string, productCommit?: string, events = true): string {
  return JSON.stringify(
    serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: sessionId,
        timecode: '2026-07-16T10:00:00.000Z',
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        ...(productCommit !== undefined && { product_commit: productCommit }),
        event_stream: events
          ? [{ t: '2026-07-16T10:00:00.000Z', kind: 'turn', dur_s: 1, in: 2, out: 3 }]
          : [],
      },
      '/repo',
    ),
  );
}

function canonicalBlobs(sessionId: string, productCommit = oid('a')): RemoteTelemetryBlob[] {
  const segment = JSON.parse(segmentText(sessionId, productCommit));
  return [
    blob(
      'manifest.json',
      serializeManifest({
        format: ROLLUP_FORMAT,
        session: sessionId,
        start_date: '2026/07/16',
        max_seq: 1,
        product_commits: [productCommit],
      }),
    ),
    blob('session.logs.jsonl', `${JSON.stringify(segmentToOtlpLogs(segment))}\n`),
    blob('session.metrics.jsonl', `${JSON.stringify(rollupToOtlpMetrics(segment))}\n`),
  ];
}

function input(
  sessionId: string,
  entries: RemoteTelemetryBlob[],
  options: { refDate?: string | null; secondRef?: RemoteTelemetryRefSnapshot } = {},
): PublishedTelemetrySessionInput {
  const refDate = options.refDate === undefined ? '2026-07-16' : options.refDate;
  const refName = `refs/harness-telemetry/${refDate?.replaceAll('-', '/') ?? 'unknown/date/value'}/${sessionId}`;
  const tip = oid('c');
  const group: SelectableTelemetrySession = {
    repository: repo,
    sessionId,
    refs: [
      {
        name: refName,
        oid: tip,
        sessionId,
        refDate,
      },
    ],
    gaps: [],
    product: { state: 'unavailable', commits: null },
  };
  return {
    group,
    refs: [
      {
        name: refName,
        advertisedOid: tip,
        history: [{ oid: tip, parents: [], entries }],
      },
      ...(options.secondRef === undefined ? [] : [options.secondRef]),
    ],
  };
}

function multiRefInput(
  sessionId: string,
  refs: Array<{ date: string; tip: string; entries: RemoteTelemetryBlob[] }>,
): PublishedTelemetrySessionInput {
  const snapshots = refs.map(({ date, tip, entries }) => ({
    name: `refs/harness-telemetry/${date.replaceAll('-', '/')}/${sessionId}`,
    advertisedOid: oid(tip),
    history: [{ oid: oid(tip), parents: [], entries }],
  }));
  return {
    group: {
      repository: repo,
      sessionId,
      refs: snapshots.map((ref) => ({
        name: ref.name,
        oid: ref.advertisedOid,
        sessionId,
        refDate: ref.name
          .slice('refs/harness-telemetry/'.length, -sessionId.length - 1)
          .replaceAll('/', '-'),
      })),
      gaps: ['duplicate_session_identity'],
      product: { state: 'unavailable', commits: null },
    },
    refs: snapshots,
  };
}

function expectOk(result: ReturnType<typeof decodePublishedTelemetrySession>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.session;
}

describe('published telemetry shape compatibility and fidelity', () => {
  it('decodes canonical, mixed, and fallback-only live-shape classes without loss', () => {
    for (const [count, kind] of [
      [52, 'canonical'],
      [2, 'mixed'],
      [14, 'fallback'],
    ] as const) {
      for (let index = 0; index < count; index++) {
        const sessionId = `${kind}-${index}`;
        const entries =
          kind === 'canonical'
            ? canonicalBlobs(sessionId)
            : kind === 'mixed'
              ? [...canonicalBlobs(sessionId), blob('2.json', segmentText(sessionId))]
              : [
                  blob(
                    'manifest.json',
                    serializeManifest({
                      format: ROLLUP_FORMAT,
                      session: sessionId,
                      start_date: '2026/07/16',
                      max_seq: 1,
                    }),
                  ),
                  blob('1.json', segmentText(sessionId)),
                ];
        const session = expectOk(decodePublishedTelemetrySession(input(sessionId, entries)));
        expect(session.fidelity).toBe('full');
        expect(session.sessionExport?.source.segment_count).toBeGreaterThan(0);
        expect(session.shapes).toContain(
          kind === 'canonical'
            ? 'canonical-pair'
            : kind === 'mixed'
              ? 'pair-plus-fallback'
              : 'fallback-only',
        );
        expect(session.blobs.map((item) => item.bytes)).toEqual(entries.map((item) => item.bytes));
      }
    }
  });

  it('keeps event and measurement coverage independent, including observed/measured zero', () => {
    const sessionId = 'empty-observed';
    const segment = JSON.parse(segmentText(sessionId, undefined, false));
    const entries = [
      blob(
        'manifest.json',
        serializeManifest({
          format: ROLLUP_FORMAT,
          session: sessionId,
          start_date: '2026/07/16',
          max_seq: 1,
        }),
      ),
      blob('session.logs.jsonl', `${JSON.stringify(segmentToOtlpLogs(segment))}\n`),
      blob('session.metrics.jsonl', `${JSON.stringify(rollupToOtlpMetrics(segment))}\n`),
    ];
    const decoded = expectOk(decodePublishedTelemetrySession(input(sessionId, entries)));
    expect(decoded.coverage.events).toEqual({ state: 'full', count: 0 });
    expect(decoded.coverage.measurements).toEqual({ state: 'complete', count: 0 });
  });

  it('classifies metrics-only as partial and manifest-only as identity-only without fabricated values', () => {
    const sessionId = 'weaker';
    const metricsOnly = expectOk(
      decodePublishedTelemetrySession(
        input(sessionId, [
          blob(
            'manifest.json',
            serializeManifest({
              format: ROLLUP_FORMAT,
              session: sessionId,
              start_date: '2026/07/16',
              max_seq: 1,
            }),
          ),
          blob('session.metrics.jsonl', JSON.stringify({ resourceMetrics: [] })),
        ]),
      ),
    );
    expect(metricsOnly.fidelity).toBe('partial');
    expect(metricsOnly.sessionExport).toBeNull();
    expect(metricsOnly.coverage.events).toEqual({ state: 'unavailable', count: null });
    expect(metricsOnly.coverage.measurements).toEqual({ state: 'complete', count: 0 });

    const identity = expectOk(
      decodePublishedTelemetrySession(
        input(sessionId, [
          blob(
            'manifest.json',
            serializeManifest({
              format: ROLLUP_FORMAT,
              session: sessionId,
              start_date: '2026/07/16',
              max_seq: 0,
            }),
          ),
        ]),
      ),
    );
    expect(identity.fidelity).toBe('identity-only');
    expect(identity.sessionExport).toBeNull();
    expect(identity.coverage.measurements.count).toBeNull();
  });

  it('uses complete-pair precedence over a duplicate loose seq', () => {
    const sessionId = 'duplicate-seq';
    const segment = JSON.parse(segmentText(sessionId));
    const entries = [
      blob('1.json', JSON.stringify(segment)),
      blob('1.logs.jsonl', `${JSON.stringify(segmentToOtlpLogs(segment))}\n`),
      blob('1.metrics.jsonl', `${JSON.stringify(rollupToOtlpMetrics(segment))}\n`),
    ];
    const decoded = expectOk(decodePublishedTelemetrySession(input(sessionId, entries)));
    expect(decoded.sessionExport?.source.segment_count).toBe(1);
  });

  it('unions asymmetric duplicate refs by explicit sequence and dedupes an identical claim', () => {
    const sessionId = 'asymmetric-refs';
    const seq1 = segmentText(sessionId);
    const decoded = expectOk(
      decodePublishedTelemetrySession(
        multiRefInput(sessionId, [
          { date: '2026-07-15', tip: 'c', entries: [blob('1.json', seq1)] },
          {
            date: '2026-07-16',
            tip: 'd',
            entries: [blob('1.json', seq1), blob('2.json', segmentText(sessionId))],
          },
        ]),
      ),
    );
    expect(decoded.sessionExport?.source.segment_count).toBe(2);
  });

  it('rejects non-identical claims for the same explicit sequence without renumbering either', () => {
    const sessionId = 'conflicting-refs';
    const changed = JSON.parse(segmentText(sessionId)) as Record<string, unknown>;
    changed.command = 'different';
    expect(
      decodePublishedTelemetrySession(
        multiRefInput(sessionId, [
          { date: '2026-07-16', tip: 'c', entries: [blob('1.json', segmentText(sessionId))] },
          { date: '2026-07-15', tip: 'd', entries: [blob('1.json', JSON.stringify(changed))] },
        ]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it('keeps equal canonical payloads at distinct line ordinals as two explicit sequences', () => {
    const sessionId = 'canonical-equal-lines';
    const segment = JSON.parse(segmentText(sessionId));
    const line = JSON.stringify(segmentToOtlpLogs(segment));
    const decoded = expectOk(
      decodePublishedTelemetrySession(
        input(sessionId, [blob('session.logs.jsonl', `${line}\n${line}\n`)]),
      ),
    );
    expect(decoded.sessionExport?.source.segment_count).toBe(2);
  });

  it('dedupes identical canonical claims for the same ordinal across refs deterministically', () => {
    const sessionId = 'canonical-same-seq';
    const line = `${JSON.stringify(segmentToOtlpLogs(JSON.parse(segmentText(sessionId))))}\n`;
    const refs = [
      { date: '2026-07-16', tip: 'c', entries: [blob('session.logs.jsonl', line)] },
      { date: '2026-07-15', tip: 'd', entries: [blob('session.logs.jsonl', line)] },
    ];
    const forward = expectOk(decodePublishedTelemetrySession(multiRefInput(sessionId, refs)));
    const reversed = expectOk(
      decodePublishedTelemetrySession(multiRefInput(sessionId, [...refs].reverse())),
    );
    expect(forward.sessionExport?.source.segment_count).toBe(1);
    expect(reversed.sessionExport).toEqual(forward.sessionExport);
  });

  it('rejects non-identical canonical claims for the same ordinal across refs', () => {
    const sessionId = 'canonical-conflict';
    const first = JSON.parse(segmentText(sessionId)) as Record<string, unknown>;
    const changed = structuredClone(first);
    changed.command = 'different';
    expect(
      decodePublishedTelemetrySession(
        multiRefInput(sessionId, [
          {
            date: '2026-07-16',
            tip: 'c',
            entries: [
              blob('session.logs.jsonl', `${JSON.stringify(segmentToOtlpLogs(first as never))}\n`),
            ],
          },
          {
            date: '2026-07-15',
            tip: 'd',
            entries: [
              blob(
                'session.logs.jsonl',
                `${JSON.stringify(segmentToOtlpLogs(changed as never))}\n`,
              ),
            ],
          },
        ]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it('reports manifest/ref date conflict as a gap without rewriting either value', () => {
    const sessionId = 'date-conflict';
    const decoded = expectOk(
      decodePublishedTelemetrySession(
        input(sessionId, canonicalBlobs(sessionId), { refDate: '2026-07-15' }),
      ),
    );
    expect(decoded.gaps).toContain('manifest_date_conflict');
  });
});

describe('published provenance agreement', () => {
  it('classifies known and partial coverage from per-segment proof and manifest aggregate', () => {
    const known = expectOk(
      decodePublishedTelemetrySession(input('known', canonicalBlobs('known'))),
    );
    expect(known.product).toEqual({ state: 'known', commits: [oid('a')] });

    const partialEntries = [...canonicalBlobs('partial'), blob('2.json', segmentText('partial'))];
    const partial = expectOk(decodePublishedTelemetrySession(input('partial', partialEntries)));
    expect(partial.product).toEqual({ state: 'partial', commits: [oid('a')] });
  });

  it('fails strict retrieval on manifest/segment or JSON/Logs companion disagreement', () => {
    const mismatch = canonicalBlobs('mismatch');
    mismatch[0] = blob(
      'manifest.json',
      serializeManifest({
        format: ROLLUP_FORMAT,
        session: 'mismatch',
        start_date: '2026/07/16',
        max_seq: 1,
        product_commits: [oid('f')],
      }),
    );
    expect(decodePublishedTelemetrySession(input('mismatch', mismatch))).toEqual({
      ok: false,
      reason: 'malformed_or_unsafe',
    });

    const json = JSON.parse(segmentText('companion', oid('a')));
    const logs = JSON.parse(segmentText('companion', oid('b')));
    expect(
      decodePublishedTelemetrySession(
        input('companion', [
          blob('1.json', JSON.stringify(json)),
          blob('1.logs.jsonl', `${JSON.stringify(segmentToOtlpLogs(logs))}\n`),
          blob('1.metrics.jsonl', `${JSON.stringify(rollupToOtlpMetrics(logs))}\n`),
        ]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });
});

describe('published tree/privacy validation', () => {
  it.each([
    ['source-shaped parent', blob('src/secret.ts', '{}')],
    ['symlink', blob('1.json', segmentText('unsafe'), '120000')],
    ['duplicate JSON key', blob('1.json', '{"schema_version":"2.5","schema_version":"2.5"}')],
    ['forbidden content key', blob('1.json', '{"prompt_text":"private prose"}')],
    ['absolute unknown path', blob('1.json', '{"safe_extra":"/Users/private/file"}')],
    ['malformed claimed JSONL', blob('session.logs.jsonl', '{not-json}\n')],
  ])('rejects %s before exposing raw bytes', (_name, unsafe) => {
    expect(decodePublishedTelemetrySession(input('unsafe', [unsafe]))).toEqual({
      ok: false,
      reason: 'malformed_or_unsafe',
    });
  });

  it.each([
    [
      'Segment required command has boolean type',
      (value: Record<string, unknown>) => {
        value.command = true;
      },
    ],
    [
      'Segment required command is null',
      (value: Record<string, unknown>) => {
        value.command = null;
      },
    ],
    [
      'Segment required command is missing',
      (value: Record<string, unknown>) => {
        delete value.command;
      },
    ],
    [
      'Segment window enum is invalid',
      (value: Record<string, unknown>) => {
        (value.window as Record<string, unknown>).since = 'yesterday';
      },
    ],
    [
      'Segment window range is reversed',
      (value: Record<string, unknown>) => {
        (value.window as Record<string, unknown>).from = 2;
      },
    ],
    [
      'Segment event numeric range is negative',
      (value: Record<string, unknown>) => {
        (value.event_stream as Array<Record<string, unknown>>)[0].dur_s = -1;
      },
    ],
    [
      'Segment captured env contains a classic GitHub token',
      (value: Record<string, unknown>) => {
        value.captured_env = { SAFE_ID: `ghp_${'a'.repeat(36)}` };
      },
    ],
    [
      'Segment nested string contains a fine-grained GitHub token',
      (value: Record<string, unknown>) => {
        (value.event_stream as Array<Record<string, unknown>>)[0].model =
          `github_pat_${'a'.repeat(48)}`;
      },
    ],
  ])('rejects %s exact type/range/credential adversary before raw admission', (_name, mutate) => {
    const value = JSON.parse(segmentText('unsafe-contract')) as Record<string, unknown>;
    mutate(value);
    const result = decodePublishedTelemetrySession(
      input('unsafe-contract', [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it.each([
    ['Logs', 'harness.command', { boolValue: true }],
    ['Logs', 'harness.session_id', { intValue: '7' }],
    ['Metrics', 'harness.command', { boolValue: true }],
    ['Metrics', 'harness.harness', { intValue: '7' }],
    ['Metrics', 'harness.schema_version', { stringValue: '2.3' }],
    ['Metrics', 'harness.command', { stringValue: `ghp_${'a'.repeat(36)}` }],
    ['Logs', 'service.version', { stringValue: 'release-candidate' }],
    ['Metrics', 'service.version', { stringValue: `AIza${'a'.repeat(35)}` }],
    ['Logs', 'harness.harness', { stringValue: 'shell' }],
    ['Metrics', 'harness.session_id', { stringValue: 'q'.repeat(64) }],
  ])('rejects %s required resource %s with wrong AnyValue/value before raw admission', (signal, key, unsafeValue) => {
    const segment = JSON.parse(segmentText('unsafe-resource'));
    const value = JSON.parse(
      JSON.stringify(signal === 'Logs' ? segmentToOtlpLogs(segment) : rollupToOtlpMetrics(segment)),
    ) as Record<string, unknown>;
    const resources = value[signal === 'Logs' ? 'resourceLogs' : 'resourceMetrics'] as Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
    }>;
    const attribute = resources[0].resource.attributes.find((entry) => entry.key === key);
    if (attribute === undefined) throw new Error(`missing fixture attribute ${key}`);
    attribute.value = unsafeValue;
    const path = signal === 'Logs' ? 'session.logs.jsonl' : 'session.metrics.jsonl';
    const result = decodePublishedTelemetrySession(
      input('unsafe-resource', [blob(path, JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it.each([
    [
      'Segment known-field free prose',
      () => {
        const value = JSON.parse(segmentText('unsafe-segment')) as Record<string, unknown>;
        value.branch = 'customer source code copied into telemetry';
        return blob('1.json', JSON.stringify(value));
      },
    ],
    [
      'Segment invalid known numeric value',
      () => {
        const value = JSON.parse(segmentText('unsafe-segment')) as {
          event_stream: Array<Record<string, unknown>>;
        };
        value.event_stream[0].dur_s = -1;
        return blob('1.json', JSON.stringify(value));
      },
    ],
    [
      'Metrics known description prose',
      () => {
        const value = JSON.parse(
          JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('unsafe-metrics')))),
        ) as {
          resourceMetrics: Array<{
            scopeMetrics: Array<{ metrics: Array<Record<string, unknown>> }>;
          }>;
        };
        value.resourceMetrics[0].scopeMetrics[0].metrics[0].description =
          'customer source code copied into telemetry';
        return blob('session.metrics.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Metrics known unit credential',
      () => {
        const value = JSON.parse(
          JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('unsafe-metrics')))),
        ) as {
          resourceMetrics: Array<{
            scopeMetrics: Array<{ metrics: Array<Record<string, unknown>> }>;
          }>;
        };
        value.resourceMetrics[0].scopeMetrics[0].metrics[0].unit = `ghp_${'a'.repeat(30)}`;
        return blob('session.metrics.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Metrics unknown known-slot name',
      () => {
        const value = JSON.parse(
          JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('unsafe-metrics')))),
        ) as {
          resourceMetrics: Array<{
            scopeMetrics: Array<{ metrics: Array<Record<string, unknown>> }>;
          }>;
        };
        value.resourceMetrics[0].scopeMetrics[0].metrics[0].name = 'customer.source.code';
        return blob('session.metrics.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Metrics duplicate semantic resource attribute',
      () => {
        const value = JSON.parse(
          JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('unsafe-metrics')))),
        ) as {
          resourceMetrics: Array<{
            resource: { attributes: Array<Record<string, unknown>> };
          }>;
        };
        value.resourceMetrics[0].resource.attributes.push({
          ...value.resourceMetrics[0].resource.attributes[0],
        });
        return blob('session.metrics.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Metrics extra resource block',
      () => {
        const value = JSON.parse(
          JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('unsafe-metrics')))),
        ) as { resourceMetrics: Array<Record<string, unknown>> };
        value.resourceMetrics.push(structuredClone(value.resourceMetrics[0]));
        return blob('session.metrics.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Logs duplicate semantic resource attribute',
      () => {
        const value = JSON.parse(
          JSON.stringify(segmentToOtlpLogs(JSON.parse(segmentText('unsafe-logs')))),
        ) as {
          resourceLogs: Array<{ resource: { attributes: Array<Record<string, unknown>> } }>;
        };
        value.resourceLogs[0].resource.attributes.push({
          ...value.resourceLogs[0].resource.attributes[0],
        });
        return blob('session.logs.jsonl', JSON.stringify(value));
      },
    ],
    [
      'Logs extra resource block',
      () => {
        const value = JSON.parse(
          JSON.stringify(segmentToOtlpLogs(JSON.parse(segmentText('unsafe-logs')))),
        ) as { resourceLogs: Array<Record<string, unknown>> };
        value.resourceLogs.push(structuredClone(value.resourceLogs[0]));
        return blob('session.logs.jsonl', JSON.stringify(value));
      },
    ],
  ])('rejects %s known-field/nested adversary before raw admission', (_name, makeUnsafe) => {
    const result = decodePublishedTelemetrySession(input('unsafe-known', [makeUnsafe()]));
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it('accepts producer Metrics containing every current optional family', () => {
    const t = '2026-07-16T10:00:00.000Z';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_version: 'test',
        harness_session_id: 'all-metrics',
        timecode: t,
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        event_stream: [
          { t, kind: 'turn', dur_s: 1, in: 2, out: 3 },
          {
            t: '2026-07-16T10:00:01.000Z',
            kind: 'flow',
            flow: 'x',
            stage: 'plan',
            status: 'active',
          },
          { t: '2026-07-16T10:00:02.000Z', kind: 'tools', name: 'Bash', count: 1, span_s: 1 },
          { t: '2026-07-16T10:00:03.000Z', kind: 'skill', name: 'the-flow', status: 'done' },
          {
            t: '2026-07-16T10:00:04.000Z',
            kind: 'command_exit',
            verb: 'checks',
            exit: 0,
            status: 'ok',
          },
        ],
      },
      '/repo',
    );
    expectOk(
      decodePublishedTelemetrySession(
        input('all-metrics', [
          blob('session.metrics.jsonl', JSON.stringify(rollupToOtlpMetrics(segment))),
        ]),
      ),
    );
  });

  it('accepts exactly the finite current8 and legacy union11 captured-env contracts', () => {
    const current = JSON.parse(segmentText('current-env')) as Record<string, unknown>;
    current.captured_env = {
      PIJ_SESSION_ID: 'pij-static-mockingbird',
      PIJ_PARENT_ID: 'pij-thirsty-panda',
      PIJ_HARNESS: 'pi',
      PIJ_ROLE: 'coder',
      PIJ_ANNOUNCE_TO: 'pij-thirsty-panda',
      PIJ_SPAWN_ID: 'spawn-0007',
      PIJ_SPAWN_MODEL: 'github-copilot/gpt-5.6-sol:xhigh',
      PIJ_SPAWN_EFFORT: 'xhigh',
    };
    expectOk(
      decodePublishedTelemetrySession(
        input('current-env', [blob('1.json', JSON.stringify(current))]),
      ),
    );

    const legacy = JSON.parse(segmentText('legacy-env')) as Record<string, unknown>;
    legacy.schema_version = '2.4';
    legacy.captured_env = {
      ...(current.captured_env as Record<string, string>),
      PIJ_ID: 'pij-legacy',
      PIJ_STATUS_KEY: 'status/9',
      PIJ_PANE_ID: '%7',
    };
    expectOk(
      decodePublishedTelemetrySession(
        input('legacy-env', [blob('1.json', JSON.stringify(legacy))]),
      ),
    );
  });

  it.each([
    ['current rejects legacy extra', '2.5', { PIJ_ID: 'pij-legacy' }],
    ['current rejects SPAWN_TASK', '2.5', { PIJ_SPAWN_TASK: 'safe-looking-task' }],
    ['current rejects unknown', '2.5', { PIJ_UNKNOWN: 'safe-looking' }],
    ['legacy rejects unknown', '2.4', { PIJ_UNKNOWN: 'safe-looking' }],
    ['legacy rejects SPAWN_TASK', '2.4', { PIJ_SPAWN_TASK: 'safe-looking-task' }],
  ])('%s before raw admission', (_name, version, capturedEnv) => {
    const value = JSON.parse(segmentText(`env-${version}`)) as Record<string, unknown>;
    value.schema_version = version;
    value.captured_env = capturedEnv;
    const result = decodePublishedTelemetrySession(
      input(`env-${version}`, [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it.each([
    ['PIJ_SESSION_ID', 'session-not-a-current-pij-id'],
    ['PIJ_PARENT_ID', '/absolute/path'],
    ['PIJ_HARNESS', 'not-a-harness'],
    ['PIJ_ROLE', 'not-a-role'],
    ['PIJ_ANNOUNCE_TO', 'announce-not-a-current-pij-id'],
    ['PIJ_SPAWN_ID', 'correlation-not-a-spawn-id'],
    ['PIJ_SPAWN_MODEL', `provider/${'x'.repeat(64)}`],
    ['PIJ_SPAWN_EFFORT', 'ultra'],
    ['PIJ_STATUS_KEY', 'status-key-without-prefix'],
    ['PIJ_PANE_ID', 'pane-7'],
  ])('rejects wrong captured-env grammar for %s', (key, unsafe) => {
    const value = JSON.parse(segmentText(`bad-${key}`)) as Record<string, unknown>;
    value.schema_version = key === 'PIJ_STATUS_KEY' || key === 'PIJ_PANE_ID' ? '2.4' : '2.5';
    value.captured_env = { [key]: unsafe };
    const result = decodePublishedTelemetrySession(
      input(`bad-${key}`, [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it.each([
    `AKIA${'A'.repeat(16)}`,
    `ASIA${'B'.repeat(16)}`,
    `sk-proj-${'c'.repeat(32)}`,
    `xoxb-${'1'.repeat(24)}`,
    `glpat-${'d'.repeat(24)}`,
    `sk_live_${'e'.repeat(32)}`,
    `AIza${'f'.repeat(35)}`,
    'q'.repeat(64),
    `eyJ${'e'.repeat(40)}.${'f'.repeat(20)}.${'g'.repeat(20)}`,
  ])('rejects credential-shaped string %s in an additive channel', (credential) => {
    const value = JSON.parse(segmentText('credential-channel')) as Record<string, unknown>;
    value.safe_extra = credential;
    const result = decodePublishedTelemetrySession(
      input('credential-channel', [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it.each([
    ['prefixless hex', '0123456789abcdef0123456789abcdef'],
    ['prefixless alphanumeric', 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'],
    ['prefixless base64-like', 'AbCdEfGhIjKlMnOpQrStUvWxYz01+/=='],
    ['innocuous-looking atom', 'build-123'],
  ])('rejects unknown additive %s strings before retaining raw bytes', (_name, unknownString) => {
    const value = JSON.parse(segmentText('unknown-string')) as Record<string, unknown>;
    value.safe_extra = unknownString;
    const result = decodePublishedTelemetrySession(
      input('unknown-string', [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it.each([
    { nested: 'build-123' },
    ['build-123'],
  ])('rejects nested unknown additive strings in %j before raw admission', (unknownValue) => {
    const value = JSON.parse(segmentText('nested-unknown-string')) as Record<string, unknown>;
    value.safe_extra = unknownValue;
    const result = decodePublishedTelemetrySession(
      input('nested-unknown-string', [blob('1.json', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it('rejects forbidden or wrong-kind Logs attributes by event context', () => {
    const segment = JSON.parse(segmentText('log-attributes'));
    const value = JSON.parse(JSON.stringify(segmentToOtlpLogs(segment))) as {
      resourceLogs: Array<{
        scopeLogs: Array<{
          logRecords: Array<{ attributes: Array<{ key: string; value: Record<string, unknown> }> }>;
        }>;
      }>;
    };
    const attrs = value.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    attrs.push({ key: 'harness.prompt', value: { stringValue: 'safe-looking' } });
    const result = decodePublishedTelemetrySession(
      input('log-attributes', [blob('session.logs.jsonl', JSON.stringify(value))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  const metricDocument = () =>
    JSON.parse(
      JSON.stringify(rollupToOtlpMetrics(JSON.parse(segmentText('metric-attributes')))),
    ) as {
      resourceMetrics: Array<{
        resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
        scopeMetrics: Array<{
          metrics: Array<{
            sum?: { dataPoints: Array<{ attributes?: Array<Record<string, unknown>> }> };
            gauge?: { dataPoints: Array<{ attributes?: Array<Record<string, unknown>> }> };
          }>;
        }>;
      }>;
    };

  it('rejects a forbidden Metrics datapoint attribute independently', () => {
    const metrics = metricDocument();
    const firstMetric = metrics.resourceMetrics[0].scopeMetrics[0].metrics[0];
    const point = (firstMetric.sum ?? firstMetric.gauge)?.dataPoints[0];
    if (point === undefined) throw new Error('missing metric point');
    point.attributes = [{ key: 'harness.prompt', value: { stringValue: 'safe-looking' } }];
    expect(
      decodePublishedTelemetrySession(
        input('metric-attributes', [blob('session.metrics.jsonl', JSON.stringify(metrics))]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it('rejects a credential in required Metrics resources independently', () => {
    const metrics = metricDocument();
    const serviceVersion = metrics.resourceMetrics[0].resource.attributes.find(
      (entry) => entry.key === 'service.version',
    );
    if (serviceVersion === undefined) throw new Error('missing service.version');
    serviceVersion.value = { stringValue: `AKIA${'A'.repeat(16)}` };
    expect(
      decodePublishedTelemetrySession(
        input('metric-resource', [blob('session.metrics.jsonl', JSON.stringify(metrics))]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it.each([
    'cache_read',
    'cache_create',
  ])('rejects a producer-impossible output-token/%s tuple before raw admission', (cacheType) => {
    const metrics = metricDocument();
    const tokenMetric = metrics.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (metric) => (metric as unknown as { name?: string }).name === 'gen_ai.client.token.usage',
    );
    const output = tokenMetric?.sum?.dataPoints.find((point) =>
      point.attributes?.some(
        (attribute) =>
          (attribute as { key?: string; value?: { stringValue?: string } }).key ===
            'gen_ai.token.type' &&
          (attribute as { value?: { stringValue?: string } }).value?.stringValue === 'output',
      ),
    );
    if (output === undefined) throw new Error('missing output token point');
    output.attributes = [
      ...(output.attributes ?? []),
      { key: 'harness.token.type', value: { stringValue: cacheType } },
    ];
    const result = decodePublishedTelemetrySession(
      input('metric-tuple', [blob('session.metrics.jsonl', JSON.stringify(metrics))]),
    );
    expect(result).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
    expect('session' in result).toBe(false);
  });

  it('rejects duplicate, missing, and extra producer-impossible token bucket sets', () => {
    const duplicate = metricDocument();
    const tokenMetric = duplicate.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (metric) => (metric as unknown as { name?: string }).name === 'gen_ai.client.token.usage',
    );
    if (tokenMetric?.sum === undefined) throw new Error('missing token metric');
    tokenMetric.sum.dataPoints.push(structuredClone(tokenMetric.sum.dataPoints[0]));
    expect(
      decodePublishedTelemetrySession(
        input('metric-duplicate-set', [blob('session.metrics.jsonl', JSON.stringify(duplicate))]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });

    const missing = metricDocument();
    const missingToken = missing.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (metric) => (metric as unknown as { name?: string }).name === 'gen_ai.client.token.usage',
    );
    if (missingToken?.sum === undefined) throw new Error('missing token metric');
    missingToken.sum.dataPoints.pop();
    expect(
      decodePublishedTelemetrySession(
        input('metric-missing-set', [blob('session.metrics.jsonl', JSON.stringify(missing))]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });

    const extra = metricDocument();
    const extraToken = extra.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (metric) => (metric as unknown as { name?: string }).name === 'gen_ai.client.token.usage',
    );
    if (extraToken?.sum === undefined) throw new Error('missing token metric');
    const extraPoint = structuredClone(extraToken.sum.dataPoints[0]) as {
      attributes?: Array<{ key?: string; value?: { stringValue?: string } }>;
    };
    const tokenType = extraPoint.attributes?.find(
      (attribute) => attribute.key === 'gen_ai.token.type',
    );
    if (tokenType?.value === undefined) throw new Error('missing token type');
    tokenType.value.stringValue = 'input';
    extraPoint.attributes = [
      ...(extraPoint.attributes ?? []),
      { key: 'harness.token.type', value: { stringValue: 'cache_read' } },
    ];
    extraToken.sum.dataPoints.push(extraPoint);
    expect(
      decodePublishedTelemetrySession(
        input('metric-extra-set', [blob('session.metrics.jsonl', JSON.stringify(extra))]),
      ),
    ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
  });

  it('round-trips the complete current Logs event-attribute vocabulary', () => {
    const t = '2026-07-16T10:00:00.000Z';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_version: 'test',
        harness_session_id: 'all-events',
        timecode: t,
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        event_stream: [
          { t, kind: 'prompt', words: 1 },
          { t, kind: 'turn', dur_s: 1, in: 2, out: 3, cache_read: 4, cache_create: 5, model: 'm' },
          {
            t,
            kind: 'tools',
            name: 'Bash',
            count: 1,
            span_s: 2,
            signature: 'sig',
            result_tokens: 3,
          },
          { t, kind: 'skill', name: 'flow', status: 'completed', dur_s: 1, arg: 'arg' },
          { t, kind: 'flow', flow: 'x', stage: 'plan', status: 'in_progress', from: 'a' },
          {
            t,
            kind: 'flow_log',
            op: 'advance',
            node: 'n',
            from: 'a',
            to: 'b',
            type: 't',
            edge_op: 'e',
          },
          { t, kind: 'branch', to: 'main', from: 'old' },
          { t, kind: 'harness', verb: 'observe', observe_kind: 'win' },
          { t, kind: 'checks', status: 'ok', gates: { tests: 'ok' } },
          { t, kind: 'command_exit', verb: 'checks', exit: 0, status: 'ok' },
          { t, kind: 'subagent', name: 'reviewer', status: 'completed', dur_s: 1 },
          { t, kind: 'compaction' },
          { t, kind: 'model', model: 'gpt', effort: 'high' },
          { t, kind: 'api_error', signature: 'rate_limit' },
          {
            t,
            kind: 'artifact',
            path: 'docs/x.md',
            artifact_type: 'review',
            change: 'edited',
            counts: { findings: 1 },
            enums: { verdict: 'APPROVE' },
            size: { lines: 1, bytes: 2 },
            plan_id: '060-x',
          },
          {
            t,
            kind: 'file',
            path: 'src/x.ts',
            change: 'edited',
            delta: { lines_added: 1, lines_removed: 0, bytes_added: 2, bytes_removed: 0 },
          },
          { t, kind: 'mark', mark_kind: 'review', counts: { findings: 1 }, verdict: 'pass' },
        ],
      },
      '/repo',
    );
    const logs = segmentToOtlpLogs(segment);
    const records = logs.resourceLogs[0].scopeLogs[0].logRecords;
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const kind = record.attributes.find((attribute) => attribute.key === 'harness.event.kind')
        ?.value.stringValue;
      const definition = kind === undefined ? undefined : LOG_EVENT_DEFINITION_BY_KIND.get(kind);
      expect(definition, `event index ${index} definition`).toBeDefined();

      const one = structuredClone(logs);
      one.resourceLogs[0].scopeLogs[0].logRecords = [record];
      const result = decodePublishedTelemetrySession(
        input('all-events', [blob('session.logs.jsonl', `${JSON.stringify(one)}\n`)]),
      );
      expect(result.ok, `event index ${index}`).toBe(true);

      const contradictoryTime = structuredClone(one);
      contradictoryTime.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano = '1';
      expect(
        decodePublishedTelemetrySession(
          input('all-events', [
            blob('session.logs.jsonl', `${JSON.stringify(contradictoryTime)}\n`),
          ]),
        ),
        `${kind} contradictory envelope/event time`,
      ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });

      const observedTime = structuredClone(one) as typeof one & {
        resourceLogs: Array<{
          scopeLogs: Array<{ logRecords: Array<{ observedTimeUnixNano?: string }> }>;
        }>;
      };
      observedTime.resourceLogs[0].scopeLogs[0].logRecords[0].observedTimeUnixNano =
        record.timeUnixNano;
      expect(
        decodePublishedTelemetrySession(
          input('all-events', [blob('session.logs.jsonl', `${JSON.stringify(observedTime)}\n`)]),
        ),
        `${kind} observedTimeUnixNano absent from current producer`,
      ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });

      for (const required of definition?.attributes.filter((attribute) => attribute.required) ??
        []) {
        const missing = structuredClone(one);
        missing.resourceLogs[0].scopeLogs[0].logRecords[0].attributes = record.attributes.filter(
          (attribute) => attribute.key !== required.key,
        );
        const rejected = decodePublishedTelemetrySession(
          input('all-events', [blob('session.logs.jsonl', JSON.stringify(missing))]),
        );
        expect(rejected, `${kind} missing ${required.key}`).toEqual({
          ok: false,
          reason: 'malformed_or_unsafe',
        });
      }

      for (const optional of definition?.attributes.filter((attribute) => !attribute.required) ??
        []) {
        if (!record.attributes.some((attribute) => attribute.key === optional.key)) continue;
        const omitted = structuredClone(one);
        omitted.resourceLogs[0].scopeLogs[0].logRecords[0].attributes = record.attributes.filter(
          (attribute) => attribute.key !== optional.key,
        );
        expect(
          decodePublishedTelemetrySession(
            input('all-events', [blob('session.logs.jsonl', JSON.stringify(omitted))]),
          ).ok,
          `${kind} optional ${optional.key}`,
        ).toBe(true);
      }

      const ranged = definition?.attributes.find(
        (attribute) =>
          (attribute.kind === 'int' || attribute.kind === 'number') && attribute.min !== undefined,
      );
      if (ranged !== undefined) {
        const invalid = structuredClone(one);
        const attribute = invalid.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(
          (entry) => entry.key === ranged.key,
        );
        if (attribute !== undefined) attribute.value = { intValue: String(ranged.min - 1) };
        expect(
          decodePublishedTelemetrySession(
            input('all-events', [blob('session.logs.jsonl', JSON.stringify(invalid))]),
          ),
          `${kind} range ${ranged.key}`,
        ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
      }

      const enumerated = definition?.attributes.find(
        (attribute) => attribute.values !== undefined && attribute.values.length > 0,
      );
      if (enumerated !== undefined) {
        const invalid = structuredClone(one);
        const attribute = invalid.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(
          (entry) => entry.key === enumerated.key,
        );
        if (attribute !== undefined) attribute.value = { stringValue: 'not-in-producer-enum' };
        expect(
          decodePublishedTelemetrySession(
            input('all-events', [blob('session.logs.jsonl', JSON.stringify(invalid))]),
          ),
          `${kind} enum ${enumerated.key}`,
        ).toEqual({ ok: false, reason: 'malformed_or_unsafe' });
      }
    }
  });

  it('accepts BOM/CRLF-safe known strings and bounded string-free additive data without normalizing raw bytes', () => {
    const sessionId = 'safe-additive';
    const parsed = JSON.parse(segmentText(sessionId));
    parsed.safe_extra = { enabled: true, count: 0, absent: null, nested: [false, 7] };
    const raw = `\ufeff${JSON.stringify(parsed)}\r\n`;
    const source = blob('1.json', raw);
    const decoded = expectOk(decodePublishedTelemetrySession(input(sessionId, [source])));
    expect(decoded.blobs[0]?.bytes).toEqual(source.bytes);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(decoded.blobs[0]?.bytes)).toBe(raw);
  });
});
