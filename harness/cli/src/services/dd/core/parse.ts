import { REFERENCES_LEDGER_FIELD } from './constants.js';
import type {
  DdDoc,
  DdFailure,
  DdHeader,
  DdReference,
  DdReferenceMode,
  DdSection,
} from './model.js';
import { isRecord } from './value.js';

function failure(location: string, message: string): DdFailure {
  return { class: 'document-invalid', location, message };
}

function parseInput(input: string | unknown): unknown | DdFailure[] {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return [{ class: 'json-invalid', location: '$', message: 'document is not valid JSON' }];
  }
}

function isFailure(value: unknown): value is DdFailure {
  return (
    isRecord(value) &&
    (value.class === 'json-invalid' || value.class === 'document-invalid') &&
    typeof value.location === 'string' &&
    typeof value.message === 'string'
  );
}

function parseHeader(raw: unknown, failures: DdFailure[]): DdHeader | undefined {
  if (!isRecord(raw)) {
    failures.push(failure('$.dd', 'dd must be an object'));
    return undefined;
  }
  if (typeof raw.schema !== 'string' || raw.schema.trim().length === 0) {
    failures.push(failure('$.dd.schema', 'schema must be a non-empty string'));
  }
  if ('spec' in raw && typeof raw.spec !== 'string') {
    failures.push(failure('$.dd.spec', 'spec must be a string'));
  }
  if ('sweep_exclude' in raw && typeof raw.sweep_exclude !== 'boolean') {
    failures.push(failure('$.dd.sweep_exclude', 'sweep_exclude must be a boolean'));
  }
  if (typeof raw.schema !== 'string' || raw.schema.trim().length === 0) return undefined;
  return {
    schema: raw.schema,
    ...(typeof raw.spec === 'string' && { spec: raw.spec }),
    ...(typeof raw.sweep_exclude === 'boolean' && { sweep_exclude: raw.sweep_exclude }),
  };
}

function parseSections(raw: unknown, failures: DdFailure[]): DdSection[] {
  if (!Array.isArray(raw)) {
    failures.push(failure('$.sections', 'sections must be an array'));
    return [];
  }
  const sections: DdSection[] = [];
  const names = new Set<string>();
  raw.forEach((entry, index) => {
    const location = `$.sections[${index}]`;
    if (!isRecord(entry)) {
      failures.push(failure(location, 'section must be an object'));
      return;
    }
    const name = entry.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      failures.push(failure(`${location}.name`, 'section name must be a non-empty string'));
    } else if (names.has(name)) {
      failures.push(failure(`${location}.name`, `duplicate section name "${name}"`));
    } else {
      names.add(name);
    }
    if (!('value' in entry)) {
      failures.push(failure(`${location}.value`, 'section value is required'));
    }
    // A document-level `title` is display-only and optional. A non-string is a
    // failure rather than a silent drop: an author who typed one meant it, and
    // quietly falling back to the derived heading would hide the mistake.
    const title = entry.title;
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      failures.push(failure(`${location}.title`, 'section title must be a non-empty string'));
    }
    if (typeof name === 'string' && name.trim().length > 0 && 'value' in entry) {
      sections.push({
        name,
        ...(typeof title === 'string' && title.trim().length > 0 && { title }),
        value: entry.value,
      });
    }
  });
  return sections;
}

function parseReferences(raw: unknown, failures: DdFailure[]): DdReference[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    failures.push(failure(`$.${REFERENCES_LEDGER_FIELD}`, 'references must be an array'));
    return [];
  }
  const references: DdReference[] = [];
  raw.forEach((entry, index) => {
    const location = `$.${REFERENCES_LEDGER_FIELD}[${index}]`;
    if (!isRecord(entry)) {
      failures.push(failure(location, 'reference must be an object'));
      return;
    }
    if (typeof entry.path !== 'string' || entry.path.trim().length === 0) {
      failures.push(failure(`${location}.path`, 'reference path must be a non-empty string'));
    }
    if (typeof entry.sha !== 'string' || entry.sha.trim().length === 0) {
      failures.push(failure(`${location}.sha`, 'reference sha must be a non-empty string'));
    }
    if (entry.mode !== 'live' && entry.mode !== 'pinned') {
      failures.push(failure(`${location}.mode`, 'reference mode must be "live" or "pinned"'));
    }
    if (
      typeof entry.path === 'string' &&
      entry.path.trim().length > 0 &&
      typeof entry.sha === 'string' &&
      entry.sha.trim().length > 0 &&
      (entry.mode === 'live' || entry.mode === 'pinned')
    ) {
      references.push({
        path: entry.path,
        sha: entry.sha,
        mode: entry.mode as DdReferenceMode,
      });
    }
  });
  return references;
}

/** Parse a JSON string or unknown value into the dd envelope; never performs schema validation. */
export function parse(input: string | unknown): DdDoc | DdFailure[] {
  const parsed = parseInput(input);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isFailure)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return [failure('$', 'document must be an object')];
  }

  const failures: DdFailure[] = [];
  const dd = parseHeader(parsed.dd, failures);
  const sections = parseSections(parsed.sections, failures);
  const references = parseReferences(parsed[REFERENCES_LEDGER_FIELD], failures);
  if (failures.length > 0 || dd === undefined) return failures;
  return { dd, sections, references };
}
