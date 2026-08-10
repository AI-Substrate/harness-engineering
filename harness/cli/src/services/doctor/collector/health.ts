import type { HashPort } from '../../../adapters/hash/hash-port.js';
import { type AgentMarker, agentsMissingHooks, detectAgents } from './agents.js';
import {
  type IngressReading,
  ingressBlocked,
  markerExplanation,
  trace2TargetPath,
} from './ingress.js';
import { GITAI_PIN } from './pin.js';
import { binaryPathFor, daemonPidPathFor, type PathLookup, resolveArtifact } from './platform.js';
import { type CollectorState, claimedHookAgents, readCollectorState } from './state.js';
import type { CollectorFsPort, CollectorPin, HostTarget } from './types.js';

/**
 * The collector health read (plan 073 · ac-000a, ac-000b, ac-000c, ac-0010,
 * ac-0012, ac-0014).
 *
 * SIMPLE AND BOUNDED, on purpose. It answers four questions a filesystem can
 * answer — is the pinned binary present and still hash-matching, were the hooks
 * installed and do they cover every agent now on this machine, is there a daemon
 * pid file, is the note schema the one we pinned — and it stops there.
 *
 * It does NOT claim collection is occurring, and that omission is the honest
 * part (ac-0012). `git ai status --json` reports only the CURRENT uncommitted
 * working log, which git-ai deletes at commit, and its `time_ago` is a human
 * string rather than a timestamp. A healthy collector therefore reads EMPTY
 * immediately after any commit — so a "recent checkpoint" check cannot tell a
 * broken collector from a clean tree. v1 records that gap instead of shipping a
 * check that would be wrong exactly when it mattered.
 *
 * `could-not-determine` is its own verdict. It is never rendered as healthy and
 * never folded into "not installed": absent is not green, and empty is not
 * clean. And every verdict is advisory — doctor warns, doctor never blocks
 * (ac-000c).
 */

export type CollectorVerdict =
  | 'healthy'
  | 'not-installed'
  | 'cli-only-trace2'
  | 'cli-only-skills'
  | 'hooks-incomplete'
  | 'ingress-blocked'
  | 'binary-not-on-path'
  | 'degraded'
  | 'could-not-determine';

export interface CollectorHealth {
  verdict: CollectorVerdict;
  /** One-line operator summary. */
  detail: string;
  /** What to do about it — present for every non-healthy verdict. */
  next_action?: string;
  binary: {
    path: string;
    present: boolean;
    /** 'match' | 'mismatch' | 'unknown' — unknown when no hash port was wired. */
    digest: 'match' | 'mismatch' | 'unknown';
  };
  hooks: {
    status: CollectorState['hooks']['status'] | 'unknown';
    /** Agents on this machine with no recorded hook install (ac-0010). */
    missing: string[];
  };
  daemon: 'pidfile-present' | 'pidfile-absent' | 'unknown';
  noteSchema: {
    expected: string;
    observed: string | null;
    status: 'match' | 'mismatch' | 'unknown';
  };
  /** The trace2 observation this read is standing on, if any was ever recorded. */
  trace2: { observed: 'empty' | 'present' | 'unknown'; at: string } | null;
  /**
   * The last install/re-check ATTEMPT, which is a different fact from `hooks`
   * above. A guard that refused to run git-ai changes this and nothing else —
   * hook coverage is a fact about the machine and survives a blocked attempt
   * intact (phase-1 review, round 3).
   */
  lastAttempt: { status: CollectorState['hooks']['status']; at: string; detail: string } | null;
  /**
   * The ingress probe this read stood on, when one was supplied (plan 074 ·
   * ac-0002). `null` means nobody probed — which is NOT the same as a probe that
   * came back clean, and is never rendered as one.
   *
   * Set on EVERY verdict since plan 077. It previously went missing on the three
   * `could-not-determine` rungs and both `not-installed` rungs, which made a
   * dropped reading indistinguishable from an absent one — the exact confusion
   * this field's `null` was defined to prevent.
   */
  ingress?: IngressReading | null;
  /**
   * Whether the bare name `git-ai` resolves on this process's PATH, when the
   * composition root looked. `null` means nobody looked — never rendered as
   * resolvable.
   */
  onPath?: PathLookup | null;
}

