import type { FlowspacePort, IngestArgs } from './flowspace-port.js';

export interface FakeFlowspaceOptions {
  detected?: boolean;
  reachable?: boolean;
}

/** Deterministic Flowspace seam: seeded availability, no daemon, recorded intent. */
export class FakeFlowspace implements FlowspacePort {
  readonly calls: Array<'detect' | 'ping' | 'ingest'> = [];
  readonly ingests: IngestArgs[] = [];

  constructor(private readonly options: FakeFlowspaceOptions = {}) {}

  detect(): boolean {
    this.calls.push('detect');
    return this.options.detected ?? true;
  }

  ping(): boolean {
    this.calls.push('ping');
    return this.options.reachable ?? true;
  }

  ingest(args: IngestArgs): void {
    this.calls.push('ingest');
    this.ingests.push({ ...args });
  }
}
