# Official Claude session-storage contract

**Recorded**: 2026-07-21
**Purpose**: Publication-safe primary-source boundary for P063 standard-Claude transcript location.

## Primary sources

- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
- [Claude Code sessions](https://code.claude.com/docs/en/sessions)
- [Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)
- [Agent SDK session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)
- [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

## Documented guarantees

1. `CLAUDE_CONFIG_DIR` selects the Claude configuration root and moves session history; the default root is `~/.claude`, with transcripts under `<config-root>/projects/`.
2. A transcript is stored as `<config-root>/projects/<encoded-project>/<session-id>.jsonl`; the project key derives from the working-directory path by replacing non-alphanumeric characters with `-`.
3. The Agent SDK addresses stored sessions by `(projectKey, sessionId)`. The documentation does not guarantee global session-ID uniqueness across project directories.
4. Resume-by-ID is scoped to the current project and its worktrees. Starting from a mismatched working directory searches the wrong project; changing directory during a session can relocate its project storage.
5. Transcript JSONL is an internal format and may change. Readers must be defensive and fail closed on malformed or unsupported records.

## P063 binding design decision

Jordan selected the smaller lookup boundary: “1 is fine, its rare occurance”.

The locator therefore:

- uses the officially selected standard config root;
- derives only explicit current-project, main-project, common-repository, and known-worktree project keys supplied through read-only ports;
- probes only exact `<session-id>.jsonl` candidates;
- confines every candidate to the selected root, rejects traversal and symlinks, and enforces bounded candidate count and file size;
- inspects path metadata before reading content;
- accepts exactly one safe match;
- returns a typed unavailable/degraded evidence reason for zero matches, multiple matches, unresolved candidate mapping, malformed content, or ambiguity;
- never picks an arbitrary match, falls back to a global scan, or searches every project directory.

The excluded machine-local alternate configuration is neither evidence nor a product special case. Product behavior remains generic to the officially selected config root; P063 validation uses only authorized standard-session evidence.

## Explicit unknown

A global exact-filename scan across every project directory is not a documented lookup contract. P063 does not implement or test that behavior.
