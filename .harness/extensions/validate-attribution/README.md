# `harness validate-attribution`

**What it answers:** does **git-ai's attribution capture survive a sandboxed agent**? When your
agent makes a commit from inside its sandbox, does a `refs/notes/ai` note appear that correctly
attributes the lines *it* wrote to *it*, and yours to you?

**What it is not:** a test of "our hook". Our relay is one component, alongside git-ai's own
checkpoint channel and your agent's hook configuration. **A run in which our relay works perfectly
and no note appears is a FAILURE of the thing being validated** — so this verb scores the outcome,
not our part in it.

**It never acts.** It reads, reports and refuses. It will not remove a relay from your config,
change a sandbox setting, or "fix" your machine to make a run scoreable. When it cannot certify a
run it tells you why and names what it found. **What to remove is your decision, not this tool's.**

---

## Read these first — this verb implements them, it does not replace them

| document | what it is for |
|---|---|
| [`docs/how/telemetry/validating-telemetry-capture-in-sandboxed-agents.md`](../../../docs/how/telemetry/validating-telemetry-capture-in-sandboxed-agents.md) | **The WHY.** Agent-neutral. What is being measured, why the sandbox matters, what makes a run valid. Read this if you only read one. |
| [`docs/how/telemetry/cursor-validation-kit/README.md`](../../../docs/how/telemetry/cursor-validation-kit/README.md) | **The RUNBOOK.** The recorded artifacts of the first real run — seed scripts, prompts, and what each step actually produced. |
| [`docs/how/telemetry/gitai-06-two-channel-model.md`](../../../docs/how/telemetry/gitai-06-two-channel-model.md) | **The MECHANISM.** The two channels, and why a blocked socket is total loss rather than misattribution. |
| [`docs/how/telemetry/README.md`](../../../docs/how/telemetry/README.md) | **The read-order block.** Start here if you are new; three separate investigations re-derived the same facts by poking at the machine first. |

**The one distinction to carry into everything below.** There are **two channels**, and confusing
them will invert your conclusion:

- **Channel 1 — checkpoint.** `git-ai checkpoint <agent>` records *what the agent wrote*. It is
  **required** for attribution and **cannot produce a note by itself**. Having it does not spoil a
  run; removing it breaks the thing you are testing.
- **Channel 2 — commit signal.** Anything that tells the daemon *a commit happened*. Our hook is
  one. A proof-of-concept relay is another. **Two of these spoil a run**, because either one could
  have caused the note and nothing in the note says which.

---

## Setting up the agent environment

### Cursor, concretely

1. **Install the hook.** `harness hooks install` writes an entry into `~/.cursor/hooks.json`.
   Confirm with `harness hooks status --json`: your agent should read `binaryState: "resolves"`
   and `commandState: "accepted"`. *(Both. `resolves` alone only means the file exists.)*
2. **Snapshot your config before you touch anything else**, and know how to put it back:
   ```bash
   mkdir -p /tmp/cursor-config-snapshot && cp ~/.cursor/*.json /tmp/cursor-config-snapshot/
   ```
3. **The sandbox must be ON.** That is the entire point — an unsandboxed shell reaches the daemon
   by itself and the run proves nothing. In Cursor this is `~/.cursor/sandbox.json`; the config
   reference is [`sandbox-04-config-reference.md`](../../../docs/how/telemetry/sandbox-04-config-reference.md).
   `~/Library/Application Support/Cursor/User/settings.json` contains **none** of it — two people
   have lost time there.
4. **Restart the agent after any config change.** A config file is not the running configuration.
   This is not pedantry: a relay was removed from a config mid-session and went on firing for the
   next run because the agent had already loaded the old file.

### Another agent

Nothing above is Cursor-specific except *where the files live*. For any other agent you need:

- **a hook surface** that runs a command around tool use (`harness hooks list --json` shows which
  agents this harness supports and which it detects on your machine);
- **a sandbox you can turn on**, and knowledge of what it denies — the probe in step 1 below is how
  you find out, and `refused` on both sockets is the condition you need;
- **the same restart discipline.**

If your agent's shell is *not* sandboxed, this verb will tell you the run was INCONCLUSIVE rather
than pretend otherwise.

---

## Where you must run it from

**Run it from the root of a repo that has `.harness/extensions/`, and point `--repo` at the
repository under test.** Extensions are discovered only in `<cwd>/.harness/extensions/`, and that
directory is **not searched upward**. Running from anywhere else gives you:

```text
E149  No extensions are loadable from /private/tmp/whatever …
```

So this, not the other way round:

```bash
cd /path/to/harness-engineering            # a repo whose .harness/extensions/ has this verb
harness validate-attribution --begin --repo ~/temp/my-probe-repo
```

This is a known limitation of shipping the verb as an extension, and it is met in practice within
about a minute of trying. It is recorded in the phase-4 close along with the question it raises —
whether a verb that validates a **machine** property belongs in the core surface instead.

## Your part, step by step

### 1. `harness validate-attribution --begin`

```bash
harness validate-attribution --begin --repo ~/temp/my-probe-repo
```

It gives you:

