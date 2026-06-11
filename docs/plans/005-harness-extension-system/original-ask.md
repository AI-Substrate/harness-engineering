# Original ask — harness-extension-system
**Captured**: 2026-06-08T02:01:21Z  ·  **By**: /the-flow

> new task, adding extenions. see a private source survey (kept in scratch/). workign from the .harness folder (not the harnes folder we have, remember project to the devleoper machines where we will install this, they will not have harnes folder as they dont have codebase here, they just have npx installed version.). In the harness folder there will be extensions, just like Pi does, in fact you can see how pi does it in its `.pi/extensions` directory (referenced privately). Also pi's source is available privately for deeper inspection. the pattern is a littel differn, our exteniosn will need to be able to expose cli verbs etc... and --he;p with them etc. so yeah, similar but not quite the same. read docs/harness-basics/intro-to-harness.md and harness-foundations/simple-mode.md. we are making the core focal point here, the ability for folks to be able to extend their harnes super easyily!

*(Private local source paths in the original wording have been replaced with neutral references per the repo publication boundary; the raw verbatim is retained in `scratch/`.)*

## Captured context (for the research pass)
- **Install target is the developer's repo, not this repo.** Developers `npx`-install the core; they will NOT have our `harness/` source tree — they get the installed CLI plus a repo-local **`.harness/`** folder containing **extensions** (mirroring pi's `.pi/extensions/`).
- **Reference survey**: a private source survey (kept in `scratch/`) (pi's plugin/microkernel architecture: discovery → load/collect → bind → emit; jiti zero-build TS; façade + late binding; module substitution).
- **Pi extensions to study**: pi's `.pi/extensions/` directory (referenced privately) (e.g. a `todo` extension — `index.ts` default-export factory + `store.ts` + `AGENTS.md` + tests).
- **Pi source for deeper inspection**: pi's source (referenced privately) — its extension-loader module.
- **Key difference from pi**: pi extensions register agent tools/commands/events; **our extensions must expose CLI verbs** (`harness <verb>`) **with their own `--help`** text. Similar pattern, different contract surface.
- **Repo intent**: this is the *core focal point* — make it trivially easy for folks to extend their harness. Retires the temporary `BUILTIN_SLOTS` scaffolding (Constitution P10: verbs are dynamic + extension-owned).
- **Required reading**: `docs/harness-basics/intro-to-harness.md`, `harness-foundations/simple-mode.md`.
