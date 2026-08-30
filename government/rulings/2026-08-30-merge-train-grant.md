# Ruling 2026-08-30 — merge-train grant

**Jordan, verbatim**: "Yeah, you don't need to ask me to do that just as long as
you don't auto-pull PRs. Once they're being pulled you rebuild it and make sure
it's all up to date on this machine. Thanks"

**Effect**: prime may push, run CI, and merge FLEET-VERIFIED branches without a
per-branch ask; PRs not produced and verified by this fleet (dependabot, external)
are NEVER auto-merged; after merges land, prime rebuilds the main checkout
(npm ci + just build / local-deploy) so the live harness is current.
