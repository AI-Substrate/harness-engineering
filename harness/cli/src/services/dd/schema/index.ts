/**
 * The `dd` schema layer's PUBLIC SDK surface.
 *
 * This barrel (with `services/dd/links/index.ts`) is the whole of what consumers
 * outside `services/dd/` may import — the flow spine's gate first. A module path
 * under `dd/core/`, `dd/schema/*.js` or `dd/links/*.js` is an internal, and reaching
 * past this file for one is an architecture violation the `flow-consumes-dd-sdk-only`
 * dependency-cruiser rule refuses. If a consumer needs something not exported here,
 * the fix is to EXPOSE a named seam deliberately — never to reach through.
 */
export type { DdDerivedState } from '../core/derive.js';
export type { DdSection } from '../core/model.js';
export type { DeclarationResult, SchemaDeclaration } from './declarations.js';
export { BUILTIN_COMPLETION_ENUM, parseSchemaDeclaration } from './declarations.js';
export * from './model.js';
export type { SchemaResolverOptions } from './resolve.js';
export { ConventionSchemaResolver, deriveSchemaItems, deriveSchemaState } from './resolve.js';
export { isQualifiedName, type RootScan, scanRoot } from './scan.js';
