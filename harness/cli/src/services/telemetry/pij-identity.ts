import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { type PijRegistry, readPijRegistry } from './pij-registry.js';
import type { Segment } from './segment.js';

/**
 * FX002 — an ADOPTED seat has no identity, so the exemplar was unscorable.
 *
 * `CURRENT_CAPTURED_ENV_KEYS` captures `PIJ_SESSION_ID` **from the environment**
 * (`capture-service.ts` · `selectCapturedEnv`). A seat that is *adopted* — an existing
 * terminal that registers itself rather than being spawned by pij — never had those
 * variables set, so it captures none of them. The join key is simply absent, and the
 * fleet join fails at the root. The seats doing the most interesting work are usually
 * adopted, including our own orchestrator seats, so we built an instrument that can
 * measure every seat except the exemplar.
 *
 * WHY THIS RESOLVES AT READ TIME, NOT AT CAPTURE TIME — a stated decision, because the
 * dossier's phrasing ("the segment must carry an explicit unresolved marker") reads as
 * capture-time and the alternative is not viable while the read pin stands:
 *
 *   A capture-time marker needs a NEW `Segment` field. This repo's convention bumps
 *   `SEGMENT_SCHEMA_VERSION` when the field SET moves (see the 2.7 note in
 *   `segment.ts`) — so the marker would make new records 2.8, and a 2.7 READ pin would
 *   then refuse every segment this build writes, as `unsupported_version`. The
 *   instrument would stop reading its own output. That is the packet's own defect
 *   class, arriving through the interaction of two of its own items.
 *
 * Resolving on READ avoids the schema entirely, and buys two things a capture-time fix
 * could not: it works RETROACTIVELY on adopted-seat segments already captured (which
 * is exactly the exemplar we cannot currently score), and it reuses the existing
 * read-only, fail-safe `pij-registry` substrate instead of writing a second reader.
 *
 * THE HARD CONSTRAINT: never fabricate an id. An unresolved identity is an explicit,
 * countable state. A guessed id produces a join that LOOKS successful and is wrong,
 * and this repo ranks a false green as worse than a false red because nothing ever
 * contests it.
 */

/**
 * WHY an identity could not be named — each a different, countable fact.
 *
 * UNRESOLVED IS NOT AN ERROR PATH. It is the normal, permanent, steady-state outcome
 * for at least one real inhabitant of `~/.pij`: `pij-telegram` is a RELAY — a bridge,
 * not an agent session — and it will never carry a harness session id, by its nature,
 * forever. If unresolved carried a severity, that seat would emit it permanently, and a
 * permanent warning is one everyone learns to ignore — which would then hide the
 * genuinely actionable unresolved cases behind it. We would have built an alarm whose
 * only steady output is noise, burying the signal it exists to guard.
 *
 * So the reasons below split along ACTIONABILITY, and {@link isActionable} is the one
 * place that decides it, so no consumer re-derives severity and drifts.
 */
export type PijIdentityUnresolved =
  /** No `PIJ_SESSION_ID` was captured and `~/.pij` was absent or unreadable. */
  | 'registry_unavailable'
  /** The registry was read, but no descriptor claims this harness session. */
  | 'no_descriptor_match'
  /**
   * The descriptor exists and is a RELAY with no session id — expected and permanent.
   * `pij-telegram` is the real-world referent. NOT a finding.
   */
  | 'no_session_by_nature'
  /**
   * The descriptor exists, is NOT a relay, and carries no session id. It SHOULD have
   * had one. This is the actionable twin of `no_session_by_nature`, and keeping them
   * apart is the whole point.
   */
  | 'session_key_missing'
  /**
   * MORE THAN ONE descriptor claims this harness session. Deliberately NOT resolved to
   * the first: several seats share a repo, and a first-wins pick is a guess wearing a
   * result's clothes. The candidates travel so a human can disambiguate.
   */
  | 'ambiguous';

/**
 * Whether an unresolved identity is a FINDING or just a fact.
 *
 * `no_session_by_nature` — a bridge that never has a session — is expected steady
 * state. `registry_unavailable` is a capability gap, not a statement about the seat
 * (this repo's standing rule: a capability gap is not a subject failure). The other
 * three are genuinely actionable.
 */
export function isActionable(reason: PijIdentityUnresolved): boolean {
  return reason !== 'no_session_by_nature' && reason !== 'registry_unavailable';
}

/** How an identity was established — or why it was not. Never a bare `null`. */
export type PijIdentity =
  | {
      status: 'resolved';
      pij_id: string;
      /** `env` — the seat was spawned by pij. `registry` — adopted, recovered by reverse join. */
      via: 'env' | 'registry';
    }
  | {
      status: 'unresolved';
      reason: PijIdentityUnresolved;
      /**
       * Whether this is a FINDING (`true`) or expected steady state (`false`).
       * Carried rather than left to the consumer so severity is decided ONCE — see
       * {@link isActionable}.
       */
      actionable: boolean;
      /** Populated ONLY for `ambiguous` — every descriptor that claimed the session. */
      candidates: string[];
    };

