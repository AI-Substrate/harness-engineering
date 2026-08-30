import type { ResolvedValue, SettingsOrigin } from '../settings/settings.js';
import type { FlowspacePort, IngestArgs } from './flowspace-port.js';

export type SyncOutcome =
  | { status: 'disabled'; origin: SettingsOrigin }
  | { status: 'undetected'; origin: SettingsOrigin }
  | { status: 'unreachable'; origin: SettingsOrigin }
  | { status: 'fired'; origin: SettingsOrigin }
  | { status: 'dispatch-failed'; origin: SettingsOrigin; logPath: string };

/** Gate expensive conversation ingestion behind resolved consent and cheap availability checks. */
export async function syncConversation(
  consent: ResolvedValue<boolean>,
  args: IngestArgs,
  flowspace: FlowspacePort,
): Promise<SyncOutcome> {
  const origin = consent.origin;
  if (!consent.value) return { status: 'disabled', origin };
  if (!flowspace.detect()) return { status: 'undetected', origin };
  if (!flowspace.ping()) return { status: 'unreachable', origin };
  const dispatch = await flowspace.ingest(args);
  return { ...dispatch, origin };
}
