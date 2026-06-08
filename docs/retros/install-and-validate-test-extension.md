
## 2026-06-08T10:26:01.830Z — install-and-validate-test-extension / 2026-06-08T20-22-14-091Z-4ed2

- runId: 2026-06-08T20-22-14-091Z-4ed2
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/install-and-validate-test-extension/runs/2026-06-08T20-22-14-091Z-4ed2
- summary: PASS: In a throwaway repo, I installed the local harness package, used the add-extension skill flow to scaffold the wrap-style greet verb with harness new, and independently verified that doctor listed it as loaded, help listed the verb, greet --help rendered usage, and invoking greet returned an ok envelope with exit code 0.
- **magicWand** (target: minih): minih should export MINIH_PROJECT_ROOT and MINIH_OUTPUT_PATH into SDK shell sessions, and minih check should mention the literal fallback path it expects when either variable is absent.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was empty in the shell, so the required initial cd "$MINIH_PROJECT_ROOT" went to the home directory and minih skills doctor initially reported skills disabled. (workaround: Used the literal project root from the run environment context and reran minih skills doctor there.)
  - [degrading] debug: npx harness doctor --json in the throwaway consumer repo exited 0 but reported status degraded because the cli-build layer looked for harness/cli/dist/index.js in the temp repo. (workaround: Treated doctorRan as successful because the command executed, then validated the extensions layer and the greet verb independently.)
  - [annoying] knowledge: harness new --wrap produced a working wrapper, but the generated summary stayed as TODO and the next_action said to edit run() even though run() already wrapped npm run demo. (workaround: Inspected the generated extension and invoked harness greet --json to confirm the wrapper was already functional.)