export interface CollectorHealthDeps {
  fs: CollectorFsPort;
  host: HostTarget;
  cwd: string;
  /**
   * Optional: with a hash port the binary's digest is RE-checked against the pin
   * on every read; without one the digest reads `unknown` and the verdict cannot
   * be `healthy`. Absent evidence never upgrades to good news.
   */
  hash?: HashPort;
  manifest?: CollectorPin;
  /**
   * An ALREADY-PERFORMED ingress probe (plan 074 · ac-0002). The probe is
   * asynchronous and this read is synchronous by design, so the composition root
   * probes first and injects the reading — which also keeps the verdict logic a
   * pure function of its inputs, drivable through every outcome with fakes.
   *
   * Absent → the ingress rung is simply not evaluated. Absence never upgrades to
   * good news and never manufactures a warning.
   */
  ingress?: IngressReading;
  /**
   * `HARNESS_NO_COLLECTOR=1` — the operator has explicitly declined the
   * automatic install. Read by the composition root and passed in (P2).
   *
   * It does NOT change what the filesystem says; it changes what the row is
   * allowed to imply. A deliberate opt-out must never render as
   * `could-not-determine` or as a broken machine, because "I chose this" and
   * "something is wrong here" are different facts and only one of them needs
   * acting on.
   */
  optedOut?: boolean;
  /**
   * An ALREADY-PERFORMED lookup of the bare name `git-ai` against PATH (see
   * {@link lookupGitAiOnPath}) — performed by the composition root, which is the
   * only layer holding the env. Absent → the rung is not evaluated; absence
   * never manufactures a warning.
   */
  pathLookup?: PathLookup;
}

/**
 * Never `healthy`: a verdict that rests on evidence we did not actually read.
 *
 * `ingress` is a REQUIRED parameter rather than an optional field on `extra`,
 * and that is the fix for a real defect (plan 077). Every caller probed, and
 * every caller then dropped the reading on the floor: `undetermined` never set
 * `ingress`, so the key was ABSENT from these three verdicts. Absent is not the
 * same as `null` — `null` is this read's way of saying nobody probed, and the
 * three could-not-determine paths were emitting something indistinguishable from
 * it while a probe HAD been taken and thrown away.
 *
 * Worse, a blocked ingress is the more urgent fact of the two. These rungs all
 * precede the `ingress-blocked` rung below, so an operator whose install state
 * is merely unrecorded was told "run --install-collector" and never told that
 * commits made from here carry NO attribution. The verdict stays
 * `could-not-determine` — we genuinely cannot determine the install — but the
 * evidence travels with it, and {@link withIngressWarning} adds the blocked
 * ingress to the operator's line so the actionable half is not silently lost.
 *
 * Making the parameter required is what stops this recurring: a new
 * could-not-determine path cannot forget to pass it, because it will not compile.
 */
function undetermined(
  detail: string,
  binary: CollectorHealth['binary'],
  ingress: IngressReading | null,
  extra: Partial<CollectorHealth> = {},
): CollectorHealth {
  return withIngressWarning({
    verdict: 'could-not-determine',
    detail,
    next_action:
      'Run `harness doctor --install-collector` to (re)place the pinned git-ai binary and record its state, then re-run doctor.',
    binary,
    hooks: { status: 'unknown', missing: [] },
    daemon: 'unknown',
    noteSchema: { expected: GITAI_PIN.expect_schema_version, observed: null, status: 'unknown' },
    trace2: null,
    lastAttempt: null,
    ingress,
    ...extra,
  });
}

/**
 * Append the blocked-ingress fact to a verdict that is NOT `ingress-blocked`.
 *
 * The verdict itself is left alone on purpose. `could-not-determine` is the
 * honest answer to "is the collector installed and hooked up", and promoting a
 * blocked ingress over it would claim git-ai *is* installed and hooked up —
 * which is exactly what this read could not establish. So the verdict keeps
 * saying what it knows, and the detail carries the second, independent fact
 * rather than dropping it.
 *
 * Two facts, one row: the operator hears both, and neither is asserted as the
 * other.
 */
