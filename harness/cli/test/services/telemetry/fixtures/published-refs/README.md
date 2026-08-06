# Published-ref fixture corpus (`fixtures/published-refs/`)

**Verbatim bytes** of this public repo's own `refs/harness-telemetry/*` refs — the exact
payload `harness telemetry pull` fetches over the wire. Copied, never rebuilt.

These are deliberately **not** under `fixtures/real/`. That directory holds *agent-surface
adapter captures* (`<surface>/<instance>/raw.* + expected-segment.json + …`) and is policed
by `check:telemetry-fixtures`, which requires per-instance OTLP goldens. A published ref is
a different artifact: it is reader **input**, not adapter output, so it lives beside that
corpus rather than inside it.

## Why this corpus exists (FX007)

The strict published-telemetry reader's key grammar and its `KNOWN_KEYS` vocabulary were
written by hand, then confirmed against examples written under the same assumptions. The
result shipped rejecting **100% of this repo's own published telemetry** with E222, and no
test noticed — because no pull test had ever read a real published byte.

The root cause was the missing control, not the regex. This corpus is that control.

## Layout

```
fixtures/published-refs/<session-uuid>/
  manifest.json           # verbatim
  session.logs.jsonl      # verbatim
  session.metrics.jsonl   # verbatim
  <n>.json                # verbatim numbered shards
  meta.json               # provenance: source ref, ref date, file list
```

`meta.json` is the only added file. Everything else is byte-identical to the ref.

## Privacy

These bytes are **already public** — they are published in this repo's own refs, which
anyone can fetch. Copying them into the test tree discloses nothing new. Telemetry is
counts-only by construction: no prompts, no file contents, no credentials.

## Adding an instance

Capture additively — a new session directory alongside the existing ones:

```bash
git ls-tree -r --name-only <ref>            # enumerate
git show <ref>:<path>                        # copy each file verbatim
```

Then write `meta.json` with `ref`, `session`, `ref_date`, and the sorted `files` list.
`published-telemetry-real-corpus.test.ts` discovers every directory automatically, so a new
instance is covered the moment it is committed.

Prefer sessions that exercise shapes the reader has failed on before: `checks` gate maps
with colon-namespaced and multi-word names, `<synthetic>` models, and multi-word exit keys.
