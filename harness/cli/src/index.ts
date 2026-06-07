#!/usr/bin/env node
import { main } from './app.js';

// Thin bin entry — always runs. All composition logic lives in app.ts (testable,
// never auto-runs). Called unconditionally so the npm/npx bin symlink works
// regardless of how the symlink resolves (companion F005).
main();
