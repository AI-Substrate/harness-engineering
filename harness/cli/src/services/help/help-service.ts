import type { FsPort } from '../../adapters/fs/fs-port.js';
import { helpPalette } from '../../output/style.js';
import type { VerbRegistry } from '../extensions/registry.js';
import { instructionsPathFor } from '../instructions/instructions-service.js';

/** Machine-readable per-verb summary surfaced by `help` (AC-1/AC-6). */
export interface VerbSummary {
  name: string;
  summary: string;
  status: 'loaded';
  /** True when the verb's extension folder carries an `instructions.md` briefing (plan 014 AC-4). */
  has_instructions: boolean;
  /** Structural v2 children, omitted for leaf/v1 verbs to preserve the v1 payload. */
  subverbs?: Array<{ name: string; summary: string }>;
}

/** The full help payload — human-rendered as text, JSON-rendered as an envelope `data`. */
export interface HelpContent {
  purpose: string;
  /** The agent's first hop: where to self-brief (plan 014 AC-4). */
  agents_start_here: string;
  output_modes: string[];
  exit_codes: Record<string, string>;
  safe_first_actions: string[];
  verbs: VerbSummary[];
  extensions: { installed: number; failed: number; conflicts: number };
}

const PURPOSE =
  "The agent-friendly front door to this repo's engineering harness. " +
  'Verbs are owned by extensions: each is a little package at `./.harness/extensions/<name>/` ' +
  '(entry `extension.ts`, briefing `instructions.md`) and becomes a `harness <verb>` command. ' +
  '`help`, `doctor`, `new`, `docs`, `skills`, `record`, `sensors`, and `instructions` are always available.';

const AGENTS_START_HERE =
  'npx harness instructions — the agent briefing (then `harness instructions <verb>` per verb)';

const OUTPUT_MODES = [
  '--json forces JSON output',
  '--no-json forces human output',
  'HARNESS_JSON=1 forces JSON (useful in CI)',
  'otherwise: piped output → JSON, an interactive TTY → human',
];

const EXIT_CODES: Record<string, string> = {
  '0': 'ok or degraded (the command reported successfully)',
  '1': 'error (something failed; see error.code + next_action)',
  '2': 'unconfigured (no behaviour mapped to this verb yet)',
};

const EMPTY_HINT =
  'No extensions installed yet. Run `harness new <name>` to scaffold one into ' +
  '`./.harness/extensions/<name>/` (entry `extension.ts` + briefing `instructions.md`). See the authoring guide.';

/**
 * Build the help payload from the assembled verb registry. The `FsPort` is used
 * ONLY for per-verb `instructions.md` existence probes at help-build time (plan
 * 014 D4) — no content is read here.
 */
export function buildHelp(registry: VerbRegistry, fs: FsPort): HelpContent {
  const installed = registry.records.filter((r) => r.status === 'loaded').length;
  const failed = registry.records.filter((r) => r.status === 'failed').length;
  const conflicts = registry.records.filter((r) => r.status === 'conflict').length;

  const safeFirstActions = [
    'harness instructions — the agent briefing (AGENTS START HERE)',
    'harness doctor — see which extensions loaded (and any that failed)',
    'harness docs — list the bundled docs (then `harness docs <id>` to read one)',
    'harness new <name> — scaffold a new extension (add --wrap "<cmd>" to wrap a real command)',
    "harness skills install --target <cli> — install this harness's skills into your CLI",
    'harness help --json — the machine-readable verb list',
  ];
  if (registry.verbs.length > 0) {
    safeFirstActions.push(
      `harness ${registry.verbs[0]?.name} --help — usage for a contributed verb`,
    );
  }

  return {
    purpose: PURPOSE,
    agents_start_here: AGENTS_START_HERE,
    output_modes: OUTPUT_MODES,
    exit_codes: EXIT_CODES,
    safe_first_actions: safeFirstActions,
    verbs: registry.verbs.map((verb) => {
      const briefingPath = instructionsPathFor(verb.name, registry);
      return {
        name: verb.name,
        summary: verb.summary,
        status: 'loaded' as const,
        has_instructions: briefingPath !== null && fs.exists(briefingPath),
        ...((verb.subverbs?.length ?? 0) > 0 && {
          subverbs: verb.subverbs?.map((subverb) => ({
            name: subverb.name,
            summary: subverb.summary,
          })),
        }),
      };
    }),
    extensions: { installed, failed, conflicts },
  };
}

/** The honest "no extensions installed yet" next_action, or undefined when verbs exist. */
export function helpEmptyHint(content: HelpContent): string | undefined {
  return content.verbs.length === 0 ? EMPTY_HINT : undefined;
}

/**
 * Render the help payload as human-readable text (pure — returns a string).
 * Core commands and contributed verbs print under SEPARATE headings (`Commands:`
 * vs `Extensions:`) so the dynamic, extension-owned surface is visually distinct
 * from the fixed core. `useColor` accents the headings (cyan core / green
 * extensions) + dims descriptions; it defaults off so non-interactive callers
 * (and tests) get plain text. The entrypoint resolves it from human + TTY state.
 */
export function renderHelpText(content: HelpContent, useColor = false): string {
  const c = helpPalette(useColor);
  const lines: string[] = [];
  lines.push('▶ AGENTS START HERE: npx harness instructions (the agent briefing)', '');
  lines.push('harness — engineering harness front door', '', content.purpose, '');
  lines.push(c.heading('Commands:'));
  lines.push(`  help                ${c.dim('explain the harness (this output)')}`);
  lines.push(
    `  doctor              ${c.dim('report what is configured + which extensions loaded')}`,
  );
  lines.push(
    `  instructions [verb] ${c.dim("the agent briefing (core, or one verb's instructions.md)")}`,
  );
  lines.push(
    `  new <name>          ${c.dim('scaffold a new extension into ./.harness/extensions/<name>/')}`,
  );
  lines.push(`  docs [id]           ${c.dim('list the bundled docs, or print one by id')}`);
  lines.push(
    `  sensors             ${c.dim('inspect, run, watch, snapshot, or check typed sensors')}`,
  );
  lines.push('', c.extHeading('Extensions:'));
  if (content.verbs.length === 0) {
    lines.push('  (no extensions installed yet)');
  }
  for (const verb of content.verbs) {
    const briefing = verb.has_instructions ? ' 📖' : '';
    lines.push(`  ${verb.name.padEnd(18)}${c.dim(verb.summary)}${briefing}`);
    for (const subverb of verb.subverbs ?? []) {
      lines.push(`    ${`${verb.name} ${subverb.name}`.padEnd(16)}${c.dim(subverb.summary)}`);
    }
  }
  const { failed, conflicts } = content.extensions;
  if (failed > 0 || conflicts > 0) {
    lines.push('', `⚠ ${failed} failed, ${conflicts} conflict(s) — run \`harness doctor\`.`);
  }
  lines.push('', c.heading('Output modes:'));
  for (const mode of content.output_modes) {
    lines.push(`  - ${mode}`);
  }
  lines.push('', c.heading('Exit codes:'));
  for (const [code, meaning] of Object.entries(content.exit_codes)) {
    lines.push(`  ${code}  ${meaning}`);
  }
  lines.push('', c.heading('Safe first actions:'));
  for (const action of content.safe_first_actions) {
    lines.push(`  - ${action}`);
  }
  return `${lines.join('\n')}\n`;
}
