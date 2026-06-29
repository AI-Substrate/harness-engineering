/**
 * `flow-eval` scenario loader + schema validation (plan 041 Phase 2, T001).
 *
 * Loads a COMMITTED scenario bundle (`scenario.json` + `assertions.json`) from
 * `live-testing/scenarios/<slug>/` and validates it against the workshop schema
 * (`docs/plans/041-flow-conformance-eval/workshops/001-…` §1–§2). The engine is
 * generic; a scenario is pure data, so the load-bearing contract is THIS shape.
 *
 * FAIL-SAFE: a malformed bundle never throws — it returns `{ ok:false, error }`
 * with a descriptive message the `score` verb maps onto an `error` envelope
 * (AC-04). Read-only; uses only the injected `ctx.fs` (no `node:*` — extensions
 * stay node-free, like the core services).
 */

/** The lane(s) an assertion is proven from — `source` in the assertion schema. */
export type AssertionSource = 'telemetry' | 'fs' | 'fs+telemetry' | 'judged';

/** One assertion entry from `assertions.json` (workshop §2). */
export interface Assertion {
  /** Stable handle, referenced in the report. */
  id: string;
  /** Resolver key — dispatched by the registry (workshop §3). */
  type: string;
  /** Lane(s) this assertion is proven from; validated against the type's allowed lanes. */
  source: AssertionSource;
  /** Type-specific params (see the registry). */
  params: Record<string, unknown>;
  /** A required assertion that resolves `fail` caps the run verdict to FAIL (default false). */
  required?: boolean;
  /** Contribution to the deterministic score (default 1). */
  weight?: number;
  /** Human label for the report row. */
  describe?: string;
}

/** The `scenario.json` shape (workshop §1). */
export interface ScenarioConfig {
  slug: string;
  title: string;
  task: string;
  base: { repo: string; ref: string };
  subject: { harness: string; model: string; effort?: string };
  flow: { mode: string; stages: string[] };
  prompts: { orchestrator: string; subject: string };
  /** Relative filename of the assertions bundle (e.g. `assertions.json`). */
  assertions: string;
}

/** A fully-loaded, validated scenario bundle. */
export interface LoadedScenario {
  config: ScenarioConfig;
  assertions: Assertion[];
  /** The scenario directory the bundle was read from. */
  dir: string;
}

/** Discriminated result — the load never throws (AC-04). */
export type LoadResult = { ok: true; scenario: LoadedScenario } | { ok: false; error: string };

/**
 * The assertion `type` registry → its allowed lane(s). This is the single source
 * of truth the loader validates `source` against AND the resolver registry binds
 * to (a `resolvers.test.ts` asserts the two stay in lock-step). Every `type` in
 * the workshop §3 taxonomy appears here.
 */
export const ASSERTION_TYPES: Record<string, AssertionSource[]> = {
  // Lane A — telemetry (joins the subject's segments by PIJ_SESSION_ID).
  'skill-called': ['telemetry'],
  'skill-sequence': ['telemetry'],
  'flow-seam-fired': ['telemetry'],
  'harness-verb-ran': ['telemetry'],
  'checks-ran': ['telemetry'],
  'tool-used': ['telemetry'],
  'compaction-occurred': ['telemetry'],
  // Lane B — fs (reads the subject's worktree).
  'file-created': ['fs'],
  'file-content-matches': ['fs'],
  'artifact-exists': ['fs'],
  'command-succeeds': ['fs'],
  // Composite — fs+telemetry (AND of both lanes).
  'retro-drained': ['fs+telemetry'],
  // Lane C — judged (inferential; surfaced as a field, filled by the orchestrator).
  judged: ['judged'],
};

const VALID_SOURCES: ReadonlySet<AssertionSource> = new Set<AssertionSource>([
  'telemetry',
  'fs',
  'fs+telemetry',
  'judged',
]);

