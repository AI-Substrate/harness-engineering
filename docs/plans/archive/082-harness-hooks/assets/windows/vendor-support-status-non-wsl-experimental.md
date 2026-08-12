# Non-WSL Windows is EXPERIMENTAL by the vendor's own label — and that qualifies every claim here

**Sourced 2026-08-10** from git-ai's own README
(<https://github.com/git-ai-project/git-ai>) and docs (<https://usegitai.com/docs>).

---

## The vendor's support statement, verbatim

> **Mac, Linux, Windows (WSL)**
> ```
> curl -sSL https://usegitai.com/install.sh | bash
> ```
>
> **Windows (non-WSL)**
> **Non-WSL Windows support is currently experimental and under active development.**
> We would love to hear your feedback while we work to get non-WSL Windows support
> production-ready.
> ```
> powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://usegitai.com/install.ps1 | iex"
> ```

**The Windows VM used throughout plan 082 is non-WSL Windows.** So every Windows measurement in
this directory was taken against a configuration the vendor labels **experimental and not
production-ready**, on a platform where they are explicitly soliciting feedback.

**This does not excuse the behaviour and it does not invalidate the measurements.** It changes
what they *mean*: the missing `KnownHuman` attestations are most likely a known-incomplete area of
an in-development port, not a silent regression in a shipped feature — and this is precisely the
feedback the vendor is asking for.

It also lines up with the other platform fact measured the same day: **Cursor has no native
Windows sandbox either** — it runs the sandbox inside WSL2. See
[`cursor-sandbox-not-on-native-windows.md`](./cursor-sandbox-not-on-native-windows.md).

> **Two independent vendors, same boundary.** Both git-ai and Cursor treat **WSL2 as the supported
> Windows path** and native Windows as either experimental or unsupported. Any future Windows work
> should decide deliberately which of the two it is testing, and say so — "Windows" is not one
> platform for this feature.

## The documented promise, and exactly where it fails

From [How Git AI Works](https://usegitai.com/docs/get-started/how-git-ai-works):

> *"Checkpoints are diffs between the current state and the previous checkpoint, each marked AI-
> or human-authored. **When you edit the files yourself between agent runs, those lines are
> checkpointed as human-authored, so hand-written and AI-written code stay cleanly separated.**"*

That is the contract, and it is the contract this plan measured:

| platform | `KnownHuman` records | human lines in an agent-run commit |
|---|---|---|
| macOS | **16** | correctly attributed `h_` |
| non-WSL Windows | **0 of 28 checkpoints** | claimed for the agent session |

Same extension (`git-ai.git-ai-vscode-0.1.21-universal`), same version string, both machines.

Note the vendor's own attribution model already has an honest bucket for this case — `git ai
stats --json` reports **`unknown_additions`: "Added lines with no attestation at all (not
attributed to AI or to a known human)"**. The Windows failure is that those lines are **not**
landing in that bucket; they are landing in the agent's.

## A DIAGNOSTIC WE NEVER USED, and should have

From [the Cursor agent guide](https://usegitai.com/docs/agents/cursor):

> **Make sure there are no Cursor Hook Errors.** Go to `Ctrl+Shift+P` and search for
> *"Output: Show Output Channels"*, then select **"Hooks"**. This will show you a log of any
> errors encountered calling the Cursor Hooks. […] If you're not seeing Cursor Hook invocations
> when the agent is working, your `hooks.json` file is likely corrupted or otherwise not being
> read correctly.

**Cursor exposes a hook-invocation error log in the UI.** Plan 082 spent three sessions and ~58
hook invocations establishing "our hook is invoked but records nothing" by building a transparent
stdin wrapper — a question this channel answers directly, from inside the IDE, in seconds.

**Add it to the top of any future hook diagnosis.** It is the vendor's own instrument, it is
free, and it was documented the whole time. *(Same failure as this plan's other recurring lesson:
the record existed and nobody read it before reaching for the machine.)*

## Their Cursor docs are STALE — do not configure from them

The same page states git-ai installs the `beforeSubmitPrompt` and `afterFileEdit` hooks. **The
shipped source rejects both**, `VERIFIED-AT-SOURCE`
(`src/commands/checkpoint_agent/presets/cursor.rs`):

```rust
// Legacy hooks no longer installed; return error so orchestrator skips.
if hook_event_name == "beforeSubmitPrompt" || hook_event_name == "afterFileEdit" {
    return Err(GitAiError::PresetError(
        "Legacy Cursor hook events (beforeSubmitPrompt/afterFileEdit) are no longer supported."
    ));
}
```

The live surface is `preToolUse` / `postToolUse`, which is what the installer actually writes and
what this plan measured. **Read the source, not the agent guide, when configuring hooks.**

## Was anyone else reporting this?

**No public reports of this specific symptom were found** — searches surface git-ai's own docs,
its repository, and competing provenance products, but no forum threads or issues describing
human lines being claimed for an agent on Windows.

Given non-WSL Windows is experimental, a small user population is the likely explanation. **Read
the absence as "few users, not yet reported", never as "does not happen elsewhere"** — an absence
of reports is not evidence of absence, which is the same reasoning error this plan spent a day
avoiding in its own instruments.

## What this changes in the write-up

Nothing is retracted. Every claim in this directory stands as measured. Two qualifiers now travel
with them:

1. **The platform is non-WSL Windows**, which git-ai labels experimental — so "broken on Windows"
   should be stated as **"broken on the platform the vendor has not yet declared
   production-ready"**.
2. **WSL2 is the supported path for both vendors**, and it is untested here. A WSL2 run is the
   obvious next measurement, and it would separate *"non-WSL Windows is incomplete"* from
   *"Windows is broken"* — which are very different findings with very different owners.