function withIngressWarning(health: CollectorHealth): CollectorHealth {
  const reading = health.ingress;
  if (reading == null || !ingressBlocked(reading)) return health;
  // The target's OWN path, from the kind table's accessor — never a kind check
  // that collapses to `(unknown)` (plan 082 · F006). A blocked reading always has
  // a probed endpoint, so `(unknown)` here would only ever have meant "we know
  // the path and declined to print it", which reads to the operator as a
  // missing fact rather than an omitted one.
  const socket = trace2TargetPath(reading.target) ?? '(unknown)';
  // Same nudge caveat as the `ingress-blocked` rung: replay into a named pipe is
  // refused (TRACE2_TARGET_POLICY.named_pipe.replayInto === false), so a Windows
  // operator must not be sent to a command that will decline.
  const recovery =
    reading.target.kind === 'named_pipe'
      ? 'Independently of that, commit through `harness commit "<message>"` while the ingress is blocked; note that `harness doctor telemetry-nudge` cannot replay into a named-pipe ingress.'
      : 'Independently of that, commit through `harness commit "<message>"` while the ingress is blocked, then run `harness doctor telemetry-nudge` from an UNSANDBOXED shell.';
  return {
    ...health,
    detail: `${health.detail}; SEPARATELY, this process cannot reach the git-ai ingress at ${socket}${markerExplanation(reading)}, so commits made from here carry NO attribution and git-ai may later attest their lines as known-human`,
    next_action: `${health.next_action ?? ''} ${recovery}`.trim(),
  };
}

/**
 * Re-word a "nothing is installed" rung for an operator who DECLINED the install.
 *
 * The filesystem facts are identical either way — that is exactly the problem.
 * Without this, `HARNESS_NO_COLLECTOR=1` produces a row indistinguishable from a
 * machine where the install silently failed, and a `next_action` telling the
 * operator to run the very command they opted out of. The verdict is left alone;
 * only the explanation and the advice change, because what moved is our
 * knowledge of WHY, not what is on disk.
 */
function asOptedOut(health: CollectorHealth, optedOut: boolean): CollectorHealth {
  if (!optedOut) return health;
  if (health.verdict === 'healthy') return health;
  return {
    ...health,
    detail: `${health.detail} — and HARNESS_NO_COLLECTOR=1 is set, so harness did not install anything: this is a DELIBERATE opt-out, not a broken machine`,
    next_action:
      'Nothing to do unless you want attribution: unset `HARNESS_NO_COLLECTOR`, or run `harness doctor --install-collector` once to install the pinned collector explicitly.',
  };
}

