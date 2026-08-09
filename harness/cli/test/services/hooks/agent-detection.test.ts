import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import {
  AGENT_MARKERS,
  detectAgents,
  UNDETECTED_INSTALLERS,
} from '../../../src/services/doctor/collector/agents.js';
import { AGENT_MATRIX, resolveConfigFiles } from '../../../src/services/hooks/agent-matrix.js';

/**
 * AGENT DETECTION — REUSED, NOT REBUILT (plan 082 tk-0007).
 *
 * git-ai's amp/opencode/pi installers test `.amp` / `.opencode` / `.pi` in the
 * CURRENT WORKING DIRECTORY, so running the installer from a directory that happens
 * to contain such a folder marks the agent installed. We cannot inherit that,
 * because `detectAgents` composes ABSOLUTE paths from the injected home.
 *
 * WHY THE DECOY TEST EXISTS ANYWAY (dw-001a). We avoid this trap by INHERITANCE —
 * we get it for free from a function written for another purpose. Inheritance can
 * be refactored away by someone who does not know it was load-bearing, and a
 * property nothing asserts is a property that can quietly stop being true. So the
 * decoy row is a POSITIVE CONTROL for a trap we did not have to avoid on purpose.
 */

let home: string;
let cwdDecoy: string;
const fs = new NodeFs();
let originalCwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-detect-home-'));
  cwdDecoy = mkdtempSync(join(tmpdir(), 'harness-detect-cwd-'));
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(home, { recursive: true, force: true });
  rmSync(cwdDecoy, { recursive: true, force: true });
});

