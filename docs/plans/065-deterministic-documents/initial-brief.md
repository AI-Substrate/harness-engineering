Harness Spine 

okay, what i'm looking at is some deep changes to teh flow spine. i twill be come fully
  dtermintiic. At the moment we have chores and htings. and a rough signposting to plans etc.



Every node can have 1-n acceptance criteria. These are from a linked section in a “DD”.
Node in flow will hav a link to a document file name in the plan folder or below, and link the section name which should be of type completable-list (or what ever name we end up calling them). 
You can imagine the-flow, phase 2 dd-link: {file: some-plan-file.dd.json, section: <stable section name that is always that same for all sections in any file that is named phase 2 in files like this>. 
The section links are not GUIDs etc, they should be stable names that work due to semantics / convention. 
Each criteria can be ticked off. Each will have an evidence field on why teh agent believes these can be checked off. 
These will link by id to the ac in plans.  

Plans are to be partially deterministically produced. 
Harness to have a first class plan verb (which uses “dd” under the hood). This will be exemplar for dd usage. 
Plans are JSON data. 
Plans rendered to MD
We add plan sections
Some are free text 
Some are tables with various things
We need to review / workshop what primitives we need
Plans are a new type of feature in harness called a “deterministic-document” see below. 
The harness has first class flow and nav spine stuff in it - this must support these concepts to help agents 
If they try to nav and a dd is not passing then it must warn
Harness first class dd will have a dd doctor command that scans entire repo and checks them all, will be called in “checks” by default always.
Harness nav should wail if you try to move from a node that has a checkable list on it and all items are not complete (just like with chores).  

## Backpressure

Back pressure to be moved to a deterministic document
The AC in the plan will have a column of type back-pressure-evidence 

## Deterministic Documents

New harness verb tree “dd” (deterministic-document)
Schema created per doc type
Dd validate, will give helpful and actionable feedback 
Needs a bunch of “section primitives”
See plan thing above 
e.g. 
list, 
completable-list (items can be checked off)
Completable table can be of table format, so can have a few fields
Each element with have a unique id (not a stable id like sections) 
Table columns can have types (string, int, bool (e.g. complete), and link “of type this other dd type, this section” see next
DD Link types
Table columns can be of type link
Imagine you have a back pressure dd, and it has a table in it that has x,y,z cols
That table will have many rows, each with ids
In my tale in another document, for example the plan doc in AC table I might have a column the links to the back pressure doc, evidence table, row <guid>
When render this will show as a link and maybe some kind of UI overview / summary
Then I can link to the backpressure evidence that I will be using for my current AC. 
Each section in a plan will get a unique id as will each element so we can link between them. 
Consider the flow Acs, in the flow spine, these acs are linked to the plan and updating in one place will update in the other
Ids are unique per file base don section type and name - e.g. phase 2 of type “plan-phase” will always have the same id in any plan file that its in. - so they are stable by convention. 
Ever edit to .dd.json will generate its .dd.md file next to it. 
.dd.json files will contain their schema
Every .dd edit updates their data and time edited as well as Sha generated from non-front matter sections. 
Dds can link to other dds both inline as well as include segments for other dds. 
As can others concepts like the-flow spine including segments from dd for ac tracking
These links can be relative and go up folders to other areas in same repo. 
We may want to extract DD concept from harness later to standalone project, so make sure the architecture is good, injected etc, no hard deps, composed etc. 
