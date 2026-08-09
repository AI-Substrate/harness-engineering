# Pull published telemetry from remote repositories

Use `harness telemetry ls` to inventory counts-only sessions published under
`refs/harness-telemetry/**`, then use `harness telemetry pull` to materialize a
selection as a deterministic, integrity-verifiable folder. Both commands read
explicit remote repositories only. They do not infer the current checkout,
`origin`, local telemetry refs, a runtime store, or a cache.

> **The corpus is frozen.** Harness stopped capturing its own telemetry at v1 — see
> [git-ai as the collector](../gitai-collector.md). Everything described here still works
> exactly as documented against the sessions published before that point; what changes is
> that `ls` returns a fixed set which will not grow.

Prerequisites:

- the repository has published telemetry refs;
- HTTPS credential helpers or an SSH agent can authenticate non-interactively;
- product-commit selection requires the named product commits to be reachable by
  the remote's metadata-only Git protocol.

Git children receive an explicit safe environment rather than the caller's full
environment. Harness preserves required platform paths, standard proxy variables,
and SSH-agent sockets; strips repository/worktree/index/object/config/namespace/
replacement/shallow/askpass/SSH-command redirects; disables system and arbitrary
global Git configuration; disables terminal prompts; and never accepts a password
or token in an argument. HTTPS operations admit only the credential-helper settings
described below.

## Repository inputs

Repeat `--repo`, repeat `--repo-file`, or combine them:

```bash
harness telemetry ls \
  --repo https://example.com/acme/alpha.git \
  --repo ssh://git@example.com/acme/beta.git

harness telemetry ls --repo-file ./telemetry-repositories.txt
```

A repository file is UTF-8 with one URL per line. Surrounding whitespace, blank
lines, and full-line comments are ignored. Inline comments are not interpreted.
CRLF and LF are both accepted.

```text
# Retrospective cohort
https://example.com/acme/alpha.git
ssh://git@example.com/acme/beta.git
```

Accepted network forms are `https://`, `ssh://`, `git://`, and scp-like SSH such
as `git@example.com:acme/alpha.git`. Public HTTPS requires no username. When a URL
or scp form names one, Harness accepts only a bounded 1–64 character non-secret
identifier using letters, digits, `.`, `_`, or `-`; examples include `git` and
deploy-style usernames. Credential-shaped usernames, every percent-encoded
username, password-bearing URLs, query strings, and fragments are rejected before
Git, identity hashing, inventory rows, bundles, reports, or output. Local paths,
relative paths, `file://`, and Git remote-helper commands are rejected at the same
boundary. Harness never accepts a password or token in a repository argument;
HTTPS credential helpers are the supported private-authentication path. Equivalent
inputs are canonicalized and deduplicated; HTTPS, SSH, and `git://` remain distinct
identities because they may authenticate differently.

### HTTPS credential helpers

For each HTTPS operation, Harness asks Git for only the bounded closed set of
unscoped and scoped global `credential.helper`, `credential.username`, and
`credential.useHttpPath` records reached through global includes. It copies every
accepted record—not only an already-matching one—in its original query/include
order into a private, sanitized Git config. Harness admits a scope only when it is
either a strict host-bearing URL without a password, query, or fragment, or a
bounded Unicode-safe opaque provider/scp-style identity. Unsafe host URLs and
malformed `scheme://` authority text reject rather than falling through. Harness
does not interpret or match either form: Git alone applies scope matching,
helper-chain order, and empty-helper reset semantics. No other global setting is
copied: URL rewrites, HTTP headers, core and hooks settings, SSH commands, include
directives, password/token/provider terminal fields, and unrelated credential keys
remain disabled.

A configured helper is user-trusted authentication code. This includes a bounded
`!command` helper. The helper or keychain communicates directly with Git; Harness
does not receive, read, cache, serialize, log, or publish the username/password or
token returned by the helper. A configured non-secret username may exist in the
private sanitized config, but no credential secret is stored by Harness or placed
in Git argv or public output.

The sanitized config belongs to one advertisement, snapshot, or product-metadata
operation and is never cached across calls or retries. On platforms with POSIX mode
support, its directory is mode `0700` and its exclusively created file is mode
`0600`. Both are removed after success, failure, timeout, malformed config, helper
failure, or partial setup. Cleanup failure is a typed transport failure and never
echoes the private path. HTTPS also sets `credential.interactive=false`,
`GCM_INTERACTIVE=never`, and `GIT_TERMINAL_PROMPT=0`, so missing or failing helpers
fail closed instead of prompting.

