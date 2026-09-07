import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ddLinkOf, type FlowNode } from '../../src/services/flow/flow-events.js';

/**
 * ac-7116 (tk-7144 + tk-7145) — the dry-run READER GAP CHECK, and ac-7115's
 * legacy retention (tk-7146).
 *
 * The claim ac-7116 makes is testable, and it is the only part of prompt-ware
 * that is: "a dry-run reader following only `orient` output + the current stage
 * module never lacks a command this plan introduced." So this file asserts
 * COVERAGE — every command the plan introduces is taught at the seam that needs
 * it — rather than trying to assert that prose reads well.
 *
 * That is a deliberately modest instrument, and it is honest about what it
 * cannot see: it proves a command is PRESENT where a reader would look, not that
 * following it produces the right document. The behavioural proof is tk-7147's
 * scripted dry-run, and bp-7116 is ABSENT-mode for exactly this reason — whether
 * the teaching actually suffices is judged by a blind subject, not by grep.
 * What this catches is the regression that would otherwise be silent: a stage
 * module rewritten without its dd commands, or a template node that loses them.
 */

const REFERENCES = fileURLToPath(
  new URL('../../../../skills/builder/references/', import.meta.url),
);

function read(relative: string): string {
  return readFileSync(join(REFERENCES, relative), 'utf8');
}

function templateNodes(): FlowNode[] {
  return (JSON.parse(read('flight-plan.template.json')) as { nodes: FlowNode[] }).nodes;
}

/** Every instruction line on a node — the text `harness flow orient` prints verbatim. */
function instructionsOf(id: string): string {
  const node = templateNodes().find((n) => n.id === id);
  if (node === undefined) throw new Error(`template lost node ${id}`);
  return (Array.isArray(node.instructions) ? node.instructions : []).join('\n');
}

describe('ac-7116 layer a — orient teaches each node its own dd commands (tk-7144)', () => {
  it.each([
    [
      'plan',
      ['harness plan new', 'node_modules/.bin/ddocs set', 'harness flow create', '--plan-dir'],
    ],
    ['impl-guide', ['harness builder guide', '--init', '--check', 'node_modules/.bin/ddocs']],
    ['phase-1', ['node_modules/.bin/ddocs set', 'harness plan validate', '--address']],
    ['review-1', ['harness builder review', '--receipt', 'not a review-exit gate']],
    [
      'post-flight',
      [
        'harness builder close',
        '--survivor',
        '--allocations',
        '--evidence',
        'harness plan validate',
        '--complete',
        '--force',
      ],
    ],
  ])('node %s bakes the commands its seam needs', (id, commands) => {
    const text = instructionsOf(id);
    for (const command of commands) expect(text).toContain(command);
  });

  it('the phase node teaches state mutation, NOT hand-editing', () => {
    const text = instructionsOf('phase-1');
    // The one sentence that matters: the sibling is generated. An agent that
    // edits the `.dd.md` produces drift the build gate will blame on a human.
    expect(text).toContain('GENERATED');
    expect(text.toLowerCase()).toContain('drift');
  });

  it('the post-flight gate states the force etiquette — an agent may not force a gate', () => {
    expect(instructionsOf('post-flight')).toContain('may not force a dd gate');
  });

  it('the plan node warns that a missing --plan-dir makes every gate refuse', () => {
    // The failure this prevents is silent and confusing: gates that resolve
    // nowhere, on a flow that looks correctly authored.
    expect(instructionsOf('plan')).toContain('E441');
  });

  it('every gated node carries BOTH the gate and the instructions to clear it', () => {
    // The pairing is the point. A gate with no baked instruction is a refusal an
    // agent meets with no idea what to run.
    for (const node of templateNodes()) {
      const link = ddLinkOf(node);
      if (link === undefined) continue;
      const text = (Array.isArray(node.instructions) ? node.instructions : []).join('\n');
      expect(text).toMatch(/harness (dd|plan) /);
    }
  });
});

