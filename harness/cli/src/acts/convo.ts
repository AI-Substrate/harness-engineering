import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { BackgroundProcessPort } from '../adapters/exec/background-port.js';
import { spawnFlowspacePing } from '../adapters/exec/spawn-flowspace-probe.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import type {
  FlowspacePort,
  IngestArgs,
  IngestDispatch,
} from '../services/convo/flowspace-port.js';
import { type SyncOutcome, syncConversation } from '../services/convo/sync-service.js';
import { loadSettings } from '../services/settings/load-settings.js';
import type {
  ResolvedValue,
  SettingsOrigin,
  SettingsRefusal,
} from '../services/settings/settings.js';
import { posixJoin } from '../services/shared/posix-path.js';
import { type PijRegistry, readPijRegistry } from '../services/telemetry/pij-registry.js';
import type { VerbActDeps } from './verb.js';

export type FlowspaceFactory = () => FlowspacePort;

export type ConvoRunResult =
  | { kind: 'outcome'; outcome: SyncOutcome }
  | { kind: 'identity-unresolvable'; origin: SettingsOrigin }
  | { kind: 'settings-refusal'; refusal: SettingsRefusal };

export function registerConvoAct(
  program: Command,
  io: CliIo,
  deps: VerbActDeps,
  flowspace?: FlowspaceFactory,
): void {
  program
    .command('convo')
    .description('Conversation ingestion controls')
    .command('sync')
    .description('Dispatch incremental conversation ingestion when consent and identity allow it')
    .option('--harness <name>', 'native harness name (defaults through the pij registry)')
    .option('--session <id>', 'native harness session id (defaults through the pij registry)')
    .option('--folder <path>', 'conversation workspace (defaults to the current repository)')
    .action(async (options: ConvoIdentityOptions) => {
      let envelope: Envelope;
      try {
        const result = await runConvoSync(
          options,
          deps,
          flowspace ?? defaultFlowspaceFactory(deps),
        );
        envelope = envelopeForConvoRun(result, deps.clock);
      } catch (error) {
        envelope = envelopeForConvoError(error, deps.clock);
      }
      exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
    });
}

/**
 * The SYNCHRONOUS half of a sync: consent + identity, no I/O beyond settings
 * and the pij registry. Split out so the lifecycle seams can learn "enabled but
 * unresolvable" BEFORE the process exits — a promise settled after
 * `process.exit` is scheduled never runs, so a warning that waits on one is
 * a warning that never prints.
 */
export type ConvoSyncPlan =
  | { kind: 'ready'; consent: ResolvedValue<boolean>; args: IngestArgs }
  | { kind: 'done'; result: ConvoRunResult };

export function planConvoSync(
  options: ConvoIdentityOptions,
  deps: Pick<VerbActDeps, 'fs' | 'env' | 'proc'>,
): ConvoSyncPlan {
  const settings = loadSettings(deps.proc.cwd(), { fs: deps.fs, env: deps.env });
  if (!settings.ok)
    return { kind: 'done', result: { kind: 'settings-refusal', refusal: settings } };
  const consent = settings.settings.flowspace.ingest.enabled;
  if (!consent.value) {
    return {
      kind: 'done',
      result: { kind: 'outcome', outcome: { status: 'disabled', origin: consent.origin } },
    };
  }

  const registry = readPijRegistry({ fs: deps.fs, env: deps.env });
  const identity = resolveConvoIdentity(options, deps.proc.cwd(), registry, deps.env);
  if (!identity.ok) {
    return { kind: 'done', result: { kind: 'identity-unresolvable', origin: consent.origin } };
  }
  return { kind: 'ready', consent, args: identity.args };
}

export async function runConvoSync(
  options: ConvoIdentityOptions,
  deps: Pick<VerbActDeps, 'fs' | 'env' | 'proc'>,
  flowspace: FlowspaceFactory,
): Promise<ConvoRunResult> {
  const plan = planConvoSync(options, deps);
  if (plan.kind === 'done') return plan.result;
  return {
    kind: 'outcome',
    outcome: await syncConversation(plan.consent, plan.args, flowspace()),
  };
}

/**
 * One line on stderr, and only for the case a fleet cannot otherwise see:
 * consent is ON but the seam has nothing to ingest under. Every other outcome
 * (disabled, undetected, dispatch) stays silent as before.
 *
 * WHY THIS EXISTS: on 2026-09-02, 245 of 248 live rs-generation pij seats
 * resolved `identity-unresolvable` and this seam discarded every one of them,
 * so a repo with consent on, `harness commit` running and `refs/notes/ai`
 * written produced ZERO indexed conversations for three days with no signal
 * anywhere. A discarded failure is an unfalsifiable success.
 *
 * Deliberately carries no session id, path, or seat name.
 */
