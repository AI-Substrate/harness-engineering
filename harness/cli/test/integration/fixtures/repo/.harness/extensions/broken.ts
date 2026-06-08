// Intentionally broken extension: throws at module-evaluation time so the loader
// records it as `failed` (E140) WITHOUT breaking the other extensions (isolation).
throw new Error('boom: this extension is intentionally broken');
