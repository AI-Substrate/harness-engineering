import { claudeAdapter } from './claude-adapter.js';
import { copilotAdapter } from './copilot-adapter.js';
import { copilotVscodeAdapter } from './copilot-vscode-adapter.js';
import { cursorAdapter } from './cursor-adapter.js';
import type { HarnessAdapter } from './harness-adapter.js';

export { claudeAdapter } from './claude-adapter.js';
export { copilotAdapter } from './copilot-adapter.js';
export { copilotVscodeAdapter } from './copilot-vscode-adapter.js';
export { cursorAdapter } from './cursor-adapter.js';
export type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessContext,
  HarnessSource,
  LiveHarnessSource,
  ReconcileHarnessSource,
} from './harness-adapter.js';
export { nullDefaultAdapter } from './harness-adapter.js';

/**
 * The core per-harness telemetry adapters (plan 034, Phase 2 · T008). The Phase-3
 * kernel preamble drops this straight into `CaptureDeps.adapters`; capture-service
 * appends {@link nullDefaultAdapter} as its `?? ` fallback, so the null-default is
 * deliberately NOT in this list. Selection in capture-service is
 * `find(a => a.handles(id)) ?? nullDefaultAdapter` over disjoint `handles`
 * predicates, so order is for determinism, not correctness. Mirrors the
 * `coreRecordTypes` composition pattern (record/registry.ts).
 */
export const coreTelemetryAdapters: HarnessAdapter[] = [
  claudeAdapter,
  copilotAdapter,
  copilotVscodeAdapter,
  cursorAdapter,
];
