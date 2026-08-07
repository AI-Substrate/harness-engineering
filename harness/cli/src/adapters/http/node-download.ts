import type { DownloadOutcome, DownloadPort } from './download-port.js';

/**
 * The real HTTP GET — global `fetch`, no dependency added (plan 073 · ac-0015).
 *
 * Redirects are followed BY HAND (`redirect: 'manual'`) rather than by the
 * runtime, and the reason is the whole point of the port: `fetch`'s automatic
 * mode reports the final URL but not the path taken, and a caller that has
 * pinned a host needs to know it was moved, how far, and to where. Following
 * manually makes each hop observable, caps the chain, and refuses a redirect
 * that omits a `Location` instead of silently returning a 3xx body as content.
 *
 * The timeout covers the WHOLE operation — connect, redirects and body read —
 * because a stalled body is exactly as fatal to a doctor run as a stalled
 * connect, and a timeout that only guards the handshake is a timeout in name.
 */
export class NodeDownload implements DownloadPort {
  /** Hops we will follow before calling it a loop. GitHub releases take two. */
  private static readonly MAX_REDIRECTS = 5;

  async get(url: string, opts: { timeoutMs: number }): Promise<DownloadOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, opts.timeoutMs));
    let timedOut = false;
    const onTimeout = (): void => {
      timedOut = true;
    };
    controller.signal.addEventListener('abort', onTimeout, { once: true });

    try {
      let current = url;
      let redirects = 0;
      for (;;) {
        const response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/octet-stream' },
        });

        if (response.status >= 300 && response.status <= 399) {
          const location = response.headers.get('location');
          if (location === null || location.trim() === '') {
            return {
              ok: false,
              kind: 'network',
              message: `HTTP ${response.status} from ${current} with no Location header`,
            };
          }
          if (redirects >= NodeDownload.MAX_REDIRECTS) {
            return {
              ok: false,
              kind: 'network',
              message: `more than ${NodeDownload.MAX_REDIRECTS} redirects starting at ${url}`,
            };
          }
          redirects += 1;
          current = new URL(location, current).toString();
          continue;
        }

        const declared = response.headers.get('content-length');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const declaredBytes =
          declared === null || !/^\d+$/.test(declared.trim())
            ? undefined
            : Number.parseInt(declared.trim(), 10);
        return {
          ok: true,
          status: response.status,
          // `response.url` is empty for a manual-redirect response in some
          // runtimes; the URL we actually requested is never in doubt.
          url: response.url === '' ? current : response.url,
          redirects,
          bytes,
          ...(declaredBytes === undefined ? {} : { declaredBytes }),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return timedOut
        ? { ok: false, kind: 'timeout', message: `timed out after ${opts.timeoutMs}ms: ${url}` }
        : { ok: false, kind: 'network', message: `${url}: ${message}` };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onTimeout);
    }
  }
}