const PIJ_SESSION_ENV = 'PIJ_SESSION_ID';

/** One construction site for an unresolved identity, so `actionable` can never drift. */
function unresolved(reason: PijIdentityUnresolved, candidates: string[] = []): PijIdentity {
  return { status: 'unresolved', reason, actionable: isActionable(reason), candidates };
}

/**
 * Every pij id whose descriptor claims `harnessSessionId`.
 *
 * Deliberately scans `by_pij` rather than using the registry's `by_harness_session`
 * map: that map is first-wins (`pij-registry.ts` — it only sets a key it does not
 * already have), so a genuine collision is invisible through it. Ambiguity is the
 * thing we must SEE here, so the lossy index is the wrong instrument. The registry
 * itself is untouched — other consumers keep the behaviour they were written against.
 */
export function descriptorsClaiming(registry: PijRegistry, harnessSessionId: string): string[] {
  const out: string[] = [];
  for (const [pijId, desc] of registry.by_pij) {
    if (desc.harness_session_id === harnessSessionId) out.push(pijId);
  }
  return out.sort();
}

/**
 * Resolve a seat's pij identity from what the capture actually recorded, falling back
 * to a reverse join through the pij registry for adopted seats.
 *
 * Precedence is deliberate: a captured `PIJ_SESSION_ID` is the seat stating its OWN
 * identity and always wins. The registry is consulted only when the env said nothing —
 * it is corroborating evidence, never an override.
 */
export function resolvePijIdentity(
  capturedEnv: Record<string, string> | undefined,
  harnessSessionId: string,
  registry: PijRegistry,
): PijIdentity {
  const fromEnv = capturedEnv?.[PIJ_SESSION_ENV];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return { status: 'resolved', pij_id: fromEnv, via: 'env' };
  }
  if (!registry.available) {
    return unresolved('registry_unavailable');
  }
  const claiming = descriptorsClaiming(registry, harnessSessionId);
  if (claiming.length === 0) {
    return unresolved('no_descriptor_match');
  }
  if (claiming.length > 1) {
    return unresolved('ambiguous', claiming);
  }
  return { status: 'resolved', pij_id: claiming[0], via: 'registry' };
}

/**
 * Resolve identity from the DESCRIPTOR direction — "can this seat be joined at all?"
 *
 * This is where the bridge case lives, and why it exists: the session direction
 * ({@link resolvePijIdentity}) is keyed BY a harness session id, so a seat that has no
 * session id can never be its subject and its "no session" fact has nowhere to be said.
 * Asked about a pij id instead, the answer is available and, crucially, SPLITTABLE:
 *
 *   relay + no session id  -> `no_session_by_nature`  expected, permanent, NOT a finding
 *   not a relay, no id     -> `session_key_missing`   should have had one — actionable
 *
 * Collapsing those two is what would make `pij-telegram` emit a permanent finding, and
 * a permanent finding is one everyone learns to ignore.
 */
export function resolveDescriptorIdentity(pijId: string, registry: PijRegistry): PijIdentity {
  if (!registry.available) return unresolved('registry_unavailable');
  const descriptor = registry.by_pij.get(pijId);
  if (descriptor === undefined) return unresolved('no_descriptor_match');
  if (descriptor.harness_session_id === null) {
    return unresolved(descriptor.relay ? 'no_session_by_nature' : 'session_key_missing');
  }
  return { status: 'resolved', pij_id: pijId, via: 'registry' };
}

/** The ports the read-time resolution needs — the same pair `readPijRegistry` takes. */
export interface PijIdentityDeps {
  fs: Pick<FsPort, 'readText' | 'readdir'>;
  env: Pick<EnvPort, 'home'>;
}

/**
 * {@link resolvePijIdentity} for a session's segments, reading the registry once.
 *
 * FAIL-SAFE, like every telemetry read: an exploding registry read resolves to
 * `registry_unavailable` rather than throwing — but note it resolves to a NAMED
 * unavailable, not to a silent absence, which is the distinction this whole packet
 * turns on.
 */
export function resolveSessionPijIdentity(
  segments: readonly Segment[],
  harnessSessionId: string,
  deps: PijIdentityDeps | undefined,
): PijIdentity {
  const captured = segments.find(
    (seg) => (seg.captured_env?.[PIJ_SESSION_ENV] ?? '').length > 0,
  )?.captured_env;
  if (captured !== undefined) {
    return { status: 'resolved', pij_id: captured[PIJ_SESSION_ENV], via: 'env' };
  }
  if (deps === undefined) {
    return unresolved('registry_unavailable');
  }
  let registry: PijRegistry;
  try {
    registry = readPijRegistry(deps);
  } catch {
    return unresolved('registry_unavailable');
  }
  return resolvePijIdentity(undefined, harnessSessionId, registry);
}
