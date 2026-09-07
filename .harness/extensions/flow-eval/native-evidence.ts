import type { ExecResult } from '@ai-substrate/engineering-harness/contract';
import { resolve } from 'node:path';

/** Flowspace's public ConversationWindow/TurnView, not telemetry SessionEvidence. */
export interface NativeTurn {
  address: string;
  turn_no: number;
  role: string;
  source: string;
  head_sha: string | null;
  at: string;
  body: string;
  items: Array<Record<string, unknown>>;
}
export interface NativeEvidence {
  source: 'flowspace';
  peer_id: string;
  native_session: string | null;
  root: string;
  model: string | null;
  effort?: string;
  provider_attestation: 'unverified';
  guid: string | null;
  base_sha: string | null;
  complete: boolean;
  cutoff: { turns: number; last_turn_at: string } | null;
  turns: NativeTurn[];
  tools: Record<string, number>;
  commands: Array<{ turn: number; argv: string[] }>;
  gaps: string[];
  receipts: string[];
}
export interface NativePorts {
  exec(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult>;
  save(name: string, text: string): void;
  /** Locally packaged/current CLI argv prefix; never resolve a registry package. */
  harness: { command: string; args: string[] };
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function json(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** Only direct, simple argv are observable. Never search strings inside eval/wrappers. */
export function directArgv(item: Record<string, unknown>): string[] | null {
  if (item.kind !== 'tool_call' || !['bash', 'functions.bash'].includes(String(item.tool))) return null;
  if (!object(item.input) || item.input.kind !== 'verbatim' || typeof item.input.text !== 'string') return null;
  const input = json(item.input.text);
  if (!object(input) || typeof input.command !== 'string') return null;
  // Deliberately excludes quoting, shell expansion, pipelines and inline programs.
  if (!/^[A-Za-z0-9_./:=@%+,-]+(?:[ \t]+[A-Za-z0-9_./:=@%+,-]+)*$/.test(input.command)) return null;
  const argv = input.command.split(/[ \t]+/);
  const executable = argv[0].split('/').pop();
  if (executable === 'harness' || executable === 'engh' || executable === 'ddocs') return argv;
  if (executable === 'node' && /(?:^|\/)harness(?:\.js)?$/.test(argv[1] ?? '')) return argv;
  return null;
}

export async function acquireNativeEvidence(peer: string, root: string, ports: NativePorts): Promise<NativeEvidence> {
  const out: NativeEvidence = {
    source: 'flowspace', peer_id: peer, native_session: null, root, model: null,
    provider_attestation: 'unverified', guid: null, base_sha: null, complete: false,
    cutoff: null, turns: [], tools: {}, commands: [], receipts: [],
    gaps: ['telemetry segments unavailable', 'token and cost usage unavailable',
      'command exits, check results and gate refusals unavailable',
      'provider-served model identity unverified', 'opaque command execution unknown',
      'tool results may be truncated by Flowspace intake'],
  };
  const capture = async (name: string, command: string, args: string[]) => {
    const result = await ports.exec(command, args, { cwd: root });
    ports.save(name, JSON.stringify({ command, args, result }, null, 2));
    out.receipts.push(name);
    if (!result.ok) throw new Error(`${command} ${args[0]} exited ${result.code}`);
    const envelope = json(result.stdout);
    if (!object(envelope) || (envelope.ok !== true && envelope.status !== 'ok')) {
      throw new Error(`${command} did not return a successful JSON envelope`);
    }
    return envelope.data;
  };
  try {
    const listing = await capture('peers.json', 'pij-rs', ['list', '--json']);
    if (!object(listing) || !Array.isArray(listing.seats)) throw new Error('rs list has no data.seats');
    const matches = listing.seats.filter((s) => object(s) && s.id === peer);
    const row = matches[0];
    if (matches.length !== 1 || !object(row) || row.harness !== 'omp' || typeof row.session !== 'string' || !row.session) {
      throw new Error('exact OMP peer row.session is unavailable');
    }
    if (typeof row.folder !== 'string' || resolve(row.folder) !== resolve(root)) throw new Error('peer native root does not match subject root');
    out.native_session = row.session;
    out.model = typeof row.model === 'string' ? row.model : null;
    if (typeof row.effort === 'string') out.effort = row.effort;
    await capture('sync.json', ports.harness.command, [...ports.harness.args, 'convo', 'sync', '--harness', 'omp', '--session', row.session, '--json']);
    const verified = await capture('verify.json', 'flowspace3', ['conversation', 'verify', '--harness', 'omp', '--session', row.session, '--json']);
    if (!object(verified) || typeof verified.guid !== 'string' || verified.address !== `conv:${verified.guid}` ||
        !Number.isSafeInteger(verified.turns) || Number(verified.turns) < 1 ||
        typeof verified.last_turn_at !== 'string' || !Number.isFinite(Date.parse(verified.last_turn_at))) {
      throw new Error('Flowspace delivery/cutoff is not established');
    }
    if (typeof verified.worktree !== 'string' || resolve(verified.worktree) !== resolve(root)) throw new Error('verified conversation root mismatch');
    out.guid = verified.guid;
    out.cutoff = { turns: Number(verified.turns), last_turn_at: verified.last_turn_at };
    // Freeze the verified cutoff. A growing conversation is partial, never silently extended.
    for (let next = 1; next <= out.cutoff.turns;) {
      const data = await capture(`window-${next}.json`, 'flowspace3', ['get', `${verified.address}#t${next}`, '--before', '0', '--after', '200', '--json']);
      if (!object(data) || data.address !== verified.address || data.turns !== out.cutoff.turns ||
          data.around !== next || !Array.isArray(data.window) || data.window.length < 1 || data.window.length > 201 ||
          typeof data.worktree !== 'string' || resolve(data.worktree) !== resolve(root)) throw new Error('partial, changed or misbound conversation window');
      if (next === 1) out.base_sha = typeof data.base_sha === 'string' ? data.base_sha : null;
      else if (data.base_sha !== out.base_sha) throw new Error('conversation base changed between windows');
      for (const raw of data.window) {
        if (!object(raw) || raw.turn_no !== next || raw.address !== `${verified.address}#t${next}` ||
            typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at)) || typeof raw.body !== 'string' ||
            typeof raw.role !== 'string' || typeof raw.source !== 'string' || !Array.isArray(raw.items) ||
            !raw.items.every(object) || next > out.cutoff.turns) throw new Error(`missing/malformed turn ${next}`);
        const turn = raw as unknown as NativeTurn;
        out.turns.push(turn);
        for (const item of turn.items) {
          if (item.kind === 'tool_call' && typeof item.tool === 'string') {
            out.tools[item.tool] = (out.tools[item.tool] ?? 0) + 1;
            const argv = directArgv(item);
            if (argv) out.commands.push({ turn: next, argv });
          }
        }
        next++;
      }
    }
    if (Date.parse(out.turns[out.turns.length - 1]?.at ?? '') !== Date.parse(out.cutoff.last_turn_at)) throw new Error('final turn timestamp does not match verified cutoff');
    out.complete = true;
  } catch (error) {
    out.gaps.push(error instanceof Error ? error.message : String(error));
  }
  if (out.complete && out.base_sha === null) out.gaps.push('native base_sha unavailable; use independently bound preparation/Git evidence');
  if (out.turns.some((turn) => turn.head_sha === null)) out.gaps.push('native per-turn head_sha unavailable; commit bindings require independent Git evidence');
  ports.save('native-evidence.json', JSON.stringify(out, null, 2));
  return out;
}
