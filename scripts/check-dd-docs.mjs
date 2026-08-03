#!/usr/bin/env node
/**
 * Drift gate for the baked `harness dd docs` corpus (plan 065, D15, AC-08).
 *
 * Regenerate-and-diff, mirroring `check:docs`: if the committed
 * `docs-content.ts` no longer matches the manifest + source markdown, this exits
 * 1 and prints the diff. It calls the generator in-process rather than
 * re-spawning node — one implementation, no second copy of the rules to drift.
 */
import { generateDdDocs } from './gen-dd-docs.mjs';

generateDdDocs({ check: true });
