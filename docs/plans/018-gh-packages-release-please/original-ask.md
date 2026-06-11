# Original ask — gh-packages-release-please
**Captured**: 2026-06-11T00:56:28Z  ·  **By**: /the-flow

> lets get it right now. get us in gh packages, using release please.

**Context (from the session that produced this):** reverses harness-core spec **AC-15** ("no npm publish"). The failing install path was `npm install -g github:…` → `ERR_MODULE_NOT_FOUND: commander` (git-URL installs don't deliver runtime deps and, upstream, must rebuild a gitignored `dist`). Decision: route consumers through a real registry — **GitHub Packages**, published by **release-please** on merge to `main`. Full diagnosis + options in [`research-dossier.md`](./research-dossier.md) (§5 option 2c).
