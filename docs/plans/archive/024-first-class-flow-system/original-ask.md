# Original ask — first-class-flow-system
**Captured**: 2026-06-17T21:05:04Z  ·  **By**: /the-flow  ·  **Fork**: `we-are-going` → renamed session `first-class-flows.`

> The flow has the ability to create a little workflow and then track it as we go. It's got a s basically a cursor spine. It's got nodes that we visit, nodes can be blocked, it stores what the user says and what decisions are made, it knows about decision points. So it's like a little DAG. We need to make this a first class concept within the harness. So that way the flow and our workflow system here can use it. Instead of putting all of this code and how to do it in the harness itself in the prompts, we should be doing this as deterministically as possible.
>
> We will have many different flows with two built in, the onboarding flow for the harness and the flow itself for the engineering flow. These will need some kind of first of all general shared workflow schema and also a custom schema for a particular workflow. So for example the actual record types that are stored in the workflows might be different.It will also need to be able to render out the mermaid and markdown like what we have now to check to show progress in human readable form. So there'll be a render command that runs and it will produce the flow markdown rather than inferring that. There can be boolean decisions that might go to sub flows, that are serial. Flows *may* be parallel, but not usually.
>
> Nodes will have properties and can show up as default which will be grey in progress, successful, or blocked. Probably others I'm not sure yet. And that will change their colouring in the main the flow. Nodes will carry the ability to link to harness records and also should be stamped with created and modified date and time. They should also have general properties for the entire flow - like git branch that was on when crated. (Created-from-branch). They will also have custom-metadata fields that can be created at runtime.  Nodes should have unique ids to allow easy manipulation by the Cli. Teh flow needs a cursor.
>
> Cursor changes need to be logged, as well as flow events like created. It's an event log, and it's inside the main json file, not separate. This allows us to track events in the flow, like how long it took to get between flow stages. The cli will expose custom event collection so we can add adhoc events along side the standard ones. We will need a work shop on what are in built events that are not exposed (move cursor), node status change (blocked etc), are there any that are public but manually called by agents or external tooling (like build run hooks??). Then we need custom events that might be defined in the erpo, these do not need custom schema, but they should enable telemetry style event capture - event name, type (string), value (bool, string, date, int etc, auto selected based on field shape, duck types).
>
> "The-flow" will know about how to use this as part of its flow process. If the harness cli is not installed, the-flow should now error out and stop. However, once installed - the target repo does *not* have to be adopted. The flow can just start creating the-flow workflows in docs/plans/<plan-slug>. This means workflows can be stored where you like. There will be a default location in .harness, but you can redirect to a json file anywhere (e.g. it would write to the-flow.json in the plan folder, and generation woudl create the-flow.md.
>
> Flows are created by running harness flow create <patht o schema>. We need to workshop the entire cli for this, all under the harness flow verb.
>
> New flows can be created as well (as in a new flow type - e.g. if the-flow schemas didn't already exist). This will scaffold a new flow type (as opposed to an instance of the flow).
>
> The-flow schemas will travel with the skill.
>
> Harness will have defaults.
>
> It's assumed that users will create more custom flows and store them in their repos, sometimes in .harness, sometimes not.
>
> You will research the flow's system (which we will supplant, so we will work on the-flow itself as part of this work) and also the harness proposed onboarding flow. Later we will add a eng-harness-flow too so that we can track the actual harness loop itself).
>
> The system is very simple and elegant, we are not boiling the ocean. . its a full plan, but limit phases please...

**Follow-up note (during research):**

> note there is a flowstate log etc, docs/plans/021-harness-flow-hooks/.the-flow-state.json... we should fold this in, this is probably our 'event log' concept, and its logging stuff in there. but also thees items may just go on as somments on the actual flow items? each flow node needs the ability to have one or more comments appened (each with their own datetime etc). date time is an importnat theme here we need to know when things were created etc for analysis later.
