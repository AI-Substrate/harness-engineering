/**
 * Clock port — the kernel's only side-effect dependency.
 *
 * Injected (never `new Date()` inside services/kernel) so envelope timestamps
 * are deterministic in unit tests. See workshop 001 + plan Finding 04.
 */
export interface Clock {
  /** Current instant as an ISO-8601 string, e.g. "2026-06-08T07:20:00.000Z". */
  nowIso(): string;
}
