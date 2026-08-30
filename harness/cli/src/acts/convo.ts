import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { BackgroundProcessPort } from '../adapters/exec/background-port.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import type { FlowspacePort, IngestArgs } from '../services/convo/flowspace-port.js';
import type { SyncOutcome } from '../services/convo/sync-service.js';
import type { SettingsOrigin } from '../services/settings/settings.js';
import type { PijRegistry } from '../services/telemetry/pij-registry.js';

export interface FlowspaceCliOptions {
  detect: () => boolean;
  ping: () => boolean;
  background: BackgroundProcessPort;
  cwd: string;
  logPath: string;
  pijId?: string;
}

export interface ConvoIdentityOptions {
  harness?: string;
  session?: string;
  folder?: string;
}

export type ConvoIdentityResolution =
  | { ok: true; args: IngestArgs; pijId?: string }
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
    ...(pijId !== undefined && { pijId }),
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

  ingest(args: IngestArgs): void {
    this.options.background.spawnDetached({
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
        ...(this.options.pijId ? ['--pij', this.options.pijId] : []),
      ],
      cwd: this.options.cwd,
      logPath: this.options.logPath,
    });
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
