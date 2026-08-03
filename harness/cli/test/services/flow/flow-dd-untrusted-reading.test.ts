import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import {
  type DdLinkReading,
  type FlowDoc,
  readingCounts,
  sanitizeDdLink,
} from '../../../src/services/flow/flow-events.js';
import { applyBatch, setNode } from '../../../src/services/flow/flow-mutations.js';
import { renderFlow, renderRailLine } from '../../../src/services/flow/flow-renderer.js';

/**
 * A stored `dd_link.reading` is UNTRUSTED INPUT (P6 review F004).
 *
 * `DdLinkReading` declares `terminal: number`, but a `FlowDoc` is JSON read off
 * disk — the type is a promise the file never made. The reading reaches a document
 * two ways (an `apply --ops` payload, and anyone with an editor), and both of its
 * counts are interpolated straight into a mermaid node label and into the rail
 * line. A `total` of `1"] --> EVIL["pwned` is not a display bug; it is a writable
 * diagram, in a file people commit and review.
 *
 * So the defence is at BOTH boundaries and this file pins both:
 *   - MUTATION — a malformed authored half is refused (`E108`), and a malformed
 *     recorded half is dropped, so the bytes never land in the file;
 *   - RENDERER — the counts are re-checked at the point of interpolation, because
 *     a hand-edited file bypasses the mutation boundary entirely.
 *
 * Each boundary is tested alone. A test that only exercised them together would
 * stay green if either were removed.
 */

const CLOCK = '2026-08-04T09:00:00.000Z';
const deps = () => ({ clock: new FakeClock(CLOCK) });

/** The payload: a `total` that closes the mermaid label and opens a new node. */
const MERMAID_INJECTION = '1"] --> EVIL["pwned';
const MARKDOWN_INJECTION = '](http://evil.example)[';

function docWith(reading: unknown): FlowDoc {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'untrusted',
    nav: { now: 'a', next: null },
    created_at: '2026-08-04T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: 'main',
      repo: null,
      created_at: '2026-08-04T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [
      {
        id: 'a',
        type: 'phase',
        label: 'A',
        status: 'in_progress',
        next: ['b'],
        dd_link: {
          address: 'docs/tasks.dd.json#tasks',
          gate: true,
          reading: reading as DdLinkReading,
        },
      },
      { id: 'b', type: 'retro', label: 'B', status: 'known', next: [] },
    ],
  };
}

function plainDoc(): FlowDoc {
  const d = docWith(undefined);
  delete d.nodes[0]?.dd_link;
  return d;
}

// ---------------------------------------------------------------------------
// The renderer boundary — a hand-edited file never reaches the mutation layer.
// ---------------------------------------------------------------------------