export const CONVO_IDENTITY_UNRESOLVABLE_LINE =
  'harness: conversation ingest is enabled here but session identity is unresolvable (no CLAUDE_CODE_SESSION_ID, no PIJ_SESSION_ID in the pij registry); nothing was ingested. Run `harness convo sync --harness <name> --session <id>` or see `harness convo sync`.';

/** Lifecycle seams never change commit or boot output or exit status. */
export function runConvoSyncSilently(
  deps: Pick<VerbActDeps, 'fs' | 'env' | 'proc'>,
  flowspace: FlowspaceFactory,
  warn: (line: string) => void = () => {},
): void {
  let plan: ConvoSyncPlan;
  try {
    plan = planConvoSync({}, deps);
  } catch {
    return;
  }
  if (plan.kind === 'done') {
    if (plan.result.kind === 'identity-unresolvable') {
      try {
        warn(CONVO_IDENTITY_UNRESOLVABLE_LINE);
      } catch {
        // A warning that cannot be written is still not a reason to touch the commit.
      }
    }
    return;
  }
  // INVARIANT (pinned by test 'spawns in the same tick'): both callers exit the
  // process in the tick this returns, so the dispatch is real ONLY because nothing
  // asynchronous precedes `spawnDetached` — settings, identity, detect, ping and
  // the spawn itself all run before the first `await` inside `ingest`. One added
  // `await` ahead of the spawn (an async mkdirp, say) would make boot and commit
  // spawn nothing, with no error and every other test green.
  void syncConversation(plan.consent, plan.args, flowspace()).catch(() => {
    // Commit and boot are never changed by optional conversation ingestion.
  });
}

export function runConvoAfterBoot(envelope: Pick<Envelope, 'command'>, sync: () => void): void {
  if (envelope.command !== 'boot') return;
  try {
    sync();
  } catch {
    // Optional ingestion never changes boot output or exit status.
  }
}

function envelopeForConvoRun(result: ConvoRunResult, clock: Clock): Envelope {
  switch (result.kind) {
    case 'outcome':
      return envelopeForSyncOutcome(result.outcome, clock);
    case 'identity-unresolvable':
      return envelopeForIdentityUnresolvable(result.origin, clock);
    case 'settings-refusal':
      return formatError('convo sync', result.refusal.code, result.refusal.message, clock, {
        next_action: result.refusal.next_action,
      });
  }
}

function defaultFlowspaceFactory(deps: VerbActDeps): FlowspaceFactory {
  return () => {
    if (deps.background === undefined || deps.fsWrite === undefined) {
      throw new Error('conversation background capability unavailable');
    }
    const cwd = deps.proc.cwd();
    const temp = posixJoin(cwd, '.harness/temp');
    return new FlowspaceCliAdapter({
      detect: () => deps.proc.which('flowspace3') !== null,
      ping: spawnFlowspacePing,
      background: deps.background,
      clock: deps.clock,
      prepare: () => deps.fsWrite?.mkdirp(temp),
      cwd,
      logPath: posixJoin(temp, 'convo-sync.log'),
    });
  };
}

export function buildSilentConvoSync(deps: VerbActDeps, warn?: (line: string) => void): () => void {
  const flowspace = defaultFlowspaceFactory(deps);
  return () => runConvoSyncSilently(deps, flowspace, warn);
}

export interface FlowspaceCliOptions {
  detect: () => boolean;
  ping: () => boolean;
  background: BackgroundProcessPort;
  clock: Pick<Clock, 'sleep'>;
  prepare?: () => void;
  cwd: string;
  logPath: string;
}

export interface ConvoIdentityOptions {
  harness?: string;
  session?: string;
  folder?: string;
}

export type ConvoIdentityResolution =
  | { ok: true; args: IngestArgs }
  | { ok: false; reason: 'identity-unresolvable' };

function flowspaceHarness(harness: string | null): string | undefined {
  if (harness === null) return undefined;
  return harness === 'pi' ? 'omp' : harness;
}

/**
 * Harnesses that export their OWN native session id into the shell a seat's
 * commands run in. This is the seat's ground truth — the pij registry only
 * ever RECORDED this value — so it is consulted before pij, and it needs no
 * pij at all. Claude Code exports `CLAUDE_CODE_SESSION_ID`; pi/omp export
 * nothing (the id lives only inside the extension process), so those seats
 * resolve through pij or not at all until pij persists the id on its rs rows
 * (pij req-0033).
 */
const NATIVE_SESSION_ENV: ReadonlyArray<{ env: string; harness: string }> = [
  { env: 'CLAUDE_CODE_SESSION_ID', harness: 'claude' },
];

function nativeIdentity(env: Pick<EnvPort, 'get'>): { harness: string; session: string } | null {
  for (const { env: name, harness } of NATIVE_SESSION_ENV) {
    const session = env.get(name);
    if (session !== undefined && session !== '') return { harness, session };
  }
  return null;
}

