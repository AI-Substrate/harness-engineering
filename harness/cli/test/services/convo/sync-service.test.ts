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
  it('does no Flowspace work when consent is disabled by default', async () => {
    const flowspace = new FakeFlowspace();

    await expect(syncConversation(consent(false, 'default'), INGEST, flowspace)).resolves.toEqual({
      status: 'disabled',
      origin: 'default',
    });
    expect(flowspace.calls).toEqual([]);
    expect(flowspace.ingests).toEqual([]);
  });

  it('preserves kill-switch origin when consent is disabled', async () => {
    const flowspace = new FakeFlowspace();

    await expect(
      syncConversation(consent(false, 'kill-switch'), INGEST, flowspace),
    ).resolves.toEqual({
      status: 'disabled',
      origin: 'kill-switch',
    });
    expect(flowspace.calls).toEqual([]);
  });

  it('stops after detection when flowspace3 is absent', async () => {
    const flowspace = new FakeFlowspace({ detected: false });

    await expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).resolves.toEqual({
      status: 'undetected',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect']);
    expect(flowspace.ingests).toEqual([]);
  });

  it('reports enabled but unreachable once without ingesting', async () => {
    const flowspace = new FakeFlowspace({ reachable: false });

    await expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).resolves.toEqual({
      status: 'unreachable',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect', 'ping']);
    expect(flowspace.ingests).toEqual([]);
  });

  it('detects, pings, then fires one ingest with the exact identity', async () => {
    const flowspace = new FakeFlowspace();

    await expect(syncConversation(consent(true, 'repo'), INGEST, flowspace)).resolves.toEqual({
      status: 'fired',
      origin: 'repo',
    });
    expect(flowspace.calls).toEqual(['detect', 'ping', 'ingest']);
    expect(flowspace.ingests).toEqual([INGEST]);
  });

  it('copies recorded ingest arguments instead of retaining caller-owned state', async () => {
    const flowspace = new FakeFlowspace();
    const input = { ...INGEST };

    await syncConversation(consent(true, 'repo'), input, flowspace);
    input.session = 'mutated';

    expect(flowspace.ingests).toEqual([INGEST]);
  });
});
