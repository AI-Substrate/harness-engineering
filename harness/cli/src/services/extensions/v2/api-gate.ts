import { ErrorCodes } from '../../../output/error-codes.js';
import { API_VOCABULARY, CORE_EXTENSION_API, type ExtensionDefinition } from '../contract.js';

const METADATA_FIELDS = new Set(['kind', 'api', 'name', 'summary', 'description']);

export type ApiGateResult =
  | { ok: true; api: number; info: string[] }
  | { ok: false; code: string; message: string; next_action: string };

type ApiVocabulary = Readonly<Record<number, readonly string[]>>;

/** Injectable only so future-core semantics can be proved without changing this core's level. */
export interface ApiGateEnvironment {
  coreApi: number;
  vocabulary: ApiVocabulary;
}

const DEFAULT_ENVIRONMENT: ApiGateEnvironment = {
  coreApi: CORE_EXTENSION_API,
  vocabulary: API_VOCABULARY,
};

/** Lowest contract level at which this running core knows a section. */
function minimumKnownApi(
  section: string,
  coreApi: number,
  vocabulary: ApiVocabulary,
): number | undefined {
  const levels = Object.entries(vocabulary)
    .filter(([level, names]) => Number(level) <= coreApi && names.includes(section))
    .map(([level]) => Number(level));
  return levels.length > 0 ? Math.min(...levels) : undefined;
}

/**
 * Enforce the v2 monotonic api contract before validation/normalization. The
 * declaration default is permanently api 2; it never follows the running core.
 */
export function gateExtensionDefinition(
  definition: ExtensionDefinition,
  environment: ApiGateEnvironment = DEFAULT_ENVIRONMENT,
): ApiGateResult {
  const rawApi = definition.api;
  const declaredApi = rawApi ?? 2;
  const { coreApi, vocabulary } = environment;
  if (!Number.isInteger(declaredApi) || declaredApi < 2) {
    return {
      ok: false,
      code: ErrorCodes.EXTENSION_LOAD_FAILED,
      message: `extension api must be an integer >= 2 (received ${String(rawApi)})`,
      next_action: `Set \`api\` to a supported extension contract level (2-${coreApi}), then retry.`,
    };
  }

  if (declaredApi > coreApi) {
    return {
      ok: false,
      code: ErrorCodes.EXTENSION_API_ABOVE_CORE,
      message: `extension requires api ${declaredApi}, but this harness core supports api ${coreApi}`,
      next_action: `Run harness update — this extension needs a newer harness core (api ${declaredApi} > supported ${coreApi}).`,
    };
  }

  const unknown: string[] = [];
  const info: string[] = [];
  for (const section of Object.keys(definition)) {
    if (METADATA_FIELDS.has(section)) continue;
    const minimumApi = minimumKnownApi(section, coreApi, vocabulary);
    if (minimumApi === undefined) {
      unknown.push(section);
      continue;
    }
    if (minimumApi > declaredApi) {
      info.push(
        `section '${section}' is known to core api ${coreApi} but was introduced in api ${minimumApi}; bump \`api\` from ${declaredApi} to ${minimumApi} to opt into its contract semantics`,
      );
    }
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      code: ErrorCodes.EXTENSION_UNKNOWN_SECTION,
      message: `unknown top-level extension section(s): ${unknown.join(', ')}`,
      next_action:
        'Fix the section name, or if it is from a newer contract: declare the api level and run harness update.',
    };
  }

  return { ok: true, api: declaredApi, info };
}
