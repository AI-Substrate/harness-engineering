# Original ask — collector-install-host-pin (#124)

**Captured**: 2026-08-08 · **By**: `pij-respectable-clam` (PM, and author of plan 073)
**Issue**: https://github.com/AI-Substrate/harness-engineering/issues/124

## The defect

`harness doctor --install-collector` **cannot succeed, on any platform.** The only install path
plan 073 shipped has never worked.

`pin.ts:22` declares `release_host: 'github.com'`, and the downloader refuses any redirect that
leaves the pinned host. **GitHub always redirects release-asset downloads to a CDN host.** So the
guard fires on the happy path and the download never starts:

```
E130 — the pinned git-ai CLI was not installed (failed) — redirect:
  .../releases/download/v1.6.21/git-ai-windows-x64.exe redirected to
  https://release-assets.githubusercontent.com/... (host release-assets.githubusercontent.com),
  off the pinned host github.com
next_action: "Nothing was placed on disk."
```

## How it was found, and how it was verified

Found by the #108 consumer while trying to answer a *different* question (plan 075's named-pipe
premise). They reported it as a raw finding, proposed no fix, and flagged their own limits.

Verified independently, at three levels, before any of it was believed:

| check | result |
|---|---|
| `curl -sI` the **Linux** asset, from macOS | `302 → release-assets.githubusercontent.com` |
| prime's **control** — `cli/cli` v2.62.0, an unrelated repo | `302 → release-assets.githubusercontent.com` |
| `rg githubusercontent harness/cli/src` | no allowlist anywhere |
| all six manifest assets at v1.6.21 | all `302` — the manifest is accurate |

The control is what settles the fix. Redirecting release assets off `github.com` is **universal
GitHub behaviour**, not specific to this asset or recent to this repo. The CDN *hostname* changed
recently; the *redirect* did not. **A `github.com` host pin could never have matched.**

## Why the suite is green

`download.test.ts:114` — *"a redirect off the pinned host is refused BEFORE the digest is
consulted"* — fakes a redirect to `cdn.example.com`, a host that **should** be refused.

So the test proves the guard **fires when it should**. Nothing anywhere proves it **does not fire
when it should not**, because no fake ever reproduced GitHub's actual redirect. The port is
injected; the one behaviour that matters was never in the fake.

This is the fifth instance this week of a control that passes by examining nothing — and **the
first to reach a shipped path** rather than being caught in review. The consumer's framing is the
right one: it is the same half-injected-seam shape as their B2 (`collector-adapters`: platform
faked, filesystem real), which makes it a **pattern**, not a set of individual test bugs.

## The quiet symptom nobody read

Every in-sandbox doctor run recorded during plan 074 reported:

> `gitai-collector: could-not-determine — a git-ai binary exists at ~/.git-ai/bin/git-ai but
> harness has no record of installing it`

I recorded that repeatedly and read it as an ordering quirk. It was the symptom. Any machine with
git-ai on it got it some other way.

## Prime's ruling on the fix

**Drop the host pin. Rely on the pinned SHA-256** — that is the property actually providing
integrity. Allowlisting the current CDN host buys a fix that breaks the next time GitHub renames
that host, which it has just done. *A host allowlist that cannot be satisfied on the happy path is
not defence-in-depth, it is an outage.*

## Blast radius — measured by prime, three live sites

| site | role |
|---|---|
| `collector/pin.ts:22` | declaration |
| `collector/regenerate.ts:123` | writes it into the generated manifest |
| `collector/install.ts:467` | **the only reader** (`expectHost: manifest.release_host`) |

Everything else `rg` returns is `.git/ai/working_logs/**` — git-ai's own log blobs, not source.
They inflate the count sevenfold and none is a site.

**And the finding attached to it: no test anywhere asserts `release_host`.** Not its presence in
the generated manifest, not its value, not that `regenerate` emits it. Convenient — dropping it
breaks no golden fixture — and also *the reason it could ship in a state that never worked*.

## Scope fence

Worktree `s078-collector-install-pin`, branch `s078/collector-install-pin`, cut at `44308756`.

Ordered **behind** 077's handoff by prime, on the grounds of not breaking a live stream — 077 is
now waiting on the consumer's re-run with both workers closed, so nothing is live to break.

## Not in scope

- The plan-075 named-pipe premise. Still unanswered, and now behind a **side-load**: prime
  approved the consumer downloading, verifying the published SHA-256 themselves, and placing the
  binary by hand. Two conditions — they state the digest they verified against and it goes on
  #124, and it is a **one-off**, not a documented workaround. This plan fixes the path; nothing
  about the bypass becomes a pattern.
- The wider half-injected-seam pattern across the suite. Named here, tracked on #124.
