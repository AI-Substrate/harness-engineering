/**
 * Generic hash port — services depend on this seam instead of runtime crypto.
 *
 * Injected to preserve the ports-only services rule and let tests use a
 * deterministic fake without changing production digest semantics.
 */
export interface HashPort {
  /** Return the lowercase hexadecimal SHA-256 digest for UTF-8 text or raw bytes. */
  sha256Hex(input: string | Uint8Array): string;
}
