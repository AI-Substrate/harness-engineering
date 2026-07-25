import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { extractCopilotUsageObservations } from '../../../src/services/telemetry/copilot-ledger.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { readRefLanes } from '../../../src/services/telemetry/ref-source.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  reduceUsageObservations,
  tokenEvidenceFromObservation,
} from '../../../src/services/telemetry/usage-observation.js';

interface TokenRecoveryFixture {
  copilot: {
    final_after_checkpoint: unknown[];
    checkpoint_nano_only: unknown[];
  };
  durable_ref: {
    session: string;
    measured: {
      time: string;
      input: number;
      output: number;
      cache_read: number;
      cache_create: number;
    };
    missing: { time: string };
  };
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('./fixtures/lane-sources/p063/token-recovery.json', import.meta.url),
    'utf8',
  ),
) as TokenRecoveryFixture;

function events(rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function durableRef(includeMissing: boolean) {
  const { session, measured, missing } = FIXTURE.durable_ref;
  const measuredSegment = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: session,
      timecode: measured.time,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
      tokens: {
        input: measured.input,
        output: measured.output,
        cache_read: measured.cache_read,
        cache_create: measured.cache_create,
        total: measured.input + measured.output + measured.cache_read + measured.cache_create,
        subagent_tokens: 0,
        grand_total: measured.input + measured.output + measured.cache_read + measured.cache_create,
      },
      event_stream: [
        {
          t: measured.time,
          kind: 'turn',
          dur_s: 1,
          in: measured.input,
          out: measured.output,
          cache_read: measured.cache_read,
          cache_create: measured.cache_create,
          model: 'fixture-model',
        },
      ],
    },
    '/fixture',
  );
  const segments = [measuredSegment];
  if (includeMissing) {
    segments.push(
      serializeSegment(
        {
          command: 'flow',
          harness: 'claude-code',
          harness_session_id: session,
          timecode: missing.time,
          window: { since: 'session-start', from: 1, to: 2 },
          branch: null,
          tokens: null,
          event_stream: [{ t: missing.time, kind: 'turn', dur_s: 1, model: 'fixture-model' }],
        },
        '/fixture',
      ),
    );
  }
  return [
    {
      name: 'session.logs.jsonl',
      content: `${segments.map((segment) => JSON.stringify(segmentToOtlpLogs(segment))).join('\n')}\n`,
    },
  ];
}

describe('P063 Phase 3 — minimized replay-derived token fixtures', () => {
  it('keeps final shutdown authoritative over an earlier checkpoint with all five fields measured', () => {
    const observations = extractCopilotUsageObservations(
      events(FIXTURE.copilot.final_after_checkpoint),
    );
    const evidence = tokenEvidenceFromObservation(reduceUsageObservations(observations), 'ledger');

    expect(evidence).toMatchObject({
      coverage: 'measured',
      source: 'ledger',
      fields: {
        input: { value: 11, observation_kind: 'final_shutdown', coverage: 'measured' },
        output: { value: 22, observation_kind: 'final_shutdown', coverage: 'measured' },
        cache_read: { value: 33, observation_kind: 'final_shutdown', coverage: 'measured' },
        cache_create: { value: 44, observation_kind: 'final_shutdown', coverage: 'measured' },
        nano_aiu: { value: 55, observation_kind: 'final_shutdown', coverage: 'measured' },
      },
    });

    // Mutation control: losing the final event must expose the older checkpoint,
    // not accidentally preserve final values through stale state or unlike-kind addition.
    const withoutFinal = tokenEvidenceFromObservation(
      reduceUsageObservations(
        observations.filter((item) => item.observation_kind !== 'final_shutdown'),
      ),
      'ledger',
    );
    expect(withoutFinal.fields.input.value).toBe(1);
    expect(withoutFinal.fields.nano_aiu.value).toBe(5);
    expect(withoutFinal.fields.input.observation_kind).toBe('cumulative_checkpoint');
  });

  it('preserves a checkpoint nano-AIU field without overclaiming primary-token coverage', () => {
    const observations = extractCopilotUsageObservations(
      events(FIXTURE.copilot.checkpoint_nano_only),
    );
    const evidence = tokenEvidenceFromObservation(reduceUsageObservations(observations), 'ledger');

    expect(evidence).toMatchObject({
      coverage: 'unavailable',
      reason: 'no_observation',
      source: null,
      fields: {
        input: { value: null, coverage: 'unavailable' },
        output: { value: null, coverage: 'unavailable' },
        cache_read: { value: null, coverage: 'unavailable' },
        cache_create: { value: null, coverage: 'unavailable' },
        nano_aiu: { value: 7, coverage: 'measured', observation_kind: 'cumulative_checkpoint' },
      },
    });

    // Mutation control: removing the only numeric field makes the event non-evidence.
    const mutant = structuredClone(FIXTURE.copilot.checkpoint_nano_only) as Array<{
      data: Record<string, unknown>;
    }>;
    delete mutant[0]?.data.totalNanoAiu;
    expect(extractCopilotUsageObservations(events(mutant))).toEqual([]);
  });

  it('returns measured fields after prune while aggregate coverage stays honestly partial', () => {
    const { session, measured } = FIXTURE.durable_ref;
    const ref = `refs/harness-telemetry/2026/01/02/${session}`;
    const lane = readRefLanes(new FakeGitRead({ [ref]: durableRef(true) })).get(session);

    expect(lane?.token_evidence).toMatchObject({
      coverage: 'partial',
      reason: 'source_unavailable',
      source: 'ref',
      fields: {
        input: { value: measured.input, coverage: 'measured', source: 'ref' },
        output: { value: measured.output, coverage: 'measured', source: 'ref' },
        cache_read: { value: measured.cache_read, coverage: 'measured', source: 'ref' },
        cache_create: { value: measured.cache_create, coverage: 'measured', source: 'ref' },
      },
    });
    expect(readRefLanes(new FakeGitRead()).has('fixture-absent-control')).toBe(false);

    // Mutation control: removing the missing shard changes aggregate coverage to
    // measured, proving partiality comes from honest source availability rather than lost values.
    expect(
      readRefLanes(new FakeGitRead({ [ref]: durableRef(false) })).get(session)?.token_evidence,
    ).toMatchObject({ coverage: 'measured', reason: null });
  });
});
