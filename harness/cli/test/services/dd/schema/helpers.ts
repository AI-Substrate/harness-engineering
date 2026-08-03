import type { DdDoc } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import type { SchemaWorld } from './world.js';
import { FIXTURE_ROOT } from './world.js';

/** Parse a fixture document out of a loaded world, failing loudly if it cannot parse. */
export function fixtureDocFrom(world: SchemaWorld, relative: string): DdDoc {
  const text = world.fs.readText(`${FIXTURE_ROOT}/${relative}`);
  if (text === null) throw new Error(`fixture document not found in world: ${relative}`);
  const result = parse(text);
  if (Array.isArray(result)) {
    throw new Error(`fixture failed to parse: ${relative}: ${JSON.stringify(result)}`);
  }
  return result;
}