/** POSIX path join — collapses duplicate separators, preserves a leading `/` (node-free). */
export function join(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/** The read-only fs surface the loader needs (a subset of `VerbContext.fs`). */
export interface ScenarioFs {
  exists(path: string): boolean;
  readText(path: string): string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validate the parsed `scenario.json`, accumulating every issue (no throw). */
function validateConfig(raw: unknown, issues: string[]): ScenarioConfig | null {
  if (!isObject(raw)) {
    issues.push('scenario.json is not a JSON object');
    return null;
  }
  for (const key of ['slug', 'title', 'task'] as const) {
    if (!isNonEmptyString(raw[key])) issues.push(`scenario.json: '${key}' must be a non-empty string`);
  }
  const base = raw.base;
  if (!isObject(base) || !isNonEmptyString(base.repo) || !isNonEmptyString(base.ref)) {
    issues.push("scenario.json: 'base' must be { repo, ref } (non-empty strings)");
  }
  const subject = raw.subject;
  if (!isObject(subject) || !isNonEmptyString(subject.harness) || !isNonEmptyString(subject.model)) {
    issues.push("scenario.json: 'subject' must be { harness, model } (non-empty strings)");
  }
  const flow = raw.flow;
  if (
    !isObject(flow) ||
    !isNonEmptyString(flow.mode) ||
    !Array.isArray(flow.stages) ||
    !flow.stages.every((s) => typeof s === 'string')
  ) {
    issues.push("scenario.json: 'flow' must be { mode, stages:[string] }");
  }
  const prompts = raw.prompts;
  if (
    !isObject(prompts) ||
    !isNonEmptyString(prompts.orchestrator) ||
    !isNonEmptyString(prompts.subject)
  ) {
    issues.push("scenario.json: 'prompts' must be { orchestrator, subject } (relative paths)");
  }
  if (!isNonEmptyString(raw.assertions)) {
    issues.push("scenario.json: 'assertions' must be a relative filename (e.g. 'assertions.json')");
  }
  if (issues.length > 0) return null;
  // Safe to assert: every branch above is clean.
  const s = raw as unknown as ScenarioConfig;
  return {
    slug: s.slug,
    title: s.title,
    task: s.task,
    base: { repo: s.base.repo, ref: s.base.ref },
    subject: {
      harness: s.subject.harness,
      model: s.subject.model,
      ...(isNonEmptyString((subject as Record<string, unknown>).effort) && {
        effort: s.subject.effort,
      }),
    },
    flow: { mode: s.flow.mode, stages: [...s.flow.stages] },
    prompts: { orchestrator: s.prompts.orchestrator, subject: s.prompts.subject },
    assertions: s.assertions,
  };
}

/** Validate one assertion entry; push descriptive issues. */
function validateAssertion(raw: unknown, index: number, seen: Set<string>, issues: string[]): Assertion | null {
  const at = `assertions[${index}]`;
  if (!isObject(raw)) {
    issues.push(`${at} is not a JSON object`);
    return null;
  }
  let ok = true;
  if (!isNonEmptyString(raw.id)) {
    issues.push(`${at}: 'id' must be a non-empty string`);
    ok = false;
  } else if (seen.has(raw.id)) {
    issues.push(`${at}: duplicate id '${raw.id}'`);
    ok = false;
  }
  const type = raw.type;
  const allowedLanes = isNonEmptyString(type) ? ASSERTION_TYPES[type] : undefined;
  if (!isNonEmptyString(type)) {
    issues.push(`${at}: 'type' must be a non-empty string`);
    ok = false;
  } else if (!allowedLanes) {
    issues.push(`${at}: unknown type '${type}' (not in the resolver registry)`);
    ok = false;
  }
  const source = raw.source;
  if (typeof source !== 'string' || !VALID_SOURCES.has(source as AssertionSource)) {
    issues.push(`${at}: 'source' must be one of telemetry|fs|fs+telemetry|judged`);
    ok = false;
  } else if (allowedLanes && !allowedLanes.includes(source as AssertionSource)) {
    issues.push(
      `${at}: source '${source}' is not valid for type '${String(type)}' (allowed: ${allowedLanes.join('|')})`,
    );
    ok = false;
  }
  if (raw.params !== undefined && !isObject(raw.params)) {
    issues.push(`${at}: 'params' must be an object when present`);
    ok = false;
  }
  if (raw.required !== undefined && typeof raw.required !== 'boolean') {
    issues.push(`${at}: 'required' must be a boolean when present`);
    ok = false;
  }
  if (raw.weight !== undefined && (typeof raw.weight !== 'number' || raw.weight < 0)) {
    issues.push(`${at}: 'weight' must be a non-negative number when present`);
    ok = false;
  }
  if (!ok) return null;
  if (isNonEmptyString(raw.id)) seen.add(raw.id);
  return {
    id: raw.id as string,
    type: type as string,
    source: source as AssertionSource,
    params: isObject(raw.params) ? raw.params : {},
    ...(typeof raw.required === 'boolean' && { required: raw.required }),
    ...(typeof raw.weight === 'number' && { weight: raw.weight }),
    ...(isNonEmptyString(raw.describe) && { describe: raw.describe }),
  };
}

/** Parse JSON, returning `{ value } | { error }` (never throws). */
function parseJson(label: string, text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: `${label}: invalid JSON — ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Load + validate the scenario bundle for `slug` under `scenariosRoot`
 * (default `<cwd>/live-testing/scenarios`). Reads `scenario.json` then the
 * `assertions` file it names. Returns a typed {@link LoadedScenario} or a
 * descriptive error — never throws (AC-04).
 */
export function loadScenario(slug: string, fs: ScenarioFs, scenariosRoot: string): LoadResult {
  if (!isNonEmptyString(slug)) {
    return { ok: false, error: 'scenario slug is required' };
  }
  const dir = join(scenariosRoot, slug);
  const scenarioPath = join(dir, 'scenario.json');
  const scenarioText = fs.readText(scenarioPath);
  if (scenarioText === null) {
    return { ok: false, error: `scenario not found: ${scenarioPath}` };
  }
  const parsed = parseJson('scenario.json', scenarioText);
  if ('error' in parsed) return { ok: false, error: parsed.error };

  const issues: string[] = [];
  const config = validateConfig(parsed.value, issues);
  if (!config) return { ok: false, error: `invalid scenario '${slug}': ${issues.join('; ')}` };

  const assertionsPath = join(dir, config.assertions);
  const assertionsText = fs.readText(assertionsPath);
  if (assertionsText === null) {
    return { ok: false, error: `assertions file not found: ${assertionsPath}` };
  }
  const parsedAssertions = parseJson(config.assertions, assertionsText);
  if ('error' in parsedAssertions) return { ok: false, error: parsedAssertions.error };

  const rawBundle = parsedAssertions.value;
  if (!isObject(rawBundle) || !Array.isArray(rawBundle.assertions)) {
    return {
      ok: false,
      error: `invalid ${config.assertions}: must be { scenario?, assertions:[...] }`,
    };
  }
  if (rawBundle.assertions.length === 0) {
    return { ok: false, error: `invalid ${config.assertions}: 'assertions' is empty` };
  }

  const seen = new Set<string>();
  const assertions: Assertion[] = [];
  for (let i = 0; i < rawBundle.assertions.length; i++) {
    const a = validateAssertion(rawBundle.assertions[i], i, seen, issues);
    if (a) assertions.push(a);
  }
  if (issues.length > 0) {
    return { ok: false, error: `invalid ${config.assertions}: ${issues.join('; ')}` };
  }

  return { ok: true, scenario: { config, assertions, dir } };
}
