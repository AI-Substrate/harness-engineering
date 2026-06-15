/**
 * Update-domain constants. Plain strings, no I/O — safe to import from services,
 * acts, and the composition root alike (the Node adapters receive these by
 * injection, never importing the service layer themselves).
 */

/** The registry package the harness CLI is published as (plan 018). */
export const PACKAGE_NAME = '@ai-substrate/engineering-harness';

/** The exact command the update banner / next_action tells users to run. */
export const UPDATE_COMMAND = 'harness update';
