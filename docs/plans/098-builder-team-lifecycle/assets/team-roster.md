# Team roster — Builder lifecycle dogfood

PM: `pij-cooperative-gibbon`; allocation and plan: `098-builder-team-lifecycle`.

## Planned topology

| Role | Model | Effort | Worktree | State | Owner |
|---|---|---|---|---|---|
| PM | existing user-selected session | existing | s098-builder-team-lifecycle | active | user-appointed |
| Plan/contract reviewer | github-copilot/claude-opus-5 | high | s098-review (full local clone) | pij-natural-gant; clone-root/nonce/argv canary passed; review not released | PM |
| Guide/readiness coder | github-copilot/gpt-6-astra | runtime default unless explicitly ruled | full local clone after contract baseline | not dispatched | PM |
| Workspace lifecycle coder | github-copilot/gpt-6-astra | runtime default unless explicitly ruled | full local clone after allocator ratification and contract baseline | blocked on ratification, not dispatched | PM |
| Runtime/dispatch coder | github-copilot/gpt-6-astra | runtime default unless explicitly ruled | full local clone after contract baseline | not dispatched | PM |
| Evidence/lifecycle coder | github-copilot/gpt-6-astra | runtime default unless explicitly ruled | full local clone after contract baseline | not dispatched | PM |
| Builder/skill assets coder | github-copilot/gpt-6-astra | runtime default unless explicitly ruled | full local clone after contract baseline | not dispatched | PM |

A row marked planned is an allocation intent, not evidence that a peer exists; append the actual spawn identity, observed runtime/canary receipt, packet basis and termination evidence before changing its state.

## Controls

- Coders are spawned from their own trees; no shared-tree edits or overlapping ownership.
- Plan review is against explicit document hashes; later code reviews use a committed composed SHA in an isolated review checkout.
- Only the PM integrates; prime governs final landing; no coder/reviewer merges into main.
- Reusable reviewer/coder completion triggers early compaction, not unauthorized closure of other seats.
- Every packet enumerates forbidden flow/government/other-worktree paths and uses C10 pointer delivery.

## OMP isolation decision

The first native OMP launch was refused before any peer was created because pij-rs rejects a Git directory containing a `worktrees` path component; prime verified this is not an actual extension collision in this repository and filed the defect upstream.

For this manual dogfood run, use a full local clone per peer (`git clone --no-hardlinks` from the PM branch), launch from that clone and canary-verify the native tool root and message round-trip before work; do not push the branch remotely merely to provision peers, rewrite `.git`, or spawn on shared main and rely on shell `cd`.

## Observed canary

- Registered reviewer: `pij-natural-gant`; parent `pij-cooperative-gibbon`; pane `%3498`; spawn `s-2948d69293902dfe10431d9ddef6bd50`.
- The relative clone-only sentinel read and shell `pwd` agreed; the PM matched the returned nonce. A message round-trip completed, with the response forwarded through the read-only scout.
- Running argv and registry carried `github-copilot/claude-opus-5` and `high`. Provider-served model identity and material effort remain unverified; these are launch/runtime-configuration observations, not a stronger backend attestation.
- No code, review packet or tests have been released to this peer. Future work acknowledgement must bind its own immutable packet/baseline and fresh nonce.