describe('renderer boundary — a malformed reading is suppressed, never interpolated', () => {
  it('a mermaid-injecting `total` cannot add a node to the diagram', () => {
    const out = renderFlow(
      docWith({ status: 'incomplete', terminal: 1, total: MERMAID_INJECTION }),
    );
    expect(out).not.toContain('EVIL');
    expect(out).not.toContain('pwned');
    // Suppressed to the bare shield — "nothing trustworthy to report", which is
    // exactly what an unevaluated link has always rendered as.
    expect(out).toContain('a["A ⛨"]');
    // And the diagram still has precisely the two nodes the document declares.
    expect([...out.matchAll(/^ {4}\w+\["/gm)]).toHaveLength(2);
  });

  it('a mermaid-injecting `terminal` is suppressed too', () => {
    const out = renderFlow(docWith({ status: 'complete', terminal: MERMAID_INJECTION, total: 3 }));
    expect(out).not.toContain('EVIL');
    expect(out).toContain('a["A ⛨"]');
  });

  it.each([
    [
      'a markdown-injecting count',
      { status: 'incomplete', terminal: 0, total: MARKDOWN_INJECTION },
    ],
    ['a negative count', { status: 'incomplete', terminal: -1, total: 3 }],
    ['a fractional count', { status: 'incomplete', terminal: 1.5, total: 3 }],
    ['NaN', { status: 'incomplete', terminal: Number.NaN, total: 3 }],
    ['Infinity', { status: 'incomplete', terminal: 0, total: Number.POSITIVE_INFINITY }],
    ['a null reading', null],
    ['an array reading', [1, 2]],
    ['an object with no counts at all', { status: 'complete' }],
  ])('the rail reports %s as `not yet evaluated`', (_name, reading) => {
    const rail = renderRailLine(docWith(reading));
    expect(rail).toContain('⚑ gate: A ⛨ not yet evaluated');
    expect(rail).not.toContain('EVIL');
    expect(rail).not.toContain('http://evil.example');
  });

  it('a WELL-FORMED reading still renders its counts — the defence is narrow', () => {
    // The suppression must not be a blanket "never show a reading": that would
    // silently disable the badge the phase exists to draw.
    const out = renderFlow(
      docWith({ status: 'incomplete', terminal: 1, total: 3, incomplete: [] }),
    );
    expect(out).toContain('a["A ⛨1/3"]');
    expect(renderRailLine(docWith({ status: 'complete', terminal: 3, total: 3 }))).toContain(
      '⚑ gate: A ⛨ 3/3 ✓',
    );
  });

  it('`readingCounts` is the single narrow gate both surfaces ask', () => {
    expect(
      readingCounts({ status: 'complete', terminal: 2, total: 2, incomplete: [], at: '' }),
    ).toEqual({ terminal: 2, total: 2 });
    expect(readingCounts(undefined)).toBeNull();
    expect(readingCounts({ terminal: '2', total: 2 } as unknown as DdLinkReading)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The mutation boundary — the bytes never land in the committed file.
// ---------------------------------------------------------------------------

describe('mutation boundary — an untrusted dd_link never reaches the document', () => {
  it('apply --ops STRIPS a malformed recorded reading and keeps the authored link', () => {
    const res = applyBatch(
      plainDoc(),
      [
        {
          op: 'insert',
          id: 'c',
          type: 'phase',
          label: 'C',
          status: 'known',
          after: 'b',
          dd_link: {
            address: 'docs/tasks.dd.json#tasks',
            gate: true,
            reading: { status: 'incomplete', terminal: 1, total: MERMAID_INJECTION },
          },
        },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The authored half survives; the un-authored, unreadable half does not.
    expect(res.doc.nodes.at(-1)?.dd_link).toEqual({
      address: 'docs/tasks.dd.json#tasks',
      gate: true,
    });
    expect(JSON.stringify(res.doc)).not.toContain('EVIL');
  });

  it('apply --ops REFUSES a malformed authored half with E108 and writes nothing', () => {
    const before = plainDoc();
    const res = applyBatch(
      before,
      [
        {
          op: 'insert',
          id: 'c',
          type: 'phase',
          label: 'C',
          status: 'known',
          after: 'b',
          dd_link: { address: '', gate: 'yes' },
        },
      ],
      deps(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('E108');
    expect(res.message).toContain('invalid dd_link');
    expect(before.nodes).toHaveLength(2); // untouched
  });

  it('a `set` op cannot smuggle a reading past the guard either', () => {
    const res = applyBatch(
      plainDoc(),
      [
        {
          op: 'set',
          id: 'a',
          dd_link: {
            address: 'docs/tasks.dd.json#tasks',
            reading: { status: 'complete', terminal: MERMAID_INJECTION, total: 9 },
          },
        },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes[0]?.dd_link).toEqual({ address: 'docs/tasks.dd.json#tasks' });
    expect(renderFlow(res.doc)).not.toContain('EVIL');
  });

  it('setNode sanitizes and refuses on the same terms as apply', () => {
    const stripped = setNode(
      plainDoc(),
      'a',
      {
        dd_link: {
          address: 'docs/tasks.dd.json#tasks',
          basis_sha: 'not-a-sha"] --> EVIL',
          reading: { status: 'bogus', terminal: 1, total: 2 },
        },
      },
      deps(),
    );
    expect(stripped.ok).toBe(true);
    if (!stripped.ok) return;
    expect(stripped.doc.nodes[0]?.dd_link).toEqual({ address: 'docs/tasks.dd.json#tasks' });

    const refused = setNode(plainDoc(), 'a', { dd_link: { address: 42 } }, deps());
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('E108');
  });

  it('a well-formed link round-trips through the sanitizer untouched', () => {
    const link = {
      address: 'docs/tasks.dd.json#tasks',
      gate: false,
      basis_sha: 'a'.repeat(64),
      reading: {
        status: 'incomplete' as const,
        terminal: 1,
        total: 3,
        incomplete: ['tk-2', 'tk-3'],
        at: '2026-08-04T09:00:00.000Z',
      },
    };
    expect(sanitizeDdLink(link)).toEqual(link);
  });
});