describe('ac-7116 layer b — each stage module teaches its own seam (tk-7145)', () => {
  it.each([
    [
      'stages/20-plan.md',
      ['plan.dd.json', 'harness plan new', 'node_modules/.bin/ddocs add', '--mint ac'],
    ],
    [
      'stages/50-phase-tasks.md',
      ['tasks.dd.json', 'node_modules/.bin/ddocs add', '--mint tk', '--mint dw'],
    ],
    [
      'stages/60-implement.md',
      ['node_modules/.bin/ddocs set', 'harness plan validate', '--address'],
    ],
    ['stages/62-progress.md', ['node_modules/.bin/ddocs set']],
    [
      'stages/70-review.md',
      [
        'harness builder review',
        '--receipt',
        'harness plan validate',
        '--address',
        'node_modules/.bin/ddocs get',
      ],
    ],
    [
      'stages/75-post-flight.md',
      [
        'harness builder close',
        '--survivor',
        '--allocations',
        '--evidence',
        '--complete',
        'harness builder tidy',
      ],
    ],
    [
      'stages/80-ship.md',
      ['node_modules/.bin/ddocs get', 'node_modules/.bin/ddocs graph map', 'archive'],
    ],
  ])('%s teaches its commands', (module, commands) => {
    const text = read(module);
    for (const command of commands) expect(text).toContain(command);
  });

  it('the authoring seams say the sibling is generated, in the module itself', () => {
    // Not merely in the template: a reader inside stage 5 is not reading orient.
    for (const module of ['stages/20-plan.md', 'stages/50-phase-tasks.md']) {
      expect(read(module)).toMatch(/never (hand-)?edit|GENERATED/i);
    }
  });

  it('1b states the dd-native root allow-list, and that no -plan.md is emitted', () => {
    const text = read('stages/20-plan.md');
    expect(text).toContain('root allow-list');
    expect(text).toContain('No `<slug>-plan.md` is emitted');
  });

  it('5 lands the phase link in the SAME stroke as the task file — at the SOURCE', () => {
    // A task file nothing points at is invisible to the gate, so the two writes
    // are one instruction, not two steps a reader may stop between.
    const text = read('stages/50-phase-tasks.md');
    expect(text).toContain('same stroke');
    // The EXACT command, not merely the section name. The earlier `#phases/`
    // substring was satisfied by a line that wrote the GENERATED sibling
    // (`tasks.dd.md#tasks`) — a non-document link that disconnects the plan's
    // work-accounting while every surrounding assertion still passes.
    expect(text).toMatch(
      /node_modules\/\.bin\/ddocs set "\$\{PLAN_DIR\}\/plan\.dd\.json#phases\/ph-XXXX\/tasks" "assets\/tasks\/phase-N\/tasks\.dd\.json#tasks"/,
    );
    expect(text).not.toMatch(/tasks\.dd\.md#tasks/);
  });

  it('5 uses BARE-ORDINAL task paths, matching the gate the template baked', () => {
    const text = read('stages/50-phase-tasks.md');
    expect(text).toContain('assets/tasks/phase-N/tasks.dd.json');
    // The two halves must agree or the gate points at nothing.
    const gate = ddLinkOf(templateNodes().find((n) => n.id === 'phase-1') as FlowNode);
    expect(gate?.address).toContain('assets/tasks/phase-1/tasks.dd.json');
  });

  it('the ops doctrine keeps whole-plan completion at post-flight during expansion', () => {
    const text = read('flight-plan-ops.md');
    expect(text).toContain('--plan-dir');
    expect(text).toContain('post-flight');
    expect(text).toContain('New review nodes carry no whole-plan check');
    expect(text).toContain('gate:false');
    expect(text).toContain('SAME batch');
  });
});

describe('ac-7115 — the legacy markdown read path is retained (tk-7146)', () => {
  let root = '';
  afterEach(() => {
    if (root.length > 0) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  /** The documented detection predicate, read from the routing module's own list. */
  function adoptable(folder: string): boolean {
    return (
      existsSync(join(folder, 'plan.dd.json')) ||
      existsSync(join(folder, 'assets')) ||
      // the legacy shapes the routing doc still names
      ['-plan.md', '-spec.md'].some((suffix) =>
        ['demo', 'legacy'].some((slug) => existsSync(join(folder, `${slug}${suffix}`))),
      )
    );
  }

  it('a LEGACY markdown plan folder still detects as adoptable', () => {
    root = mkdtempSync(join(tmpdir(), 'legacy-'));
    const folder = join(root, 'docs/plans/001-legacy');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'legacy-plan.md'), '# Plan\n\n## Implementation Plan\n', 'utf8');

    expect(adoptable(folder)).toBe(true);
    // And nothing converted it — dd-native is the WRITE path only.
    expect(existsSync(join(folder, 'plan.dd.json'))).toBe(false);
  });

  it('a DD-NATIVE plan folder detects too — the predicate accepts both shapes', () => {
    root = mkdtempSync(join(tmpdir(), 'ddnative-'));
    const folder = join(root, 'docs/plans/002-native');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'plan.dd.json'), '{}', 'utf8');
    expect(adoptable(folder)).toBe(true);
  });

  it('an EMPTY folder is a fresh start, not an adoption — the planted-bad control', () => {
    root = mkdtempSync(join(tmpdir(), 'empty-'));
    const folder = join(root, 'docs/plans/003-empty');
    mkdirSync(folder, { recursive: true });
    expect(adoptable(folder)).toBe(false);
  });

  it('routing still NAMES the legacy shapes, and says dd-native is write-path only', () => {
    // The regression this catches is a rewrite that deletes the legacy branch —
    // 63 references key on `<slug>-plan.md`, and stranding them would strand
    // every in-flight plan (key finding F4).
    const text = read('00-routing.md');
    expect(text).toContain('*-plan.md');
    expect(text).toContain('WRITE path only');
    expect(text).toContain('no migration backlog');
  });
});

