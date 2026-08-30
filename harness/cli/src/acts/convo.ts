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
import type { SettingsOrigin, SettingsRefusal } from '../services/settings/settings.js';
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

export async function runConvoSync(
  options: ConvoIdentityOptions,
  deps: Pick<VerbActDeps, 'fs' | 'env' | 'proc'>,
  flowspace: FlowspaceFactory,
): Promise<ConvoRunResult> {
  const settings = loadSettings(deps.proc.cwd(), { fs: deps.fs, env: deps.env });
  if (!settings.ok) return { kind: 'settings-refusal', refusal: settings };
  const consent = settings.settings.flowspace.ingest.enabled;
  if (!consent.value) {
    return { kind: 'outcome', outcome: { status: 'disabled', origin: consent.origin } };
  }

  const registry = readPijRegistry({ fs: deps.fs, env: deps.env });
  const identity = resolveConvoIdentity(options, deps.proc.cwd(), registry, deps.env);
  if (!identity.ok) return { kind: 'identity-unresolvable', origin: consent.origin };
  return {
    kind: 'outcome',
    outcome: await syncConversation(consent, identity.args, flowspace()),
  };
}

/** Lifecycle seams deliberately discard every outcome and every failure. */
export function runConvoSyncSilently(
  deps: Pick<VerbActDeps, 'fs' | 'env' | 'proc'>,
  flowspace: FlowspaceFactory,
): void {
  void runConvoSync({}, deps, flowspace).catch(() => {
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

export function buildSilentConvoSync(deps: VerbActDeps): () => void {
  const flowspace = defaultFlowspaceFactory(deps);
  return () => runConvoSyncSilently(deps, flowspace);
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

export function resolveConvoIdentity(
  options: ConvoIdentityOptions,
  cwd: string,
  registry: PijRegistry,
  env: Pick<EnvPort, 'get'>,
): ConvoIdentityResolution {
  const identity = env.get('PIJ_SESSION_ID') ?? options.session;
  const pijId =
    identity === undefined
      ? undefined
      : registry.by_pij.has(identity)
        ? identity
        : registry.by_harness_session.get(identity);
  const descriptor = pijId === undefined ? undefined : registry.by_pij.get(pijId);
  const harness = options.harness ?? flowspaceHarness(descriptor?.harness ?? null);
  const session = options.session ?? descriptor?.harness_session_id ?? undefined;

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
