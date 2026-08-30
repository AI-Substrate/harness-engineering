import type { EnvPort } from '../../adapters/env/env-port.js';
import { type ErrorCode, ErrorCodes } from '../../output/error-codes.js';

export const SETTINGS_SCHEMA_MAJOR = 1;
export const TELEMETRY_KILL_SWITCH_ENV = 'HARNESS_NO_TELEMETRY';
export const REPO_SETTINGS_PATH = '.harness/settings.json';
export const LOCAL_SETTINGS_PATH = '.harness/settings.local.json';

export type SettingsOrigin = 'default' | 'repo' | 'local' | 'kill-switch';
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ResolvedValue<T extends JsonValue = JsonValue> {
  value: T;
  origin: SettingsOrigin;
}

export type ResolvedTree = { [key: string]: ResolvedValue | ResolvedTree };

export interface ResolvedSettings {
  governance: ResolvedTree;
  machine: ResolvedTree;
  flowspace: { ingest: { enabled: ResolvedValue<boolean> } };
}

export interface SettingsRefusal {
  ok: false;
  code: ErrorCode;
  message: string;
  next_action: string;
}

export type SettingsResolution = { ok: true; settings: ResolvedSettings } | SettingsRefusal;

type SettingsDocument = {
  governance?: Record<string, JsonValue>;
  machine?: Record<string, JsonValue>;
  flowspace?: { ingest?: { enabled?: boolean } };
};

type SettingsSource = typeof REPO_SETTINGS_PATH | typeof LOCAL_SETTINGS_PATH;
type ParsedDocument = { ok: true; document: SettingsDocument } | SettingsRefusal;
type OptionalObject = { ok: true; value?: Record<string, JsonValue> } | SettingsRefusal;

const ALLOWED_TOP_LEVEL_KEYS = new Set(['schema_version', 'governance', 'machine', 'flowspace']);

