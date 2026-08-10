/**
 * THE INVOCATION PROBE PORT — "does the configured command RUN?" (plan 082, F008).
 *
 * A port rather than a service helper because answering it requires spawning a
 * child, and `statusHooks` must stay pure over its deps: a spawn inside the
 * service would make every status test spawn a process, and the fence a caller
 * injects would stop meaning anything.
 *
 * THE SENTINEL LIVES HERE, WITH THE TYPE, because it IS the contract. The
 * question the port answers is not "did the command exit 0" — on the Windows 11
 * guest measured 2026-08-10, Windows Script Host exited 0 after failing to
 * execute our ES module, and every status field we had said healthy. The only
 * honest evidence is a token that could not have appeared unless OUR CODE
 * PRINTED IT, so the producer (`harness hooks self-test`) and the consumer (the
 * spawning adapter) read the same constant from one place.
 *
 * DISTINCT FROM THE OWNERSHIP MARKER in `hook-marker.ts`: that one asserts a
 * config entry is ours, this one asserts a process reached our code. One string
 * serving both would let a probe that merely echoed the config look like proof.
 */
export const HOOK_SELF_TEST_MARKER = 'ai-substrate-harness-hook-self-test-ok';

/** What a probe reports about one configured invocation. */
export interface InvocationProbeResult {
  /** Did it exit 0? NOT sufficient for `runs` — see the module doc. */
  ok: boolean;
  /** Did our sentinel come back? The ONLY thing that can produce `runs`. */
  evidence: boolean;
  /** Why, in words, when there is no evidence. */
  detail?: string;
}

/**
 * Executes the CONFIGURED invocation and reports whether our code ran.
 *
 * It receives the interpreter and script READ BACK OUT OF THE USER'S CONFIG —
 * not what we would write now, and not `harness` off PATH — because the whole
 * finding is that the configured pair was not what we assumed. A probe that
 * reconstructs its own command answers a question nobody asked.
 *
 * `interpreter` is `null` for a pre-F008 (one-token) config, which is a real
 * answer and not a failure.
 */
export type InvocationProbe = (interpreter: string | null, script: string) => InvocationProbeResult;
