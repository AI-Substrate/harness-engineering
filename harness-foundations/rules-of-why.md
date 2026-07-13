# The Rules of Why

The other foundation documents say what an engineering harness is and how to operate one. This one says why it exists at all — the posture behind everything else. If a rule elsewhere ever seems arbitrary, it should trace back to something on this page.

## Rule 1. Don't apologise — fix

When an agent hits friction, the default behaviour is to say sorry and work around it. The apology costs tokens; the workaround costs everyone who comes next. The harness posture is the opposite: the environment is a legitimate target for work. When something in the environment made the work harder, slower, or less certain than it should have been, that is not an embarrassment to route around — it is the next unit of work, or at minimum a captured observation.

The workaround solves it for you, once. The fix solves it for everyone, forever.

## Rule 2. "Us" means agents and humans together

The environment is not the human's property that agents borrow. Agents are real users of the engineering surface — often the majority user, and the one that exposes UX failures fastest because it inherits no tribal knowledge. "Is the environment working for us?" means working for the humans on the team, the agents in this session, every future agent session, and the next teammate who clones the repo. A fix that helps only one of those is half a fix.

## Rule 3. Every run produces two things: the work, and evidence about the environment

Agents are trained to stay on target — blinkers on, neurotically seeking "done" for the stated task. That focus is necessary and must not be broken: the task is why the session exists, and nothing here dilutes it. But every task also runs *through* the environment, and the run itself generates evidence about how well that environment serves the work. The standing second objective — never displacing the first — is to notice what the run revealed and pay it forward. The work delivers its value once; the environment shapes the value of every run after it. Both matter; neither is the other's exercise.

## Rule 4. Every difficulty is a gift — if it is encoded

A silent crash, a misleading error, an undocumented build step: hit once, these are frictions. Catalogued, encoded as something executable, and verified, they are gifts to every future session. The test of capture is not "did we write it down?" but "can the next run benefit without reading anything?" A lesson is not captured until it is encoded; a wiki note is weaker than a command, check, fixture, default, or error message that does the thing.

This is what produced the measured curve: the same class of change going from 16 hours to 15 minutes over five iterations, with the difference living entirely in the harness and the knowledge it carried forward.

## Rule 5. Small things compound at team scale

A friction that wastes three turns feels too small to fix. Multiply it: every developer, every agent session, every day, many times a day. Teams pay tokens — real money — to rediscover the same facts, then throw the learning away at the end of every session. The economics of the harness are the economics of compounding: small fixes accrue the way small frictions do, and the break-even on encoding a fix is usually a handful of future runs. Nothing is beneath encoding if it recurs.

## Rule 6. Tokens are a friction like any other

Token waste is environment friction and belongs in the same loop as flaky steps and misleading errors. Doctrine restated in three places, a CLI that echoes the same envelope four times, a premium model doing work a cheap one could do — each is a recurring cost every session pays. A magic wand that saves a bunch of tokens is a first-class magic wand. And shift proof left out of inference into deterministic code wherever possible: you would not write a unit test as markdown and ask the agent to "run the md" — so don't leave to inference what a check could prove for free.

## Rule 7. Backpressure must have somewhere to live

When a human corrects an agent — "that's not done", "the architecture is wrong" — that correction is the most valuable artefact of the session, and by default it evaporates with the chat. The harness exists to be the obvious, standardised home for it: encode the correction as a sensor, and every teammate and every future session inherits it automatically. Fixed once, caught forever. When the sensor itself is wrong, there is no debate about where the fix goes — you fix the checker first, then the code.

## Rule 8. Discriminate — this is not a mandate for neurosis

Not every stumble is an environment defect. An honest mistake, a one-off, a cost of doing novel work — these are noise, and treating them as MUST-FIX-ALL-THE-THINGS is its own failure mode: it burns tokens, derails the task, and buries the real signals. The discrimination test: would a reasonable next person or agent hit this same thing? If yes, it is harness feedback — capture it, and fix it when the fix is small or the recurrence is costly. If no, let it go. Capture is cheap; encoding is a judgement call; neurosis is never the goal.

## Rule 9. Improvement is offered, never imposed

The loop never gates, scores, or blocks. Humans decide what gets encoded, deferred, or declined — and declining leaves a trace so recurrence stays visible, but it is always a legitimate answer. A harness that nags is a harness that gets bypassed; the paved path wins by being easier, not mandatory.

---

**The one-line version:** we are all — humans and agents — temporary occupants of an environment that outlives every session; don't apologise for its rough edges, fix them, encode the fix, and hand the next occupant a better place to work than the one you found.
