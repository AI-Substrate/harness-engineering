import type { Clock } from '../../adapters/clock/clock-port.js';
import { formatUnconfigured } from '../../output/envelope.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort } from '../../output/output-port.js';

export interface DdActDeps {
  clock: Clock;
}

export type DdOwningPhase =
  | 'Phase 2: Schema layer & baked docs'
  | 'Phase 3: Render, adapters & freshness'
  | 'Phase 4: Links, ledger & doctor';

export function exitDdStub(
  command: string,
  owner: DdOwningPhase,
  io: CliIo,
  deps: DdActDeps,
): never {
  const envelope = formatUnconfigured(
    command,
    `${owner} owns this command body. Complete that phase, then retry.`,
    deps.clock,
    { data: { owner_phase: owner } },
  );
  return exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
}
