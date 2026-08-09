# Command reference

Run dd commands from the repository root because of
[known cwd defect FU-4](08-validation-and-doctor.md#known-cwd-defect).

Add `--json` for a machine-readable envelope. On a human terminal, commands
with dedicated human renderers print readable text or markdown.

For what these verbs are collectively FOR, see
[The builder proof graph](11-the-builder-proof-graph.md).

## Validate and render

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd validate <path>` | validate a document and three outbound hops |
| `node_modules/.bin/dd validate <path> --depth 0` | validate only the named document |
| `node_modules/.bin/dd validate <path> --depth <n>` | validate the named outbound radius |
| `node_modules/.bin/dd build <path>` | write the canonical `.dd.md` sibling |
| `node_modules/.bin/dd build <path> --check` | compare the canonical render without writing |
| `node_modules/.bin/dd doctor` | sweep the repository at unlimited radius |
| `node_modules/.bin/dd doctor --path <dir>` | scope the sweep's starting set |

`validate` returns `ok`, `degraded` for warnings only, or `error` when any
ERROR-class finding exists. `doctor` follows the same severity posture.

`build` can return `degraded` while still writing output when an adapter fails.
The affected values use an explicit raw fallback.

## Inspect schemas

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd schema list` | list winning repository, harness, and home schemas |
| `node_modules/.bin/dd schema show <package>/<schema>` | show one resolved package in detail |

`schema list` cannot include a document-folder root because it accepts no
document path. Validate a document to prove its local package resolves.

## Generate and validate addresses

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd address generate <interior>` | generate a bare same-document address |
| `node_modules/.bin/dd address generate <interior> --path <file>` | generate a qualified address |
| `node_modules/.bin/dd address validate <address>` | check syntax and normalization |
| `node_modules/.bin/dd address validate <address> --resolve` | resolve and classify every segment |

Example:

```bash
node_modules/.bin/dd address generate \
  "phases/ph-0002/tasks" \
  --path docs/how/dd/exemplar/plan.dd.json
```

Bare addresses cannot resolve at the command line without a containing
document. Use `<path>#<interior>` with `--resolve`.

## Resolve links and bases

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd link resolve <address>` | return the addressed value and target metadata |
| `node_modules/.bin/dd link verify-basis <address> --sha <sha>` | compare a recorded SHA with the target |
| `node_modules/.bin/dd link verify-basis <address> --sha <sha> --update <doc>` | move an existing ledger entry and regenerate its sibling |

`verify-basis` returns `fresh` or `stale`. Stale is a degraded result rather
than a failing result.

`--update` mutates the document named by the option. It never creates a missing
ledger entry.

## Inspect the corpus graph

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd links <target>` | report inbound and outbound edges for one document |
| `node_modules/.bin/dd graph` | return the repository graph as Mermaid and structured data |
| `node_modules/.bin/dd graph --path <dir>` | seed the graph from a subtree |
| `node_modules/.bin/dd graph map <address>` | walk one row's neighbourhood in both directions |
| `node_modules/.bin/dd graph map <address> --direction in` | only what points AT this row |
| `node_modules/.bin/dd graph map <address> --rel <rel>` | follow only edges carrying that relation (repeatable) |

`dd links` accepts a document path or a qualified address, but reports edges at
document granularity.

`--rel` has no default on purpose. An absent flag means EVERY relation: a filter
that quietly defaulted to a set would answer a narrower question than the one
asked while looking like a complete map.

## Write documents

The CLI is the writer. Every verb here validates the result against the schema
BEFORE anything reaches disk, and rebuilds the `.dd.md` sibling in the same
operation — so a refusal leaves the document exactly as it was, and a success
can never leave source and sibling out of step.

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd get <address>` | return the value at any address |
| `node_modules/.bin/dd set <address> <value>` | replace the value at an address |
| `node_modules/.bin/dd set <address> <json> --value-json` | replace it with parsed JSON (arrays, objects, numbers) |
| `node_modules/.bin/dd add <address> <json>` | append an item to a list |
| `node_modules/.bin/dd add <address> <json> --mint <prefix>` | append it with a fresh collision-free id |
| `node_modules/.bin/dd rm <address>` | remove the item at an address |

Do not hand-edit a `.dd.json`. Two things go wrong quietly when you do: the
sibling `.dd.md` stops matching its source (which `dd build --check` then reports
as drift you did not knowingly create), and any recorded basis SHA that cites the
document goes stale without anything saying so. Both are repaired by using the
verbs in the first place.

`--mint <prefix>` exists because ids are unique per FILE and born once. Choosing
one by hand means reading every id in the document first, and the failure when
you get it wrong is a validation error at best and a silently duplicated address
at worst.

## Plan and flow surfaces

These act on a whole plan — the overview document plus every task file it links
to — rather than on one document.

| Command | Effect |
| --- | --- |
| `harness plan validate <plan>` | mechanical validation plus the semantic layer |
| `harness plan validate <plan> --complete` | per-row accounting; green means zero errors AND zero warnings |
| `harness plan validate <plan> --address <address>` | scope the semantic checks to one address's reachable closure |
| `harness plan render <plan>` | render the plan and every task file it links to |
| `harness plan pr-body <plan>` | render the closed criteria, with their evidence, as PR markdown |
| `harness plan pr-body <plan> --pin-head` | pin every reference at the origin remote and HEAD commit |
| `harness flow create <type> --plan-dir <dir>` | anchor the template's relative gate addresses at a plan folder |
| `harness flow relocate --to <dir>` | re-point a flow's gate addresses after the plan folder moved |

Without `--complete`, open rows appear as one summary info line rather than a
warning each. That is deliberate: mid-flight, "twelve things are still open" is
the normal state of a plan being worked on, and warning about each one trains a
reader to ignore the warnings. `--address` is the on-demand scoped read, and
`--complete` is the close-out question.

`plan pr-body` REFUSES an unclosed corpus rather than rendering a partial table.
A table that quietly omitted the criteria that were not met would make a
reviewer's approval mean less than the reviewer thought it did.

`--plan-dir` and `--to` both refuse an absolute or `..`-escaping folder instead
of dropping it. A dropped `--plan-dir` is byte-indistinguishable from never
passing one, and the flow it writes fails later at a departure, far from the typo.

## Fences as data

A dispatch fence — the paths a delegated agent may and may not touch — is a
`builder/fence` document rather than a paragraph in a brief.

| Command | Effect |
| --- | --- |
| `harness plan fence <fence>` | check the working tree's changed paths against the fence |
| `harness plan fence <fence> --paths <p...>` | check exactly these paths |
| `harness plan fence <fence> --base <ref>` | check what changed since a ref |

Every row carries `owner`, `cause` and `expiry`, so a rule cannot quietly outlive
its reason and an amendment is a row edit with an author. A refusal names BOTH
the offending path and the row that refused it — a fence that cannot say which
rule applies is an opinion.

`forbid` beats `allow`, always. Written the other way round, adding a broad allow
row later would silently unlock everything an earlier forbid row named. A fence
with no `allow` rows at all is read as a blocklist, not as a total prohibition.

## Reviews as documents

A review round is a `builder/review` document: findings as addressed rows, and a
verdict that links every one of them to what was decided — `confirmed`,
`refuted`, `fixed` or `deferred`, each with its rationale.

There is no verb for this, and there does not need to be one: a review corpus
validates, renders and is queried like any other document.

```bash
node_modules/.bin/dd validate docs/how/dd/exemplar/review/round-1.dd.json
just review-refuted        # which findings were refuted, and on what grounds?
just review-dim0           # what did Dim-0 probe, and what did it cite?
just review-unresolved     # silence means every finding was decided
```

The queries are the reason. "Which findings were refuted?" is worth asking across
rounds and across models — to stop the same finding being re-opened on reasoning
that was already answered, and to see which reviewers find things that turn out
to be real. Prose cannot answer that; rows can.

`kind: dim0` rows record what happened when a reviewer mutated a control ON
PURPOSE, and carry a `pressure` link to the fixture that fired. That is what turns
"the tests would have caught it" from a claim into a citation — and a Dim-0 that
did NOT fire is the most valuable row in the document.

## Gate a flow on the documents

A flow node may carry a `dd_link`, and departure is refused until it reads
green. There are two kinds:

| Shape | Question it asks |
| --- | --- |
| `{"address": "…/tasks.dd.json#tasks"}` | is every row at that address gate-terminal? |
| `{"address": "…/plan.dd.json", "check": "plan-validate"}` | does `plan validate --complete` come back green? |

The completion kind is cheap and belongs on phase nodes. The check kind runs the
semantic validator live and belongs on the last review node. Both quote what they
found verbatim rather than interpreting it, and both record a `--force` override
as a defended decision rather than silently allowing it.

## Read baked guidance

| Command | Effect |
| --- | --- |
| `node_modules/.bin/dd docs list` | list documentation compiled into the CLI |
| `node_modules/.bin/dd docs get dd-overview` | print the built-in overview |
| `node_modules/.bin/dd docs get how-to-add-a-schema` | print the schema and adapter guide |

In human mode, `docs get` prints markdown directly. In JSON mode, the markdown
is returned in `data.content`.

## JSON envelope examples

Validation counts:

```bash
node_modules/.bin/dd validate path/to/document.dd.json --json \
  | jq '{status, counts: .data.counts}'
```

Resolved schema paths:

```bash
node_modules/.bin/dd schema list --json \
  | jq -r '.data.schemas[] | "\(.name)\t\(.path)"'
```

Graph size:

```bash
node_modules/.bin/dd graph --path path/to/corpus --json \
  | jq '.data.counts'
```
