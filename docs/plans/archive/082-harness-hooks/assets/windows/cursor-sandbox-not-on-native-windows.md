# Cursor's sandbox is not available on native Windows — and what that means for the relay

**Measured and sourced 2026-08-10.** Prompted by an operator observation: the Cursor Command
Mode dropdown offers **"Allowlist (with Sandbox)"** on macOS but only **"Allowlist"** on the
Windows VM.

---

## The vendor's own statement

From Cursor's engineering blog, [Implementing a secure sandbox for local
agents](https://cursor.com/blog/agent-sandboxing) (2026-02-18), verbatim:

> **On Windows, we run our Linux sandbox inside WSL2.** Building an equivalent native Windows
> sandbox is significantly harder because most existing sandboxing primitives are tailored to
> browsers and do not support general-purpose developer tools. **We're working with Microsoft** to
> ensure the necessary primitives become available.

Platform table, from the same source and the run-modes docs:

| platform | sandbox mechanism | availability |
|---|---|---|
| **macOS** | Seatbelt | supported directly |
| **Linux** | Landlock v3, kernel 6.2+, unprivileged user namespaces | supported **if** the kernel prerequisites hold; otherwise Cursor falls back to **asking for approval** rather than running unattended |
| **Windows** | the Linux sandbox **inside WSL2** | **no native Windows sandbox exists** |

So the UI difference is correct behaviour, not a misconfiguration: a Cursor running natively on
Windows — not through WSL2 — **has no sandbox to offer**, and the dropdown says so honestly.

This also explains the `harness doctor` row on that box:

> `cursor-sandbox — cannot-tell: Cursor's terminal allowlist could not be read
> (…/.cursor/permissions.json does not exist), so whether git and harness run outside the sandbox
> is UNKNOWN`

`permissions.json` was absent because the allowlist-with-sandbox mode was never available to
configure.

## WHY THIS MATTERS TO US — the relay's premise does not hold on native Windows

**The relay exists to re-raise trace2 events that a sandbox blocked.** That is its entire reason
for being: an agent command sandbox blocks git's `af_unix` socket write, git silently disables
trace2, and the commit lands with no authorship record.

**On native Windows there is no sandbox, so nothing is blocked.** git's own trace2 events reach
the daemon every time, through the named pipe, unimpeded.

That retro-explains three results we measured and could not fully account for:

| observation | explanation |
|---|---|
| git-ai produced a note in **every** Windows run, including ones where our relay stayed silent | git's own trace2 always got through |
| removing the `index-was-not-clean` guard changed attribution **not at all** | our events were redundant with git's own |
| the "sandbox off" run was identical to the "sandbox on" run | **there was never a sandbox in either** |

### The honest consequence

**Our relay has never been exercised on Windows.** Every Windows measurement in this plan is the
**pass-through** case — the relay emitting alongside a git stream that was already arriving. We
have shown the relay *connects to a live daemon and reports honestly* (kill the daemon: pipe
vanishes, `ENOENT`, `failed: absent`; restart: `CONNECTED`, `emitted`). We have **not** shown it
rescuing a commit that would otherwise have been lost, because on that machine no commit was ever
at risk.

**This is not a defect.** It is a scope fact that must travel with any Windows claim: *the relay
is correct and connected on Windows; its rescue path is untested there because the condition it
rescues from does not occur on native Windows.*

To exercise it, you would need Cursor running **through WSL2** (where the Linux sandbox applies),
or an artificially blocked ingress.

## WHAT THIS DOES NOT EXPLAIN — do not conflate the two Windows gaps

**It does not explain the missing `KnownHuman` attestations.** Sandboxing governs *command
execution*; `KnownHuman` records come from something watching **editor typing** — the records
carry `agent_id: null` and `agent_metadata: null`, so they are produced outside the agent hook
path entirely.

| gap | domain | status |
|---|---|---|
| no sandbox on native Windows | command execution isolation | **explained** — vendor-documented, WSL2-only |
| `KnownHuman` never recorded (0 of 28, same extension version that produces 16 on macOS) | editor-side human attestation | **unexplained** |

Two holes on one platform, in two different subsystems. **There is no evidence they share a
cause**, and treating the sandbox finding as an explanation for the attestation gap would be a
fifth wrong-source claim in one day.

## Bearing on the harness's own documentation

`gitai-06-two-channel-model.md` records the two escapes from the sandbox failure mode and rules
that **`harness commit` + buffer/nudge is the product** while the allowlist is *"diagnostic
context only"* — partly because *"agents write `&&`-chained commands by default"* and an
allowlist survives only a lone allowlisted command.

That ruling is unaffected. But the platform picture underneath it should be stated plainly:

- **macOS** — the sandbox is real and is the condition the relay exists for.
- **Linux** — the sandbox is real *when kernel prerequisites hold*; otherwise Cursor prompts
  instead of running unattended, which is a different failure shape again.
- **Native Windows** — there is no sandbox, so the relay's rescue path is dormant. What is
  broken there is attribution *semantics*, not delivery.

## Sources

- <https://cursor.com/blog/agent-sandboxing> — the platform implementations, verbatim above
- <https://cursor.com/changelog/1-7> — sandboxed terminals ship; the agent uses PowerShell on Windows
- <https://cursor.com/changelog/2-5> — sandbox network access controls
- <https://cursor.com/docs/agent/tools/terminal> — sandboxed commands run in a restricted
  environment; points at run-modes for platform requirements