export function invalidSettings(
  source: string,
  problem: string,
  nextAction?: string,
): SettingsRefusal {
  return {
    ok: false,
    code: ErrorCodes.SETTINGS_INVALID,
    message: `${source}: ${problem}.`,
    next_action: nextAction ?? `Fix the JSON in ${source}, then retry.`,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonValueProblem(value: unknown, path: string): string | null {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const problem = jsonValueProblem(value[i], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = jsonValueProblem(child, `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  }
  return `contains a non-JSON value at ${path}`;
}

function readObject(
  document: Record<string, unknown>,
  key: 'governance' | 'machine',
  source: SettingsSource,
): OptionalObject {
  const value = document[key];
  if (value === undefined) return { ok: true };
  if (!isObject(value)) return invalidSettings(source, `"${key}" must be an object`);
  const problem = jsonValueProblem(value, key);
  return problem === null
    ? { ok: true, value: value as Record<string, JsonValue> }
    : invalidSettings(source, problem);
}

function parseDocument(text: string | null, source: SettingsSource): ParsedDocument {
  if (text === null) return { ok: true, document: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidSettings(source, 'file is not valid JSON');
  }
  if (!isObject(parsed)) return invalidSettings(source, 'file must contain a JSON object');

  const unknownKeys = Object.keys(parsed).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return invalidSettings(
      source,
      `file contains unknown top-level key(s): ${unknownKeys.sort().join(', ')}`,
    );
  }

  const schemaVersion = parsed.schema_version;
  if (schemaVersion !== undefined) {
    if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
      return invalidSettings(source, 'schema_version must be a finite number');
    }
    const major = Math.trunc(schemaVersion);
    if (major !== SETTINGS_SCHEMA_MAJOR) {
      return {
        ok: false,
        code: ErrorCodes.SETTINGS_SCHEMA_VERSION,
        message: `${source}: schema_version ${schemaVersion} has an unsupported major (this CLI understands major ${SETTINGS_SCHEMA_MAJOR}).`,
        next_action: 'Run `harness update` to get a CLI that understands this settings version.',
      };
    }
  }

  if (source === LOCAL_SETTINGS_PATH && Object.hasOwn(parsed, 'governance')) {
    return invalidSettings(
      source,
      'governance-class key "governance" is forbidden in local settings',
      `Remove governance settings from ${LOCAL_SETTINGS_PATH}, move them to ${REPO_SETTINGS_PATH}, then retry.`,
    );
  }

  const governance = readObject(parsed, 'governance', source);
  if (!governance.ok) return governance;
  const machine = readObject(parsed, 'machine', source);
  if (!machine.ok) return machine;

  const flowspaceRaw = parsed.flowspace;
  let flowspace: SettingsDocument['flowspace'];
  if (flowspaceRaw !== undefined) {
    if (!isObject(flowspaceRaw)) return invalidSettings(source, '"flowspace" must be an object');
    const unknownFlowspace = Object.keys(flowspaceRaw).filter((key) => key !== 'ingest');
    if (unknownFlowspace.length > 0) {
      return invalidSettings(
        source,
        `file contains unknown flowspace key(s): ${unknownFlowspace.sort().join(', ')}`,
      );
    }

    const ingestRaw = flowspaceRaw.ingest;
    if (ingestRaw !== undefined) {
      if (!isObject(ingestRaw)) {
        return invalidSettings(source, '"flowspace.ingest" must be an object');
      }
      const unknownIngest = Object.keys(ingestRaw).filter((key) => key !== 'enabled');
      if (unknownIngest.length > 0) {
        return invalidSettings(
          source,
          `file contains unknown flowspace.ingest key(s): ${unknownIngest.sort().join(', ')}`,
        );
      }
      if (source === LOCAL_SETTINGS_PATH && Object.hasOwn(ingestRaw, 'enabled')) {
        return invalidSettings(
          source,
          'governance-class consent key "flowspace.ingest.enabled" is forbidden in local settings',
          `Remove flowspace.ingest.enabled from ${LOCAL_SETTINGS_PATH}, move it to ${REPO_SETTINGS_PATH}, then retry.`,
        );
      }
      if (ingestRaw.enabled !== undefined && typeof ingestRaw.enabled !== 'boolean') {
        return invalidSettings(source, '"flowspace.ingest.enabled" must be a boolean');
      }
      flowspace = {
        ingest: { ...(ingestRaw.enabled !== undefined && { enabled: ingestRaw.enabled }) },
      };
    } else {
      flowspace = {};
    }
  }

  return {
    ok: true,
    document: {
      ...(governance.value && { governance: governance.value }),
      ...(machine.value && { machine: machine.value }),
      ...(flowspace && { flowspace }),
    },
  };
}

function resolveTree(
  repo: Record<string, JsonValue> | undefined,
  local: Record<string, JsonValue> | undefined,
): ResolvedTree {
  const resolved: ResolvedTree = {};
  const keys = new Set([...Object.keys(repo ?? {}), ...Object.keys(local ?? {})]);
  for (const key of keys) {
    const repoValue = repo?.[key];
    const hasLocal = local !== undefined && Object.hasOwn(local, key);
    const localValue = hasLocal ? local[key] : undefined;

    if (hasLocal) {
      resolved[key] = isObject(localValue)
        ? resolveTree(
            isObject(repoValue) ? (repoValue as Record<string, JsonValue>) : undefined,
            localValue as Record<string, JsonValue>,
          )
        : { value: localValue as JsonValue, origin: 'local' };
    } else if (isObject(repoValue)) {
      resolved[key] = resolveTree(repoValue as Record<string, JsonValue>, undefined);
    } else if (repoValue !== undefined) {
      resolved[key] = { value: repoValue, origin: 'repo' };
    }
  }
  return resolved;
}

/** Resolve settings without filesystem, process, clock, or other ambient I/O. */
export function resolve(
  repoText: string | null,
  localText: string | null,
  env: Pick<EnvPort, 'get'>,
): SettingsResolution {
  const repo = parseDocument(repoText, REPO_SETTINGS_PATH);
  if (!repo.ok) return repo;
  const local = parseDocument(localText, LOCAL_SETTINGS_PATH);
  if (!local.ok) return local;

  const killed = env.get(TELEMETRY_KILL_SWITCH_ENV) === '1';
  const repoEnabled = repo.document.flowspace?.ingest?.enabled;
  return {
    ok: true,
    settings: {
      governance: resolveTree(repo.document.governance, undefined),
      machine: resolveTree(repo.document.machine, local.document.machine),
      flowspace: {
        ingest: {
          enabled: killed
            ? { value: false, origin: 'kill-switch' }
            : repoEnabled === undefined
              ? { value: false, origin: 'default' }
              : { value: repoEnabled, origin: 'repo' },
        },
      },
    },
  };
}