/**
 * Precedence: explicit flags → the harness's own exported session id → the
 * pij registry (legacy `~/.pij/<id>.json`; rs-generation seats are NOT there
 * and carry no inner session id anywhere yet — see pij req-0033).
 */
export function resolveConvoIdentity(
  options: ConvoIdentityOptions,
  cwd: string,
  registry: PijRegistry,
  env: Pick<EnvPort, 'get'>,
): ConvoIdentityResolution {
  const native = nativeIdentity(env);
  const identity = env.get('PIJ_SESSION_ID') ?? options.session;
  const pijId =
    identity === undefined
      ? undefined
      : registry.by_pij.has(identity)
        ? identity
        : registry.by_harness_session.get(identity);
  const descriptor = pijId === undefined ? undefined : registry.by_pij.get(pijId);
  const harness =
    options.harness ?? native?.harness ?? flowspaceHarness(descriptor?.harness ?? null);
  const session = options.session ?? native?.session ?? descriptor?.harness_session_id ?? undefined;

  if (harness === undefined || session === undefined) {
    return { ok: false, reason: 'identity-unresolvable' };
  }
  return {
    ok: true,
    args: { harness, session, folder: options.folder ?? cwd },
  };
}

export function envelopeForIdentityUnresolvable(origin: SettingsOrigin, clock: Clock): Envelope {
  return formatDegraded(
    'convo sync',
    {
      status: 'identity-unresolvable',
      origin,
      message: 'Conversation ingest is enabled, but cannot resolve session identity.',
    },
    'Pass `--harness <name> --session <id>` explicitly (and optionally `--folder <path>`), then retry.',
    clock,
  );
}

/** CLI adapter for the synchronous gates and detached ingest dispatch. */
export class FlowspaceCliAdapter implements FlowspacePort {
  constructor(private readonly options: FlowspaceCliOptions) {}

  detect(): boolean {
    return this.options.detect();
  }

  ping(): boolean {
    return this.options.ping();
  }

  async ingest(args: IngestArgs): Promise<IngestDispatch> {
    this.options.prepare?.();
    const child = this.options.background.spawnDetached({
      command: 'flowspace3',
      args: [
        'conversation',
        'ingest',
        '--harness',
        args.harness,
        '--session',
        args.session,
        '--folder',
        args.folder,
      ],
      cwd: this.options.cwd,
      logPath: this.options.logPath,
    });
    const outcome = await Promise.race([
      child.exitCode.then((code) => ({ kind: 'exited' as const, code })),
      this.options.clock.sleep(250).then(() => ({ kind: 'running' as const })),
    ]);
    return outcome.kind === 'running' || outcome.code === 0
      ? { status: 'fired' }
      : { status: 'dispatch-failed', logPath: this.options.logPath };
  }
}

/** Map the pure sync outcome onto claims no stronger than the mechanism proves. */
export function envelopeForSyncOutcome(outcome: SyncOutcome, clock: Clock): Envelope {
  switch (outcome.status) {
    case 'disabled': {
      const message =
        outcome.origin === 'default'
          ? 'Conversation ingest is off because it was not configured.'
          : outcome.origin === 'kill-switch'
            ? 'Conversation ingest is off because HARNESS_NO_TELEMETRY=1 fired the kill switch.'
            : 'Conversation ingest is disabled by tracked repository settings.';
      return formatOk('convo sync', { ...outcome, message }, clock);
    }
    case 'undetected':
      return formatDegraded(
        'convo sync',
        { ...outcome, message: 'Conversation ingest is enabled, but flowspace3 was not detected.' },
        'Install flowspace3 or make it available on PATH, then retry.',
        clock,
      );
    case 'unreachable':
      return formatDegraded(
        'convo sync',
        { ...outcome, message: 'The Flowspace daemon is unreachable.' },
        'Run `flowspace3 ping`, repair the daemon if needed, then retry.',
        clock,
      );
    case 'dispatch-failed':
      return formatDegraded(
        'convo sync',
        {
          ...outcome,
          message: 'Conversation ingest exited during the dispatch grace period.',
        },
        `Inspect ${outcome.logPath}, repair the dispatch failure, then retry.`,
        clock,
      );
    case 'fired':
      return formatOk(
        'convo sync',
        {
          ...outcome,
          message:
            'Conversation ingest was dispatched in the background; delivery is not verified.',
        },
        clock,
      );
  }
}

/** Deliberately excludes the caught value: it may contain a private transcript path. */
export function envelopeForConvoError(_error: unknown, clock: Clock): Envelope {
  return formatError(
    'convo sync',
    ErrorCodes.UNKNOWN,
    'Conversation ingest dispatch failed before it could be started.',
    clock,
    { next_action: 'Check flowspace3 availability and retry `harness convo sync`.' },
  );
}
