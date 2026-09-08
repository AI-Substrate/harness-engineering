import { createHash } from 'node:crypto';
import { ConventionSchemaResolver, type DdDoc, parse } from '@ai-substrate/dd';
import { validateDocument } from '@ai-substrate/dd/core/validate';
import { renderDd } from '@ai-substrate/dd/render/renderer';
import { type ErrorCode, ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixDirname,
  posixJoin,
  posixRelative,
  resolveInRepo,
} from '../shared/posix-path.js';
import type {
  BuilderContext,
  BuilderDeps,
  BuilderFailure,
  BuilderRecord,
  BuilderResult,
  Check,
  CheckReceipt,
  FileDigest,
  RecordKind,
  Stored,
} from './types.js';

const MAX_RECORD_BYTES = 4 * 1024 * 1024;
// Preservation inventories scale with whole workspaces, unlike ordinary control records.
const MAX_PRESERVATION_BYTES = 64 * 1024 * 1024;
const READABLE_PACKET_SCHEMAS = ['builder/work-packet', 'builder/packet'] as const;
const WRITABLE_SCHEMAS = new Set([
  'builder/plan',
  'builder/backpressure',
  'builder/impl-guide',
  'builder/allocation',
  'builder/packet',
  'builder/work-packet',
  'builder/team',
]);

export function builderFailure(
  code: ErrorCode,
  message: string,
  next_action: string,
  details?: unknown,
): BuilderFailure {
  return { ok: false, code, message, next_action, ...(details !== undefined && { details }) };
}

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function isCanonicalRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) &&
    !/(?:^|\/)\.\.?(?:\/|$)|\/\/|\\/.test(path) &&
    !path.includes('\0')
  );
}

/** POSIX-relative cache paths only. Explicit evidence may promote to required, never waive it. */
export function isBuilderPreservationExcluded(relativePath: string): boolean {
  return (
    isCanonicalRelativePath(relativePath) &&
    /(?:^|\/)(?:\.git|node_modules|\.venv|__pycache__|\.cache|\.vite)(?:\/|$)/.test(relativePath)
  );
}

function builderIntentProjection(doc: DdDoc, normalizePath: (path: string) => string): string {
  const normalize = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const address = /^([^\s#]*\.dd\.(?:json|md))(#[^\s]*)?$/.exec(value);
      return address && !/^[a-z]+:\/\//i.test(address[1])
        ? `${normalizePath(address[1])}${address[2] ?? ''}`
        : value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return value;
  };
  const workRow = (row: unknown): unknown => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
    if (!('id' in row) || typeof row.id !== 'string') return row;
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== 'state' && key !== 'proven_by'),
    );
  };
  const sections = doc.sections
    // This section reports execution outcomes; it is not product intent or authority.
    .filter(
      (section) => !(doc.dd.schema === 'builder/plan' && section.name === 'implementation_summary'),
    )
    .map((section) => {
      let value = section.value;
      if (
        section.name === 'meta' &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        value = Object.fromEntries(
          Object.entries(value).filter(
            ([key]) =>
              !(doc.dd.schema === 'builder/plan' && key === 'status') &&
              !(doc.dd.schema === 'builder/impl-guide' && key === 'updated'),
          ),
        );
      }
      if (doc.dd.schema === 'builder/plan') {
        if (
          ['acceptance_criteria', 'phases', 'tasks'].includes(section.name) &&
          Array.isArray(value)
        ) {
          value = value.map(workRow);
        }
        if (
          section.name === 'done_when' &&
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          value = Object.fromEntries(
            Object.entries(value).map(([key, rows]) => [
              key,
              Array.isArray(rows) ? rows.map(workRow) : rows,
            ]),
          );
        }
      }
      return { ...section, value };
    });
  const references = (doc.references ?? []).map((reference) => ({
    ...reference,
    path: normalizePath(reference.path),
  }));
  return JSON.stringify(normalize({ ...doc, sections, references }));
}

/**
 * Intent equality only, never readiness or approval. Callers validate DD/link semantics,
 * historical raw digests and same-plan identity separately. Unknown relative relocations
 * stay unequal: without source locations this function cannot prove them equivalent.
 */
