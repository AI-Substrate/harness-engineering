# Harness extension test fixture

A deliberately tiny repo. The `install-and-validate-test-extension` minih agent
copies this folder into a fresh temp directory, installs the harness core into
it, then drives the `add-extension` skill to author and validate a new
`harness <verb>` extension end-to-end.

- `package.json` exposes a real `demo` script (`npm run demo` → `demo ok`) so a
  `--wrap "npm run demo"` extension has a genuine command to wrap.
- This repo intentionally has **no** `.harness/` folder at the start — the agent
  proves a clean repo can be extended from zero.
