import type { ExtensionDefinition } from '../contract.js';

export interface V2ValidationResult {
  issues: string[];
  /** Sensor-specific subset so the registry can surface E216 instead of generic E140. */
  sensorIssues: string[];
  info: string[];
}

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function noteUnknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  info: string[],
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      info.push(`${path}.${field}: unknown field tolerated (doctor info)`);
    }
  }
}

const OPTION_FIELDS = new Set(['flags', 'description', 'defaultValue']);
const ARG_FIELDS = new Set(['name', 'description']);
const VERB_FIELDS = new Set(['summary', 'description', 'options', 'args', 'run', 'sub']);
const SUBVERB_FIELDS = new Set(['summary', 'description', 'options', 'args', 'run']);
const RECORD_FIELDS = new Set(['description', 'template']);
const SENSOR_FIELDS = new Set(['summary', 'run', 'watch', 'trigger', 'timeoutMs', 'guidance']);
const LEGACY_SENSOR_FIELDS = new Set([...SENSOR_FIELDS, 'command', 'args']);
const SENSOR_NAME = /^[a-z][a-z0-9-]*$/;

function legacyCommandSensor(value: UnknownRecord): boolean {
  return (
    typeof value.command === 'string' &&
    value.command.trim().length > 0 &&
    (value.args === undefined ||
      (Array.isArray(value.args) && value.args.every((arg) => typeof arg === 'string')))
  );
}

function sensorIssue(message: string, issues: string[], sensorIssues: string[]): void {
  issues.push(message);
  sensorIssues.push(message);
}

function sensorDeclIssues(
  name: string,
  value: unknown,
  issues: string[],
  sensorIssues: string[],
  info: string[],
): void {
  const path = `sensors.${name}`;
  if (!SENSOR_NAME.test(name)) {
    sensorIssue(`${path} name must match ^[a-z][a-z0-9-]*$`, issues, sensorIssues);
  }
  if (!isObject(value)) {
    sensorIssue(`${path} is not an object`, issues, sensorIssues);
    return;
  }
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) {
    sensorIssue(`${path} has missing or empty summary`, issues, sensorIssues);
  }
  const legacy = value.run === undefined && legacyCommandSensor(value);
  if (typeof value.run !== 'function' && !legacy) {
    sensorIssue(`${path} has missing run() handler`, issues, sensorIssues);
  }
  if (legacy) {
    info.push(`${path}: Phase 1 command/args sensor normalized through the compatibility wrapper`);
  }
  if (
    value.watch !== undefined &&
    (!Array.isArray(value.watch) ||
      value.watch.some((glob) => typeof glob !== 'string' || glob.trim().length === 0))
  ) {
    sensorIssue(`${path}.watch must be a non-empty string array`, issues, sensorIssues);
  }
  if (value.trigger !== undefined && value.trigger !== 'watch' && value.trigger !== 'manual') {
    sensorIssue(`${path}.trigger must be 'watch' or 'manual'`, issues, sensorIssues);
  }
  if (
    value.timeoutMs !== undefined &&
    (!Number.isInteger(value.timeoutMs) || (value.timeoutMs as number) <= 0)
  ) {
    sensorIssue(`${path}.timeoutMs must be a positive integer`, issues, sensorIssues);
  }
  if (
    value.guidance !== undefined &&
    (typeof value.guidance !== 'string' || value.guidance.trim().length === 0)
  ) {
    sensorIssue(`${path}.guidance must be a non-empty string`, issues, sensorIssues);
  }
  if (
    (value.trigger ?? 'watch') === 'watch' &&
    (!Array.isArray(value.watch) || value.watch.length === 0)
  ) {
    info.push(
      `${path}: no watch globs; never watch-fired and runs only via \`harness sensors run\` / \`check\``,
    );
  }
  noteUnknownFields(value, legacy ? LEGACY_SENSOR_FIELDS : SENSOR_FIELDS, path, info);
}

function parameterIssues(
  value: unknown,
  kind: 'options' | 'args',
  path: string,
  issues: string[],
  info: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) {
      issues.push(`${itemPath} is not an object`);
      return;
    }
    if (kind === 'options') {
      if (!nonEmpty(item.flags)) issues.push(`${itemPath} has missing or empty flags`);
      if (!nonEmpty(item.description)) {
        issues.push(`${itemPath} has missing or empty description`);
      }
      noteUnknownFields(item, OPTION_FIELDS, itemPath, info);
      return;
    }
    if (!nonEmpty(item.name)) issues.push(`${itemPath} has missing or empty name`);
    if (!nonEmpty(item.description)) issues.push(`${itemPath} has missing or empty description`);
    // Variadics are deliberately legal on the v2 path.
    noteUnknownFields(item, ARG_FIELDS, itemPath, info);
  });
}

