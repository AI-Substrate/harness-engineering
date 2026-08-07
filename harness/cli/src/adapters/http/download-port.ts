/**
 * HTTP GET port — the ONE seam through which the harness pulls bytes off the
 * network (plan 073 · ac-0015).
 *
 * It reports where the request ENDED UP (`url`) and how many hops it took, not
 * just what came back. That is the whole reason this is a port rather than a
 * bare `fetch` call: "the bytes arrived" and "the bytes came from the host we
 * pinned" are different claims, and only the second one is worth anything to a
 * verifier. A caller can then refuse a redirect that left the pinned host and
 * SAY SO, instead of reporting a digest mismatch and leaving an operator to
 * guess whether they were attacked or the mirror was stale.
 *
 * Lives in `adapters/` because services may only import `-port.ts` files from
 * this layer (`.dependency-cruiser.cjs`, rule `services-only-adapter-ports`).
 */
export interface DownloadPort {
  get(url: string, opts: { timeoutMs: number }): Promise<DownloadOutcome>;
}

export type DownloadOutcome =
  | {
      ok: true;
      status: number;
      /** The FINAL url after redirects. */
      url: string;
      redirects: number;
      bytes: Uint8Array;
      /** The server's declared `Content-Length`, when it sent one. */
      declaredBytes?: number;
    }
  | { ok: false; kind: 'timeout' | 'network'; message: string };
