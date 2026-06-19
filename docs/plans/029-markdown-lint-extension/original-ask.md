# Original ask — markdown-lint-extension
**Captured**: 2026-06-19T00:15:35Z  ·  **By**: /the-flow

> i want to dogfood this repo and add an extension. first get comfortabel and
> look at how to ad exteniosn. note other agents are working here too. do not
> change branches etc

> we are going to add a markdown linter. first we can install a regualr markdown
> linter. but i also want to check that mermaid's render and that links are valid
> (in repo links).

> we should use third party where possible, just wrap it up in an extension we
> can expose to make it very easy, then we add that exteiosn as part of our just
> fft flow.

**Decisions captured during kickoff** (not part of the verbatim ask):
- Mermaid check: LIGHT — `mermaid.parse()` headless syntax validation, no Chromium
  (chosen because the extension runs inside `just fft`, which runs constantly).
- Constraint: shared working tree with other agents; do not change branches or
  touch other agents' in-progress files.
