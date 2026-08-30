export interface IngestArgs {
  harness: string;
  session: string;
  folder: string;
}

export type IngestDispatch = { status: 'fired' } | { status: 'dispatch-failed'; logPath: string };

export interface FlowspacePort {
  detect(): boolean;
  ping(): boolean;
  ingest(args: IngestArgs): Promise<IngestDispatch>;
}