export function sameBuilderDocumentIntent(left: DdDoc, right: DdDoc, planId: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(planId)) return false;
  if (
    left.dd.schema !== right.dd.schema ||
    !['builder/plan', 'builder/impl-guide'].includes(left.dd.schema)
  ) {
    return false;
  }
  const archived = `docs/plans/archive/${planId}/`;
  const active = `docs/plans/${planId}/`;
  const normalizePath = (path: string): string => {
    if (!path.startsWith(archived) || !isCanonicalRelativePath(path)) return path;
    return `${active}${path.slice(archived.length)}`;
  };
  return (
    builderIntentProjection(left, normalizePath) === builderIntentProjection(right, normalizePath)
  );
}
/** Only the canonical plan-to-archive move can relocate immutable evidence. */
export function relocatedRef(
  ref: FileDigest,
  baseline: { plan: FileDigest },
  context: BuilderContext,
): FileDigest {
  const oldDir = posixDirname(baseline.plan.path);
  const currentDir = posixRelative(context.repoRoot, context.planDir);
  if (currentDir === oldDir) return ref;
  const plan = /^docs\/plans\/(?:archive\/)?([^/]+)$/.exec(oldDir);
  if (!plan || ![`docs/plans/${plan[1]}`, `docs/plans/archive/${plan[1]}`].includes(currentDir))
    return ref;
  return ref.path.startsWith(`${oldDir}/`)
    ? { ...ref, path: `${currentDir}${ref.path.slice(oldDir.length)}` }
    : ref;
}

/** Resolve local DD addresses using their real source locations; shared records owns intent policy. */
export function resolveDocumentAddresses(
  doc: DdDoc,
  documentPath: string,
  repoRoot: string,
): DdDoc {
  const resolvePath = (path: string) =>
    /^[a-z]+:\/\//i.test(path)
      ? path
      : posixRelative(repoRoot, resolveInRepo(path, posixDirname(documentPath)));
  const resolveValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const address = /^([^\s#]*\.dd\.(?:json|md))(#[^\s]*)?$/.exec(value);
      return address ? `${resolvePath(address[1])}${address[2] ?? ''}` : value;
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, resolveValue(child)]),
      );
    return value;
  };
  return {
    ...doc,
    sections: doc.sections.map((section) => ({ ...section, value: resolveValue(section.value) })),
    references: (doc.references ?? []).map((reference) => ({
      ...reference,
      path: resolvePath(reference.path),
    })),
  };
}

export function recordSchema(kind: RecordKind): string {
  if (kind === 'allocation') return 'builder/allocation';
  if (kind === 'packet') return 'builder/work-packet';
  if (kind === 'ack') return 'builder/packet';
  return 'builder/team';
}

export function builderContext(deps: BuilderDeps, input: string): BuilderResult<BuilderContext> {
  const candidate = resolveInRepo(input, deps.repoRoot);
  const planPath = candidate.endsWith('.dd.md')
    ? `${candidate.slice(0, -6)}.dd.json`
    : candidate.endsWith('.dd.json')
      ? candidate
      : posixJoin(candidate, 'plan.dd.json');
  if (!isWithin(deps.repoRoot, planPath)) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'The plan is outside this repository.',
      'Run Builder from the plan workspace and pass its canonical plan path.',
    );
  }
  const planDir = posixDirname(planPath);
  return {
    ok: true,
    value: {
      repoRoot: deps.repoRoot,
      planDir,
      planPath,
      guidePath: posixJoin(planDir, 'assets/impl-guide.dd.json'),
      flowPath: posixJoin(planDir, 'the-flow.json'),
      teamDir: posixJoin(planDir, 'assets/team'),
    },
  };
}

export function builderRecordPath(context: BuilderContext, kind: RecordKind, key?: string): string {
  if (key !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key))
    throw new Error('Invalid Builder record key.');
  return posixJoin(context.teamDir, `${kind}${key === undefined ? '' : `-${key}`}.dd.json`);
}

function fileRef(deps: BuilderDeps, path: string, contents: string | Uint8Array): FileDigest {
  return {
    path: isWithin(deps.repoRoot, path) ? posixRelative(deps.repoRoot, path) : path,
    sha256: sha256(contents),
  };
}

