import type { FlowspacePort, IngestArgs, IngestDispatch } from './flowspace-port.js';

export interface FakeFlowspaceOptions {
  detected?: boolean;
  reachable?: boolean;
  dispatch?: IngestDispatch;
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

  async ingest(args: IngestArgs): Promise<IngestDispatch> {
    this.calls.push('ingest');
    this.ingests.push({ ...args });
    return this.options.dispatch ?? { status: 'fired' };
  }
}