SSH, scp-like SSH, and `git://` skip credential-config discovery and
materialization. They retain the isolated null global config; SSH-agent forwarding
and behavior are unchanged.

## List published sessions

With no selector, `ls` inventories every usable advertised session:

```bash
harness telemetry ls --repo https://example.com/acme/alpha.git
harness --json telemetry ls --repo-file ./telemetry-repositories.txt
```

Preview the same whole-session selectors accepted by `pull`:

```bash
# Exact terminal session id
harness telemetry ls --repo https://example.com/acme/alpha.git \
  --session session-demo-001

# Inclusive ref start-date interval
harness telemetry ls --repo https://example.com/acme/alpha.git \
  --from-date 2026-07-01 --to-date 2026-07-16

# Inclusive product-commit interval
harness telemetry ls --repo https://example.com/acme/alpha.git \
  --from-commit 1111111111111111111111111111111111111111 \
  --to-commit 9999999999999999999999999999999999999999
```

A row is one `(repository key, terminal session id)` group. It reports safe
repository identity, refs, known date, shape, logical bytes, product-provenance
state, data fidelity, and typed gaps. A ref date is known only after strict real-
calendar parsing; an impossible date is JSON `null`/text `—` plus
`date_provenance_unavailable`. It never prints blob content, Git stderr,
credentials, or disposable paths.

## Pull complete sessions

`pull` requires exactly one selector and one exact output folder:

```bash
# Exact session
harness telemetry pull \
  --repo https://example.com/acme/alpha.git \
  --session session-demo-001 \
  --out ./telemetry-pull/session-demo-001

# Inclusive date interval across two repositories
harness telemetry pull \
  --repo https://example.com/acme/alpha.git \
  --repo https://example.com/acme/beta.git \
  --from-date 2026-07-01 --to-date 2026-07-16 \
  --out ./telemetry-pull/july-cohort

# Inclusive product-commit interval
harness telemetry pull \
  --repo https://example.com/acme/alpha.git \
  --from-commit 1111111111111111111111111111111111111111 \
  --to-commit 9999999999999999999999999999999999999999 \
  --out ./telemetry-pull/product-range
```

Date and product endpoints are inclusive. Product membership requires both
`ancestor(from, candidate)` and `ancestor(candidate, to)`, so merged paths and
both endpoints count. Start and end may be the same commit.

**A selector chooses session groups, not records.** If any ref date or recorded
product commit intersects, Harness retrieves every distinct ref, its complete
validated telemetry history, and every safe blob in that repository-scoped
session. It never trims events, metrics, sequence numbers, or bytes to the range.
Graph availability is tracked separately from telemetry-declared provenance: when
a selected session has one known in-range commit and another graph-unavailable
candidate, the whole session is retained in a deterministic degraded bundle. Its
per-ref product evidence becomes partial and each affected ref carries
`commit_provenance_unavailable`. A residual contradiction becomes a typed safe
failure rather than an uncaught exception.

## Output folder

The exact `--out` folder contains a manifest and repository-local content-addressed
blobs:

```text
telemetry-pull/product-range/
├── bundle.json
└── repositories/
    └── repo-0123456789abcdef/
        └── blobs/
            ├── 36b4…e97a.blob
            └── f191…624d.blob
```

Untrusted Git paths never become host paths. `bundle.json` maps each logical Git
path to a SHA-256 blob path. Equal content deduplicates within one repository;
repository boundaries remain explicit.

### `bundle.json` tour

The top-level key order is fixed:

1. **`schema_version`** — `harness.telemetry-pull-bundle/v1`.
2. **`selection`** — fixed public mode `session|date|product-commit`,
   `session_id`, date/commit endpoint fields, `complete|partial` completeness,
   matched repository/session/ref counts, and sorted selection gaps.
   Non-applicable endpoints are explicitly `null`; commit endpoints are same-width
   lowercase full 40- or 64-hex OIDs. The internal name `commit` is not a v1 alias.
3. **`provenance`** — canonical repositories and repository-scoped sessions.
4. **`integrity`** — `sha256` plus every managed raw blob's `repository_key`,
   path, digest, and size.

