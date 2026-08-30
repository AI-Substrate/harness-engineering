export interface IngestArgs {
  harness: string;
  session: string;
  folder: string;
}

export interface FlowspacePort {
  detect(): boolean;
  ping(): boolean;
  ingest(args: IngestArgs): void;
}
