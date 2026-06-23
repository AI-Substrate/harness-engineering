import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildGovernanceSkeleton,
  GOVERNANCE_SKELETON,
} from '../../../src/services/init/governance-template.js';

/*
Test Doc:
- Why: `buildGovernanceSkeleton()` is the byte-source `harness init` stamps as the governance-doc
  INCEPTION skeleton. Boot (maturity), `eng-harness-0-adopt` (## Injection map), and the router's
  S3 rung read this exact shape — heading/order drift, or a faked repo-specific field, would make
  boot misreport and break "the harness never fakes success".
- Contract: pure (no I/O imports); returns GOVERNANCE_SKELETON; the `## ` section set + order mirror
  the canonical governance doc (governance-doc.md:24-35); maturity seeded L0 in its own trailing
  section; injection map empty; no BIO/signal field populated with a real value.
- Quality Contribution: pins the CLI↔governance-doc seam + the never-fake-success honesty invariant.
*/

/** This module's own source — read to assert it stays I/O-free (cf. retro-template.test). */
const SRC_PATH = fileURLToPath(
  new URL('../../../src/services/init/governance-template.ts', import.meta.url),
);

/** Ordered `## ` section headings — the canonical governance-doc contract (governance-doc.md:24-35). */
const CANONICAL_SECTIONS = [
  'Boot command',
  'Checks command',
  'Health check',
  'Interact method',
  'Observe method',
  'Deterministic signal inventory',
  'Evidence paths',
  'Injection map',
  'Back-pressure gaps',
  'Current maturity snapshot',
];

/** The `## ` (level-2) headings, in document order. */
function sectionHeadings(md: string): string[] {
  return md
    .split('\n')
    .map((line) => /^## (.+)$/.exec(line)?.[1])
    .filter((h): h is string => h !== undefined);
}

/** The body between a `## <section>` heading and the next `## ` heading. */
function sectionBody(md: string, section: string): string {
  return (md.split(`## ${section}\n`)[1] ?? '').split('\n## ')[0] ?? '';
}

describe('buildGovernanceSkeleton', () => {
  it('returns the GOVERNANCE_SKELETON constant', () => {
    expect(buildGovernanceSkeleton()).toBe(GOVERNANCE_SKELETON);
  });

  it('carries the canonical BIO section set, in canonical order', () => {
    expect(sectionHeadings(buildGovernanceSkeleton())).toEqual(CANONICAL_SECTIONS);
  });

  it('opens with the title + AGENTS START HERE breadcrumb to the instructions channel', () => {
    const md = buildGovernanceSkeleton();
    expect(md.startsWith('# Engineering harness\n')).toBe(true);
    expect(md).toContain('AGENTS START HERE → `harness instructions`');
  });

  it('seeds maturity at L0 in its own trailing section (honest — nothing proven yet)', () => {
    const md = buildGovernanceSkeleton();
    expect(md).toContain('## Current maturity snapshot');
    expect(md).toMatch(/\*\*L0 —[^\n]*nothing proven yet\.\*\*/);
    // Maturity is the LAST section — boot reads the *current* snapshot at the tail.
    expect(sectionHeadings(md).at(-1)).toBe('Current maturity snapshot');
  });

  it('ships an EMPTY injection map for adopt Step 3 to fill — no real seam wired in', () => {
    const md = buildGovernanceSkeleton();
    expect(md).toContain('## Injection map');
    expect(md).toContain('| Seam event | Fires from | What fires it |');
    expect(md).toContain('| <!-- e.g. session-start --> | | |');
  });

  it('NEVER fakes harness state — every BIO/signal field is a placeholder, not a value', () => {
    const md = buildGovernanceSkeleton();
    for (const section of [
      'Boot command',
      'Checks command',
      'Health check',
      'Interact method',
      'Observe method',
      'Deterministic signal inventory',
      'Evidence paths',
    ]) {
      const body = sectionBody(md, section).trim();
      expect(body.startsWith('<!--'), `${section} body must be a placeholder comment`).toBe(true);
    }
  });

  it('is a pure module — no fs/clock/process imports (Constitution P2)', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
    expect(src).not.toContain('node:fs');
  });

  it('matches the committed skeleton snapshot (byte drift guard)', () => {
    expect(buildGovernanceSkeleton()).toMatchInlineSnapshot(`
      "# Engineering harness

      > **AGENTS START HERE → \`harness instructions\`** — the CLI's baked agent
      > briefing (envelope contract, role split, discovery loop). Then
      > \`harness instructions <verb>\` per verb.

      ## Boot command
      <!-- TODO (eng-harness-0-adopt / \`harness new boot --wrap "<cmd>"\`):
           the exact command that boots the system to a healthy, observable state (<60s target).
           Composes \`harness checks\` (below) once services are ready. -->

      ## Checks command
      <!-- TODO (eng-harness-0-adopt / \`harness new checks --wrap "<aggregate lint+test+typecheck recipe>"\`):
           the mandated quality gate (lint, unit tests, typecheck…). Agents run \`harness checks\` before
           work is "done"; teams gate commits/push on it; \`harness boot\` composes it. Extend as the team grows. -->

      ## Health check
      <!-- TODO: the command/endpoint that proves the system is up (read by boot Stage 1). -->

      ## Interact method
      <!-- TODO: how an agent sends input to the running system (boot Stage 2). -->

      ## Observe method
      <!-- TODO: how an agent captures evidence — logs, screenshots, traces (boot Stage 3). -->

      ## Deterministic signal inventory
      <!-- TODO: sensors that prove behaviour without inference — runtime inspectability,
           smoke paths, architecture/static checks, security/dependency/schema checks. -->

      ## Evidence paths
      <!-- TODO: where artifacts land (log/trace/screenshot/output locations). -->

      ## Injection map
      <!-- Where the repo's extant dev/SDD flow calls /eng-harness-flow. One row per seam.
           Filled by eng-harness-0-adopt Step 3 (with the user's go-ahead). -->

      | Seam event | Fires from | What fires it |
      |---|---|---|
      | <!-- e.g. session-start --> | | |

      ## Back-pressure gaps
      <!-- TODO: behaviours still relying on inference/human eyeballing — improvement
           candidates, named honestly. Never scores. -->

      ## Current maturity snapshot
      **L0 — seeded at inception by \`harness init\`; nothing proven yet.**
      <!-- The single, current L0–L4 level the harness is ACTUALLY at. Updated ONLY at
           the Improve beat (never by boot, which is read-only). See maturity-assessment.md. -->
      "
    `);
  });
});
