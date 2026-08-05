/**
 * Outcome-event derivation (plan 034 Phase 5, T5.6/T5.7 — AC-19, source matrix §2).
 *
 * When a harness sub-command runs, its captured RESULT (the JSON command envelope
 * a harness verb prints — `{ command, status, data }`) yields two outcome events:
 *   • `command_exit` — the verb + a process exit (the observed error flag, else
 *     derived from the verdict) + the normalized status.
 *   • `checks` — for `harness checks`: the overall verdict + per-gate verdicts.
 *
 * CODES / VERDICTS ONLY (AC-15): the gate `note` (free text) and every other
 * envelope field are dropped — the envelope is never spread. `error.code` joins
 * that set at plan 071 (tk-7169): an `E###` is a fixed vocabulary, and it is what
 * makes a REFUSAL provable from evidence. Commits are
 * intentionally NOT events (git is queryable later — AC-19). Pure (no I/O); the
 * adapter supplies the result text + timestamp it observed.
 */

import type { ChecksStatus, Event } from './events.js';

interface RawEnvelope {
  command?: unknown;
  status?: unknown;
  data?: unknown;
  error?: unknown;
}

/**
 * An `E###` code, or `null`.
 *
 * The whole capture rests on this predicate, so it is deliberately the tightest
 * thing that can be written: three digits after an `E`, anchored both ends. A
 * value that does not match is DROPPED rather than trimmed — the moment this
 * function starts salvaging almost-codes it becomes a free-text channel, and the
 * privacy argument for capturing it at all (a fixed vocabulary, exactly like
 * `checks.gates` and `mark.verdict`) stops being true.
 */
function errorCode(raw: unknown): string | null {
  const code = (raw as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^E\d{3}$/.test(code) ? code : null;
}

/** Narrow a raw envelope `status` to the coarse checks verdict, or `null`. */
function normalizeChecksStatus(raw: unknown): ChecksStatus | null {
  if (raw === 'ok') return 'ok';
  if (raw === 'degraded') return 'degraded';
  if (raw === 'error' || raw === 'fatal') return 'error';
  return null;
}

/** A harness JSON envelope, or `null` when the text is not one (e.g. the human rail). */
function parseEnvelope(text: string): RawEnvelope | null {
  const trimmed = text.trim();
  // Must be a bare JSON object — a strict guard so free-form output (rail mode,
  // a command run without `--json`) is never mis-read as an envelope.
  if (trimmed.length === 0 || trimmed[0] !== '{') return null;
  try {
    const v: unknown = JSON.parse(trimmed);
    return v !== null && typeof v === 'object' ? (v as RawEnvelope) : null;
  } catch {
    return null;
  }
}

/** `data.gates[] → { name: status }` (names + verdicts only; `note` dropped). */
function gateVerdicts(data: unknown): Record<string, string> | null {
  const gates = (data as { gates?: unknown } | null | undefined)?.gates;
  if (!Array.isArray(gates)) return null;
  const out: Record<string, string> = {};
  for (const g of gates) {
    const name = (g as { name?: unknown })?.name;
    const status = (g as { status?: unknown })?.status;
    if (typeof name === 'string' && typeof status === 'string') out[name] = status;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build the `checks` event for one observed `harness checks` outcome — the SINGLE
 * grammar both producers share (plan 069):
 *  - the ADAPTER path, when a harness JSON envelope was captured in a transcript's
 *    tool result ({@link outcomeEvents}), and
 *  - the SELF path, when the harness CLI observes its OWN exit envelope
 *    (`checks-capture.ts`) — the only observer that works on every agent harness.
 *
 * Returns `null` when `rawStatus` is not a recognized verdict — an honest silence,
 * never a fabricated `ok`. CODES/VERDICTS ONLY: gate `note` (free text) and every
 * other envelope field are dropped.
 */
export function buildChecksEvent(rawStatus: unknown, data: unknown, t: string): Event | null {
  const status = normalizeChecksStatus(rawStatus);
  if (status === null) return null;
  const ev: Event = { t, kind: 'checks', status };
  const gates = gateVerdicts(data);
  if (gates !== null) ev.gates = gates;
  return ev;
}

/**
 * Derive the outcome events for one captured harness command result. Returns `[]`
 * when `resultText` is not a harness envelope (the command ran without `--json`,
 * or the text is human rail) — honest, never fabricated.
 *
 * @param resultText the command's captured stdout (the JSON envelope, ideally)
 * @param t          the event timestamp the adapter observed for the result
 * @param isError    the harness's observed error flag (Claude tool_result `is_error`)
 */
export function outcomeEvents(resultText: string, t: string, isError = false): Event[] {
  const env = parseEnvelope(resultText);
  if (env === null) return [];
  const verb = typeof env.command === 'string' && env.command.length > 0 ? env.command : null;
  if (verb === null) return [];

  const status = normalizeChecksStatus(env.status);
  const events: Event[] = [];

  // command_exit — the observed error flag wins; else derive from the verdict
  // (a harness verb exits non-zero only on `error`/`fatal`).
  const exit = isError || status === 'error' ? 1 : 0;
  const ce: Event = { t, kind: 'command_exit', verb, exit };
  if (typeof env.status === 'string') ce.status = env.status;
  // The refusal's own code. Without it a gate refusal is invisible in evidence:
  // the flow file is untouched by design, so `flow nav set` exiting 1 with E440
  // and exiting 1 for any other reason were the same event.
  const code = errorCode(env.error);
  if (code !== null) ce.code = code;
  events.push(ce);

  // checks — overall verdict + per-gate verdicts (names/statuses only), via the
  // shared builder so this path and the CLI's own exit-observation path cannot
  // produce differently-shaped `checks` events (plan 069).
  if (verb === 'checks') {
    const ck = buildChecksEvent(env.status, env.data, t);
    if (ck !== null) events.push(ck);
  }
  return events;
}
