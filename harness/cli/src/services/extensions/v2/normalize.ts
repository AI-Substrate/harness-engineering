import type { HarnessRecordType } from '../../record/contract.js';
import { posixDirname, toPosix } from '../../shared/posix-path.js';
import type {
  ExtensionDefinition,
  HarnessVerb,
  SensorDecl,
  SensorRunContext,
  SubverbDecl,
  VerbDecl,
} from '../contract.js';
import type {
  NormalizedCustomItem,
  NormalizedExtension,
  NormalizedSubverb,
  NormalizedVerb,
} from './types.js';

function extensionFolderName(entryPath: string): string {
  const directory = toPosix(posixDirname(entryPath)).replace(/\/+$/, '');
  return directory.slice(directory.lastIndexOf('/') + 1);
}

function kernelBareHandler(name: string): HarnessVerb['run'] {
  return (ctx) =>
    ctx.unconfigured(`Pick a subverb for '${name}'. Run \`harness ${name} --help\` for choices.`);
}

function normalizeSubverb(name: string, declaration: SubverbDecl): NormalizedSubverb {
  return {
    name,
    summary: declaration.summary,
    ...(declaration.description !== undefined && { description: declaration.description }),
    ...(declaration.options !== undefined && { options: declaration.options }),
    ...(declaration.args !== undefined && { args: declaration.args }),
    // V2 author typing widens args for variadics. Runtime construction is handled
    // by verb-v2; the internal normalized function remains structurally callable.
    run: declaration.run as unknown as HarnessVerb['run'],
  };
}

function normalizeVerb(name: string, declaration: VerbDecl): NormalizedVerb {
  return {
    name,
    summary: declaration.summary,
    ...(declaration.description !== undefined && { description: declaration.description }),
    ...(declaration.options !== undefined && { options: declaration.options }),
    ...(declaration.args !== undefined && { args: declaration.args }),
    run:
      declaration.run !== undefined
        ? (declaration.run as unknown as HarnessVerb['run'])
        : kernelBareHandler(name),
    hasOwnRun: declaration.run !== undefined,
    subverbs: Object.entries(declaration.sub ?? {}).map(([subName, sub]) =>
      normalizeSubverb(subName, sub),
    ),
  };
}

/** Phase 1 accepted a reserved command/args shape before S1 settled run(). */
function legacySensorRun(raw: Record<string, unknown>): SensorDecl['run'] {
  const command = String(raw.command);
  const args = Array.isArray(raw.args)
    ? raw.args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  return async (ctx: SensorRunContext) => {
    const result = await ctx.exec(command, args);
    return result.code === 0
      ? { state: 'pass' }
      : { state: 'fail', details: `${command} exited with code ${result.code}` };
  };
}

/** Rebuild from known fields so runtime extras cannot overwrite kernel identity. */
function normalizeSensorDeclaration(declaration: SensorDecl): SensorDecl {
  const raw = declaration as unknown as Record<string, unknown>;
  return {
    summary: declaration.summary,
    run: typeof declaration.run === 'function' ? declaration.run : legacySensorRun(raw),
    ...(Array.isArray(declaration.watch) && { watch: [...declaration.watch] }),
    trigger: declaration.trigger ?? 'watch',
    timeoutMs: declaration.timeoutMs ?? 30_000,
    ...(declaration.guidance !== undefined && { guidance: declaration.guidance }),
  };
}

/** Adapt a v1 file into the current shape without changing any v1 declaration. */
export function normalizeV1Extension(
  entryPath: string,
  verbs: readonly HarnessVerb[],
  recordTypes: readonly HarnessRecordType[],
): NormalizedExtension {
  return {
    name: extensionFolderName(entryPath),
    source: 'v1',
    api: 1,
    entryPath,
    verbs: [...verbs],
    sensors: [],
    recordTypes: [...recordTypes],
    customItems: [],
    info: [],
  };
}

/** Adapt an api-2 definition into the versionless current shape. */
export function normalizeV2Extension(
  entryPath: string,
  definition: ExtensionDefinition,
  validatorInfo: readonly string[] = [],
): NormalizedExtension {
  const info = [...validatorInfo];
  const folderName = extensionFolderName(entryPath);
  if (definition.name !== folderName) {
    info.push(
      `definition name '${definition.name}' differs from extension folder '${folderName}' (tolerated)`,
    );
  }

  const recordTypes: HarnessRecordType[] = Object.entries(definition.records ?? {}).map(
    ([type, declaration]) => ({
      kind: 'record',
      type,
      description: declaration.description,
      template: declaration.template,
    }),
  );
  const customItems: NormalizedCustomItem[] = Object.entries(definition.custom ?? {}).flatMap(
    ([type, items]) =>
      Object.entries(items).map(([name, declaration]) => ({ type, name, declaration })),
  );

  return {
    name: definition.name,
    source: 'v2',
    api: definition.api ?? 2,
    entryPath,
    verbs: Object.entries(definition.verbs ?? {}).map(([name, declaration]) =>
      normalizeVerb(name, declaration),
    ),
    sensors: Object.entries(definition.sensors ?? {}).map(([name, declaration]) => ({
      name,
      declaration: normalizeSensorDeclaration(declaration),
    })),
    recordTypes,
    customItems,
    info,
  };
}
