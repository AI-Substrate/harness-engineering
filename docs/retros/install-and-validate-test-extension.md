
## 2026-06-08T10:26:01.830Z — install-and-validate-test-extension / 2026-06-08T20-22-14-091Z-4ed2

- runId: 2026-06-08T20-22-14-091Z-4ed2
- runDir: ~/substrate/harness-engineering/agents/install-and-validate-test-extension/runs/2026-06-08T20-22-14-091Z-4ed2
- summary: PASS: In a throwaway repo, I installed the local harness package, used the add-extension skill flow to scaffold the wrap-style greet verb with harness new, and independently verified that doctor listed it as loaded, help listed the verb, greet --help rendered usage, and invoking greet returned an ok envelope with exit code 0.
- **magicWand** (target: minih): minih should export MINIH_PROJECT_ROOT and MINIH_OUTPUT_PATH into SDK shell sessions, and minih check should mention the literal fallback path it expects when either variable is absent.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was empty in the shell, so the required initial cd "$MINIH_PROJECT_ROOT" went to the home directory and minih skills doctor initially reported skills disabled. (workaround: Used the literal project root from the run environment context and reran minih skills doctor there.)
  - [degrading] debug: npx harness doctor --json in the throwaway consumer repo exited 0 but reported status degraded because the cli-build layer looked for harness/cli/dist/index.js in the temp repo. (workaround: Treated doctorRan as successful because the command executed, then validated the extensions layer and the greet verb independently.)
  - [annoying] knowledge: harness new --wrap produced a working wrapper, but the generated summary stayed as TODO and the next_action said to edit run() even though run() already wrapped npm run demo. (workaround: Inspected the generated extension and invoked harness greet --json to confirm the wrapper was already functional.)

## 2026-06-08T22:57:59.495Z — install-and-validate-test-extension / 2026-06-09T08-54-42-126Z-7d46

- runId: 2026-06-09T08-54-42-126Z-7d46
- runDir: ~/substrate/harness-engineering/agents/install-and-validate-test-extension/runs/2026-06-09T08-54-42-126Z-7d46
- summary: PASS: in a throwaway repository, the add-extension skill was available, scaffolded the wrap variant for harness boot via harness new, and produced .harness/extensions/boot.ts wrapping npm run demo. Independent checks confirmed doctor listed the extension as loaded, help listed boot, boot --help rendered usage, and npx harness boot --json returned status ok with exit code 0; the temp repo was removed afterward.
- **magicWand** (target: project): The local install path should package or build harness/cli/dist/index.js reliably, and harness doctor --json should distinguish installed-package health from cwd source-tree build health so a throwaway repo can get an unambiguous local-install result.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was empty in the shell, so the required initial cd $MINIH_PROJECT_ROOT could not reach the project root and minih skills doctor initially reported skills disabled. (workaround: Used ~/substrate/harness-engineering as the project root.)
  - [degrading] build: npm install of the local project root completed, but the installed package did not include harness/cli/dist/index.js, and npx harness doctor --json reported the cli-build layer as not built. (workaround: Copied the source to WORKDIR/_harness-core, ran npm install and npm run build there, then installed that built temp copy.)
  - [annoying] test: After the extension loaded and ran successfully, doctor --json still had top-level status degraded because the cwd cli-build layer was false in the throwaway repo. (workaround: Recorded the degraded top-level doctor status while validating that the extension layer was ok and boot was loaded.)