Selection gaps are closed objects with exactly `repository_key`, nullable
`session_id`, nullable `ref`, and `reason`. An unresolved date or product gap
always carries its strict advertisement ref. The reader resolves each gap back to
the named repository/session/ref and its date/product/duplicate/manifest evidence,
rejects ghost or contradictory gaps, and requires unique deterministic ordering
plus `complete|partial` consistency. Session data gaps are closed
`{field, reason, refs}` objects: `reason` is one of `field_not_recorded`,
`signal_unavailable`, or `identity_only`, and `refs` is the sorted set of ref
names supporting the absence claim. They are not free-form strings.

Each repository records `key`, credential-free `url`, `advertised_ref_count`,
`selected_ref_count`, and `sessions[]`. Each session records:

- `session_id` and `full|partial|identity-only` fidelity;
- independent event and measurement coverage states plus typed data gaps;
- every ref's name and advertised OID;
- per-ref known/unavailable date, one published shape, and
  `known|partial|unavailable` product-commit evidence;
- child-before-parent `commits[]`;
- each commit's `tree[]`, whose entries carry `logical_path`, `git_blob_oid`,
  `content_sha256`, byte count, and `bundle_path`.

The reader closes every nested key set and cross-checks declared counts, canonical
URL/key identity, duplicate identities, date/session/OID rules, tree-to-integrity
ownership, and the exact managed path set. Producer and reader are guarded by an
independent fixed golden rather than validating only each other's assumptions.

Selection completeness, product-provenance coverage, and data fidelity are three
separate questions. `selection.completeness: "complete"` does not imply every old
session recorded product commits, and known product commits do not imply full
session data.

## Zero, empty, and unavailable

A measured zero is evidence; unavailable is not zero.

```jsonc
// bundle.json coverage state: a Metrics record exists (it may prove zero datapoints).
"measurements": "complete"

// No safe measurement substrate exists; the accompanying gap names the absence.
"measurements": "unavailable"
```

Counts and contributor denominators are reconstructed into report
`evidence_totals`; they are not invented in the bundle manifest. The same
distinction applies to events. A valid empty Logs collection is `events:"full"`
and can later prove measured zero. Missing data stays `unavailable` plus a gap—never
a fabricated `0`, `""`, `[]`, epoch timestamp, empty model, or synthetic session
export.

- **`full`**: the selected group reconstructs a valid `SessionExport`.
- **`partial`**: no full export is possible, but valid source bytes affirm at
  least one event/measurement collection, including an affirmative measured zero.
- **`identity-only`**: repository/ref/session identity is valid, but event and
  measurement values are unavailable.

Corrupt or privacy-unsafe claimed data fails; it never downgrades to
`identity-only`.

## Raw blobs, Logs, Metrics, and product commits

Raw `.blob` files are the validated published bytes exactly as Git served them.
Harness does not decode/re-encode, trim, normalize BOM/CRLF/final newlines, or
regenerate Metrics during pull. Every digest and size is checked before publish
and again when reporting.

Both OTLP signals remain present:

- Logs are the lossless per-segment reconstruction substrate;
- Metrics remain published, retrieved, and report-compatible derived evidence.

Current Segment 2.7 records use OTLP schema v0.4.0/scope 2.7 and may carry
`harness.product.commit` in each Logs resource. The rollup-v1 manifest's optional
`product_commits` is a verified aggregate/index, not the sole proof. Current
`captured_env` is finite: exactly eight pij identity/orchestration keys with
per-key identifier, enum, model, and effort grammars; unknown keys and
`PIJ_SPAWN_TASK` never enter raw evidence. Segment 2.4 reads use the same eight
plus only the historical `PIJ_ID`, `PIJ_STATUS_KEY`, and `PIJ_PANE_ID` grammars.

The shared resource/schema/scope metadata also appears on current Metrics records.
One producer-owned closed definition table covers activity, ratio, token, flow-
stage, tool-call, skill-status, and command-exit families; the strict reader uses
that same table for units, kinds, point types, temporality, attributes, enums, and
dependent tuples. One shared full-set validator also requires unique canonical
attribute tuples. When token usage is present it contains exactly four identities:
plain input, plain output, input+cache-read, and input+cache-create. Missing,
duplicate, or extra buckets fail. Other documented dynamic tuples occur at most
once. Plain input/output token points omit `harness.token.type`; cache-read/create
points require `gen_ai.token.type=input` plus the matching cache discriminator.
Output/cache combinations are rejected as producer-impossible.
A separate producer-owned Logs table covers every event kind, required versus
optional attributes, exact AnyValue kinds, enums, ranges, and severity. The same
record validator requires envelope `timeUnixNano` to equal nanoseconds derived
from `harness.event.t`; current records reject `observedTimeUnixNano`. Required
attribute deletion fails before raw admission; optional omission remains valid.
Existing Segment 2.4/OTLP v0.1 blobs stay byte-identical and readable.

