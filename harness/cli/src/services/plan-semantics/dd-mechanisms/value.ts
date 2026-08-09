/**
 * TEMPORARY COPY of dd `core/value` — no public `@ai-substrate/dd` home at the pin
 * (`@ai-substrate/dd/core/value` → ERR_PACKAGE_PATH_NOT_EXPORTED). Algorithm-class:
 * type narrowing that cannot drift. Replaced by dd's mechanism seam (dd `6aaef35`).
 * See ./README.md.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
