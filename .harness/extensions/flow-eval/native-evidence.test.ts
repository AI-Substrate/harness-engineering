import { describe, expect, it } from 'vitest';
import { acquireNativeEvidence, directArgv, type NativePorts } from './native-evidence.js';
import { resolveAssertionDetailed } from './resolvers.js';

const guid = '11111111-2222-3333-4444-555555555555';
const address = `conv:${guid}`;
function fixture(count = 403) {
  const saved = new Map<string, string>();
  const calls: Array<{ command: string; args: string[] }> = [];
  const turns = Array.from({ length: count }, (_, index) => ({
    address: `${address}#t${index + 1}`, turn_no: index + 1, role: 'agent', source: 'system',
    head_sha: 'a'.repeat(40), at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    body: `turn ${index + 1}`, items: [],
  }));
  let change: (command: string, args: string[], data: any) => any = (_c, _a, data) => data;
  const ports: NativePorts = {
    harness: { command: 'node', args: ['/evaluator/harness.js'] },
    save: (name, text) => saved.set(name, text),
    exec: async (command, args) => {
      calls.push({ command, args });
      let data: unknown;
      if (command === 'pij-rs') data = { seats: [{ id: 'pij-subject', session: 'native-1', harness: 'omp', folder: '/subject', model: 'gpt-config' }] };
      else if (args.includes('verify')) data = { guid, address, worktree: '/subject', turns: count, last_turn_at: turns[count - 1].at };
      else if (args[0] === 'get') {
        const around = Number(args[1].split('#t')[1]);
        data = { address, worktree: '/subject', base_sha: 'a'.repeat(40), turns: count, around, window: turns.slice(around - 1, around + 200) };
      } else data = { dispatched: true };
      return { ok: true, code: 0, stdout: JSON.stringify({ ok: true, data: change(command, args, data) }), stderr: '' };
    },
  };
  return { ports, saved, calls, turns, mutate: (fn: typeof change) => { change = fn; } };
}