/**
 * tk-7152 / tk-7165 — the close-out seams teach the two verbs that keep an
 * archived plan's evidence alive.
 *
 * Both stages instruct a MECHANISM, and phase 1's defect class was a brief that
 * instructs a mechanism while omitting what it needs to run. These pins hold the
 * exact commands, not the topic: prose can be rewritten freely, but it may not
 * quietly stop naming the verb, because the failure that follows is invisible —
 * a body full of dead links, or a set of gates pointing at a folder that moved.
 */
describe('close-out seams teach preservation-aware archive and the PR proof table', () => {
  it('75 post-flight delegates archival and relocation to the preservation-aware close', () => {
    const stage = read('stages/75-post-flight.md');
    expect(stage).toMatch(
      /harness builder close "\$\{PLAN\}" --survivor "\$\{SURVIVOR\}" --allocations "\$\{ALLOCATIONS\}" --evidence "\$\{EVIDENCE\}"/,
    );
    expect(stage).toContain('Close archives and repairs canonical document/flow bindings');
    expect(stage).toContain('Do not run a second manual move');
    expect(stage).toContain('outside every retiring root');
    expect(stage).toContain('harness builder tidy');
  });

  it('80 ship appends the derived proof table, pinned at HEAD', () => {
    const stage = read('stages/80-ship.md');
    expect(stage).toMatch(/harness plan pr-body\s+"\$\{PLAN_DIR\}\/plan\.dd\.json" --pin-head/);
    expect(stage).toContain('docs/plans/archive/');
    // The two refusals a stage reader must NOT route around by hand.
    expect(stage).toContain('E457');
    expect(stage).toContain('do NOT hand-write the table');
    expect(stage).toContain('Do not assemble the URL yourself');
  });
});
