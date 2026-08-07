/**
 * The git-ai collector lifecycle (plan 073) — harness's answer to "who collects
 * AI attribution now that harness does not?".
 *
 * Composition order for a caller: {@link installCollector} (stage 1 places the
 * pinned, SHA-256-verified binary; stage 2 installs hooks behind the trace2
 * guard), {@link recheckCollector} when a new coding harness may have appeared,
 * and {@link readCollectorHealth} for doctor's warn-only report row — a pure
 * filesystem read that never invokes git-ai.
 */
export { AGENT_MARKERS, type AgentMarker, agentsMissingHooks, detectAgents } from './agents.js';
export {
  type DownloadFailureReason,
  downloadAndVerify,
  type VerifiedDownloadDeps,
  type VerifiedDownloadRequest,
  type VerifiedDownloadResult,
} from './download.js';
export {
  type CollectorHealth,
  type CollectorHealthDeps,
  type CollectorVerdict,
  readCollectorHealth,
} from './health.js';
export {
  type CliStage,
  type CollectorInstallResult,
  type CollectorRecheckResult,
  GITAI_PIN_CONFIG,
  type HooksStage,
  INSTALL_HOOKS_DISCLOSURES,
  installCollector,
  installHooks,
  recheckCollector,
} from './install.js';
export { GITAI_PIN } from './pin.js';
export {
  type ArtifactResolution,
  binaryPathFor,
  configPathFor,
  daemonPidPathFor,
  resolveArtifact,
  resolvePlatformKey,
} from './platform.js';
export {
  type RegeneratePinDeps,
  type RegeneratePinRequest,
  type RegeneratePinResult,
  regenerateGitAiPin,
  renderPinSource,
} from './regenerate.js';
export {
  COLLECTOR_STATE_FILE,
  COLLECTOR_STATE_SCHEMA,
  type CollectorState,
  collectorStatePath,
  emptyCollectorState,
  readCollectorState,
  type Trace2Observation,
  writeCollectorState,
} from './state.js';
export {
  manualHookInstructions,
  mayInstallHooks,
  readGlobalTrace2,
  type Trace2Reading,
  type Trace2Status,
} from './trace2.js';
export type {
  CollectorDeps,
  CollectorFsPort,
  CollectorPin,
  DownloadOutcome,
  DownloadPort,
  ExecutableBitPort,
  HostTarget,
  PlatformKey,
  ResolvedArtifact,
} from './types.js';
