import type { SlotRegistry, SlotStatus } from '../slots/slot-registry.js';

/** Machine-readable per-slot summary surfaced by `help --json` (AC-8/PL-02). */
export interface SlotSummary {
  name: string;
  status: SlotStatus;
  description: string;
  next_action: string;
}

/** The full help payload — human-rendered as text, JSON-rendered as an envelope `data`. */
export interface HelpContent {
  purpose: string;
  output_modes: string[];
  exit_codes: Record<string, string>;
  safe_first_actions: string[];
  slots: SlotSummary[];
}

const PURPOSE =
  "The agent-friendly front door to this repo's engineering harness. " +
  'Two commands work today (help, doctor); the rest are honest unconfigured stubs ' +
  'an extension will fill later.';

const OUTPUT_MODES = [
  '--json forces JSON output',
  '--no-json forces human output',
  'HARNESS_JSON=1 forces JSON (useful in CI)',
  'otherwise: piped output → JSON, an interactive TTY → human',
];

const EXIT_CODES: Record<string, string> = {
  '0': 'ok or degraded (the command reported successfully)',
  '1': 'error (something failed; see error.code + next_action)',
  '2': 'unconfigured (no behaviour mapped to this slot yet)',
};

const SAFE_FIRST_ACTIONS = [
  'harness doctor — check what is configured vs unconfigured',
  'harness help --json — the machine-readable command map',
  'harness run validate --dry-run — see a slot without executing anything',
];

/** Build the help payload from the live slot registry (pure — no I/O). */
export function buildHelp(registry: SlotRegistry): HelpContent {
  return {
    purpose: PURPOSE,
    output_modes: OUTPUT_MODES,
    exit_codes: EXIT_CODES,
    safe_first_actions: SAFE_FIRST_ACTIONS,
    slots: registry.map((slot) => ({
      name: slot.name,
      status: slot.status,
      description: slot.description,
      next_action: slot.next_action,
    })),
  };
}

/** Render the help payload as human-readable text (pure — returns a string). */
export function renderHelpText(content: HelpContent): string {
  const lines: string[] = [];
  lines.push('harness — engineering harness front door', '', content.purpose, '');
  lines.push('Commands:');
  lines.push('  help                explain the harness (this output)');
  lines.push('  doctor              report what is configured vs unconfigured');
  for (const slot of content.slots) {
    const mark = slot.status === 'configured' ? ' ' : '·';
    lines.push(`  ${mark} ${slot.name.padEnd(16)}${slot.description} [${slot.status}]`);
  }
  lines.push('', 'Output modes:');
  for (const mode of content.output_modes) {
    lines.push(`  - ${mode}`);
  }
  lines.push('', 'Exit codes:');
  for (const [code, meaning] of Object.entries(content.exit_codes)) {
    lines.push(`  ${code}  ${meaning}`);
  }
  lines.push('', 'Safe first actions:');
  for (const action of content.safe_first_actions) {
    lines.push(`  - ${action}`);
  }
  return `${lines.join('\n')}\n`;
}