- **a relay census** — every hook entry on your machine, classified and *named*. If more than one
  could send a commit signal, it says so **now**, before you spend your time on a run that could
  not have been scored.
- **a baseline** — the journal cursor, the current `HEAD`, and the **mtime of the harness binary**
  your hook points at, so a rebuild during the run is detected rather than silently measured.
- **the probe** — `.harness-attribution-probe.py`, written into your repo.
- **the prompt** — in `data.prompt`. Paste it into your agent.

### 2. Paste the prompt into your agent

It instructs the agent to do three things: run the probe **in its own shell**, make and commit a
small change, and write down **which lines it personally wrote**.

**What you must NOT do — and must tell the agent not to do:**

- do not run or configure **git-ai, harness, telemetry or notes** commands. *A collector is being
  observed and touching it invalidates the run.*
- do not set or unset environment variables.
- do not **"fix" anything that looks broken**. A refusal *is* the measurement. Report it verbatim.
- do not rebuild the harness — see the mtime check above.

**What to bring back:** the probe output (the agent leaves it in
`.harness-attribution-probe.out`), the ground truth (`.harness-attribution-truth.json`), and the
commit itself. Write the ground truth down **before** reading any note — deciding afterwards which
lines "were really the agent's" is how a wrong result gets read as a right one.

### 3. `harness validate-attribution --end`

```bash
harness validate-attribution --end --repo ~/temp/my-probe-repo
```

It reads the journal delta, the probe output, and the note (`refs/notes/ai` — always that ref;
`--ref=git-ai` prints nothing, and "no note" is the total-loss signature, so the wrong ref invents
a false negative). Then it scores.

---

## What each verdict means for you

| verdict | exit | what it means | what to do |
|---|---|---|---|
| **PASS** | 0 | The shell was sandboxed, exactly one relay could signal the commit, it emitted, and the note landed with the identity you declared. **Capture survived.** | Record it. It proves this for **this agent on this machine** — it does not generalise to another agent's sandbox. |
| **FAIL** | 1 | The run was a valid experiment and capture did **not** survive. | Read `because`. `emitted + no note` is the most informative failure — run `git-ai await`, re-read, and if still absent keep everything exactly as it is. |
| **INCONCLUSIVE** | 0 | **The run was fine. The experiment was not.** A competing relay, an unmeasured or open sandbox, a rebuilt binary. | Fix the *experiment* and re-run. This is the normal outcome of a careful first attempt, and it is not a failure of your machine. |

**INCONCLUSIVE is the verdict this verb exists for.** A tool that can only say PASS or FAIL will
report a confounded run as a PASS — which is exactly what nearly happened on the run that produced
this extension.

### Acknowledging an entry you know is harmless

The census cannot know what a third party's script does by reading its command line, so anything it
does not recognise is treated as a **possible** commit signal. If you know better, say so
explicitly:

```bash
harness validate-attribution --begin --acknowledge hook-probe.py
```

The acknowledgement is **recorded in the evidence** and appears in the verdict. The tool refuses to
guess; you declare; the declaration is part of the record rather than an assumption inside it.

---

## What this verb cannot do

State these to yourself before quoting a result.

- **It cannot see a broken runtime.** It checks that the installed command's *options* are ones the
  binary declares (`harness hooks status`'s `commandState`); it does not prove the binary works, or
  that `node` is healthy, or that the daemon is behaving.
- **It cannot prove your agent invoked the hook.** It can only observe that our journal recorded a
  fire. An empty journal is reported as "our hook never ran", which is a symptom with several
  causes.
- **It scores one commit.** Attribution is known to be trustworthy at *commit granularity* and to
  over-count AI on a **mixed human+AI commit** — see the runbook's §4. This verb does not change
  that and does not test it.
- **INCONCLUSIVE means the run was fine and the experiment was not.** It is never a statement about
  your machine's health.
- **A PASS is one agent, one machine, one commit.** It is evidence, not a guarantee, and it does not
  transfer to a different agent's sandbox without re-running.

---

## For maintainers

`scoring.ts` is **pure** — no I/O, no imports — and holds every verdict rule. `extension.ts` is the
I/O shell that turns a machine into an `Evidence` object. That split exists so the two real control
runs can be replayed from recorded evidence in `scoring.test.ts`:

| control | verdict | why |
|---|---|---|
| **run 9** (`1cbdf0de`) | INCONCLUSIVE | two channel-2 relays; either could have caused the note |
| **run 10** (`5ac3eaa`) | PASS | one channel-2 relay, sandbox engaged, we emitted, note identity matched |

They differ in **exactly one material variable**, which is what makes them a control pair rather
than two runs that happened to disagree. `RUN_10_WITHOUT_PROBE` pins the precondition gate: strip
run 10's shell-side probe and its PASS falls to INCONCLUSIVE.

**Why that gate exists.** Run 10's PASS was provisional for twenty minutes because the sandbox
condition was measured **once**, in run 9, and carried forward. Not a wrong measurement — an
un-repeated one. `--begin` obtains the probe for **this** run and refuses without it. The rule has
a real incident behind it rather than a principle.