export function digestBuilderFile(deps: BuilderDeps, input: string): BuilderResult<FileDigest> {
  const path = resolveInRepo(input, deps.repoRoot);
  const bytes = deps.fs.readBytesNoFollow(path);
  if (bytes === null)
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Cannot read a regular file: ${path}`,
      'Restore the required file without symlinks, then retry.',
    );
  return { ok: true, value: fileRef(deps, path, bytes) };
}

/** Verify immutable raw Git blobs without reading or materializing current working files. */
export async function verifyBuilderFilesAtCommit(
  deps: BuilderDeps,
  sourceSha: string,
  files: readonly FileDigest[],
): Promise<BuilderResult<true>> {
  const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  const refuse = (message: string, details?: unknown) =>
    builderFailure(
      ErrorCodes.BUILDER_PROOF,
      message,
      'Restore the original committed evidence and byte-capable Git access; never relabel the sealed receipt.',
      details,
    );
  if (!objectId.test(sourceSha)) return refuse('The baseline does not name a full Git commit ID.');
  const paths = new Set<string>();
  for (const file of files) {
    if (
      !isCanonicalRelativePath(file.path) ||
      file.path.endsWith('/') ||
      !isWithin(deps.repoRoot, resolveInRepo(file.path, deps.repoRoot)) ||
      paths.has(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      return refuse(`Invalid or duplicate sealed file binding: ${file.path}`);
    paths.add(file.path);
  }
  const options = {
    cwd: deps.repoRoot,
    timeoutMs: 30000,
    env: { GIT_NO_REPLACE_OBJECTS: '1' },
  };
  try {
    const commit = await deps.exec.run(
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${sourceSha}^{commit}`],
      options,
    );
    if (commit.code !== 0 || commit.stdout.trim() !== sourceSha)
      return refuse(`The sealed source commit is absent or rewritten: ${sourceSha}`, commit);
    if (files.length === 0) return { ok: true, value: true };
    const tree = await deps.exec.run(
      'git',
      ['--literal-pathspecs', 'ls-tree', '-l', '-z', '--full-tree', sourceSha, '--', ...paths],
      options,
    );
    if (tree.code !== 0)
      return refuse(`Cannot observe the sealed file tree at ${sourceSha}.`, tree);
    if (tree.stdout && !tree.stdout.endsWith('\0'))
      return refuse('The committed file tree is truncated or malformed.');
    const blobs = new Map<string, { oid: string; size: number }>();
    for (const entry of tree.stdout.split('\0').slice(0, -1)) {
      const match = /^(100644|100755) blob ([a-f0-9]+) +(0|[1-9][0-9]*)\t([\s\S]+)$/.exec(entry);
      if (
        !match ||
        !objectId.test(match[2]) ||
        !Number.isSafeInteger(Number(match[3])) ||
        !paths.has(match[4]) ||
        blobs.has(match[4])
      )
        return refuse(
          'A committed input is not a unique regular-file blob with a valid size.',
          entry,
        );
      blobs.set(match[4], { oid: match[2], size: Number(match[3]) });
    }
    for (const file of files) {
      const blob = blobs.get(file.path);
      if (!blob) return refuse(`Declared evidence is missing from the source commit: ${file.path}`);
      const captured = await deps.exec.run('git', ['cat-file', 'blob', blob.oid], {
        ...options,
        stdoutEncoding: 'base64',
      });
      if (captured.code !== 0)
        return refuse(`Cannot read the committed blob: ${file.path}`, captured);
      if (captured.stdoutEncoding !== 'base64')
        return refuse(`Exact Git byte capture is unsupported for sealed input: ${file.path}`);
      const bytes = Buffer.from(captured.stdout, 'base64');
      if (bytes.toString('base64') !== captured.stdout || bytes.length !== blob.size)
        return refuse(`Committed blob encoding or byte count is corrupt: ${file.path}`);
      if (sha256(bytes) !== file.sha256)
        return refuse(`Committed blob does not match the sealed digest: ${file.path}`);
    }
    return { ok: true, value: true };
  } catch (error) {
    return refuse(
      `Committed evidence observation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Capture textual Git evidence through bytes, rejecting lossy filenames or document decoding. */
export async function readBuilderGitText(
  deps: BuilderDeps,
  args: string[],
  cwd = deps.repoRoot,
): Promise<BuilderResult<string>> {
  try {
    const result = await deps.exec.run('git', args, {
      cwd,
      timeoutMs: 30000,
      stdoutEncoding: 'base64',
      env: { GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.code !== 0 || result.stdoutEncoding !== 'base64')
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Git text evidence could not be captured without byte loss.',
        'Restore byte-capable Git observation before binding committed evidence.',
        result,
      );
    const bytes = Buffer.from(result.stdout, 'base64');
    if (bytes.toString('base64') !== result.stdout)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Git text evidence has corrupt encoding.',
        'Recover a complete byte-preserving observation before retrying.',
      );
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Git paths or documents cannot be read as exact UTF-8 text.',
      'Use readable UTF-8 Git paths and canonical DD JSON; no integration evidence was accepted.',
      String(error),
    );
  }
}

function validateBuilderDocument(
  deps: BuilderDeps,
  path: string,
  doc: DdDoc,
): BuilderResult<ConventionSchemaResolver> {
  const resolver = new ConventionSchemaResolver({ fs: deps.fs, repoRoot: deps.repoRoot });
  const errors = validateDocument(doc, path, resolver, deps.repoRoot).filter(
    (issue) => issue.severity === 'ERROR',
  );
  if (errors.length > 0)
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Invalid DD document: ${path}`,
      'Correct the named schema violations with the local ddocs CLI.',
      errors,
    );
  return { ok: true, value: resolver };
}

