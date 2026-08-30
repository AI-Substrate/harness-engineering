import { describe, expect, it } from 'vitest';
import { FakeFlowspace } from '../../../src/services/convo/fake-flowspace.js';
import type { IngestArgs } from '../../../src/services/convo/flowspace-port.js';
import { syncConversation } from '../../../src/services/convo/sync-service.js';
import type { ResolvedValue } from '../../../src/services/settings/settings.js';

const INGEST: IngestArgs = {
  harness: 'omp',
  session: 'session-42',
  folder: '/repo',
};

function consent(value: boolean, origin: ResolvedValue<boolean>['origin']): ResolvedValue<boolean> {
  return { value, origin };
}

describe('conversation sync service', () => {
  it('does no Flowspace work when consent is disabled by default', () => {
    const flowspace = new FakeFlowspace();

    expect(syncConversation(consent(false, 'default'), INGEST, flowspace)).toEqual({
      status: 'disabled',
      origin: 'default',
    });
    expect(flowspace.calls).toEqual([]);
    expect(flowspace.ingests).toEqual([]);
  });

  it('preserves kill-switch origin when consent is disabled', () => {
    const flowspace = new FakeFlowspace();

    expect(syncConversation(consent(false, 'kill-switch'), INGEST, flowspace)).toEqual({
      status: 'disabled',
      origin: 'kill-switch',
    });
    expect(flowspace.calls).toEqual([]);
  });

  it('stops after detection when flowspace3 is absent', () => {
    const flowspace = new FakeFlowspace({ detected: false });

    expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).toEqual({
      status: 'undetected',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect']);
    expect(flowspace.ingests).toEqual([]);
  });

  it('reports enabled but unreachable once without ingesting', () => {
    const flowspace = new FakeFlowspace({ reachable: false });

    expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).toEqual({
      status: 'unreachable',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect', 'ping']);
    expect(flowspace.ingests).toEqual([]);
  });

  it('detects, pings, then fires one ingest with the exact identity', () => {
    const flowspace = new FakeFlowspace();

    expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).toEqual({
      status: 'fired',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect', 'ping', 'ingest']);
    expect(flowspace.ingests).toEqual([INGEST]);
  });

  it('copies recorded ingest arguments instead of retaining caller-owned state', () => {
    const flowspace = new FakeFlowspace();
    const input = { ...INGEST };

    syncConversation(consent(true, 'repo'), input, flowspace);
    input.session = 'mutated';

    expect(flowspace.ingests).toEqual([INGEST]);
  });
});
