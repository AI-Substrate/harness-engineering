/**
 * Read-only SQLite port (plan 034 follow-on) — lets a telemetry adapter read a
 * harness's local SQLite store (e.g. Cursor's `state.vscdb`) WITHOUT importing
 * `node:*` (P2). `NodeDb` backs it with the experimental `node:sqlite`; tests use
 * `FakeDb`. Every read is best-effort: a missing / locked / corrupt db or a
 * failing query yields `[]`, never a throw — telemetry must never break the host.
 */

/** One result row as a column→value map (values are whatever SQLite returns). */
export type DbRow = Record<string, unknown>;

export interface DbPort {
  /**
   * Run a read-only SQL query against the SQLite file at `dbPath`, returning the
   * result rows. Returns `[]` if the file is missing/locked/unreadable or the
   * query fails (never throws). The connection is opened read-only and closed
   * before returning, so it is safe to run against a db another process holds.
   */
  query(dbPath: string, sql: string, params?: readonly (string | number)[]): DbRow[];
}
