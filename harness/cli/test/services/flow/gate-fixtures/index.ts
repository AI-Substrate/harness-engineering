import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSchemaFs } from '@ai-substrate/dd/node';
import { FsDocLoader } from '@ai-substrate/dd';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { MemoizingDocLoader } from '@ai-substrate/dd/links';
import { ConventionSchemaResolver } from '@ai-substrate/dd/schema';
import type { DdGateDeps } from '../../../../src/services/flow/flow-dd-gate.js';
import type { FlowDoc, FlowNode } from '../../../../src/services/flow/flow-events.js';

/**
 * The gate-matrix fixture corpus (plan 065 P6 T001).
 *
 * Every fixture is built into a fresh temp directory and torn down after the test.
 * That is not a stylistic preference: the subject of this phase is the live flow
 * machinery, and this repository's own `docs/plans/.../the-flow.json` is real,
 * in-use state. A committed fixture flow would be one `--path` typo away from a
 * test writing over it, so no fixture flow is ever committed and no test ever
 * points at a tracked flow file.
 *
 * The wiring is the PRODUCTION wiring — the same `ConventionSchemaResolver`,
 * `FsDocLoader` and `MemoizingDocLoader` the `flow` act composes. A hand-rolled
 * fake resolver would only prove the gate works against a hand-rolled fake.
 */

/** A dd document's completable item: an id plus the state it carries. */
export interface Item {
  id: string;
  state: string;
}

export interface SchemaSpec {
  /** Qualified `<pkg>/<schema>` name. */
  name: string;
  /**
   * A custom state vocabulary + its gate-terminal subset. Omitted ⇒ the schema
   * declares no enum, so dd's built-in completion enum and its default
   * `checked ∪ human-skipped ∪ na` apply.
   */
  custom?: { values: string[]; gateTerminal: string[] };
}

export interface GateFixture {
  /** Absolute POSIX-logical root of the temp repo. */
  root: string;
  /** Production dd wiring rooted at {@link root}. */
  deps: DdGateDeps;
  /**
   * A FRESH set of dd deps — what the next command invocation would build.
   *
   * `MemoizingDocLoader` caches for exactly one command, which is the only window
   * in which "the file has not changed underneath us" holds. A test that edits a
   * document mid-run is modelling a SECOND command, so it must ask for second-command
   * wiring; reusing {@link deps} across the edit would quietly re-serve the cached
   * pre-edit document and prove the opposite of what the test claims.
   */
  freshDeps(): DdGateDeps;
  /** Write (or rewrite) a dd document; returns the repo-relative path. */
  writeDoc(relative: string, schema: string, items: Item[]): string;
  /** Write an arbitrary file verbatim — for the malformed/unreadable rows. */
  writeRaw(relative: string, text: string): void;
  cleanup(): void;
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function schemaJson(spec: SchemaSpec): string {
  const stateShape = spec.custom ? { type: 'state', enum: 'custom' } : { type: 'state' };
  return `${JSON.stringify(
    {
      dd_schema: 1,
      description: `gate-matrix fixture schema ${spec.name}`,
      ...(spec.custom && {
        enums: {
          custom: { values: spec.custom.values, gate_terminal: spec.custom.gateTerminal },
        },
      }),
      sections: {
        tasks: {
          shape: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'state'],
              fields: { id: { type: 'string' }, state: stateShape },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Build a temp repo carrying the given schema packages.
 *
 * `home` is pointed at a non-existent directory under the temp root rather than
 * the real `$HOME`: without that, a developer who happens to have `~/.dd/schemas`
 * would get different resolution than CI, and a matrix row could pass or fail by
 * machine.
 */
export function gateFixture(schemas: SchemaSpec[]): GateFixture {
  const root = toPosixPath(mkdtempSync(join(tmpdir(), 'harness-gate-')));
  for (const spec of schemas) {
    const dir = join(root, '.dd', 'schemas', ...spec.name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'schema.json'), schemaJson(spec), 'utf8');
  }
  const fs = new NodeSchemaFs();
  const freshDeps = (): DdGateDeps => ({
    schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: root, home: `${root}/nohome` }),
    docLoader: new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), null)),
  });
  const deps = freshDeps();
  const writeRaw = (relative: string, text: string): void => {
    const absolute = join(root, relative);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text, 'utf8');
  };
  return {
    root,
    deps,
    freshDeps,
    writeRaw,
    writeDoc(relative, schema, items) {
      writeRaw(
        relative,
        `${JSON.stringify(
          { dd: { schema }, sections: [{ name: 'tasks', value: items }], references: [] },
          null,
          2,
        )}\n`,
      );
      return relative;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A minimal two-node flow whose FIRST node carries the gate.
 *
 * The cursor starts on `a`, so `setNow(doc, 'b')` is a departure FROM the gated
 * node — the exact move AC-10 governs.
 */
export function gatedFlow(link: FlowNode['dd_link'], nodes?: FlowNode[]): FlowDoc {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'gate-matrix',
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
    nodes: nodes ?? [
      {
        id: 'a',
        type: 'phase',
        label: 'Phase A',
        status: 'in_progress',
        next: ['b'],
        ...(link !== undefined && { dd_link: link }),
      },
      { id: 'b', type: 'review', label: 'Review', status: 'known', next: [] },
    ],
  };
}

/** The built-in completion vocabulary, named for readability at call sites. */
export const STATES = {
  unchecked: 'unchecked',
  checked: 'checked',
  blocked: 'blocked',
  humanSkipped: 'human-skipped',
  na: 'na',
} as const;