function subverbIssues(value: unknown, path: string, issues: string[], info: string[]): void {
  if (!isObject(value)) {
    issues.push(`${path} is not an object`);
    return;
  }
  if (!nonEmpty(value.summary)) issues.push(`${path} has missing or empty summary`);
  if (typeof value.run !== 'function') issues.push(`${path} has missing run() handler`);
  if ('sub' in value) issues.push(`${path}.sub exceeds the one level subverb limit`);
  parameterIssues(value.options, 'options', `${path}.options`, issues, info);
  parameterIssues(value.args, 'args', `${path}.args`, issues, info);
  noteUnknownFields(value, SUBVERB_FIELDS, path, info);
}

function verbIssues(value: unknown, path: string, issues: string[], info: string[]): void {
  if (!isObject(value)) {
    issues.push(`${path} is not an object`);
    return;
  }
  if (!nonEmpty(value.summary)) issues.push(`${path} has missing or empty summary`);
  if (value.run !== undefined && typeof value.run !== 'function') {
    issues.push(`${path}.run must be a function`);
  }
  if (value.sub !== undefined && !isObject(value.sub)) {
    issues.push(`${path}.sub must be an object`);
  }
  const subEntries = isObject(value.sub) ? Object.entries(value.sub) : [];
  if (typeof value.run !== 'function' && subEntries.length === 0) {
    issues.push(`${path} needs run() or at least one subverb`);
  }
  for (const [name, sub] of subEntries) {
    if (!nonEmpty(name)) issues.push(`${path}.sub has an empty name`);
    subverbIssues(sub, `${path}.sub.${name}`, issues, info);
  }
  parameterIssues(value.options, 'options', `${path}.options`, issues, info);
  parameterIssues(value.args, 'args', `${path}.args`, issues, info);
  noteUnknownFields(value, VERB_FIELDS, path, info);
}

/** V2 shape validation with strict structures and tolerant unknown nested fields. */
export function validateV2Extension(value: unknown): V2ValidationResult {
  const issues: string[] = [];
  const sensorIssues: string[] = [];
  const info: string[] = [];
  if (!isObject(value)) return { issues: ['not an object'], sensorIssues, info };

  const definition = value as UnknownRecord & Partial<ExtensionDefinition>;
  if (definition.kind !== 'extension') issues.push("missing kind:'extension'");
  if (!nonEmpty(definition.name)) issues.push('missing or empty name');
  if (!nonEmpty(definition.summary)) issues.push('missing or empty summary');
  if (
    definition.api !== undefined &&
    (!Number.isInteger(definition.api) || (definition.api as number) < 2)
  ) {
    issues.push('api must be an integer >= 2');
  }

  if (definition.verbs !== undefined && !isObject(definition.verbs)) {
    issues.push('verbs must be an object');
  } else if (isObject(definition.verbs)) {
    for (const [name, verb] of Object.entries(definition.verbs)) {
      if (!nonEmpty(name)) issues.push('verbs has an empty name');
      verbIssues(verb, `verbs.${name}`, issues, info);
    }
  }

  if (definition.records !== undefined && !isObject(definition.records)) {
    issues.push('records must be an object');
  } else if (isObject(definition.records)) {
    for (const [name, record] of Object.entries(definition.records)) {
      if (!nonEmpty(name)) issues.push('records has an empty type key');
      const path = `records.${name}`;
      if (!isObject(record)) {
        issues.push(`${path} is not an object`);
        continue;
      }
      if (!nonEmpty(record.description)) issues.push(`${path} has missing or empty description`);
      if (!nonEmpty(record.template)) issues.push(`${path} has missing or empty template`);
      noteUnknownFields(record, RECORD_FIELDS, path, info);
    }
  }

  if (definition.sensors !== undefined) {
    if (!isObject(definition.sensors)) {
      sensorIssue('sensors must be an object', issues, sensorIssues);
    } else {
      for (const [name, sensor] of Object.entries(definition.sensors)) {
        sensorDeclIssues(name, sensor, issues, sensorIssues, info);
      }
    }
  }

  if (definition.custom !== undefined) {
    if (!isObject(definition.custom)) {
      issues.push('custom must be an object');
    } else {
      for (const [type, items] of Object.entries(definition.custom)) {
        if (!isObject(items)) {
          issues.push(`custom.${type} must be an object`);
          continue;
        }
        for (const [name, item] of Object.entries(items)) {
          if (!isObject(item) || !nonEmpty(item.summary)) {
            issues.push(`custom.${type}.${name} has missing or empty summary`);
          }
        }
      }
    }
  }

  return { issues, sensorIssues, info };
}
