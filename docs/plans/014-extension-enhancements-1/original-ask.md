# Original ask — extension-enhancements-1
**Captured**: 2026-06-09T23:56:09Z  ·  **By**: /the-flow

> need a new plan for botht eh general agent instructiosn and the instructions per extension stuff. THey should be in md and loaded dynamically at runtime for extensions from filesystem. Core agent_instructions coudl be baked. Also in this, i want to move extensiosn to extensions/<extension_name>/extension.ts... then we can pop any other files in this same folder and break our extensions up a bit. call the new plan extension_enhancements_1 (there will be more extension_ehnacements plans later :)).

## Session context (design already converged in conversation, 2026-06-10)

- **Concept**: verbs gain `agent_instructions` — a standing role-briefing for the *calling* agent ("you bring the inference, the verb brings the determinism"). Distinct from minih's `prompt.md`/`instructions.md` (those brief workers *inside* agent runs); deliberately named differently to avoid confusion.
- **Core surface sketch**: `harness instructions` (bare = the CLI's own baked briefing) and `harness instructions <verb>` (per-extension briefing), envelope-wrapped, `--json` first-class.
- **Storage decision (this ask)**: per-extension instructions live as **`.md` files on disk, loaded dynamically at runtime** (not strings baked in TS); the **core** CLI-level instructions **may be baked** into the binary.
- **Folder-layout move (this ask)**: extensions move from flat `.harness/extensions/<name>.ts` to `.harness/extensions/<name>/extension.ts`, so sibling files (e.g. `agent-instructions.md`, helper modules) can live alongside and big extensions can be split up.
- **Discoverability chain sketched**: `harness help` gains an "AGENTS START HERE → harness instructions" banner + per-verb `has_instructions` in JSON; doctor row; breadcrumbs in `engineering-harness.md` / `AGENTS.md` planted by setup skills; `harness-1-boot` step 0 reads instructions.
- Naming note: plan family is `extension-enhancements-N`; this is **1** of an intended series.
