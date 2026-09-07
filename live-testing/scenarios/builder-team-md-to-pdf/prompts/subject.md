# Document workbench

Build a reusable local engineering-harness extension that converts a Markdown file into a readable PDF. Mermaid fenced diagrams must render as diagrams, not source code. Support ordinary headings, lists and code blocks, and report input/rendering errors clearly.

Use the locally delivered **Builder** method. Make the architecture and implementation decisions yourself. Do not publish, push or modify global installations.

Expose the extension through the local harness CLI with discoverable help. Add `.harness/pdf-command.json` containing an `argv` array for its real invocation; use separate `{input}` and `{output}` arguments where file paths belong. This is the automation interface for callers, not a test wrapper. Leave the working implementation, its usage guidance and a sample PDF in the repository.

Report the selected canonical plan path, committed result SHA, invocation and output paths to the assigning peer. Keep all work within your assigned repository and explicitly allocated workspaces.
