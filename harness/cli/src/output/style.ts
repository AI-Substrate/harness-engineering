import type { HelpConfiguration } from 'commander';
import type { OutputMode } from './output-port.js';

/**
 * Minimal ANSI styling for the human surfaces — deliberately zero runtime deps.
 * The CLI ships only `commander` + `jiti`; pulling in a color library
 * (chalk/picocolors) would bloat the published install + supply-chain surface
 * for text decoration alone, against the lean-prod-dep posture. These few SGR
 * wrappers cover it, and every new colour belongs HERE rather than in the
 * surface that wanted it, so the CLI keeps one styling vocabulary.
 *
 * Two surfaces, two gating strategies:
 *   - commander's `--help` (auto-generated): styled via {@link helpStyleConfig}
 *     and applied UNCONDITIONALLY — commander v14 strips ANSI itself on
 *     non-color output streams (honoring NO_COLOR / FORCE_COLOR / CLICOLOR_FORCE
 *     / isTTY), so the gating is commander's job there.
 *   - the hand-rolled `harness help` (renderHelpText): bypasses commander, so it
 *     gates color itself via {@link resolveUseColor} — on by default for an
 *     interactive human run, stripped everywhere else.
 */

const ESC = '\x1b[';
const sgr =
  (open: number, close: number) =>
  (s: string): string =>
    `${ESC}${open}m${s}${ESC}${close}m`;

export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const cyan = sgr(36, 39);
export const green = sgr(32, 39);
export const red = sgr(31, 39);
export const yellow = sgr(33, 39);
export const magenta = sgr(35, 39);

/**
 * Whether OUR own renderers should emit ANSI. Color is ON for an interactive
 * human run and OFF when piped/JSON; NO_COLOR (any non-empty value) or
 * FORCE_COLOR=0/false forces it off, while a truthy FORCE_COLOR / any
 * CLICOLOR_FORCE forces it on. Precedence mirrors commander's own `useColor()`
 * so both help surfaces agree in every environment.
 */
export function resolveUseColor(opts: {
  mode: OutputMode;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}): boolean {
  const { mode, isTty, env } = opts;
  if (
    (env.NO_COLOR !== undefined && env.NO_COLOR !== '') ||
    env.FORCE_COLOR === '0' ||
    env.FORCE_COLOR === 'false'
  ) {
    return false;
  }
  if (
    (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') ||
    env.CLICOLOR_FORCE !== undefined
  ) {
    return true;
  }
  return mode === 'human' && isTty;
}

/**
 * Commander help styling (a `Partial<Help>` via `configureHelp`): accent the
 * section titles so the contributed-verb group reads as distinct from core —
 * `Extensions:` green, `Commands:` cyan, every other title (Usage/Options/…)
 * plain bold. ONLY titles are styled; option/argument/description terms stay
 * verbatim so `helpInformation()` substrings remain stable for tests and pipes.
 */
export function helpStyleConfig(): HelpConfiguration {
  return {
    styleTitle: (title) => {
      if (title.startsWith('Extensions')) return bold(green(title));
      if (title.startsWith('Commands')) return bold(cyan(title));
      return bold(title);
    },
  };
}

/** Accent functions for the hand-rolled `harness help` renderer (identity when disabled). */
export interface HelpPalette {
  heading: (s: string) => string;
  extHeading: (s: string) => string;
  dim: (s: string) => string;
}

const identity = (s: string): string => s;

export function helpPalette(enabled: boolean): HelpPalette {
  if (!enabled) {
    return { heading: identity, extHeading: identity, dim: identity };
  }
  return { heading: (s) => bold(cyan(s)), extHeading: (s) => bold(green(s)), dim };
}
