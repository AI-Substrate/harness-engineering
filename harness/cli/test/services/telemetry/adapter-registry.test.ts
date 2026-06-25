import { describe, expect, it } from 'vitest';
import {
  claudeAdapter,
  copilotAdapter,
  coreTelemetryAdapters,
  cursorAdapter,
  nullDefaultAdapter,
} from '../../../src/services/telemetry/adapters/index.js';
import type { CaptureDeps } from '../../../src/services/telemetry/capture-service.js';

/**
 * T008 (plan 2.6 · AC-12) — the core-adapter registry the Phase-3 kernel preamble
 * consumes. Real adapters only, in a stable order; the null-default stays the
 * capture-service `?? ` fallback (NOT a registry entry).
 */

describe('T008 — coreTelemetryAdapters registry', () => {
  it('lists the real adapters in a stable order', () => {
    expect(coreTelemetryAdapters).toEqual([claudeAdapter, copilotAdapter, cursorAdapter]);
  });

  it('each adapter handles only its own harness id (disjoint predicates)', () => {
    expect(claudeAdapter.handles('claude-code')).toBe(true);
    expect(claudeAdapter.handles('copilot-cli')).toBe(false);
    expect(copilotAdapter.handles('copilot-cli')).toBe(true);
    expect(copilotAdapter.handles('claude-code')).toBe(false);
    expect(cursorAdapter.handles('cursor-agent')).toBe(true);
    expect(cursorAdapter.handles('claude-code')).toBe(false);
  });

  it('excludes the null-default (capture-service supplies it as the fallback)', () => {
    expect(coreTelemetryAdapters).not.toContain(nullDefaultAdapter);
  });

  it('is assignable to CaptureDeps.adapters (the Phase-3 consumption shape)', () => {
    // Type-level proof: this compiles iff coreTelemetryAdapters fits the seam.
    const adapters: CaptureDeps['adapters'] = coreTelemetryAdapters;
    expect(adapters).toBe(coreTelemetryAdapters);
  });
});