export function readCollectorHealth(deps: CollectorHealthDeps): CollectorHealth {
  const manifest = deps.manifest ?? GITAI_PIN;
  const optedOut = deps.optedOut === true;
  const maybeOptedOut = (health: CollectorHealth): CollectorHealth => asOptedOut(health, optedOut);
  const binaryPath = binaryPathFor(deps.host.home, deps.host.platform);
  const present = deps.fs.exists(binaryPath);
  const state = readCollectorState(deps.fs, deps.cwd);

  const resolution = resolveArtifact(deps.host.platform, deps.host.arch, manifest);
  if (!resolution.ok) {
    return {
      verdict: 'not-installed',
      detail: resolution.detail,
      next_action:
        'git-ai publishes no binary for this platform/arch. AI attribution cannot be collected here; nothing was installed.',
      binary: { path: binaryPath, present, digest: 'unknown' },
      hooks: { status: 'unknown', missing: [] },
      daemon: 'unknown',
      noteSchema: { expected: manifest.expect_schema_version, observed: null, status: 'unknown' },
      trace2: null,
      lastAttempt: null,
      // Carried, not warned on. With no binary published for this host there is
      // nothing collecting, so a blocked ingress is not an independent piece of
      // bad news here — but the reading still travels, because `null` has to
      // keep meaning "nobody probed" and nothing else.
      ingress: deps.ingress ?? null,
    };
  }

  // Digest: re-read from disk when a hash port is wired. `unknown` is honest and
  // is NOT healthy — it is the difference between "we checked" and "we assumed".
  let digest: CollectorHealth['binary']['digest'] = 'unknown';
  if (present && deps.hash !== undefined) {
    const bytes = deps.fs.readBytesNoFollow(binaryPath);
    digest =
      bytes === null
        ? 'unknown'
        : deps.hash.sha256Hex(bytes).toLowerCase() === resolution.artifact.sha256.toLowerCase()
          ? 'match'
          : 'mismatch';
  } else if (present && state?.cli.digest != null) {
    digest =
      state.cli.digest.toLowerCase() === resolution.artifact.sha256.toLowerCase()
        ? 'match'
        : 'mismatch';
  }

  const binary = { path: binaryPath, present, digest };

  if (!present && state === null) {
    return maybeOptedOut({
      verdict: 'not-installed',
      detail: `git-ai is not installed (no binary at ${binaryPath}, no recorded install)`,
      next_action:
        'Run `harness doctor --install-collector` to fetch the pinned git-ai release, verify its SHA-256, and install the agent hooks.',
      binary,
      hooks: { status: 'unknown', missing: [] },
      daemon: 'unknown',
      noteSchema: { expected: manifest.expect_schema_version, observed: null, status: 'unknown' },
      trace2: null,
      lastAttempt: null,
      // Same reasoning as the unsupported-platform rung above: the reading is
      // preserved, but nothing is installed to be losing attribution, so it is
      // not surfaced as a second warning.
      ingress: deps.ingress ?? null,
    });
  }
  if (state === null) {
    return maybeOptedOut(
      undetermined(
        `a git-ai binary exists at ${binaryPath} but harness has no record of installing it — provenance and hook state are unknown`,
        binary,
        deps.ingress ?? null,
      ),
    );
  }
  if (!present) {
    return undetermined(
      `harness recorded a git-ai install (${state.cli.status}) but nothing is at ${binaryPath} — the binary has been moved or removed`,
      binary,
      deps.ingress ?? null,
      { trace2: latestTrace2(state) },
    );
  }

  const detected = detectAgents(deps.fs, deps.host.home);
  const missing: AgentMarker[] =
    state.hooks.status === 'installed'
      ? agentsMissingHooks(detected, claimedHookAgents(state))
      : [];
  const daemon: CollectorHealth['daemon'] = deps.fs.exists(daemonPidPathFor(deps.host.home))
    ? 'pidfile-present'
    : 'pidfile-absent';
  const attempt = state.last_attempt ?? null;
  const base = {
    binary,
    hooks: { status: state.hooks.status, missing: missing.map((agent) => agent.id) },
    daemon,
    noteSchema: state.note_schema,
    trace2: latestTrace2(state),
    lastAttempt:
      attempt === null ? null : { status: attempt.status, at: attempt.at, detail: attempt.detail },
    ingress: deps.ingress ?? null,
    onPath: deps.pathLookup ?? null,
  };

  if (digest === 'mismatch') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `the git-ai binary at ${binaryPath} does NOT match the pinned ${manifest.version} digest — it has been replaced or upgraded out from under the manifest`,
      next_action:
        'Re-run `harness doctor --install-collector` to restore the pinned, verified binary (git-ai auto-update should already be disabled in ~/.git-ai/config.json).',
    };
  }

  // The distinct partial state (ac-0014): the CLI is genuinely installed and
  // verified; the hooks are genuinely not on, for a named and recoverable
  // reason. Not healthy, not a failed install, not could-not-determine.
  //
  // THIS RUNG QUOTES A RECORD, AND NOW SAYS SO. `readCollectorHealth` is
  // synchronous by design, so it cannot re-read the live git config — every
  // word here is about what the LAST ATTEMPT observed, at the timestamp given.
  // Stating that as a present-tense fact about the machine is what made the
  // operator-facing half of the latch: they removed the section we told them to
  // remove and were told it was still there. The unlatch itself lives in
  // `auto-install.ts` (it re-reads the live config before trusting this
  // verdict); what belongs HERE is not overclaiming, and naming a command that
  // works from where they are standing.
  if (state.hooks.status === 'skipped-trace2') {
    const observedAt = base.trace2 === null ? '' : ` when last checked (${base.trace2.at})`;
    return {
      ...base,
      verdict: 'cli-only-trace2',
      detail: `git-ai CLI installed and hash-matching (${manifest.version}), hooks NOT installed because a global trace2 config was observed present${observedAt} — no AI attribution is being collected`,
      next_action:
        'Back up your global trace2 keys and remove the section (`git-ai install-hooks` deletes it machine-wide, so harness will not do it for you) — then a plain `harness doctor` re-reads the live config and installs the hooks. `harness doctor --install-collector` forces it immediately. If you would rather keep your trace2 config, run `git-ai install-hooks` yourself knowing the section goes.',
    };
  }
  if (state.hooks.status === 'skipped-skills') {
    return {
      ...base,
      verdict: 'cli-only-skills',
      detail: `git-ai CLI installed and hash-matching (${manifest.version}), hooks NOT installed because real content sits where git-ai keeps its skill links — ${state.hooks.detail}`,
      next_action:
        'Move or rename the reported skill paths if they are yours to keep, then re-run `harness doctor --install-collector`. Harness will not delete them for you.',
    };
  }
  // A NEW STATE INHERITS THE DEFAULT VERDICT OF EVERY RUNG THAT PREDATES IT, and
  // the default at the bottom of this ladder is `healthy` (plan 082 · F007).
  //
  // This rung is not decoration. Without it a `binary-unusable` state falls
  // through `skipped-*`, through `failed || not-attempted`, past the missing-agent
  // rung — and lands on `healthy`, announcing that a binary which cannot start is
  // "installed and hash-matching, collection is CONFIGURED". The row was already
  // half-lying before F007 (it reported the CLI `already-current`, a claim about
  // bytes, beside a hook failure caused by those bytes not running); after F007 it
  // would have lied MORE loudly, because the hook stage would no longer say
  // `failed` to contradict it.
  //
  // The CLI half of the sentence is kept TRUE rather than softened: the artifact
  // genuinely is present and genuinely does match the pin. What is added is the
  // half that was missing — that this proves provenance and not viability.
  //
  // F3 (review round 2) — THE CAUSE IS NAMED ONCE, BY THE CODE THAT MEASURED IT.
  // This action used to assert that a missing Visual C++ Redistributable was the
  // usual Windows cause of EVERY `binary-unusable` outcome — a timeout, a failed
  // spawn, a silent exit 0, an ordinary non-zero, and on hosts that are not
  // Windows at all. Only ONE cause was ever measured (`0xC0000135`, fixed on a
  // Windows 11 guest on 2026-08-10), and `describeExit` already names it for
  // exactly that code and no other. That sentence arrives here inside
  // `state.hooks.detail`, and this rung CARRIES it rather than deciding for
  // itself when to mention a redistributable. `describeExit` stays the only
  // thing in the codebase that names one.
  //
  // AND next_action CARRIES IT, NOT `detail` — because an actionable string must
  // be SELF-CONTAINED. You cannot control which surface renders it alone, and
  // one already does: `harness checks`' housekeeping nudge takes `next_action`
  // and nothing else (`housekeeping.ts` · `CollectorHooksReading`, three fields
  // on purpose so it cannot couple to this ladder). A `next_action` that says
  // "see the detail above" is false wherever there is no above. So the cause
  // travels with the action, and `detail` states the condition without it —
  // which is also why this is not a stutter on the doctor row: the two fields
  // say different things, they do not repeat one.
  //
  // AND THE COMMAND IS RUNNABLE. It said `git-ai --version`, which is not on
  // PATH: harness deliberately never runs the vendor's `install.sh` (see the
  // header of install.ts), and that installer is the thing that prepends PATH.
  // We placed the binary at a path we know, so we hand over that path.
  if (state.hooks.status === 'binary-unusable') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `the pinned git-ai ${manifest.version} is present at ${binaryPath} and its digest matches — but it CANNOT RUN on this machine, so no hooks were installed and no AI attribution is being collected`,
      next_action: `Make the binary at ${binaryPath} runnable and harness needs nothing further from you — it re-probes on the next ordinary \`harness doctor\` and installs the hooks itself once it runs, with no flag and no re-run by hand. This is what harness observed when it asked: ${state.hooks.detail}`,
    };
  }
  if (state.hooks.status === 'unverified') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `git-ai CLI installed, but the hook install could NOT be verified — ${state.hooks.detail}`,
      next_action:
        'Nothing here proves hooks are on: `git-ai install-hooks` exited 0 without leaving its own global trace2 key. Re-run `harness doctor --install-collector`, and if it repeats, run `git-ai install-hooks` by hand and read its output.',
    };
  }
  if (state.hooks.status === 'failed' || state.hooks.status === 'not-attempted') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `git-ai CLI installed but hooks are ${state.hooks.status} — ${state.hooks.detail}`,
      next_action: 'Re-run `harness doctor --install-collector` and read the reported cause.',
    };
  }
  if (missing.length > 0) {
    // The gap is about the NEW harness, never about the collector as a whole:
    // the hooks that are on are still on and still collecting. When a re-check
    // has already been blocked by a guard, saying "re-run the re-check" is
    // advice we know does not work — `--recheck-collector` is still not named
    // here, and for a second reason found since: `recheckCollector` returns
    // early when no NEW agent is detected, so it is not a general remedy at all.
    // What the operator IS told is the pair that works — remove the cause and
    // re-run a plain doctor (which now re-reads the live config), or run the
    // vendor command by hand.
    const labels = missing.map((agent) => agent.label).join(', ');
    const covered = `hooks remain installed and collecting for ${state.hooks.agents.length} EVIDENCED agent(s)${
      state.hooks.agents.length === 0 ? '' : ` (${state.hooks.agents.join(', ')})`
    }${unevidencedSuffix(state)}`;
    if (attempt?.status === 'skipped-trace2') {
      return {
        ...base,
        verdict: 'hooks-incomplete',
        detail: `${covered}, but ${labels} is NOT instrumented — the automatic re-install was blocked because a global trace2 config was observed present at ${attempt.at}`,
        next_action: `Back up your global trace2 keys and remove the section, then re-run \`harness doctor\` — it re-reads the live config and will cover ${labels} automatically. Or run \`${binaryPath} install-hooks\` yourself (it deletes the whole global trace2 section, so harness will not do it for you). The hooks already installed are unaffected either way.`,
      };
    }
    if (attempt?.status === 'skipped-skills') {
      return {
        ...base,
        verdict: 'hooks-incomplete',
        detail: `${covered}, but ${labels} is NOT instrumented — the automatic re-install was blocked because real content sits where git-ai keeps its skill links: ${attempt.detail}`,
        next_action: `Move or rename the reported skill paths if they are yours to keep, then re-run \`harness doctor --recheck-collector\` to cover ${labels}. The hooks already installed are unaffected either way.`,
      };
    }
    if (attempt?.status === 'binary-unusable') {
      // The rung that made F3's condition matter: this is the ONLY
      // `binary-unusable` verdict `harness checks`' housekeeping nudge can
      // reach, and that surface renders `next_action` with no `detail` beside
      // it. `missing` is `[]` unless `hooks.status === 'installed'`
      // (see above), so the primary rung above structurally cannot get here —
      // measured, not assumed. Hence the same rule, for the same reason: the
      // observation travels inside the action, and `describeExit` remains the
      // only code that names a redistributable.
      return {
        ...base,
        verdict: 'hooks-incomplete',
        detail: `${covered}, but ${labels} is NOT instrumented — the automatic re-install was blocked at ${attempt.at} because the pinned binary could no longer run`,
        next_action: `Make the binary at ${binaryPath} runnable and the next ordinary \`harness doctor\` covers ${labels} by itself. The hooks already installed are unaffected — they were installed by a binary that ran. This is what harness observed when it asked: ${attempt.detail}`,
      };
    }
    return {
      ...base,
      verdict: 'hooks-incomplete',
      detail: `a coding harness appeared since the hooks were installed: ${labels} — its edits are not being attributed (${covered})`,
      next_action:
        'Run `harness doctor --recheck-collector` to install hooks for the new harness (the trace2 guard runs again first).',
    };
  }
  if (digest === 'unknown') {
    return undetermined(
      `git-ai is present at ${binaryPath} but its digest could not be re-verified on this read`,
      binary,
      deps.ingress ?? null,
      { hooks: base.hooks, daemon, noteSchema: base.noteSchema, trace2: base.trace2 },
    );
  }
  if (state.note_schema.status === 'mismatch') {
    return {
      ...base,
      verdict: 'degraded',
      detail: `git-ai writes note schema ${state.note_schema.observed ?? 'unknown'} but the manifest expects ${state.note_schema.expected} — readers may misparse the notes`,
      next_action:
        'Review the manifest and the note readers together; bump `expect_schema_version` in manifest.ts only with the readers.',
    };
  }

  // ADDITIVE (plan 074 · ac-0002): everything a filesystem can see is fine, and
  // yet this process cannot reach the ingress. Placed here, immediately before
  // `healthy`, so no pre-existing verdict path changes — the ONLY read it
  // converts is one that would otherwise have said "collection is configured",
  // which is exactly the read that would have been a lie.
  //
  // Why it matters more than it looks: a blocked ingress does not merely lose
  // data. git-ai's recovery ladder attests the unrecorded lines as known-HUMAN
  // (dossier F-03), so the output is a confident wrong number that no
  // filesystem-level signal can see. Warn-only, like every doctor rung (073
  // ac-000c) — this never blocks a commit or a run.
  if (deps.ingress !== undefined && ingressBlocked(deps.ingress)) {
    const socket = trace2TargetPath(deps.ingress.target) ?? '(unknown)';
    // TRANSPORT-AWARE, because a pipe reading can reach this rung now (plan 082
    // · F006) and three of these sentences were written when only a socket
    // could. "the socket file exists" is not merely imprecise about a pipe — it
    // is false: no stat was taken and there is no file to stat. For a pipe the
    // CONNECT carries that evidence instead (`ENOENT` → absent, `EACCES` →
    // denied), so the sentence has to name what was actually observed.
    const pipe = deps.ingress.target.kind === 'named_pipe';
    const endpoint = pipe ? `named pipe at ${socket}` : `ingress socket at ${socket}`;
    // The af_unix sentence is MEASURED: a denied connect to a socket file that
    // is right there is the observed Seatbelt/command-sandbox signature on this
    // machine. The PIPE sentence must NOT inherit that claim — nothing in this
    // repo has run on Windows, so it says what would follow rather than what was
    // seen. One measured sentence and one inferred sentence must not read alike.
    const evidence = pipe
      ? 'the connect was denied rather than simply failing to find the pipe, which is consistent with a command sandbox denying the connect — UNMEASURED on Windows, this is inference from the error code, not an observed signature'
      : 'the connect was denied while the socket file exists, which is what a command sandbox looks like';
    // The nudge REPLAY is refused on a pipe (plan 075, unchanged by F006 — see
    // TRACE2_TARGET_POLICY.named_pipe.replayInto). Naming it here would hand a
    // Windows operator a command that answers "not supported on this platform",
    // which is worse than naming no command at all.
    //
    // Nor does `harness commit` VERIFY on this branch: it deliberately skips the
    // note poll and reports `ingress-unverified` (commit-service.ts, plan 075 ·
    // ac-0005), so promising it "tells you whether attribution landed" would
    // promise evidence the command refuses to produce. What it actually does is
    // commit without diverting the pipe and report the outcome as UNVERIFIED —
    // the manual note check is the only thing that answers the question.
    const recovery = pipe
      ? 'Commit through `harness commit "<message>"`, which commits WITHOUT overriding the pipe and reports attribution as NOT VERIFIED on this platform — it buffers nothing here, so there is nothing to drain. Check a commit for yourself with `git notes --ref=ai show <sha>`. Replay via `harness doctor telemetry-nudge` is NOT available for a named-pipe ingress, so recovery here means restoring an unsandboxed connect. See `harness instructions commit`.'
      : 'Commit through `harness commit "<message>"`, which buffers trace2 to a file when the ingress is blocked and tells you whether attribution landed; then run `harness doctor telemetry-nudge` from an UNSANDBOXED shell to replay the buffer. See `harness instructions commit`.';
    return {
      ...base,
      verdict: 'ingress-blocked',
      detail: `git-ai ${manifest.version} is installed and hooked up, but this process CANNOT reach its ${endpoint} — ${evidence}${markerExplanation(deps.ingress)}. Commits made from here carry NO attribution, and git-ai may later attest their lines as known-human`,
      next_action: recovery,
    };
  }

  // ADDITIVE (plan 082, windows arm): the pinned binary is installed, verified
  // and hooked up — and the bare name `git-ai` resolves to NOTHING on PATH.
  // Placed immediately before `healthy` like the ingress rung above: the only
  // read it converts is one that would otherwise claim collection is configured.
  //
  // Why a whole rung for a PATH entry: this failure is INVISIBLE from inside.
  // Binary present, extension installed, daemon running, commits succeeding,
  // notes being written — and human attribution quietly wrong, because git-ai's
  // editor extension spawns the bare name on every save to record the KnownHuman
  // attestation, the spawn dies with ENOENT in the extension-host console where
  // nobody looks, and the commit-time recovery then skips the human sweep on any
  // commit that carries AI attestations. Measured end-to-end on non-WSL Windows
  // (0 KnownHuman in 28 checkpoints until the PATH entry was added); a macOS
  // host resolves the login-shell env into the extension host and normally
  // never hits this. Warn-only, like every doctor rung (073 ac-000c).
  if (deps.pathLookup !== undefined && deps.pathLookup.resolved === null) {
    const binaryDir = binaryPath.slice(0, binaryPath.lastIndexOf('/'));
    return {
      ...base,
      verdict: 'binary-not-on-path',
      detail: `git-ai ${manifest.version} is installed at ${binaryPath} and hooked up, but the bare name \`git-ai\` resolves to NOTHING on PATH — editor extensions spawn \`git-ai\` by name on every save to record human (KnownHuman) attestations, so those spawns fail silently and human-typed lines can later be attributed to the AI agent. Everything else about this install reads fine from inside; that invisibility is exactly what this row exists to surface (evidence: docs/plans/082-harness-hooks/assets/windows/root-cause-extension-cannot-find-git-ai.md)`,
      next_action: `Add ${binaryDir} to your user PATH yourself, then FULLY restart your editor/IDE so its extension host inherits the new environment (an already-running process keeps the old one). Doctor will not edit PATH for you.`,
    };
  }

  return {
    ...base,
    verdict: 'healthy',
    // EVIDENCED vs CLAIMED, said out loud rather than collapsed into one number.
    // This line used to read "hooks installed for N agent(s)" where N was
    // whatever the install recorded — which, on the Windows run of 2026-08-09,
    // was six on a machine where three were verifiable.
    detail: `git-ai ${manifest.version} installed and hash-matching, hooks EVIDENCED for ${
      state.hooks.agents.length
    } agent(s)${unevidencedSuffix(state)}, daemon pid file ${
      daemon === 'pidfile-present' ? 'present' : 'absent'
    } — collection is CONFIGURED (v1 cannot prove it is occurring; see docs/how/gitai-collector.md)`,
  };
}

/**
 * The most recent GUARD reading — never a post-install verification read. After a
 * successful install the post read legitimately shows git-ai's own two trace2
 * keys; reporting that as the guard's answer would read as "we installed hooks
 * over someone's trace2 config", which is the one thing that never happens.
 */
function latestTrace2(state: CollectorState): CollectorHealth['trace2'] {
  const latest = state.trace2.find((entry) => entry.phase !== 'post-install');
  return latest === undefined ? null : { observed: latest.observed, at: latest.at };
}

/**
 * The gap between what git-ai claimed and what we could evidence, as a clause —
 * or nothing at all when there is no gap.
 *
 * Reported EVERY time it is non-empty, including on the `healthy` verdict, and
 * that is the point. A row that says "healthy" while silently holding names it
 * could not confirm is the same defect in a friendlier tone.
 */
function unevidencedSuffix(state: CollectorState): string {
  const evidenced = new Set(state.hooks.agents.map((id) => id.toLowerCase()));
  const extra = claimedHookAgents(state).filter((id) => !evidenced.has(id.toLowerCase()));
  if (extra.length === 0) return '';
  return ` (git-ai also named ${extra.join(', ')}, unconfirmed here — not a claim they are unhooked)`;
}