export function readBuilderDocument(
  deps: BuilderDeps,
  input: string,
  schema: string | readonly string[],
  maxBytes = MAX_RECORD_BYTES,
): BuilderResult<Stored<DdDoc>> {
  const path = resolveInRepo(input, deps.repoRoot);
  const loaded = deps.fs.readTextFileNoFollow(posixDirname(path), path, maxBytes);
  if (loaded.status !== 'ok')
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Cannot read ${path}: ${loaded.reason}`,
      `Supply a readable regular DD JSON document of at most ${maxBytes} bytes.`,
      { max_bytes: maxBytes },
    );
  const doc = parse(loaded.text);
  if (
    Array.isArray(doc) ||
    (typeof schema === 'string' ? doc.dd.schema !== schema : !schema.includes(doc.dd.schema))
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `${path} must be a ${typeof schema === 'string' ? schema : schema.join(' or ')} document.`,
      'Use the corresponding packaged Builder schema and canonical DD JSON source.',
      Array.isArray(doc) ? doc : undefined,
    );
  }
  const valid = validateBuilderDocument(deps, path, doc);
  if (!valid.ok) return valid;
  return { ok: true, value: { ref: fileRef(deps, path, loaded.text), value: doc } };
}

export function readBuilderRecord<T extends BuilderRecord>(
  deps: BuilderDeps,
  path: string,
  kind: T['record_type'],
): BuilderResult<Stored<T>> {
  const loaded = readBuilderDocument(
    deps,
    path,
    kind === 'packet' ? READABLE_PACKET_SCHEMAS : recordSchema(kind),
    kind === 'preservation' ? MAX_PRESERVATION_BYTES : MAX_RECORD_BYTES,
  );
  if (!loaded.ok) return loaded;
  const sections = loaded.value.value.sections;
  const value = sections[0]?.value;
  if (
    sections.length !== 1 ||
    sections[0]?.name !== kind ||
    value === null ||
    typeof value !== 'object' ||
    !('record_type' in value) ||
    value.record_type !== kind
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Expected exactly one ${kind} record in ${path}.`,
      'Supply the record produced by the corresponding Builder operation.',
    );
  }
  return { ok: true, value: { ref: loaded.value.ref, value: value as T } };
}

export interface RecordWriteOptions {
  /** null/omitted means create-only; a digest is an explicit compare-and-swap. */
  expectedSha256?: string | null;
  /** Explicit external allocation authority, never inferred from the target path. */
  root?: string;
}

