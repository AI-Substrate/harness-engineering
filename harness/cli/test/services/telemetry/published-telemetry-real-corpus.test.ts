import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  RemoteRepository,
  RemoteTelemetryBlob,
} from '../../../src/adapters/git/remote-telemetry-git-port.js';
import {
  decodePublishedTelemetrySession,
  type PublishedTelemetrySessionInput,
} from '../../../src/services/telemetry/published-telemetry.js';
import type { SelectableTelemetrySession } from '../../../src/services/telemetry/remote-selection.js';

/**
 * FX007 — the control that did not exist.
 *
 * The strict reader's key grammar was written by hand and then confirmed against
 * an example written under the same assumption. It shipped rejecting 100% of this
 * repo's own published telemetry with E222, and no test noticed — because no pull
 * test had ever read a real published byte. The root cause was the missing test,
 * not the regex.
 *
 * These fixtures are the VERBATIM bytes of this public repo's own
 * `refs/harness-telemetry/*` refs — the same bytes `telemetry pull` fetches. They
 * are copied, not rebuilt, so this test cannot pass by accident of a hand-built
 * wrapper that happens to dodge the reader's strict paths.
 *
 * Published refs are immutable. Every key in here is a key the reader must be
 * able to read forever.
 */

const fixturesDir = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures',
  'published-refs',
);

const encoder = new TextEncoder();
const repo: RemoteRepository = {
  key: 'repo-aaaaaaaaaaaaaaaa',
  identity: 'https://example.com/team/repo',
  transportUrl: 'https://example.com/team/repo',
};
const tipOid = 'c'.repeat(40);

interface CapturedRef {
  session: string;
  refName: string;
  refDate: string;
  entries: RemoteTelemetryBlob[];
  segments: Record<string, unknown>[];
  logs: Record<string, unknown>[];
}

function loadCapturedRefs(): CapturedRef[] {
  return readdirSync(fixturesDir)
    .filter((name) => statSync(join(fixturesDir, name)).isDirectory())
    .sort()
    .map((session) => {
      const dir = join(fixturesDir, session);
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
        ref: string;
        ref_date: string;
        files: string[];
      };
      const entries = meta.files.map((path) => ({
        path,
        mode: '100644',
        type: 'blob' as const,
        oid: 'b'.repeat(40),
        bytes: encoder.encode(readFileSync(join(dir, path), 'utf8')),
      }));
      const segments = meta.files
        .filter((path) => /^\d+\.json$/.test(path))
        .map(
          (path) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as Record<string, unknown>,
        );
      const logs = meta.files
        .filter((path) => path.endsWith('.logs.jsonl'))
        .flatMap((path) =>
          readFileSync(join(dir, path), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>),
        );
      return {
        session,
        refName: meta.ref,
        refDate: meta.ref_date.replaceAll('/', '-'),
        entries,
        segments,
        logs,
      };
    });
}

function inputFor(captured: CapturedRef): PublishedTelemetrySessionInput {
  const group: SelectableTelemetrySession = {
    repository: repo,
    sessionId: captured.session,
    refs: [
      {
        name: captured.refName,
        oid: tipOid,
        sessionId: captured.session,
        refDate: captured.refDate,
      },
    ],
    gaps: [],
    product: { state: 'unavailable', commits: null },
  };
  return {
    group,
    refs: [
      {
        name: captured.refName,
        advertisedOid: tipOid,
        history: [{ oid: tipOid, parents: [], entries: captured.entries }],
      },
    ],
  };
}

const capturedRefs = loadCapturedRefs();

/** Every map key the strict reader validates, gathered from a captured segment. */
function labelKeysOf(segment: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const event of (segment.event_stream as Record<string, unknown>[] | undefined) ?? []) {
    keys.push(...Object.keys((event.gates as Record<string, unknown>) ?? {}));
    keys.push(...Object.keys((event.enums as Record<string, unknown>) ?? {}));
    keys.push(...Object.keys((event.counts as Record<string, unknown>) ?? {}));
  }
  keys.push(...Object.keys((segment.models as Record<string, unknown>) ?? {}));
  keys.push(...Object.keys((segment.tools as Record<string, unknown>) ?? {}));
  keys.push(...Object.keys((segment.skills as Record<string, unknown>) ?? {}));
  const rollup = (segment.rollup as Record<string, unknown> | null) ?? {};
  const outcomes = (rollup.outcomes as Record<string, unknown> | undefined) ?? {};
  keys.push(...Object.keys((outcomes.exits as Record<string, unknown>) ?? {}));
  return keys;
}

/**
 * Every kvlist ENTRY key in an OTLP logs document — the producer's data labels as
 * they cross the wire. These are validated by a DIFFERENT constant from the
 * segment-path label maps, which is why the segment-path fix did not reach them.
 */
function kvlistKeysOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) kvlistKeysOf(item, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'kvlistValue' && child !== null && typeof child === 'object') {
      for (const entry of ((child as Record<string, unknown>).values as unknown[]) ?? []) {
        const pair = entry as { key?: unknown };
        if (typeof pair.key === 'string') out.push(pair.key);
      }
    }
    kvlistKeysOf(child, out);
  }
  return out;
}

describe('published telemetry reads this repo real published refs', () => {
  it('has captured refs to read', () => {
    expect(capturedRefs.length).toBeGreaterThan(0);
  });

  it.each(
    capturedRefs.map((captured) => [captured.session, captured] as const),
  )('decodes session %s from its verbatim published bytes', (_session, captured) => {
    const result = decodePublishedTelemetrySession(inputFor(captured));
    expect(
      result.ok,
      result.ok ? undefined : `rejected as ${result.reason} (this is the E222 pull reports)`,
    ).toBe(true);
  });

  /**
   * The key shapes the producer really emits that the shipped grammar rejected:
   * npm-style colon namespacing, and multi-word command labels. Pinned by name so
   * a future tightening cannot silently re-strand the immutable back catalogue.
   */
  it('carries the key shapes that made the shipped reader fail', () => {
    const keys = new Set(capturedRefs.flatMap((c) => c.segments.flatMap(labelKeysOf)));
    expect(keys).toContain('check:docs');
    expect(keys).toContain('dd doctor');
  });

  /**
   * The OTLP path's own version of the same defect. `SAFE_IDENTIFIER` admitted a
   * colon but not a space, so `git commit` under `harness.tool.control` stranded
   * the whole session on `validLogs` — a second hand-written grammar that had
   * never been checked against producer output.
   */
  it('carries the multi-word kvlist keys that stranded the OTLP logs path', () => {
    const keys = new Set(capturedRefs.flatMap((c) => c.logs.flatMap((doc) => kvlistKeysOf(doc))));
    expect(keys).toContain('git commit');
  });
});