## Duplicate identities and multiple repositories

Two refs in one repository with the same terminal session id form one logical
session. Every distinct ref/history is preserved. Each ref is decoded first. A
canonical JSONL line's one-based ordinal is its explicit sequence identity; a
loose filename contributes its numeric sequence. A complete canonical pair
shadows only its matching loose fallback, semantically identical claims for the
same sequence dedupe, and non-identical claims for the same explicit sequence fail
E222 rather than being renumbered or both counted. Equal payloads at distinct
sequence positions remain distinct. Genuinely identity-less legacy evidence
survives in deterministic ref/internal order. The bundle records
`duplicate_session_identity`.

The same terminal id in two repositories remains two inputs. Their repository keys,
ref histories, blob paths, and report provenance stay separate; report scope may
therefore list the same opaque session id twice.

## Report a pulled bundle

The existing report command accepts either the exact folder or `bundle.json`:

```bash
harness telemetry report ./telemetry-pull/product-range \
  --out ./telemetry-report

harness telemetry report ./telemetry-pull/product-range/bundle.json \
  --out ./telemetry-report/report.json
```

Before reporting, Harness verifies the schema, exact managed path set, every blob
hash/size, and path confinement. It does not refetch or repair.

- Full inputs use the established `SessionExport` calculations exactly.
- Partial inputs contribute only measured/observed evidence with contributor
  denominators.
- Identity-only inputs add repository/session scope but no numeric, event, model,
  time, or finding claim.

Bundle reports add `provenance.input_coverage` and discriminated
`evidence_totals`. Every internal input has an explicit `legacy|bundle` origin.
`--filter-repo` applies only to bundle origins before every scope, repository,
coverage, gap, contributor, and numeric calculation. Bundle reading carries each
repository key and canonical identity even when it has zero selected sessions, so
a matching unresolved-only gap is retained by either requested key or identity;
nonmatching gaps are excluded. It is echo-only for legacy `SessionExport` inputs
because that v1 shape carries no repository identity; a mixed report retains every
legacy export and only matching bundle repositories.
A weaker input that cannot evaluate a
requested harness/model/branch/date facet is excluded and declared rather than
guessed.

Existing numeric totals remain event-substrate subtotals. Bundle HTML and insights
show accepted/considered sessions, N-of-M contributors, unavailable/excluded
evidence, and selection/data gaps in the existing report stack. In coverage mode,
the returned page replaces the legacy totals/empty-dimension runtime; it does not
prepend or CSS-hide it. Every column remains visible in a mixed page: bundle
columns show coverage and contributor-backed analytics, while legacy columns show
their event-substrate totals and non-empty rollups. A measured zero is shown only
with a non-zero contributor denominator; unavailable evidence is never rendered
as zero. A complete empty bundle uses normal empty-cohort semantics; an unresolved
partial empty bundle is coverage-only and never claims zero or "no activity."
Legacy-only pages without `provenance.input_coverage` retain their byte-identical
rendering path.

## Status, gaps, and zero matches

- **`ok`**: every requested repository succeeded and no selection/data gap affects
  the result.
- **`degraded`** (exit 0): the result is valid but selection is partial, a session
  is partial/identity-only, or a typed gap needs interpretation.
- **`error`** (exit 1): required transport, integrity, privacy, endpoint, output,
  or exact-session requirements failed.

`ls` keeps successful repositories when another repository fails and reports the
safe failure as degraded. `pull` is all-or-none for required repository failures;
it writes no folder in that case. An exact session absent after all repositories
advertise is E221.

A date/product range with no known match still produces a valid deterministic
empty bundle. If no unresolved groups exist it is complete; unresolved date or
commit provenance makes it a degraded partial empty bundle with explicit gaps.

## Effects and privacy boundaries

The JSON envelope reports only safe effects: repositories consulted, refs
advertised/fetched, logical telemetry bytes, whether product graph metadata was
fetched, `callerRepositoryMutated:false`, disposable cleanup, and bundle
written/reused state.