describe('detection reuses the collector — no second detector (dw-0019)', () => {
  it('every matrix row LINKS to a real collector marker (dw-0019)', () => {
    /*
    Test Doc:
    - Why: dw-0019. A second detector is a second answer to "which agents are here".
      This row found a real instance of that: comparing our slugs to the collector's
      ids directly returned ['claude-code', 'github-copilot'] unmatched, because the
      collector mirrors git-ai's table where they are `claude` and `copilot`. The
      divergence arrived through NAMING rather than through a second detector, which
      is the same failure with a cheaper disguise.
    - Contract: every detectId resolves, so a rename on either side fails here
      instead of silently detecting nothing.
    */
    const known = new Set(AGENT_MARKERS.map((marker) => marker.id.toLowerCase()));
    const unresolved = AGENT_MATRIX.filter((spec) => !known.has(spec.detectId.toLowerCase()));
    expect(unresolved.map((s) => `${s.agent} -> ${s.detectId}`)).toEqual([]);
  });

  it('the two config tables have not DRIFTED from each other', () => {
    /*
    Test Doc:
    - Why: the collector's marker table and our matrix were built from the SAME
      source raid at different times by different tasks. If they disagree, one is
      writing to a file the other never backs up, and neither would report it.
    - Contract: for every linked agent, our resolved config files are among the
      collector's declared configs (home-relative).
    - WHAT THIS IS NOT: it is NOT corroboration of the paths. Both tables descend
      from one source, so a raid that misread a path puts the SAME error in both and
      this passes cleanly. Agreement between two derivations of one source is a
      shared blind spot, not independent evidence.
    - WHAT IT IS: a DRIFT guard. A transcription slip introduced by either task
      after the raid now fails here — which is precisely the class that produced the
      detectId divergence above. Actual corroboration needs a different source; see
      the live-config row below.
    */
    const byId = new Map(AGENT_MARKERS.map((marker) => [marker.id.toLowerCase(), marker]));
    const disagreements: string[] = [];

    for (const spec of AGENT_MATRIX) {
      const marker = byId.get(spec.detectId.toLowerCase());
      if (marker === undefined) continue;
      const ours = resolveConfigFiles(spec, '/h', () => undefined).map((p) =>
        p.slice('/h/'.length),
      );
      // The collector lists LEGACY paths too (copilot migrates from .github/hooks);
      // ours must be a subset of what it knows about, never a path it has never seen.
      for (const path of ours) {
        if (!marker.configs.includes(path)) disagreements.push(`${spec.agent}: ${path}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('detects an agent from an ABSOLUTE marker under the injected home', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    expect(detectAgents(fs, home).map((a) => a.id)).toContain('cursor');
  });

  it('detects nothing in an EMPTY home — the negative control', () => {
    // Without this, "detects cursor" would also pass for a detector that returns
    // every agent unconditionally.
    expect(detectAgents(fs, home)).toEqual([]);
  });
});

describe('the DECOY — a marker in the CWD must not count (dw-001a)', () => {
  it.each([
    '.amp',
    '.opencode',
    '.pi',
    '.cursor',
    '.claude',
  ])('running from a directory containing %s does NOT detect it', (marker) => {
    /*
      Test Doc:
      - Why: dw-001a. This is git-ai's actual bug — amp/opencode/pi test the marker
        in the CWD, so `cd ~/projects/thing && install` marks an agent present
        because that project happens to have a `.pi` directory.
      - Contract: with the marker present in the CWD and ABSENT from the home,
        nothing is detected.
      - Quality Contribution: a positive control for a trap avoided by inheritance.
        If someone later "simplifies" detection to a relative check, this is the row
        that objects.
      */
    mkdirSync(join(cwdDecoy, marker), { recursive: true });
    process.chdir(cwdDecoy);

    expect(detectAgents(fs, home)).toEqual([]);
  });

  it('and the SAME marker in the HOME is detected — proving the row is not vacuous', () => {
    /*
    Test Doc:
    - Why: every decoy row above asserts an EMPTY result, which a detector that
      always returned nothing would also satisfy. This is the discriminator.
    - Contract: same marker, same cwd, different location → detected.
    */
    mkdirSync(join(cwdDecoy, '.cursor'), { recursive: true });
    mkdirSync(join(home, '.cursor'), { recursive: true });
    process.chdir(cwdDecoy);

    expect(detectAgents(fs, home).map((a) => a.id)).toEqual(['cursor']);
  });
});

describe('Cline is UNDETECTED, not absent (dw-001b)', () => {
  it('is named in UNDETECTED_INSTALLERS rather than silently missing', () => {
    /*
    Test Doc:
    - Why: dw-001b. Cline is editor-level, so marker detection cannot reach it.
      "Not detected" and "not installed" are different facts, and collapsing them
      makes a coverage hole look like an empty machine — the same silent-half-working
      shape this plan keeps meeting.
    - Contract: cline appears in the declared undetected list.
    */
    expect(UNDETECTED_INSTALLERS.map((id) => id.toLowerCase())).toContain('cline');
  });

  it('is NOT in the Strategy A matrix — it is Strategy D, and a different problem', () => {
    // Guards against someone "fixing" the detection gap by adding cline to the JSON
    // matrix, which would write a config file cline does not read.
    expect(AGENT_MATRIX.map((s) => s.agent)).not.toContain('cline');
  });

  it('the undetected list is non-empty and declared — not an empty constant nobody fills', () => {
    expect(UNDETECTED_INSTALLERS.length).toBeGreaterThan(0);
  });
});

describe('CORROBORATION from a source other than the raid — the live filesystem', () => {
  it('every DETECTED agent has a config where the matrix says it does', () => {
    /*
    Test Doc:
    - Why: the drift check above compares two tables sharing one ancestor, so it
      cannot corroborate a path. The live filesystem is genuinely independent
      evidence: these files were written by the agents themselves, not transcribed
      by us.
    - Contract: if detection reports ANY agent present, at least one detected agent
      must have a config file exactly where the matrix says. If detection reports
      none, this is a REAL skip and says so.
    - HOW IT CAN FAIL — the property an earlier version of this row lacked. Break
      the matrix paths and a detected agent yields no existing config, so it goes
      red. That also couples the two tables: being able to detect an agent by its
      marker directory while finding no config where the matrix claims one means one
      of the two is wrong — the exact failure that produced `detectId`.
    - WHAT IT DELIBERATELY DOES NOT ASSERT: which agents a developer has installed.
      That is not a property of this codebase, so the gate is detection (observed),
      never a hardcoded expectation.
    - READ ONLY. Nothing here opens a file for writing: the live ~/.cursor/hooks.json
      holds the git-ai checkpoint pipeline that phase 1's only end-to-end measurement
      depends on.
    */
    const realHome = process.env.HOME ?? process.env.USERPROFILE;
    if (realHome === undefined || realHome.length === 0) {
      expect(realHome).toBeUndefined();
      return;
    }

    const readEnv = (name: string) => process.env[name];
    const detected = detectAgents(fs, realHome).map((m) => m.id.toLowerCase());

    const found: string[] = [];
    const absent: string[] = [];
    for (const spec of AGENT_MATRIX) {
      if (!detected.includes(spec.detectId.toLowerCase())) continue;
      for (const path of resolveConfigFiles(spec, realHome, readEnv)) {
        (fs.exists(path) ? found : absent).push(`${spec.agent}: ${path}`);
      }
    }

    console.log(
      `live-config corroboration — detected ${detected.length}, config FOUND ${found.length}, ABSENT ${absent.length}`,
    );
    for (const entry of found) console.log(`  present: ${entry}`);
    for (const entry of absent) console.log(`  absent:  ${entry}`);

    if (detected.length === 0) {
      // A REAL skip: no agents on this machine (the CI case). Asserted as
      // "nothing detected", not merely "nothing found" — the latter is also what a
      // broken matrix produces.
      expect(detected).toEqual([]);
      return;
    }

    // Detection found agents, so the matrix must locate at least one of their
    // configs. A matrix with broken paths fails here.
    expect(found.length).toBeGreaterThan(0);
  });
});
