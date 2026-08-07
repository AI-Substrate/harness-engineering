import type {
  ProbeOutcome,
  RelayResult,
  SocketProbePort,
  SocketRelayPort,
} from './socket-probe-port.js';

/**
 * Deterministic sockets for tests (plan 074 · ac-000a) — fakes over mocks, the
 * repo's standing pattern.
 *
 * This is what makes the whole feature CI-achievable: EVERY probe outcome,
 * including `timeout` and `error:<code>`, is a seeded value rather than a
 * condition someone has to manufacture with a real daemon, a real socket, or a
 * real sandbox. No test in this plan needs any of those.
 */
export class FakeSocketProbe implements SocketProbePort {
  readonly calls: string[] = [];

  /**
   * `outcomes` maps socket path → outcome; `fallback` answers any path not
   * named. A test that cares about only one socket seeds only the fallback.
   */
  constructor(
    private readonly outcomes: Record<string, ProbeOutcome> = {},
    private readonly fallback: ProbeOutcome = 'absent',
  ) {}

  probe(path: string): Promise<ProbeOutcome> {
    this.calls.push(path);
    return Promise.resolve(this.outcomes[path] ?? this.fallback);
  }
}

/** One recorded replay write. */
export interface FakeRelayCall {
  path: string;
  payload: string;
}

/**
 * Deterministic relay. Records every write so a test can assert BOTH what was
 * replayed and — the point of ac-0007 — that a bare doctor/checks run wrote
 * nothing at all.
 */
export class FakeSocketRelay implements SocketRelayPort {
  readonly sends: FakeRelayCall[] = [];

  constructor(private readonly result: RelayResult = { ok: true, bytes: 0 }) {}

  send(path: string, payload: string): Promise<RelayResult> {
    this.sends.push({ path, payload });
    return Promise.resolve(
      this.result.ok ? { ok: true, bytes: Buffer.byteLength(payload, 'utf8') } : this.result,
    );
  }
}
