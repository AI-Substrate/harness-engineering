## 1. Pure Statistics Contract

- [ ] 1.1 Add `harness/cli/test/services/flow/flow-stats.test.ts` with failing cases for mixed/repeated values, custom overlay values, zero nodes, exact totals, and lexical key ordering.
- [ ] 1.2 Add the pure `harness/cli/src/services/flow/flow-stats.ts` service that computes `node_count`, `by_status`, and `by_type` in one pass and returns deterministically ordered maps; make the service tests pass.

## 2. CLI Command and Output

- [ ] 2.1 Add act-level tests in `harness/cli/test/acts/flow-stats.test.ts` for `--path` and `--slug`, exact human rendering, the JSON envelope shape, empty-flow output, representative existing read errors, and proof that the source JSON/sibling render are unchanged.
- [ ] 2.2 Register the read-only `stats` subcommand in `harness/cli/src/acts/flow.ts`, reusing `resolveFlowPath`, `readFlowDoc`, the standard failure envelope, and the pure statistics result for both raw human output and JSON data; make the act tests pass.

## 3. Documentation and Verification

- [ ] 3.1 Document `harness flow stats` usage, human output, JSON fields, and `--path`/`--slug` examples in `docs/how/harness-flow.md`, then regenerate the tracked docs bundle with the existing docs generation command.
- [ ] 3.2 Run the targeted flow service/act tests, confirm formatting and typechecking, and finish with the repository composite `just checks` gate.