The adapter uses argv, never a shell; disables prompts/hooks; creates each child
environment from the safe baseline above; and fetches telemetry into disposable
bare storage. After initialization every repository operation carries an explicit
`--git-dir=<command-owned-store>` while repository-independent advertisement does
not. Hostile inherited Git redirects therefore cannot change caller refs, objects,
index, branch, or worktree. Exact/date selectors group the advertisement first and fetch
only whole matching session groups; unknown-only date groups remain unfetched gaps.
Commit selection fetches every telemetry group because its evidence is inside the
validated records. Every snapshot compares the complete advertised namespace; any
addition, removal, or OID move discards the attempt, and the service recomputes the
whole transaction once before E223. Product-commit selection fetches bounded commit
metadata with `tree:0`; one total 120-second product operation deadline is shared by
endpoint, candidate, and ancestry calls rather than reset per OID. A timeout or
server filter rejection has no unfiltered fallback. Product source trees/blobs are
never report input or bundle content.

Before raw telemetry is copied, Harness rejects unsafe layouts, symlinks,
submodules, source-shaped parents, malformed UTF-8/JSON/JSONL, duplicate keys,
wrong/null/missing known Segment fields, wrong OTLP AnyValue kinds, unknown
resource/event/metric semantic attributes, or **any unknown additive string**—
including prefixless hex/alphanumeric/base64-like tokens and innocuous-looking
atoms. Unknown strings have no entropy, length, charset, or provider-prefix escape;
only named producer-owned fields with positive grammars may carry strings. Bounded
unknown null/boolean/finite-number/container shapes remain accepted only when no
nested unknown string appears. Current pij ids, spawn correlations/models, harness/role/effort,
service version, command, session, model, signature, path, schema/scope, OID, and
time roles each use positive field grammars. Shared defense-in-depth also rejects
GitHub, AWS, Stripe, Google, JWT, Bearer, private-key, password, secret, credential,
and common access-token shapes in every string channel. Required OTLP resource
identities are exact strings/enums/OIDs, not merely present keys. All validation
finishes before raw bytes are retained. Errors never echo raw bytes,
stderr, secrets, target identities, lock names, or temp paths.

## Troubleshooting E220–E227

| Code | Meaning | Safe response |
|---|---|---|
| E220 | Remote transport/auth/protocol/timeout or metadata-only graph unavailable | Check ambient auth and server protocol/filter support; retry without changing output. |
| E221 | Exact session conclusively absent | Run `telemetry ls`; copy the exact terminal id. |
| E222 | Selected telemetry is malformed, unsafe, or contradictory | Republish/fix the named remote telemetry; no bytes were written. |
| E223 | Telemetry namespace moved twice during one snapshot | Wait for publication to settle, then rerun. |
| E224 | Product endpoint is unknown/unreachable/not a commit | Use full reachable product commit OIDs for every repository. |
| E225 | Product start is not an ancestor of end | Choose an ancestor-valid interval. |
| E226 | Exact output exists but differs or has extra/missing/non-regular entries | Choose an absent folder, or reuse the untouched identical folder. There is no force flag. |
| E227 | Temp/write/hash/lock/publish/cleanup failed | Check parent permissions and concurrent writers; retry safely. |

Repository-key collisions are rejected before network access rather than silently
merging identities. Change the repository set or investigate the canonical
identities; Harness never lengthens one key opportunistically.

## Deterministic automation

Use JSON mode, explicit repositories, and a new output path per intended snapshot:

```bash
harness --json telemetry pull \
  --repo-file ./telemetry-repositories.txt \
  --from-date 2026-07-01 --to-date 2026-07-16 \
  --out ./artifacts/telemetry-2026-07-01--2026-07-16
```

The same verified remote OIDs plus selector produce identical folder bytes. The
filesystem port resolves `--out` to one native canonical target identity, so
relative/absolute/dot/trailing-separator aliases converge while distinct targets
do not. The publisher hashes only that canonical target identity into one parent-
local lock; different bundle bytes targeting the same folder therefore contend on
the same lock. An absent target publishes atomically through a sibling temp. An
existing byte-identical target returns `reused:true`; any difference is E226.
There is no overwrite, force, cache, generated-at clock, hidden local fallback, or
raw target disclosure in public output.