describe('native Flowspace source', () => {
  it('pages the complete verified cutoff with at most 200 surrounding turns and preserves raw receipts', async () => {
    const f = fixture();
    const evidence = await acquireNativeEvidence('pij-subject', '/subject', f.ports);
    expect(evidence.complete).toBe(true);
    expect(evidence.turns).toHaveLength(403);
    expect(f.calls.filter((c) => c.args[0] === 'get').map((c) => c.args)).toEqual([
      ['get', `${address}#t1`, '--before', '0', '--after', '200', '--json'],
      ['get', `${address}#t202`, '--before', '0', '--after', '200', '--json'],
      ['get', `${address}#t403`, '--before', '0', '--after', '200', '--json'],
    ]);
    expect(evidence.source).toBe('flowspace');
    expect(evidence).not.toHaveProperty('segments');
    expect(evidence).not.toHaveProperty('effort');
    expect(evidence.provider_attestation).toBe('unverified');
    expect(f.saved.has('verify.json')).toBe(true);
    expect(f.saved.has('window-403.json')).toBe(true);
  });
  it('preserves null Git metadata from the delivered OMP positive-control shape', async () => {
    // The supplied control had 79 delivered turns, base_sha:null and head_sha:null.
    // Recreate that public shape without committing the private transcript.
    const f = fixture(79);
    f.mutate((_command, args, data) => args[0] === 'get' ? {
      ...data, base_sha: null, window: data.window.map((turn: Record<string, unknown>) => ({ ...turn, head_sha: null })),
    } : data);
    const evidence = await acquireNativeEvidence('pij-subject', '/subject', f.ports);
    expect(evidence.complete).toBe(true);
    expect(evidence.base_sha).toBeNull();
    expect(evidence.turns).toHaveLength(79);
    expect(evidence.turns.every((turn) => turn.head_sha === null)).toBe(true);
    expect(evidence.gaps).toContain('native base_sha unavailable; use independently bound preparation/Git evidence');
    expect(evidence.gaps).toContain('native per-turn head_sha unavailable; commit bindings require independent Git evidence');
    const persisted = JSON.parse(f.saved.get('native-evidence.json')!);
    expect(persisted.base_sha).toBeNull();
    expect(persisted.turns[0].head_sha).toBeNull();
  });
  it.each([1, 200, 201, 202, 402])('covers exactly %i turns at pagination boundaries', async (count) => {
    const f = fixture(count);
    const evidence = await acquireNativeEvidence('pij-subject', '/subject', f.ports);
    expect(evidence.complete).toBe(true);
    expect(evidence.turns).toHaveLength(count);
  });
  it.each([
    ['missing native ID', (c: string, _a: string[], data: any) => c === 'pij-rs' ? { seats: [{ ...data.seats[0], session: null }] } : data],
    ['wrong root', (c: string, _a: string[], data: any) => c === 'pij-rs' ? { seats: [{ ...data.seats[0], folder: '/other' }] } : data],
    ['missing turn', (_c: string, a: string[], data: any) => a[0] === 'get' ? { ...data, window: data.window.slice(1) } : data],
    ['changing cutoff', (_c: string, a: string[], data: any) => a[0] === 'get' ? { ...data, turns: 404 } : data],
    ['wrong conversation', (_c: string, a: string[], data: any) => a[0] === 'get' ? { ...data, address: 'conv:wrong' } : data],
    ['wrong final timestamp', (_c: string, a: string[], data: any) => a.includes('verify') ? { ...data, last_turn_at: '2020-01-01T00:00:00Z' } : data],
    ['missing delivery', (_c: string, a: string[], data: any) => a.includes('verify') ? { queued: true } : data],
  ] as const)('retains partial evidence as unknown for %s', async (_label, change) => {
    const f = fixture(); f.mutate(change);
    const evidence = await acquireNativeEvidence('pij-subject', '/subject', f.ports);
    expect(evidence.complete).toBe(false);
    expect(evidence.gaps.length).toBeGreaterThan(6);
    const result = await resolveAssertionDetailed({ id: 'N', type: 'native-evidence-complete', source: 'native', params: {} }, {
      evidence: null, native: evidence, worktree: '/subject', fs: { exists: () => false, readText: () => null, readdir: () => [] }, exec: f.ports.exec,
    });
    expect(result.verdict).toBe('unknown');
  });
  it('never reads a quoted wrapper, script body or tool-result prose as an executed command', () => {
    const call = (tool: string, command: string) => ({ kind: 'tool_call', tool, input: { kind: 'verbatim', text: JSON.stringify({ command }) } });
    expect(directArgv(call('bash', 'node harness/cli/bin/harness.js builder guide plan'))).toEqual(['node', 'harness/cli/bin/harness.js', 'builder', 'guide', 'plan']);
    for (const command of ['echo "harness checks"', 'node -e "harness checks"', 'harness checks && echo ok', 'harness checks; false', '$(harness checks)']) expect(directArgv(call('bash', command))).toBeNull();
    expect(directArgv(call('eval', 'harness checks'))).toBeNull();
    expect(directArgv({ kind: 'tool_result', tool: 'bash', head: 'harness checks passed' })).toBeNull();
  });
  it('keeps telemetry-only fields unknown even when native turns are complete', async () => {
    const f = fixture(1);
    const native = await acquireNativeEvidence('pij-subject', '/subject', f.ports);
    for (const type of ['checks-ran', 'gate-refused', 'compaction-occurred', 'skill-called']) {
      expect((await resolveAssertionDetailed({ id: type, type, source: 'telemetry', params: {} }, {
        evidence: null, native, worktree: '/subject', fs: { exists: () => false, readText: () => null, readdir: () => [] }, exec: f.ports.exec,
      })).verdict).toBe('unknown');
    }
  });
});