/** Validates before claiming; all cooperating writers share the same exclusive lock. */
export function writeBuilderDocument(
  deps: BuilderDeps,
  input: string,
  doc: DdDoc,
  options: RecordWriteOptions = {},
): BuilderResult<Stored<DdDoc>> {
  const root = options.root ?? deps.repoRoot;
  const path = resolveInRepo(input, root);
  if (!path.endsWith('.dd.json') || !WRITABLE_SCHEMAS.has(doc.dd.schema)) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Builder may only write its guide and factual record schemas.',
      'Use the owning plan/flow CLI for canonical lifecycle state.',
    );
  }
  const identity = deps.fs.normalizeBundleTargetIdentity(path);
  const rootIdentity = deps.fs.realpath(root);
  if (rootIdentity === null || !isWithin(rootIdentity, identity)) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      `Record target escapes its explicit root: ${path}`,
      'Select a target inside the verified allocation authority or plan workspace.',
    );
  }
  const valid = validateBuilderDocument(deps, path, doc);
  if (!valid.ok) return valid;
  const resolved = valid.value.resolve(doc.dd.schema, path);
  if (!resolved.ok)
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      resolved.message,
      'Stage the required Builder schema before writing.',
    );
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const maxBytes =
    doc.dd.schema === 'builder/team' &&
    doc.sections.length === 1 &&
    doc.sections[0]?.name === 'preservation'
      ? MAX_PRESERVATION_BYTES
      : MAX_RECORD_BYTES;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes)
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Builder document exceeds its ${maxBytes}-byte limit: ${path}`,
      'Keep the complete evidence and resolve the record-size limit before retrying; no existing record was replaced.',
      { bytes, max_bytes: maxBytes },
    );
  const face = renderDd(doc, { path, repoRoot: deps.repoRoot, schema: resolved.schema });
  const token = deps.nonce();
  if (!/^[A-Za-z0-9_-]+$/.test(token))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid write nonce.',
      'Supply a unique filename-safe nonce.',
    );
  const lock = `${path}.lock`;
  const temp = `${path}.${token}.tmp`;
  const facePath = `${path.slice(0, -5)}.md`;
  const faceTemp = `${facePath}.${token}.tmp`;
  let claimed = false;
  let sourceWritten = false;
  let tempCreated = false;
  let faceCreated = false;
  try {
    deps.fs.mkdirp(posixDirname(path));
    claimed = deps.fs.createExclusive(lock, token);
    if (!claimed)
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `Record is already claimed: ${path}`,
        'Wait for the owning writer, or inspect an interrupted write before recovering its lock.',
      );
    const current = deps.fs.exists(path)
      ? deps.fs.readTextFileNoFollow(root, path, maxBytes)
      : null;
    if (current !== null && current.status !== 'ok')
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `Existing record cannot be safely read: ${path}`,
        'Restore the original regular file; do not overwrite an unreadable record.',
      );
    const oldText = current?.status === 'ok' ? current.text : null;
    const expected = options.expectedSha256 ?? null;
    const matches =
      expected === null
        ? oldText === null || oldText === text
        : oldText !== null && sha256(oldText) === expected;
    if (!matches)
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `Record changed since it was read: ${path}`,
        'Re-read the current record and retry with its exact digest.',
      );
    tempCreated = deps.fs.createExclusive(temp, text);
    if (tempCreated) faceCreated = deps.fs.createExclusive(faceTemp, face);
    if (!tempCreated || !faceCreated) {
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'A record temporary file already exists or could not be created.',
        'Retry with a fresh nonce after inspecting the conflicting temporary file.',
      );
    }
    if (oldText !== text) {
      deps.fs.rename(temp, path);
      sourceWritten = true;
    }
    deps.fs.rename(faceTemp, facePath);
    return { ok: true, value: { ref: fileRef(deps, path, text), value: doc } };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Record write failed: ${error instanceof Error ? error.message : String(error)}`,
      sourceWritten
        ? `The source was saved. Run local ddocs build on ${path}, then re-read its digest before retrying.`
        : 'Repair the filesystem failure and retry without discarding the existing record.',
      { source_written: sourceWritten, path },
    );
  } finally {
    if (claimed) {
      // Only remove this writer's temporary files and its still-owned lock.
      for (const file of [...(tempCreated ? [temp] : []), ...(faceCreated ? [faceTemp] : [])]) {
        try {
          if (deps.fs.exists(file)) deps.fs.deleteFile(file);
        } catch {
          /* The next attempt reports the retained conflict. */
        }
      }
      try {
        if (deps.fs.readText(lock) === token) deps.fs.deleteFile(lock);
      } catch {
        /* A retained lock remains a visible refusal, never stolen. */
      }
    }
  }
}

export function writeBuilderRecord<T extends BuilderRecord>(
  deps: BuilderDeps,
  path: string,
  value: T,
  options?: RecordWriteOptions,
): BuilderResult<Stored<T>> {
  const result = writeBuilderDocument(
    deps,
    path,
    {
      dd: { schema: recordSchema(value.record_type) },
      sections: [{ name: value.record_type, value }],
      references: [],
    },
    options,
  );
  return result.ok ? { ok: true, value: { ref: result.value.ref, value } } : result;
}

export async function runBuilderCheck(
  deps: BuilderDeps,
  check: Check,
  root: string = deps.repoRoot,
): Promise<BuilderResult<CheckReceipt>> {
  const cwd = resolveInRepo(check.cwd, root);
  if (
    !check.command.trim() ||
    !Array.isArray(check.args) ||
    check.args.some((arg) => typeof arg !== 'string') ||
    !isWithin(root, cwd) ||
    !Number.isSafeInteger(check.timeout_ms) ||
    check.timeout_ms <= 0
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      `Invalid executable check ${check.id}.`,
      'Declare a command, argv array, confined relative cwd and positive bounded timeout.',
    );
  }
  try {
    const result = await deps.exec.run(check.command, check.args, {
      cwd,
      timeoutMs: check.timeout_ms,
    });
    return {
      ok: true,
      value: {
        id: check.id,
        command: check.command,
        args: check.args,
        cwd,
        exit_code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        recorded_at: deps.clock.nowIso(),
      },
    };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Could not execute ${check.id}: ${error instanceof Error ? error.message : String(error)}`,
      'Restore the declared executable and rerun the named check.',
    );
  }
}
